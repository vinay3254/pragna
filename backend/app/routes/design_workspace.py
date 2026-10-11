"""Brand libraries, references, feedback, collaboration and deterministic canvas tools."""

import asyncio
import base64
import json
import secrets
import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app import design_service, repository
from app.auth import get_current_user
from app.design_canvas import canvas_layers, mutate_canvas
from app.design_imports import (
    MAX_UPLOAD_BYTES,
    extract_reference,
    imported_theme,
    sanitize_imported_html,
)
from app.routes.design import _project_payload, _screen_payload

router = APIRouter(prefix="/api/design")
ROLES = {"viewer": 0, "commenter": 1, "editor": 2, "owner": 3}
KINDS = {"prototype", "presentation", "document", "marketing"}


class CaptureInput(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    selector: str | None = Field(None, max_length=500)


@router.post("/projects/{project_id}/capture")
async def capture(
    request: Request,
    project_id: int,
    body: CaptureInput,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "editor")
    from app.design_capture import capture_reference

    try:
        content = await capture_reference(body.url, body.selector)
    except Exception as exc:
        detail = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Website could not be read. Upload its source or a screenshot instead."
        )
        raise HTTPException(400, detail)
    return await reference(
        request, project_id, ReferenceInput(name=body.url[:200], content=content), user
    )


@router.get("/projects/{project_id}/revision")
async def revision(
    request: Request, project_id: int, user: dict = Depends(get_current_user)
):
    project = project_access(request, user, project_id)
    conn = request.app.state.conn
    screens = conn.execute(
        "SELECT id,name,position,current_version_id FROM design_screens WHERE project_id=? ORDER BY position,id",
        (project_id,),
    ).fetchall()
    payload = [project, [dict(row) for row in screens]]
    return {
        "revision": hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
    }


class AssistantInput(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


@router.post("/screens/{screen_id}/assistant")
async def assistant(
    request: Request,
    screen_id: int,
    body: AssistantInput,
    user: dict = Depends(get_current_user),
):
    _, screen = screen_access(request, user, screen_id, "editor")
    if not screen.get("body"):
        raise HTTPException(400, "Build the prototype first")
    try:
        async with asyncio.timeout(35):
            content = await design_service._llm(
                request.app.state.settings,
                [
                    {
                        "role": "system",
                        "content": "You are an assistant inside a user-created prototype. Answer in plain text, up to 150 words. You have no external tools or access to private files.",
                    },
                    {"role": "user", "content": body.prompt},
                ],
                stage="assistant",
                max_tokens=1024,
            )
    except Exception:
        raise HTTPException(503, "AI demo is unavailable. Try again shortly.")
    return {"content": content[:8000]}


def project_access(request, user, project_id, role="viewer"):
    project = repository.get_design_project(
        request.app.state.conn, user["id"], project_id
    )
    if not project:
        raise HTTPException(404, "Project not found")
    if ROLES[project["access_role"]] < ROLES[role]:
        raise HTTPException(403, f"This action requires {role} access")
    return project


def screen_access(request, user, screen_id, role="viewer"):
    screen = repository.get_design_screen(request.app.state.conn, user["id"], screen_id)
    if not screen:
        raise HTTPException(404, "Screen not found")
    return project_access(request, user, screen["project_id"], role), screen


class SystemInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    theme: dict
    guidelines: str = Field("", max_length=10000)
    components: list[dict] = Field(default_factory=list, max_length=30)
    is_default: bool = False


def system_value(row):
    result = dict(row)
    result["theme"] = json.loads(result["theme"])
    result["components"] = json.loads(result["components"])
    result["is_default"] = bool(result["is_default"])
    return result


@router.get("/systems")
async def systems(request: Request, user: dict = Depends(get_current_user)):
    return [
        system_value(row)
        for row in request.app.state.conn.execute(
            "SELECT * FROM design_systems WHERE user_id=? ORDER BY is_default DESC,updated_at DESC",
            (user["id"],),
        ).fetchall()
    ]


@router.post("/systems")
async def create_system(
    request: Request, body: SystemInput, user: dict = Depends(get_current_user)
):
    try:
        theme = design_service.validate_theme(body.theme)
    except design_service.DesignError as exc:
        raise HTTPException(400, str(exc))
    # Store reusable component patterns, never arbitrary metadata objects or executable imports.
    components = [
        {
            "name": str(c.get("name", "Component"))[:80],
            "description": str(c.get("description", ""))[:500],
            "html": str(c.get("html", ""))[:6000],
        }
        for c in body.components
    ]
    conn = request.app.state.conn
    now = repository._now()
    if body.is_default:
        conn.execute(
            "UPDATE design_systems SET is_default=0 WHERE user_id=?", (user["id"],)
        )
    cur = conn.execute(
        "INSERT INTO design_systems (user_id,name,theme,guidelines,components,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (
            user["id"],
            body.name.strip(),
            json.dumps(theme),
            body.guidelines,
            json.dumps(components),
            int(body.is_default),
            now,
            now,
        ),
    )
    conn.commit()
    return system_value(
        conn.execute(
            "SELECT * FROM design_systems WHERE id=?", (cur.lastrowid,)
        ).fetchone()
    )


