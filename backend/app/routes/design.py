import json
import io
import zipfile
import re
from urllib.parse import urlsplit, unquote

from bs4 import BeautifulSoup

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


class TextUpdate(BaseModel):
    selector: str = Field(..., min_length=1, max_length=2000)
    text: str = Field(..., max_length=4000)
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
    return {"project": project, "screens": [_screen_payload(project, s) for s in screens],
            "messages": repository.list_design_messages(conn, project["id"])}


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
async def list_projects(request: Request, include_previews: bool = True, user: dict = Depends(get_current_user)):
    conn = request.app.state.conn
    projects = repository.list_design_projects(conn, user["id"])
    for project in projects:
        if not include_previews:
            summary = conn.execute(
                "SELECT COUNT(*) AS screen_count, COUNT(current_version_id) AS built_count FROM design_screens WHERE project_id = ?",
                (project["id"],),
            ).fetchone()
            project["screen_count"] = summary["screen_count"]
            project["has_preview"] = summary["built_count"] > 0
            continue
        screens = repository.list_design_screens(conn, project["id"])
        project["screen_count"] = len(screens)
        first = next((s for s in screens if s.get("body")), None)
        project["preview_html"] = (
            design_service.render_document(first["body"], project["theme"], first["id"], interactive=False) if first else None
        )
    return projects


@router.get("/api/design/projects/{project_id}/preview")
async def project_preview(request: Request, project_id: int, user: dict = Depends(get_current_user)):
    project = _own_project(request, user, project_id)
    conn = request.app.state.conn
    row = conn.execute(
        "SELECT id FROM design_screens WHERE project_id = ? AND current_version_id IS NOT NULL ORDER BY position, id LIMIT 1",
        (project_id,),
    ).fetchone()
    first = repository.get_design_screen(conn, user["id"], row["id"]) if row else None
    return {"html": design_service.render_document(first["body"], project["theme"], first["id"], interactive=False) if first and first.get("body") else None}


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
        repository.add_design_message(conn, project_id, "user", body.prompt.strip() or "Design from this reference image")
        events = design_service.generate_flow(conn, settings, project, body.prompt.strip(), image, body.add)
        built, failed = set(), set()
        terminal = False
        try:
            async for event in events:
                if event["type"] == "screen":
                    built.add(event["id"])
                    # The page renders html, so send the finished document, not just the body.
                    event = {**event, "html": design_service.render_document(
                        event["body"], project["theme"], event["id"], interactive=True)}
                elif event["type"] == "screen_error":
                    failed.add(event["id"])
                elif event["type"] == "error":
                    terminal = True
                    repository.add_design_message(conn, project_id, "assistant", event["error"])
                elif event["type"] == "done":
                    terminal = True
                    message = f"Created {len(built)} screen{'s' if len(built) != 1 else ''}. Explore your design in Preview, or describe what to change."
                    if failed:
                        message += f" {len(failed)} screen(s) need a retry."
                    repository.add_design_message(conn, project_id, "assistant", message)
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            terminal = True
            repository.add_design_message(conn, project_id, "assistant", f"Generation failed: {exc}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
        finally:
            if not terminal:
                repository.add_design_message(conn, project_id, "assistant",
                    "Generation stopped. Completed screens are saved; retry any remaining screens.")
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
    conn = request.app.state.conn
    context = "\n".join(f"{m['role']}: {m['content']}" for m in repository.list_design_messages(conn, project["id"])[-8:])[-8000:]
    repository.add_design_message(conn, project["id"], "user", f"{screen['name']}: {body.instruction}")
    try:
        updated = await design_service.edit_screen_body(
            request.app.state.settings, screen["body"], body.instruction, body.element_html, context=context
        )
    except DesignError as exc:
        repository.add_design_message(conn, project["id"], "assistant", f"Could not update {screen['name']}: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))
    current = repository.get_design_screen(conn, user["id"], screen_id)
    if not current or current["current_version_id"] != screen["current_version_id"]:
        repository.add_design_message(conn, project["id"], "assistant", "This screen changed during generation. The newer design is preserved; retry your edit.")
        raise HTTPException(status_code=409, detail="This screen changed during generation. Refresh and retry your edit.")
    repository.add_screen_version(conn, screen_id, updated, body.instruction)
    repository.add_design_message(conn, project["id"], "assistant", f"Updated {screen['name']}. The previous version is available in History.")
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
    repository.add_design_message(conn, project["id"], "assistant", f"Built {screen['name']}. It is ready to refine.")
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.get("/api/design/screens/{screen_id}/versions")
async def screen_versions(request: Request, screen_id: int, user: dict = Depends(get_current_user)):
    _own_screen(request, user, screen_id)
    return repository.list_screen_versions(request.app.state.conn, screen_id)


@router.post("/api/design/screens/{screen_id}/restore")
async def restore_version(request: Request, screen_id: int, body: RestoreRequest, user: dict = Depends(get_current_user)):
    project, screen = _own_screen(request, user, screen_id)
    conn = request.app.state.conn
    if not repository.restore_screen_version(conn, screen_id, body.version_id):
        raise HTTPException(status_code=404, detail="Version not found")
    repository.add_design_message(conn, project["id"], "assistant", f"Restored an earlier version of {screen['name']}.")
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.post("/api/design/screens/{screen_id}/text")
async def update_text(request: Request, screen_id: int, body: TextUpdate, user: dict = Depends(get_current_user)):
    """Change a leaf element's text without a model call; never accept HTML from the editor."""
    project, screen = _own_screen(request, user, screen_id)
    if body.version_id != screen["current_version_id"]:
        raise HTTPException(status_code=409, detail="This screen changed. Select the text again and retry.")
    if not screen.get("body"):
        raise HTTPException(status_code=400, detail="This screen has no design to edit yet")
    soup = BeautifulSoup(f"<body>{screen['body']}</body>", "html.parser")
    try:
        element = soup.select_one(body.selector)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid text selection")
    if (not element or element.name in {"body", "script", "style", "input", "textarea", "img", "svg", "path", "iframe"}
            or element.find(True)):
        raise HTTPException(status_code=400, detail="Select a single text element to edit")
    element.string = body.text
    updated = soup.body.decode_contents()
    if len(updated.encode("utf-8")) > design_service.MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="This screen is too large")
    conn = request.app.state.conn
    repository.add_screen_version(conn, screen_id, updated, "Edited text directly")
    repository.update_design_project(conn, project["id"])
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], screen_id))


