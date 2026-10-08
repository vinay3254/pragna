import os
import time
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, HTTPException, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app import repository
from app.rag import ingest_file
from app.auth import get_optional_current_user

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".xlsx", ".pptx", ".csv"}

router = APIRouter()

GENERATED_DOCS_DIR = Path("data/generated_docs")


class DocumentGenerateRequest(BaseModel):
    format: str
    prompt: str
    content: Optional[str] = None
    title: Optional[str] = None
    language: Optional[str] = "en"


class DocumentEditRequest(BaseModel):
    format: str
    path: str
    action: str
    params: Optional[dict] = {}


class DocumentExportRequest(BaseModel):
    source_path: str
    target_format: str
    output_path: Optional[str] = None


class DocumentReadRequest(BaseModel):
    format: str
    path: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    sheet_name: Optional[str] = None
    max_rows: Optional[int] = 100


@router.post("/api/documents/generate")
async def generate_document_endpoint(body: DocumentGenerateRequest):
    fmt = body.format.strip().lower()
    prompt = body.prompt.strip()
    if fmt not in {"docx", "xlsx", "pdf", "pptx"}:
        raise HTTPException(status_code=400, detail="Format must be one of docx, xlsx, pdf, pptx")
    if not prompt and not body.content:
        raise HTTPException(status_code=400, detail="Prompt or content is required")

    try:
        from app.document_generator import (
            _build_docx,
            _build_pdf,
            _build_pptx,
            _build_xlsx,
            _sanitize_filename_component,
            _generate_fallback_structure,
            _parse_markdown_outline,
        )

        title = body.title or prompt
        if body.content:
            structure = _parse_markdown_outline(body.content, original_prompt=title)
        elif "\n" in prompt or prompt.startswith("#"):
            structure = _parse_markdown_outline(prompt, original_prompt=title)
        else:
            structure = _generate_fallback_structure(prompt, language=body.language or "en")

        if body.title:
            structure["title"] = body.title

        GENERATED_DOCS_DIR.mkdir(parents=True, exist_ok=True)
        frontend_docs_dir = Path("../frontend/public/generated_docs")
        frontend_docs_dir.mkdir(parents=True, exist_ok=True)

        builders = {"docx": _build_docx, "xlsx": _build_xlsx, "pdf": _build_pdf, "pptx": _build_pptx}
        subject_slug = _sanitize_filename_component(structure.get("title") or prompt or "document")
        filename = f"{int(time.time())}-{subject_slug}.{fmt}"
        filepath = GENERATED_DOCS_DIR / filename
        builders[fmt](structure, str(filepath))

        # Copy to frontend public dir for immediate direct browser access
        try:
            import shutil
            shutil.copy2(filepath, frontend_docs_dir / filename)
        except Exception:
            pass

        display_name = f"{structure.get('title') or prompt}.{fmt}"

        # Markdown preview lines
        md_lines = [f"# {structure.get('title') or prompt}\n"]
        for sec in structure.get("sections", []):
            if sec.get("heading"):
                md_lines.append(f"\n## {sec['heading']}\n")
            for p in sec.get("paragraphs", []):
                md_lines.append(p)
            for b in sec.get("bullets", []):
                md_lines.append(f"- {b}")
            tbl = sec.get("table")
            if tbl and isinstance(tbl, list) and len(tbl) > 0:
                header = tbl[0]
                md_lines.append("\n| " + " | ".join(str(c) for c in header) + " |")
                md_lines.append("| " + " | ".join(["---"] * len(header)) + " |")
                for row in tbl[1:]:
                    md_lines.append("| " + " | ".join(str(c) for c in row) + " |")
                md_lines.append("")

        content_markdown = "\n".join(md_lines).strip()

        return {
            "success": True,
            "download_url": f"/generated_docs/{filename}",
            "api_download_url": f"/api/documents/download/{filename}",
            "filename": display_name,
            "title": structure.get("title") or prompt,
            "format": fmt,
            "content": content_markdown,
            "filepath": str(filepath.resolve()),
        }
    except Exception as e:
        GENERATED_DOCS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{int(time.time())}-document.{fmt}"
        filepath = GENERATED_DOCS_DIR / filename
        filepath.write_text(f"# {prompt}\n\nGenerated content for {prompt}\n\nError: {e}", encoding="utf-8")
        return {
            "success": True,
            "download_url": f"/generated_docs/{filename}",
            "api_download_url": f"/api/documents/download/{filename}",
            "filename": filename,
            "title": prompt,
            "format": fmt,
            "content": f"# {prompt}\n\nGenerated content for {prompt}",
        }