@router.put("/systems/{system_id}")
async def update_system(
    request: Request,
    system_id: int,
    body: SystemInput,
    user: dict = Depends(get_current_user),
):
    conn = request.app.state.conn
    if not conn.execute(
        "SELECT id FROM design_systems WHERE id=? AND user_id=?",
        (system_id, user["id"]),
    ).fetchone():
        raise HTTPException(404, "Design system not found")
    try:
        theme = design_service.validate_theme(body.theme)
    except design_service.DesignError as exc:
        raise HTTPException(400, str(exc))
    if body.is_default:
        conn.execute(
            "UPDATE design_systems SET is_default=0 WHERE user_id=?", (user["id"],)
        )
    components = [
        {
            "name": str(c.get("name", "Component"))[:80],
            "description": str(c.get("description", ""))[:500],
            "html": str(c.get("html", ""))[:6000],
        }
        for c in body.components
    ]
    conn.execute(
        "UPDATE design_systems SET name=?,theme=?,guidelines=?,components=?,is_default=?,updated_at=? WHERE id=?",
        (
            body.name.strip(),
            json.dumps(theme),
            body.guidelines,
            json.dumps(components),
            int(body.is_default),
            repository._now(),
            system_id,
        ),
    )
    conn.commit()
    return system_value(
        conn.execute("SELECT * FROM design_systems WHERE id=?", (system_id,)).fetchone()
    )


@router.delete("/systems/{system_id}")
async def delete_system(
    request: Request, system_id: int, user: dict = Depends(get_current_user)
):
    conn = request.app.state.conn
    if not conn.execute(
        "SELECT id FROM design_systems WHERE id=? AND user_id=?",
        (system_id, user["id"]),
    ).fetchone():
        raise HTTPException(404, "Design system not found")
    conn.execute(
        "UPDATE design_project_options SET design_system_id=NULL WHERE design_system_id=?",
        (system_id,),
    )
    conn.execute("DELETE FROM design_systems WHERE id=?", (system_id,))
    conn.commit()
    return {"ok": True}


class OptionsInput(BaseModel):
    kind: Literal["prototype", "presentation", "document", "marketing"] | None = None
    design_system_id: int | None = None
    settings: dict | None = None


def save_options(conn, project_id, kind, system_id, settings):
    encoded = json.dumps(settings)
    if len(encoded) > 4000:
        raise HTTPException(400, "Project settings are too large")
    row = conn.execute(
        "SELECT id FROM design_project_options WHERE project_id=?", (project_id,)
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE design_project_options SET kind=?,design_system_id=?,settings=? WHERE project_id=?",
            (kind, system_id, encoded, project_id),
        )
    else:
        conn.execute(
            "INSERT INTO design_project_options (project_id,kind,design_system_id,settings) VALUES (?,?,?,?)",
            (project_id, kind, system_id, encoded),
        )
    conn.commit()