@router.get("/api/design/projects/{project_id}/export")
async def export_project(request: Request, project_id: int, user: dict = Depends(get_current_user)):
    project = _own_project(request, user, project_id)
    screens = [s for s in repository.list_design_screens(request.app.state.conn, project_id) if s.get("body")]
    if not screens:
        raise HTTPException(status_code=400, detail="Build a screen before exporting")
    buffer = io.BytesIO()
    filenames = {}
    for index, screen in enumerate(screens, 1):
        name = "".join(c if c.isascii() and (c.isalnum() or c in "-_") else "-" for c in screen["name"]).strip("-") or "screen"
        filenames[screen["id"]] = f"{index:02d}-{name}.html"
    normalize = lambda value: re.sub(r"[^a-z0-9]", "", value.lower())
    destinations = {normalize(s["name"]): filenames[s["id"]] for s in screens}
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
        for screen in screens:
            soup = BeautifulSoup(screen["body"], "html.parser")
            for link in soup.find_all("a", href=True):
                href = str(link["href"])
                if urlsplit(href).scheme or href.startswith(("//", "#")):
                    continue
                path = unquote(urlsplit(href).path).rstrip("/").rsplit("/", 1)[-1]
                target = destinations.get(normalize(re.sub(r"\.html?$", "", path)))
                if target:
                    link["href"] = target
            html = design_service.inline_images(design_service.render_document(
                str(soup), project["theme"], screen["id"], interactive=False, standalone=True))
            bundle.writestr(filenames[screen["id"]], html)
        bundle.writestr("theme.json", json.dumps(project["theme"], indent=2))
    return Response(buffer.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="pragna-design.zip"'})


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
