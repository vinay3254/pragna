import json
from fastapi import APIRouter, Request, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from app import repository
from app.chat_service import resume_tool_reply
from app.auth import get_current_user, get_optional_current_user

router = APIRouter()


class ResumeToolRequest(BaseModel):
    tool_call_id: int
    approved: bool
    conversation_id: Optional[int] = None


class SearchRequest(BaseModel):
    query: str


class RagSearchRequest(BaseModel):
    query: str
    document_ids: Optional[list[int]] = None
    top_k: int = 5


@router.post("/api/tools/rag_search")
async def rag_search(request: Request, body: RagSearchRequest):
    from app.rag import retrieve
    settings = request.app.state.settings
    collection = request.app.state.collection
    where = {"document_id": {"$in": body.document_ids}} if body.document_ids else None
    results = await retrieve(
        body.query,
        collection,
        settings.embed_model,
        settings.ollama_url,
        top_k=body.top_k,
        where=where,
    )
    return {"success": True, "results": results}


@router.post("/api/tools/search")
async def tool_search(body: SearchRequest):
    from app.tools import perform_web_search
    return await perform_web_search(body.query)


@router.post("/api/conversations/{conversation_id}/resume-tool")
@router.post("/api/tools/resume")
async def resume_tool(
    request: Request,
    body: ResumeToolRequest,
    conversation_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
):
    conn = request.app.state.conn
    cid = conversation_id or body.conversation_id
    if cid is None:
        # Resolve conversation_id from tool_call if not provided directly
        tool_call = repository.get_tool_call(conn, body.tool_call_id)
        if not tool_call:
            raise HTTPException(status_code=404, detail="Tool call not found")
        msg = repository.get_message(conn, tool_call["message_id"])
        cid = msg["conversation_id"] if msg else None

    if cid is None:
        raise HTTPException(status_code=400, detail="conversation_id is required")

    conversation = repository.get_conversation(conn, cid)
    if not conversation or conversation["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")

    tool_call = repository.get_tool_call(conn, body.tool_call_id)

    if not tool_call:
        raise HTTPException(status_code=409, detail="Tool call not found")

    if tool_call["status"] != "pending":
        raise HTTPException(status_code=409, detail="Tool call is not pending approval")

    state = request.app.state
    memories_collection = getattr(state, "memories_collection", None)
    browser_service = getattr(state, "browser_service", None)

    async def event_stream():
        async for event in resume_tool_reply(
            state.conn, state.collection, body.tool_call_id, body.approved, state.settings,
            user_id=current_user["id"],
            memories_collection=memories_collection,
            browser_service=browser_service,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/api/kanban")
@router.get("/api/tools/kanban")
async def get_kanban_tasks(request: Request, current_user: dict = Depends(get_current_user)):
    from app import kanban_service
    tasks = kanban_service.list_tasks(request.app.state.conn)
    return {"tasks": tasks}


class KanbanTaskRequest(BaseModel):
    action: str
    task_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    conversation_id: Optional[str] = None


@router.post("/api/kanban")
@router.post("/api/tools/kanban")
async def post_kanban_task(
    request: Request, body: KanbanTaskRequest, current_user: dict = Depends(get_current_user)
):
    from app import kanban_service
    conn = request.app.state.conn
    if body.action == "create":
        if not body.title:
            raise HTTPException(status_code=400, detail="title is required to create a task")
        return kanban_service.create_task(
            conn,
            body.title,
            body.description or "",
            body.status or "todo",
            body.priority or "medium",
            conversation_id=body.conversation_id,
        )
    if body.action == "update":
        if not body.task_id:
            raise HTTPException(status_code=400, detail="task_id is required to update a task")
        return kanban_service.update_task(
            conn, body.task_id, status=body.status, title=body.title, description=body.description
        )
    if body.action == "delete":
        if not body.task_id:
            raise HTTPException(status_code=400, detail="task_id is required to delete a task")
        return kanban_service.delete_task(conn, body.task_id)
    raise HTTPException(status_code=400, detail=f"Unknown action '{body.action}'")


@router.get("/api/scheduled-tasks")
@router.get("/api/tools/scheduled")
async def get_scheduled_tasks(request: Request, current_user: dict = Depends(get_optional_current_user)):
    from app import cron_service
    jobs = cron_service.list_scheduled_tasks(request.app.state.conn, user_id=current_user["id"])
    return {"jobs": jobs}


class ScheduledTaskRequest(BaseModel):
    action: str
    title: Optional[str] = None
    prompt: Optional[str] = None
    schedule: Optional[str] = None
    job_id: Optional[int] = None
    conversation_id: Optional[str] = None


class SchedulePreviewRequest(BaseModel):
    text: str
    timezone: Optional[str] = None


@router.post("/api/tools/scheduled/preview")
async def preview_schedule(body: SchedulePreviewRequest, current_user: dict = Depends(get_optional_current_user)):
    """Parse a natural-language schedule so the UI can show "Next run" before saving."""
    from app import cron_service
    parsed = cron_service.parse_schedule_text(body.text, body.timezone)
    if not parsed:
        return {"found": False}
    return {"found": True, **parsed}


@router.post("/api/scheduled-tasks")
@router.post("/api/tools/scheduled")
async def post_scheduled_task(
    request: Request, body: ScheduledTaskRequest, current_user: dict = Depends(get_optional_current_user)
):
    from app import cron_service
    conn = request.app.state.conn
    if body.action == "create":
        if not body.prompt or not body.schedule:
            raise HTTPException(status_code=400, detail="prompt and schedule are required")
        return cron_service.schedule_task(
            conn, body.prompt, body.schedule, conversation_id=body.conversation_id, title=body.title,
            user_id=current_user["id"],
        )
    if body.action in ("delete", "cancel"):
        if not body.job_id:
            raise HTTPException(status_code=400, detail="job_id is required")
        return cron_service.cancel_scheduled_task(conn, body.job_id, user_id=current_user["id"])
    if body.action == "toggle":
        if not body.job_id:
            raise HTTPException(status_code=400, detail="job_id is required")
        return cron_service.toggle_scheduled_task(conn, body.job_id, user_id=current_user["id"])
    if body.action == "run":
        if not body.job_id:
            raise HTTPException(status_code=400, detail="job_id is required")
        return await cron_service.run_scheduled_task_now(conn, body.job_id, user_id=current_user["id"])
    raise HTTPException(status_code=400, detail=f"Unknown action '{body.action}'")


class CreateSkillRequest(BaseModel):
    name: str
    description: str
    instructions: str


@router.get("/api/skills")
@router.get("/api/tools/skills")
async def get_skills(current_user: dict = Depends(get_current_user)):
    from app import skills_service
    skills = skills_service.list_skills()
    return {"skills": skills}


@router.post("/api/skills")
@router.post("/api/tools/skills")
async def create_skill(body: CreateSkillRequest, current_user: dict = Depends(get_current_user)):
    from app import skills_service
    res = skills_service.save_skill(body.name, body.description, body.instructions)
    return res


@router.post("/api/skills/upload")
async def upload_skill(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    from app import skills_service
    import re
    skills_dir = skills_service.ensure_skills_dir()
    clean_filename = re.sub(r"[^\w\.\-]", "_", file.filename)
    if not clean_filename.endswith((".md", ".py")):
        clean_filename += ".md"
    content = await file.read()
    dest = skills_dir / clean_filename
    dest.write_bytes(content)
    skills = skills_service.list_skills()
    return {"success": True, "message": f"Skill file '{clean_filename}' uploaded successfully.", "skills": skills}


@router.post("/api/skills/reload")
async def reload_skills(current_user: dict = Depends(get_current_user)):
    from app import skills_service
    skills = skills_service.list_skills()
    return {"success": True, "message": f"Skills reloaded. {len(skills)} skills active.", "skills": skills}


@router.delete("/api/skills/{name}")
@router.delete("/api/tools/skills/{name}")
async def delete_skill(name: str, current_user: dict = Depends(get_current_user)):
    from app import skills_service
    clean_name = name.replace(".md", "").strip()
    path = skills_service.SKILLS_DIR / f"{clean_name}.md"
    if path.exists():
        path.unlink()
        return {"success": True, "message": f"Deleted skill '{clean_name}'"}
    raise HTTPException(status_code=404, detail="Skill not found")