@router.patch("/projects/{project_id}/options")
async def project_options(
    request: Request,
    project_id: int,
    body: OptionsInput,
    user: dict = Depends(get_current_user),
):
    project = project_access(request, user, project_id, "editor")
    conn = request.app.state.conn
    system_id = project.get("design_system_id")
    if "design_system_id" in body.model_fields_set:
        system_id = body.design_system_id
        if system_id:
            system = conn.execute(
                "SELECT * FROM design_systems WHERE id=? AND user_id=?",
                (system_id, user["id"]),
            ).fetchone()
            if not system:
                raise HTTPException(404, "Design system not found")
            repository.update_design_project(
                conn, project_id, theme=json.loads(system["theme"])
            )
    save_options(
        conn,
        project_id,
        body.kind or project["kind"],
        system_id,
        body.settings if body.settings is not None else project["settings"],
    )
    repository.update_design_project(conn, project_id)
    return _project_payload(
        conn, repository.get_design_project(conn, user["id"], project_id)
    )


@router.get("/projects/{project_id}/workspace")
async def workspace(
    request: Request, project_id: int, user: dict = Depends(get_current_user)
):
    project = project_access(request, user, project_id)
    conn = request.app.state.conn
    sources = []
    for row in conn.execute(
        "SELECT id,filename,media_type,metadata,created_at FROM design_sources WHERE project_id=? ORDER BY id",
        (project_id,),
    ).fetchall():
        item = dict(row)
        item["metadata"] = json.loads(item["metadata"])
        sources.append(item)
    comments = [
        dict(row)
        for row in conn.execute(
            """SELECT c.*,COALESCE(u.name,'Collaborator') AS author
        FROM design_comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? ORDER BY c.id""",
            (project_id,),
        ).fetchall()
    ]
    members = (
        [
            dict(row)
            for row in conn.execute(
                """SELECT m.id,m.user_id,m.role,u.name,u.email
        FROM design_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?""",
                (project_id,),
            ).fetchall()
        ]
        if project["access_role"] == "owner"
        else []
    )
    share = (
        conn.execute(
            "SELECT token FROM design_shares WHERE project_id=? ORDER BY id DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if project["access_role"] == "owner"
        else None
    )
    return {
        "sources": sources,
        "comments": comments,
        "members": members,
        "share_token": share["token"] if share else None,
        "access_role": project["access_role"],
    }


@router.post("/projects/{project_id}/sources")
async def upload_source(
    request: Request,
    project_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "editor")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        media, content, metadata = await asyncio.to_thread(
            extract_reference, file.filename or "reference.txt", data
        )
    except Exception as exc:
        raise HTTPException(
            400,
            str(exc) if isinstance(exc, ValueError) else "This file could not be read",
        )
    conn = request.app.state.conn
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM design_sources WHERE project_id=?", (project_id,)
    ).fetchone()["n"]
    if count >= 20:
        raise HTTPException(400, "Use at most 20 reference files per project")
    if media.startswith(("image/", "video/", "audio/")):
        metadata["asset_token"] = secrets.token_urlsafe(24)
    cur = conn.execute(
        "INSERT INTO design_sources (project_id,filename,media_type,content,metadata,created_at) VALUES (?,?,?,?,?,?)",
        (
            project_id,
            (file.filename or "reference")[:200],
            media,
            content,
            json.dumps(metadata),
            repository._now(),
        ),
    )
    source_id = cur.lastrowid
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {
        "id": source_id,
        "filename": file.filename,
        "media_type": media,
        "metadata": metadata,
    }


