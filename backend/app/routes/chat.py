import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Request, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from app.chat_service import generate_reply, _UNSET, ALLOWED_MODELS
from app.auth import get_optional_current_user, get_current_user
from app import repository

logger = logging.getLogger("pragna.chat")
router = APIRouter()


async def _handle_chat_stream(request: Request, body: dict, current_user: dict):
    conversation_id = body.get("conversation_id") or body.get("chat_id")
    if isinstance(conversation_id, str) and not conversation_id.isdigit():
        conversation_id = None
    elif conversation_id is not None:
        conversation_id = int(conversation_id)

    message = body.get("message") or body.get("text") or body.get("prompt") or ""
    
    # Model resolution
    fallbacks = body.get("fallback_models")
    first_fallback = fallbacks[0] if isinstance(fallbacks, list) and len(fallbacks) > 0 else None
    model = (
        body.get("model")
        or body.get("model_override")
        or first_fallback
        or request.app.state.settings.chat_model
        or "gemma4:cloud"
    )
    if model not in ALLOWED_MODELS and ":" not in model:
        model = request.app.state.settings.chat_model or "gemma4:cloud"

    document_ids = body.get("document_ids")
    preferred_language = body.get("preferred_language") or body.get("preferredLanguage") or body.get("language")
    state = request.app.state

    parent_id = body.get("parent_id") if "parent_id" in body else _UNSET

    memories_collection = getattr(state, "memories_collection", None)
    browser_service = getattr(state, "browser_service", None)

    async def event_stream():
        try:
            async for event in generate_reply(
                state.conn, state.collection, state.settings,
                conversation_id, message, model, parent_id,
                user_id=current_user["id"],
                memories_collection=memories_collection,
                browser_service=browser_service,
                document_ids=document_ids,
                preferred_language=preferred_language,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.exception("Error during chat stream")
            err_event = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err_event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/chat")
async def chat_endpoint(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    return await _handle_chat_stream(request, body, current_user)


@router.post("/api/chat_stream")
async def chat_stream_endpoint(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    return await _handle_chat_stream(request, body, current_user)


@router.post("/api/orchestrator/query")
async def orchestrator_query(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    # If client accepts event-stream, stream it; otherwise collect and return JSON
    accept = request.headers.get("accept", "")
    if "text/event-stream" in accept:
        return await _handle_chat_stream(request, body, current_user)
    
    # Non-streaming response collection
    message = body.get("message") or body.get("text") or ""
    model = body.get("model") or body.get("model_override") or request.app.state.settings.chat_model or "gemma4:cloud"
    state = request.app.state
    full_text = ""
    sources = []
    
    async for event in generate_reply(
        state.conn, state.collection, state.settings,
        None, message, model, _UNSET,
        user_id=current_user["id"],
        memories_collection=getattr(state, "memories_collection", None),
        browser_service=getattr(state, "browser_service", None),
    ):
        if event.get("type") == "token" or event.get("type") == "content":
            full_text += event.get("content", "")
        elif event.get("type") == "done":
            sources = event.get("sources", [])

    return {
        "reply": full_text,
        "text": full_text,
        "content": full_text,
        "sources": sources,
        "actions": [],
    }


@router.post("/api/process_text")
async def process_text(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    return await orchestrator_query(request, current_user)


@router.post("/api/orchestrator/analyze_uploads")
async def analyze_uploads(
    request: Request,
    message: str = Form(""),
    language: str = Form("en"),
    user_id: str = Form(""),
    chat_mode: str = Form("general"),
    files: List[UploadFile] = File([]),
    current_user: dict = Depends(get_optional_current_user),
):
    # Ingest uploaded files into temporary/RAG collection if any
    uploaded_summaries = []
    for f in files:
        uploaded_summaries.append(f"Uploaded file: {f.filename}")
    
    combined_message = message
    if uploaded_summaries:
        combined_message += "\n\n[Attached Files]:\n" + "\n".join(uploaded_summaries)
    
    state = request.app.state
    full_text = ""
    sources = []
    async for event in generate_reply(
        state.conn, state.collection, state.settings,
        None, combined_message, state.settings.chat_model, _UNSET,
        user_id=current_user["id"],
        memories_collection=getattr(state, "memories_collection", None),
        browser_service=getattr(state, "browser_service", None),
    ):
        if event.get("type") == "token" or event.get("type") == "content":
            full_text += event.get("content", "")
        elif event.get("type") == "done":
            sources = event.get("sources", [])

    return {
        "reply": full_text,
        "text": full_text,
        "content": full_text,
        "sources": sources,
        "actions": [],
    }


@router.post("/api/compare")
async def compare_models(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    prompt = body.get("prompt") or body.get("message") or ""
    models = body.get("models", ["gemma4:cloud", "nemotron-3-super:cloud"])
    results = {}
    state = request.app.state
    
    for m in models[:3]:
        resp_text = ""
        try:
            async for event in generate_reply(
                state.conn, state.collection, state.settings,
                None, prompt, m, _UNSET,
                user_id=current_user["id"],
            ):
                if event.get("type") in ("token", "content"):
                    resp_text += event.get("content", "")
            results[m] = {"response": resp_text, "success": True}
        except Exception as e:
            results[m] = {"response": f"Error: {e}", "success": False}
            
    return {"success": True, "results": results}


@router.post("/api/summarize_chat")
async def summarize_chat(request: Request, current_user: dict = Depends(get_optional_current_user)):
    body = await request.json()
    messages = body.get("messages", [])
    if not messages:
        return {"summary": "No messages to summarize."}
    
    summary_prompt = "Summarize the following conversation in 2-3 concise sentences:\n\n"
    for m in messages[-10:]:
        role = m.get("sender") or m.get("role") or "user"
        text = m.get("text") or m.get("content") or ""
        summary_prompt += f"{role}: {text}\n"

    state = request.app.state
    summary = ""
    async for event in generate_reply(
        state.conn, state.collection, state.settings,
        None, summary_prompt, state.settings.chat_model, _UNSET,
        user_id=current_user["id"],
    ):
        if event.get("type") in ("token", "content"):
            summary += event.get("content", "")

    return {"summary": summary.strip() or "Summary complete."}
