import asyncio
import os
import sys
from pathlib import Path

# Fix Playwright on Windows: SelectorEventLoop (default) doesn't support
# subprocess creation needed by Playwright. Switch to ProactorEventLoop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import Settings, get_settings
from app.rate_limit import RateLimitMiddleware
from app.db import init_db, get_connection
from app.rag import get_chroma_collection, ingest_file
from app.memory_service import get_memories_chroma_collection
from app.browser_service import BrowserService
from app import repository
from app.routes import (
    health,
    conversations,
    documents,
    chat,
    messages,
    artifacts,
    memories,
    tools,
    auth,
    oauth,
    voice,
    images,
    system,
    agent,
    browser,
    billing,
)

# Populates os.environ from backend/.env -- needed because a few keys
# (BRAVE_SEARCH_API_KEY, STABILITY_API_KEY) are read via plain os.getenv()
# in tools.py rather than through the pydantic Settings class, which has
# its own separate .env loading that doesn't touch os.environ.
load_dotenv()


def _cors_origins(settings: Settings) -> list[str]:
    raw = settings.cors_allow_origins or ""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if settings.frontend_public_url and settings.frontend_public_url not in parts:
        parts.append(settings.frontend_public_url)
    if not parts:
        parts = ["http://localhost:5173", "http://localhost:5180", "http://localhost:4028", "http://localhost:3000"]
    return parts


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    fastapi_app = FastAPI(title="pragna", description="PRAGNA 1-A UI + Engine Backend")
    fastapi_app.state.settings = settings

    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    fastapi_app.add_middleware(RateLimitMiddleware)

    @fastapi_app.on_event("startup")
    async def startup():
        init_db(settings.db_path, settings.database_url)
        fastapi_app.state.conn = get_connection(settings.db_path, settings.database_url)
        fastapi_app.state.collection = get_chroma_collection(settings)
        fastapi_app.state.memories_collection = get_memories_chroma_collection(settings)
        fastapi_app.state.browser_service = BrowserService()

        if settings.email_auth_enabled and not settings.is_emailjs_configured():
            import logging
            logging.getLogger(__name__).warning(
                "EMAIL_AUTH_ENABLED is True but EmailJS configuration is incomplete. "
                "Email auth endpoints will return 503 Service Unavailable until configured."
            )

        from app.cron_service import run_scheduled_jobs_worker
        import asyncio
        asyncio.create_task(run_scheduled_jobs_worker(fastapi_app.state.conn))

        documents_dir = Path(settings.documents_dir)
        documents_dir.mkdir(parents=True, exist_ok=True)
        for file_path in sorted(documents_dir.iterdir()):
            if not file_path.is_file():
                continue
            if repository.document_exists(fastapi_app.state.conn, file_path.name):
                continue
            document_id = repository.create_document_record(
                fastapi_app.state.conn, file_path.name, "folder", 0
            )
            chunk_count = await ingest_file(
                file_path,
                file_path.name,
                document_id,
                fastapi_app.state.collection,
                settings.embed_model,
                settings.ollama_url,
            )
            repository.update_document_chunk_count(
                fastapi_app.state.conn, document_id, chunk_count
            )

    fastapi_app.include_router(health.router)
    fastapi_app.include_router(auth.router)
    fastapi_app.include_router(oauth.router)
    fastapi_app.include_router(conversations.router)
    fastapi_app.include_router(documents.router)
    fastapi_app.include_router(chat.router)
    fastapi_app.include_router(messages.router)
    fastapi_app.include_router(artifacts.router)
    fastapi_app.include_router(memories.router)
    fastapi_app.include_router(tools.router)
    fastapi_app.include_router(voice.router)
    fastapi_app.include_router(images.router)
    fastapi_app.include_router(system.router)
    fastapi_app.include_router(agent.router)
    fastapi_app.include_router(browser.router)
    fastapi_app.include_router(billing.router)
    return fastapi_app


app = create_app()