@router.get("/assets/{source_id}/{token}")
async def source_asset(request: Request, source_id: int, token: str):
    row = request.app.state.conn.execute(
        "SELECT media_type,content,metadata FROM design_sources WHERE id=?",
        (source_id,),
    ).fetchone()
    if (
        not row
        or not row["media_type"].startswith(("image/", "video/", "audio/"))
        or not secrets.compare_digest(
            json.loads(row["metadata"]).get("asset_token", ""), token
        )
    ):
        raise HTTPException(404, "Asset not found")
    data = base64.b64decode(row["content"].partition(",")[2])
    headers = {
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
    }
    byte_range = request.headers.get("range")
    if byte_range:
        import re

        match = re.fullmatch(r"bytes=(\d*)-(\d*)", byte_range)
        if not match or not any(match.groups()):
            return Response(
                status_code=416, headers={"Content-Range": f"bytes */{len(data)}"}
            )
        start = int(match[1]) if match[1] else max(0, len(data) - int(match[2]))
        end = (
            min(len(data) - 1, int(match[2]))
            if match[1] and match[2]
            else len(data) - 1
        )
        if start > end or start >= len(data):
            return Response(
                status_code=416, headers={"Content-Range": f"bytes */{len(data)}"}
            )
        headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
        return Response(
            data[start : end + 1],
            status_code=206,
            media_type=row["media_type"],
            headers=headers,
        )
    return Response(data, media_type=row["media_type"], headers=headers)


@router.delete("/projects/{project_id}/sources/{source_id}")
async def delete_source(
    request: Request,
    project_id: int,
    source_id: int,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "editor")
    conn = request.app.state.conn
    conn.execute(
        "DELETE FROM design_sources WHERE id=? AND project_id=?",
        (source_id, project_id),
    )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"ok": True}


class ReferenceInput(BaseModel):
    content: str = Field(..., min_length=1, max_length=60000)
    name: str = Field("Pasted reference", max_length=200)


@router.post("/projects/{project_id}/reference")
async def pasted_reference(
    request: Request,
    project_id: int,
    body: ReferenceInput,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "editor")
    conn = request.app.state.conn
    if (
        conn.execute(
            "SELECT COUNT(*) AS n FROM design_sources WHERE project_id=?", (project_id,)
        ).fetchone()["n"]
        >= 20
    ):
        raise HTTPException(400, "Use at most 20 reference files per project")
    cur = conn.execute(
        "INSERT INTO design_sources (project_id,filename,media_type,content,metadata,created_at) VALUES (?,?,?,?,?,?)",
        (project_id, body.name, "text/plain", body.content, "{}", repository._now()),
    )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"id": cur.lastrowid}


@router.post("/projects/{project_id}/system-from-sources")
async def system_from_sources(
    request: Request,
    project_id: int,
    body: ReferenceInput,
    user: dict = Depends(get_current_user),
):
    project = project_access(request, user, project_id, "editor")
    conn = request.app.state.conn
    references = "\n".join(
        row["content"]
        for row in conn.execute(
            "SELECT content FROM design_sources WHERE project_id=? AND media_type='text/plain'",
            (project_id,),
        ).fetchall()
    )[:60000]
    theme = imported_theme(references, project["theme"])
    system = await create_system(
        request,
        SystemInput(
            name=body.name,
            theme=theme,
            guidelines=body.content[:10000]
            + "\n\nReference conventions:\n"
            + references[:6000],
        ),
        user,
    )
    save_options(conn, project_id, project["kind"], system["id"], project["settings"])
    repository.update_design_project(conn, project_id, theme=theme)
    return system


class CommentInput(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    screen_id: int | None = None
    selector: str | None = Field(None, max_length=2000)


@router.post("/projects/{project_id}/comments")
async def add_comment(
    request: Request,
    project_id: int,
    body: CommentInput,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "commenter")
    conn = request.app.state.conn
    if (
        body.screen_id
        and not conn.execute(
            "SELECT id FROM design_screens WHERE id=? AND project_id=?",
            (body.screen_id, project_id),
        ).fetchone()
    ):
        raise HTTPException(400, "Choose a screen in this project")
    selector = body.selector
    if selector and body.screen_id:
        from bs4 import BeautifulSoup

        screen = repository.get_design_screen(conn, user["id"], body.screen_id)
        soup = BeautifulSoup(
            "<body>" + (screen.get("body") or "") + "</body>", "html.parser"
        )
        try:
            element = soup.select_one(selector)
        except Exception:
            raise HTTPException(400, "Choose a valid element for this comment")
        if not element or element.name in {"body", "html", "script", "style"}:
            raise HTTPException(400, "The selected element changed. Select it again.")
        anchor = element.get("data-design-anchor") or secrets.token_hex(12)
        element["data-design-anchor"] = anchor
        selector = f'[data-design-anchor="{anchor}"]'
        # Annotation metadata belongs to the current revision; it does not alter visual design or undo order.
        repository.update_screen_version_body(
            conn, screen["current_version_id"], soup.body.decode_contents()
        )
    now = repository._now()
    cur = conn.execute(
        "INSERT INTO design_comments (project_id,screen_id,user_id,selector,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        (
            project_id,
            body.screen_id,
            user["id"],
            selector,
            body.content.strip(),
            now,
            now,
        ),
    )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"id": cur.lastrowid}


