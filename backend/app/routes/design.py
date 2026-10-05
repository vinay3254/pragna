import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app import design_service, repository
from app.auth import get_current_user
from app.design_service import DesignError

router = APIRouter()

# 10MB of image is ~13.4M base64 characters.
MAX_IMAGE_CHARS = 14_000_000


class ProjectCreate(BaseModel):
    name: str = Field(design_service.DEFAULT_PROJECT_NAME, min_length=1, max_length=80)
    device: str = Field("mobile", pattern="^(mobile|web)$")
    theme: dict | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    theme: dict | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field("", max_length=4000)
    image: str | None = Field(None, max_length=MAX_IMAGE_CHARS)
    add: bool = False


class EditRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=2000)
    element_html: str | None = Field(None, max_length=8000)


class RegenerateRequest(BaseModel):
    prompt: str | None = Field(None, max_length=4000)


class RestoreRequest(BaseModel):
    version_id: int


def _screen_payload(project: dict, screen: dict) -> dict:
    body = screen.get("body")
    return {
        "id": screen["id"],
        "name": screen["name"],
        "position": screen["position"],
        "version_id": screen["current_version_id"],
        "body": body,
        "html": design_service.render_document(body, project["theme"], screen["id"], interactive=True) if body else None,
    }


def _project_payload(conn, project: dict) -> dict:
    screens = repository.list_design_screens(conn, project["id"])
    return {"project": project, "screens": [_screen_payload(project, s) for s in screens]}


