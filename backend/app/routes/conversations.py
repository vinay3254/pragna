import json
import uuid
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, Field
from app import repository
from app.auth import get_optional_current_user, get_current_user

router = APIRouter()


class CreateConversationRequest(BaseModel):
    title: Optional[str] = "New Chat"


class RenameRequest(BaseModel):
    title: str


class PinRequest(BaseModel):
    is_pinned: bool = True


class ShareRequest(BaseModel):
    title: Optional[str] = None
    messages: Optional[list] = None


class ActiveLeafRequest(BaseModel):
    message_id: int


class SyncChat(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1, max_length=200)
    updatedAt: str = ""


class SyncRequest(BaseModel):
    chats: list[SyncChat] = Field(default_factory=list, max_length=25)
    deleted_ids: list[str] = Field(default_factory=list, max_length=5000)
    since: Optional[str] = None


@router.get("/api/conversations")
async def list_conversations(
    request: Request, q: str | None = None, current_user: dict = Depends(get_optional_current_user)
):
    return repository.list_conversations(request.app.state.conn, current_user["id"], q)


@router.post("/api/conversations")
async def create_conversation_endpoint(
    request: Request, body: Optional[CreateConversationRequest] = None, current_user: dict = Depends(get_optional_current_user)
):
    title = body.title if body and body.title else "New Chat"
    cid = repository.create_conversation(request.app.state.conn, title, current_user["id"])
    return {"id": cid, "title": title, "user_id": current_user["id"]}


@router.get("/api/conversations/{conversation_id}")
async def get_conversation(
    request: Request, conversation_id: int, current_user: dict = Depends(get_current_user)
):
    conn = request.app.state.conn
    conversation = repository.get_conversation(conn, conversation_id)
    if not conversation or conversation["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation["messages"] = repository.list_messages(conn, conversation_id)
    return conversation


@router.patch("/api/conversations/{conversation_id}")
@router.put("/api/conversations/{conversation_id}")
@router.patch("/api/chat/{conversation_id}/rename")
async def rename_conversation(
    request: Request, conversation_id: int, body: RenameRequest, current_user: dict = Depends(get_current_user)
):
    conn = request.app.state.conn
    conversation = repository.get_conversation(conn, conversation_id)
    if not conversation or conversation["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    repository.rename_conversation(conn, conversation_id, body.title)
    return {"id": conversation_id, "title": body.title, "success": True}


@router.patch("/api/chat/{conversation_id}/pin")
async def pin_chat(
    request: Request, conversation_id: int, body: Optional[PinRequest] = None, current_user: dict = Depends(get_current_user)
):
    return {"id": conversation_id, "is_pinned": body.is_pinned if body else True, "success": True}


@router.patch("/api/chat/{conversation_id}/archive")
async def archive_chat(
    request: Request, conversation_id: int, current_user: dict = Depends(get_current_user)
):
    return {"id": conversation_id, "archived": True, "success": True}


@router.delete("/api/conversations/{conversation_id}")
@router.delete("/api/chat/{conversation_id}")
async def delete_conversation(
    request: Request, conversation_id: int, current_user: dict = Depends(get_current_user)
):
    conn = request.app.state.conn
    conversation = repository.get_conversation(conn, conversation_id)
    if not conversation or conversation["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    repository.delete_conversation(conn, conversation_id)
    return {"id": conversation_id, "deleted": True, "success": True}


@router.post("/api/conversations/{conversation_id}/active-leaf")
async def set_active_leaf(
    request: Request, conversation_id: int, body: ActiveLeafRequest, current_user: dict = Depends(get_current_user)
):
    conn = request.app.state.conn
    conversation = repository.get_conversation(conn, conversation_id)
    if not conversation or conversation["user_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    updated = repository.set_active_leaf(conn, conversation_id, body.message_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found in this conversation")
    return {"conversation_id": conversation_id, "active_leaf_id": body.message_id}


@router.post("/api/chat/{conversation_id}/share")
async def share_chat(
    request: Request, conversation_id: int, body: Optional[ShareRequest] = None, current_user: dict = Depends(get_current_user)
):
    token = str(uuid.uuid4())
    conn = request.app.state.conn
    conversation = repository.get_conversation(conn, conversation_id)
    messages = body.messages if body and body.messages else (repository.list_messages(conn, conversation_id) if conversation else [])
    title = (body.title if body and body.title else (conversation["title"] if conversation else "Shared Chat"))
    repository.create_shared_conversation(
        conn,
        token=token,
        title=title,
        content=json.dumps(messages, default=str),
        owner_user_id=current_user.get("id"),
    )
    return {"success": True, "share_token": token, "share_url": f"/share/{token}"}


@router.get("/api/share/{token}")
async def get_shared_chat(request: Request, token: str):
    row = repository.get_shared_conversation(request.app.state.conn, token)
    if not row:
        raise HTTPException(status_code=404, detail="Shared chat not found or expired")
    return {"success": True, "title": row["title"], "messages": json.loads(row["content"])}


@router.get("/api/chat/search")
async def search_chats(
    request: Request, q: str = "", limit: int = 20, current_user: dict = Depends(get_current_user)
):
    results = repository.list_conversations(request.app.state.conn, current_user["id"], q)
    return {"success": True, "results": results[:limit]}


@router.post("/api/chat/sync")
async def sync_chats(request: Request, body: SyncRequest, current_user: dict = Depends(get_current_user)):
    return repository.sync_chats(
        request.app.state.conn, current_user["id"], [chat.model_dump() for chat in body.chats], body.deleted_ids, body.since
    )
