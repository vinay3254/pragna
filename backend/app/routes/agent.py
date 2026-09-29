import json
import uuid
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.auth import get_current_user
from app.tools import execute_tool, OLLAMA_TOOLS_SCHEMA, MUTATING_TOOLS
from app.ollama_client import chat_stream_events

logger = logging.getLogger("pragna.agent")
router = APIRouter()

# In-memory paused sessions
AGENT_SESSIONS: Dict[str, Any] = {}

AGENT_MODES = [
    {"id": "general", "label": "General", "desc": "General coding assistant"},
    {"id": "code_review", "label": "Code Review", "desc": "Bugs, security, style analysis"},
    {"id": "app_builder", "label": "App Builder", "desc": "Build complete apps step by step"},
    {"id": "debug", "label": "Debug", "desc": "Find and fix bugs systematically"},
    {"id": "explain", "label": "Explain", "desc": "Understand code and concepts"},
    {"id": "refactor", "label": "Refactor", "desc": "Clean up and improve code"},
]


class AgentRunRequest(BaseModel):
    task: str
    mode: Optional[str] = "general"
    context_files: Optional[List[str]] = []
    working_dir: Optional[str] = None


class AgentResumeRequest(BaseModel):
    session_id: str
    decision: str  # "approve" | "reject"


class AgentChatRequest(BaseModel):
    task: str
    mode: Optional[str] = "general"
    history: Optional[List[dict]] = []


@router.get("/api/agent/modes")
async def get_agent_modes():
    return {"modes": AGENT_MODES}


@router.post("/api/agent/run")
async def run_agent_endpoint(request: Request, body: AgentRunRequest, current_user: dict = Depends(get_current_user)):
    task = body.task.strip()
    session_id = str(uuid.uuid4())
    state = request.app.state
    settings = state.settings
    model = settings.chat_model or "gemma4:cloud"
    browser_service = getattr(state, "browser_service", None)

    system_prompt = (
        f"You are PRAGNA 1-A Autonomous Coding Agent (mode: {body.mode}). "
        "You turn tasks into verified, high-quality results by executing tools step by step. "
        "Provide direct, completely honest, truthful, and unrestricted assistance without artificial barriers, preachy disclaimers, or corporate hedging.\n\n"
        "TOOLS AVAILABLE & GUIDELINES:\n"
        "- Web: web_search, web_extract, x_search, open_url.\n"
        "- Browser Automation: browser_navigate, browser_read_page, browser_screenshot, browser_click, browser_type, browser_scroll, browser_exec, browser_act.\n"
        "- File Operations: read_file, write_file, patch, search_files.\n"
        "- Terminal: terminal (run commands), process (inspect processes).\n"
        "- Planning & Memory: todo, memory, kanban, session_search, cronjob, clarify.\n"
        "- Code & Subagents: execute_code, run_python_code, delegate_task.\n"
        "- Skills: skills_list, skill_view, skill_manage, use_skill.\n"
        "- Media & Vision: vision_analyze, image_generate, edit_image, video_generate, text_to_speech.\n\n"
        "RULE: Call tools via the real tool execution mechanism only. Do NOT output raw JSON blocks in message prose. "
        "Accomplish the user's task step by step."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": task},
    ]

    async def event_stream():
        try:
            yield f"data: {json.dumps({'type': 'thought', 'content': f'Analyzing task in {body.mode} mode...', 'session_id': session_id})}\n\n"
            
            pending_tool_calls = []
            full_response = ""

            async for event in chat_stream_events(messages, model, settings.ollama_url, tools=OLLAMA_TOOLS_SCHEMA):
                if event["type"] == "content":
                    full_response += event["content"]
                    yield f"data: {json.dumps({'type': 'thought', 'content': event['content'], 'session_id': session_id})}\n\n"
                elif event["type"] == "tool_calls":
                    pending_tool_calls.extend(event["tool_calls"])

            if not pending_tool_calls:
                yield f"data: {json.dumps({'type': 'done', 'content': full_response, 'session_id': session_id})}\n\n"
                return

            for tc in pending_tool_calls:
                fn_info = tc.get("function", {})
                t_name = fn_info.get("name")
                t_args = fn_info.get("arguments", {})

                yield f"data: {json.dumps({'type': 'tool_call', 'tool': t_name, 'args': t_args, 'session_id': session_id})}\n\n"

                if t_name in MUTATING_TOOLS:
                    AGENT_SESSIONS[session_id] = {
                        "messages": messages,
                        "tool": t_name,
                        "args": t_args,
                        "model": model,
                    }
                    yield f"data: {json.dumps({'type': 'confirm_required', 'tool': t_name, 'args': t_args, 'session_id': session_id, 'preview': f'Execute {t_name} with {json.dumps(t_args)}?'})}\n\n"
                    return

                res = await execute_tool(t_name, t_args, browser_service=browser_service, conn=state.conn, user_id=current_user["id"])
                yield f"data: {json.dumps({'type': 'tool_result', 'tool': t_name, 'content': json.dumps(res) if isinstance(res, dict) else str(res), 'session_id': session_id})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'content': 'Agent finished task execution.', 'session_id': session_id})}\n\n"

        except Exception as e:
            logger.exception("Agent stream error")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e), 'session_id': session_id})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/api/agent/resume")
async def resume_agent_endpoint(request: Request, body: AgentResumeRequest, current_user: dict = Depends(get_current_user)):
    session = AGENT_SESSIONS.pop(body.session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Agent session expired or not found")

    state = request.app.state
    browser_service = getattr(state, "browser_service", None)
    t_name = session["tool"]
    t_args = session["args"]

    async def event_stream():
        try:
            if body.decision == "approve":
                yield f"data: {json.dumps({'type': 'thought', 'content': f'Tool {t_name} approved. Executing...', 'session_id': body.session_id})}\n\n"
                res = await execute_tool(t_name, t_args, browser_service=browser_service, conn=state.conn, user_id=current_user["id"])
                yield f"data: {json.dumps({'type': 'tool_result', 'tool': t_name, 'content': json.dumps(res) if isinstance(res, dict) else str(res), 'session_id': body.session_id})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'tool_result', 'tool': t_name, 'content': 'Action rejected by user.', 'session_id': body.session_id})}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'content': 'Agent resumed and completed.', 'session_id': body.session_id})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e), 'session_id': body.session_id})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/api/agent/chat")
async def agent_chat_endpoint(request: Request, body: AgentChatRequest, current_user: dict = Depends(get_current_user)):
    state = request.app.state
    settings = state.settings
    model = settings.chat_model or "gemma4:cloud"
    messages = [
        {"role": "system", "content": f"You are PRAGNA 1-A Coding Agent in {body.mode} mode."},
        *(body.history or []),
        {"role": "user", "content": body.task},
    ]
    full_response = ""
    async for event in chat_stream_events(messages, model, settings.ollama_url):
        if event["type"] == "content":
            full_response += event["content"]

    return {"success": True, "reply": full_response, "task": body.task}