def _own_project(request: Request, user: dict, project_id: int) -> dict:
    project = repository.get_design_project(request.app.state.conn, user["id"], project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _own_screen(request: Request, user: dict, screen_id: int) -> tuple[dict, dict]:
    """(project, screen) for a screen the user owns; 404 otherwise, so ids do not leak."""
    conn = request.app.state.conn
    screen = repository.get_design_screen(conn, user["id"], screen_id)
    if not screen:
        raise HTTPException(status_code=404, detail="Screen not found")
    return repository.get_design_project(conn, user["id"], screen["project_id"]), screen


def _valid_image(image: str | None) -> str | None:
    if image and not image.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Image must be an image data URL")
    return image


@router.get("/api/design/projects")
async def list_projects(request: Request, user: dict = Depends(get_current_user)):
    conn = request.app.state.conn
    projects = repository.list_design_projects(conn, user["id"])
    for project in projects:
        first = next((s for s in repository.list_design_screens(conn, project["id"]) if s.get("body")), None)
        project["preview_html"] = (
            design_service.render_document(first["body"], project["theme"], first["id"], interactive=False) if first else None
        )
    return projects


@router.post("/api/design/projects")
async def create_project(request: Request, body: ProjectCreate, user: dict = Depends(get_current_user)):
    try:
        theme = design_service.validate_theme(body.theme)
    except DesignError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    conn = request.app.state.conn
    project_id = repository.create_design_project(conn, user["id"], body.name, body.device, theme)
    return _project_payload(conn, repository.get_design_project(conn, user["id"], project_id))


@router.get("/api/design/projects/{project_id}")
async def get_project(request: Request, project_id: int, user: dict = Depends(get_current_user)):
    return _project_payload(request.app.state.conn, _own_project(request, user, project_id))


@router.patch("/api/design/projects/{project_id}")
async def update_project(request: Request, project_id: int, body: ProjectUpdate, user: dict = Depends(get_current_user)):
    project = _own_project(request, user, project_id)
    try:
        theme = design_service.validate_theme(body.theme) if body.theme is not None else None
    except DesignError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    conn = request.app.state.conn
    repository.update_design_project(conn, project["id"], name=body.name, theme=theme)
    return _project_payload(conn, repository.get_design_project(conn, user["id"], project_id))


@router.delete("/api/design/projects/{project_id}")
async def delete_project(request: Request, project_id: int, user: dict = Depends(get_current_user)):
    project = _own_project(request, user, project_id)
    repository.delete_design_project(request.app.state.conn, project["id"])
    return {"ok": True}


@router.post("/api/design/projects/{project_id}/generate")
async def generate(request: Request, project_id: int, body: GenerateRequest, user: dict = Depends(get_current_user)):
    project = _own_project(request, user, project_id)
    image = _valid_image(body.image)
    if not body.prompt.strip() and not image:
        raise HTTPException(status_code=400, detail="Describe what to design or attach an image")
    conn, settings = request.app.state.conn, request.app.state.settings

    async def stream():
        events = design_service.generate_flow(conn, settings, project, body.prompt.strip(), image, body.add)
        try:
            async for event in events:
                if event["type"] == "screen":
                    # The page renders html, so send the finished document, not just the body.
                    event = {**event, "html": design_service.render_document(
                        event["body"], project["theme"], event["id"], interactive=True)}
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
        finally:
            await events.aclose()

    # no-transform keeps proxies (Next's rewrite included) from gzip-buffering the stream.
    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/api/design/screens/{screen_id}/edit")
async def edit_screen(request: Request, screen_id: int, body: EditRequest, user: dict = Depends(get_current_user)):
    project, screen = _own_screen(request, user, screen_id)
    if not screen.get("body"):
        raise HTTPException(status_code=400, detail="This screen has no design to edit yet")
    try:
        updated = await design_service.edit_screen_body(
            request.app.state.settings, screen["body"], body.instruction, body.element_html
        )
    except DesignError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    conn = request.app.state.conn
    repository.add_screen_version(conn, screen_id, updated, body.instruction)
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.post("/api/design/screens/{screen_id}/regenerate")
async def regenerate_screen(request: Request, screen_id: int, body: RegenerateRequest, user: dict = Depends(get_current_user)):
    """Retry a screen that failed to build."""
    project, screen = _own_screen(request, user, screen_id)
    purpose = (body.prompt or screen["name"]).strip()
    try:
        built = await design_service.generate_screen_body(
            request.app.state.settings, purpose, project["device"],
            {"name": screen["name"], "purpose": purpose}, [{"name": screen["name"], "purpose": purpose}],
        )
        built = await design_service.illustrate(request.app.state.settings, built, purpose)
    except DesignError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    conn = request.app.state.conn
    repository.add_screen_version(conn, screen_id, built, purpose)
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.get("/api/design/screens/{screen_id}/versions")
async def screen_versions(request: Request, screen_id: int, user: dict = Depends(get_current_user)):
    _own_screen(request, user, screen_id)
    return repository.list_screen_versions(request.app.state.conn, screen_id)


@router.post("/api/design/screens/{screen_id}/restore")
async def restore_version(request: Request, screen_id: int, body: RestoreRequest, user: dict = Depends(get_current_user)):
    project, _ = _own_screen(request, user, screen_id)
    conn = request.app.state.conn
    if not repository.restore_screen_version(conn, screen_id, body.version_id):
        raise HTTPException(status_code=404, detail="Version not found")
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.delete("/api/design/screens/{screen_id}")
async def delete_screen(request: Request, screen_id: int, user: dict = Depends(get_current_user)):
    _own_screen(request, user, screen_id)
    repository.delete_design_screen(request.app.state.conn, screen_id)
    return {"ok": True}


@router.get("/api/design/screens/{screen_id}/export")
async def export_screen(request: Request, screen_id: int, user: dict = Depends(get_current_user)):
    """Standalone HTML (no editor script), served as a download so it never renders on this origin."""
    project, screen = _own_screen(request, user, screen_id)
    if not screen.get("body"):
        raise HTTPException(status_code=400, detail="This screen has no design to export yet")
    html = design_service.inline_images(
        design_service.render_document(screen["body"], project["theme"], screen_id, interactive=False, standalone=True)
    )
    filename = "".join(c if c.isalnum() or c in "-_" else "-" for c in screen["name"]).strip("-") or "screen"
    return Response(
        html, media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.html"'},
    )