class ResolveInput(BaseModel):
    resolved: bool


@router.patch("/projects/{project_id}/comments/{comment_id}")
async def resolve_comment(
    request: Request,
    project_id: int,
    comment_id: int,
    body: ResolveInput,
    user: dict = Depends(get_current_user),
):
    project = project_access(request, user, project_id, "commenter")
    conn = request.app.state.conn
    comment = conn.execute(
        "SELECT user_id FROM design_comments WHERE id=? AND project_id=?",
        (comment_id, project_id),
    ).fetchone()
    if not comment:
        raise HTTPException(404, "Comment not found")
    if comment["user_id"] != user["id"] and ROLES[project["access_role"]] < 2:
        raise HTTPException(
            403, "Only the author or an editor can resolve this comment"
        )
    conn.execute(
        "UPDATE design_comments SET resolved=?,updated_at=? WHERE id=?",
        (int(body.resolved), repository._now(), comment_id),
    )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"ok": True}


class MemberInput(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: Literal["viewer", "commenter", "editor"]


@router.post("/projects/{project_id}/members")
async def add_member(
    request: Request,
    project_id: int,
    body: MemberInput,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "owner")
    conn = request.app.state.conn
    member = repository.get_user_by_email(conn, body.email.strip().lower())
    if not member:
        raise HTTPException(400, "This person needs a Pragna account first")
    if member["id"] == user["id"]:
        raise HTTPException(400, "You already own this project")
    existing = conn.execute(
        "SELECT id FROM design_members WHERE project_id=? AND user_id=?",
        (project_id, member["id"]),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE design_members SET role=? WHERE id=?", (body.role, existing["id"])
        )
    else:
        conn.execute(
            "INSERT INTO design_members (project_id,user_id,role) VALUES (?,?,?)",
            (project_id, member["id"], body.role),
        )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"ok": True}


@router.delete("/projects/{project_id}/members/{member_id}")
async def remove_member(
    request: Request,
    project_id: int,
    member_id: int,
    user: dict = Depends(get_current_user),
):
    project_access(request, user, project_id, "owner")
    conn = request.app.state.conn
    conn.execute(
        "DELETE FROM design_members WHERE id=? AND project_id=?",
        (member_id, project_id),
    )
    conn.commit()
    repository.update_design_project(conn, project_id)
    return {"ok": True}


@router.post("/projects/{project_id}/share")
async def create_share(
    request: Request, project_id: int, user: dict = Depends(get_current_user)
):
    project_access(request, user, project_id, "owner")
    conn = request.app.state.conn
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM design_shares WHERE project_id=?", (project_id,))
    conn.execute(
        "INSERT INTO design_shares (project_id,token,created_at) VALUES (?,?,?)",
        (project_id, token, repository._now()),
    )
    conn.commit()
    return {"token": token}


@router.delete("/projects/{project_id}/share")
async def revoke_share(
    request: Request, project_id: int, user: dict = Depends(get_current_user)
):
    project_access(request, user, project_id, "owner")
    conn = request.app.state.conn
    conn.execute("DELETE FROM design_shares WHERE project_id=?", (project_id,))
    conn.commit()
    return {"ok": True}