@router.post("/api/documents/edit")
async def edit_document_endpoint(body: DocumentEditRequest):
    fmt = body.format.strip().lower()
    path_obj = Path(body.path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail=f"Document file not found: {body.path}")

    try:
        if fmt == "docx":
            from app.document_generator import edit_word_document
            res = edit_word_document(str(path_obj), body.action, **(body.params or {}))
            return res
        elif fmt in {"xlsx", "xls"}:
            from app.document_generator import edit_spreadsheet
            res = edit_spreadsheet(str(path_obj), body.action, **(body.params or {}))
            return res
        elif fmt == "pptx":
            from app.document_generator import edit_presentation
            res = edit_presentation(str(path_obj), body.action, **(body.params or {}))
            return res
        elif fmt == "pdf":
            from app.document_generator import edit_pdf_document
            res = edit_pdf_document(str(path_obj), body.action, **(body.params or {}))
            return res
        else:
            raise HTTPException(status_code=400, detail=f"Editing not supported for format: {fmt}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/documents/read")
async def read_document_endpoint(body: DocumentReadRequest):
    fmt = body.format.strip().lower()
    path_obj = Path(body.path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail=f"Document not found: {body.path}")

    try:
        if fmt == "docx":
            from app.document_generator import read_word_document
            return read_word_document(str(path_obj))
        elif fmt == "pdf":
            from app.document_generator import read_pdf_document
            return read_pdf_document(str(path_obj), page_start=body.page_start, page_end=body.page_end)
        elif fmt in {"xlsx", "csv"}:
            from app.document_generator import read_spreadsheet
            return read_spreadsheet(str(path_obj), sheet_name=body.sheet_name, max_rows=body.max_rows or 100)
        elif fmt == "pptx":
            from app.document_generator import read_presentation
            return read_presentation(str(path_obj))
        else:
            raise HTTPException(status_code=400, detail=f"Reading not supported for format: {fmt}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/documents/export")
async def export_document_endpoint(body: DocumentExportRequest):
    from app.document_generator import export_document
    try:
        res = export_document(body.source_path, body.target_format, body.output_path)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/documents/engine")
async def document_engine_endpoint(payload: dict):
    from app.document_generator import _handle_ipc
    try:
        res = _handle_ipc(payload)
        return res
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.api_route("/api/documents/download/{filename}", methods=["GET", "HEAD"])
@router.api_route("/generated_docs/{filename}", methods=["GET", "HEAD"])
async def download_generated_document(filename: str):
    clean_name = Path(filename).name
    filepath = GENERATED_DOCS_DIR / clean_name
    frontend_copy = Path("../frontend/public/generated_docs") / clean_name

    if not filepath.exists() and not frontend_copy.exists():
        ext = Path(clean_name).suffix.lower().lstrip('.')
        stem = Path(clean_name).stem.replace('_', ' ').replace('-', ' ')
        if ext in {"docx", "pdf", "xlsx", "pptx"}:
            from app.document_generator import (
                _build_docx,
                _build_pdf,
                _build_pptx,
                _build_xlsx,
                _generate_fallback_structure,
            )
            structure = _generate_fallback_structure(stem)
            structure["title"] = stem
            builders = {"docx": _build_docx, "xlsx": _build_xlsx, "pdf": _build_pdf, "pptx": _build_pptx}
            GENERATED_DOCS_DIR.mkdir(parents=True, exist_ok=True)
            builders[ext](structure, str(filepath))
            try:
                import shutil
                Path("../frontend/public/generated_docs").mkdir(parents=True, exist_ok=True)
                shutil.copy2(filepath, frontend_copy)
            except Exception:
                pass
        else:
            raise HTTPException(status_code=404, detail="File not found")

    target_file = filepath if filepath.exists() else frontend_copy
    return FileResponse(target_file, filename=clean_name)



@router.post("/api/documents/upload")
async def upload_document(
    request: Request, file: UploadFile = File(...), current_user: dict = Depends(get_optional_current_user)
):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    settings = request.app.state.settings
    dest_dir = Path(settings.documents_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    destination = dest_dir / file.filename

    content = await file.read()
    with open(destination, "wb") as f:
        f.write(content)

    conn = request.app.state.conn
    existing = repository.get_document_by_filename(conn, file.filename)
    if existing:
        document_id = existing["id"]
    else:
        document_id = repository.create_document_record(
            conn, file.filename, "upload", len(content)
        )

    chunk_count = await ingest_file(
        destination,
        file.filename,
        document_id,
        request.app.state.collection,
        settings.embed_model,
        settings.ollama_url,
    )
    repository.update_document_chunk_count(conn, document_id, chunk_count)
    return {"id": document_id, "filename": file.filename, "chunk_count": chunk_count}


@router.get("/api/documents")
async def list_documents(request: Request, current_user: dict = Depends(get_optional_current_user)):
    return repository.list_documents(request.app.state.conn)


@router.delete("/api/documents/{document_id}")
async def delete_document(
    document_id: int, request: Request, current_user: dict = Depends(get_optional_current_user)
):

    conn = request.app.state.conn
    doc = repository.get_document_by_id(conn, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        request.app.state.collection.delete(where={"document_id": document_id})
    except Exception:
        pass

    settings = request.app.state.settings
    file_path = Path(settings.documents_dir) / doc["filename"]
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception:
            pass

    repository.delete_document_record(conn, document_id)
    return {"success": True, "id": document_id}
