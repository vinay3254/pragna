from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from app.auth import get_current_user
from app.design_exports import handoff_bundle, visual_export
from app.routes.design_workspace import project_access

router = APIRouter(prefix="/api/design")


@router.get("/projects/{project_id}/download/{format}")
async def download(
    request: Request,
    project_id: int,
    format: str,
    user: dict = Depends(get_current_user),
):
    project = project_access(request, user, project_id)
    if format not in {"pdf", "pptx", "handoff"}:
        raise HTTPException(400, "Choose PDF, PPTX or handoff")
    try:
        data = (
            handoff_bundle(request.app.state.conn, project)
            if format == "handoff"
            else await visual_export(request.app.state.conn, project, format)
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(
            503,
            "Export renderer unavailable. Check that Playwright Chromium is installed, or export HTML.",
        )
    media = {
        "pdf": "application/pdf",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "handoff": "application/zip",
    }[format]
    ext = "zip" if format == "handoff" else format
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="pragna-design.{ext}"'},
    )