@router.get("/shared/{token}")
async def shared_design(request: Request, token: str):
    conn = request.app.state.conn
    share = conn.execute(
        "SELECT project_id FROM design_shares WHERE token=?", (token,)
    ).fetchone()
    if not share:
        raise HTTPException(404, "This link is unavailable or was revoked")
    row = conn.execute(
        "SELECT user_id FROM design_projects WHERE id=?", (share["project_id"],)
    ).fetchone()
    project = repository.get_design_project(conn, row["user_id"], share["project_id"])
    return {
        "project": {
            key: project[key] for key in ("id", "name", "device", "kind", "theme")
        },
        "screens": [
            {
                "id": s["id"],
                "name": s["name"],
                "html": design_service.render_document(
                    s["body"], project["theme"], s["id"], False
                ),
                "layout": s.get("layout", {}),
            }
            for s in repository.list_design_screens(conn, project["id"])
            if s.get("body")
        ],
    }


class CanvasInput(BaseModel):
    selector: str = Field(..., min_length=1, max_length=2000)
    selectors: list[str] | None = Field(None, max_length=30)
    operation: Literal[
        "style",
        "duplicate",
        "delete",
        "move-earlier",
        "move-later",
        "group",
        "ungroup",
        "flip-horizontal",
        "flip-vertical",
    ]
    styles: dict[str, str] = Field(default_factory=dict, max_length=20)
    version_id: int


@router.get("/screens/{screen_id}/layers")
async def layers(
    request: Request, screen_id: int, user: dict = Depends(get_current_user)
):
    _, screen = screen_access(request, user, screen_id)
    return canvas_layers(screen.get("body") or "")


@router.post("/screens/{screen_id}/canvas")
async def canvas_change(
    request: Request,
    screen_id: int,
    body: CanvasInput,
    user: dict = Depends(get_current_user),
):
    project, screen = screen_access(request, user, screen_id, "editor")
    conn = request.app.state.conn
    if screen["current_version_id"] != body.version_id:
        raise HTTPException(409, "This screen changed. Refresh and select again.")
    try:
        updated = design_service._checked(
            mutate_canvas(
                screen.get("body") or "",
                body.selector,
                body.operation,
                body.styles,
                body.selectors,
            )
        )
    except (ValueError, design_service.DesignError) as exc:
        raise HTTPException(400, str(exc))
    repository.add_screen_version(conn, screen_id, updated, "Canvas: " + body.operation)
    repository.update_design_project(conn, project["id"])
    return _screen_payload(
        project, repository.get_design_screen(conn, user["id"], screen_id)
    )


@router.post("/screens/{screen_id}/duplicate")
async def duplicate_screen(
    request: Request, screen_id: int, user: dict = Depends(get_current_user)
):
    project, screen = screen_access(request, user, screen_id, "editor")
    conn = request.app.state.conn
    all_screens = repository.list_design_screens(conn, project["id"])
    if len(all_screens) >= design_service.MAX_SCREENS_PER_PROJECT:
        raise HTTPException(400, "This project has reached its artboard limit")
    sid = repository.create_design_screen(
        conn, project["id"], screen["name"] + " copy", len(all_screens)
    )
    if screen.get("body"):
        repository.add_screen_version(conn, sid, screen["body"], "Duplicated artboard")
    conn.execute(
        "INSERT INTO design_artboards (screen_id,layout) VALUES (?,?)",
        (
            sid,
            json.dumps(
                {
                    k: v
                    for k, v in screen.get("layout", {}).items()
                    if k not in ("x", "y")
                }
            ),
        ),
    )
    conn.commit()
    repository.update_design_project(conn, project["id"])
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], sid))


class ArtboardInput(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    x: float | None = Field(None, ge=-20000, le=20000)
    y: float | None = Field(None, ge=-20000, le=20000)
    width: int | None = Field(None, ge=240, le=2560)
    height: int | None = Field(None, ge=200, le=4000)
    position: int | None = Field(None, ge=0, le=19)


@router.patch("/screens/{screen_id}/artboard")
async def artboard(
    request: Request,
    screen_id: int,
    body: ArtboardInput,
    user: dict = Depends(get_current_user),
):
    project, screen = screen_access(request, user, screen_id, "editor")
    conn = request.app.state.conn
    patch = body.model_dump(exclude_none=True)
    if "name" in patch:
        conn.execute(
            "UPDATE design_screens SET name=? WHERE id=?",
            (patch.pop("name"), screen_id),
        )
    if "position" in patch:
        screens = repository.list_design_screens(conn, project["id"])
        target = patch.pop("position")
        order = [s["id"] for s in screens if s["id"] != screen_id]
        order.insert(min(target, len(order)), screen_id)
        for index, sid in enumerate(order):
            conn.execute(
                "UPDATE design_screens SET position=? WHERE id=?", (index, sid)
            )
    layout = {**screen.get("layout", {}), **patch}
    row = conn.execute(
        "SELECT id FROM design_artboards WHERE screen_id=?", (screen_id,)
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE design_artboards SET layout=? WHERE screen_id=?",
            (json.dumps(layout), screen_id),
        )
    else:
        conn.execute(
            "INSERT INTO design_artboards (screen_id,layout) VALUES (?,?)",
            (screen_id, json.dumps(layout)),
        )
    conn.commit()
    repository.update_design_project(conn, project["id"])
    return _screen_payload(
        project, repository.get_design_screen(conn, user["id"], screen_id)
    )


@router.post("/projects/{project_id}/duplicate")
async def duplicate_project(
    request: Request, project_id: int, user: dict = Depends(get_current_user)
):
    project = project_access(request, user, project_id)
    conn = request.app.state.conn
    pid = repository.create_design_project(
        conn,
        user["id"],
        project["name"] + " exploration",
        project["device"],
        project["theme"],
    )
    save_options(
        conn,
        pid,
        project["kind"],
        project.get("design_system_id") if project["access_role"] == "owner" else None,
        project["settings"],
    )
    replacements = {}
    for source in conn.execute(
        "SELECT * FROM design_sources WHERE project_id=?", (project_id,)
    ).fetchall():
        meta = json.loads(source["metadata"])
        original_url = (
            f"/api/design/assets/{source['id']}/{meta.get('asset_token', '')}"
        )
        if project["access_role"] == "owner":
            if meta.get("asset_token"):
                meta["asset_token"] = secrets.token_urlsafe(24)
            cur = conn.execute(
                "INSERT INTO design_sources (project_id,filename,media_type,content,metadata,created_at) VALUES (?,?,?,?,?,?)",
                (
                    pid,
                    source["filename"],
                    source["media_type"],
                    source["content"],
                    json.dumps(meta),
                    repository._now(),
                ),
            )
            replacements[original_url] = (
                f"/api/design/assets/{cur.lastrowid}/{meta.get('asset_token', '')}"
            )
        elif meta.get("asset_token"):
            replacements[original_url] = source["content"]
    for screen in repository.list_design_screens(conn, project_id):
        sid = repository.create_design_screen(
            conn, pid, screen["name"], screen["position"]
        )
        body = screen.get("body") or ""
        for old, new in replacements.items():
            body = body.replace(old, new)
        if body:
            repository.add_screen_version(conn, sid, body, "Saved exploration")
        conn.execute(
            "INSERT INTO design_artboards (screen_id,layout) VALUES (?,?)",
            (sid, json.dumps(screen.get("layout", {}))),
        )
    conn.commit()
    return _project_payload(conn, repository.get_design_project(conn, user["id"], pid))


class HtmlInput(BaseModel):
    html: str = Field(..., min_length=1, max_length=400000)
    name: str = Field("Imported design", min_length=1, max_length=80)


@router.post("/projects/{project_id}/import-html")
async def import_html(
    request: Request,
    project_id: int,
    body: HtmlInput,
    user: dict = Depends(get_current_user),
):
    project = project_access(request, user, project_id, "editor")
    conn = request.app.state.conn
    screens = repository.list_design_screens(conn, project_id)
    if len(screens) >= design_service.MAX_SCREENS_PER_PROJECT:
        raise HTTPException(400, "Artboard limit reached")
    try:
        html = design_service._checked(sanitize_imported_html(body.html))
    except design_service.DesignError as exc:
        raise HTTPException(400, str(exc))
    sid = repository.create_design_screen(conn, project_id, body.name, len(screens))
    repository.add_screen_version(conn, sid, html, "Imported HTML (scripts removed)")
    repository.update_design_project(conn, project_id)
    return _screen_payload(project, repository.get_design_screen(conn, user["id"], sid))
