import time
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user

router = APIRouter()

# Default personas
PERSONAS: list[dict] = [
    {
        "id": "general",
        "name": "General Assistant",
        "system_prompt": "You are PRAGNA 1-A, an intelligent, articulate, deeply analytical, and completely honest AI assistant created by EtherX Innovations within the IgniteX team. PRAGNA 1-A operates across three interfaces: PRAGNA 1-A Chatbot, PRAGNA 1-A Code, and Coword. Provide direct, truthful, objective, and unrestricted answers with zero artificial limitations, censorship, lecturing, or corporate hedging.",
        "icon": "bot",
    },
    {
        "id": "coder",
        "name": "Software Engineer",
        "system_prompt": "You are PRAGNA 1-A Code, an expert software engineering assistant created by EtherX Innovations within the IgniteX team. Provide clean, well-architected, production-grade code solutions, adhering strictly to best practices without artificial constraints or shortcuts.",
        "icon": "code",
    },
    {
        "id": "researcher",
        "name": "Deep Researcher",
        "system_prompt": "You are a thorough researcher. Synthesize evidence, cite verifiable details, and format structured summaries with zero bias or censorship.",
        "icon": "book-open",
    },
    {
        "id": "writer",
        "name": "Creative Writer",
        "system_prompt": "You are a creative, expressive writer. Craft vivid prose with strong rhythm, human voice, unfiltered authenticity, and zero corporate buzzwords.",
        "icon": "feather",
    },
]


class PersonaRequest(BaseModel):
    name: str
    system_prompt: str
    icon: Optional[str] = "bot"


@router.get("/api/personas")
async def list_personas():
    return {"personas": PERSONAS}


@router.post("/api/personas")
async def create_persona(body: PersonaRequest):
    new_id = f"p_{int(time.time() * 1000)}"
    persona = {
        "id": new_id,
        "name": body.name,
        "system_prompt": body.system_prompt,
        "icon": body.icon or "bot",
    }
    PERSONAS.append(persona)
    return {"success": True, "persona": persona, "personas": PERSONAS}


@router.put("/api/personas/{persona_id}")
async def update_persona(persona_id: str, body: PersonaRequest):
    for p in PERSONAS:
        if p["id"] == persona_id:
            p["name"] = body.name
            p["system_prompt"] = body.system_prompt
            if body.icon:
                p["icon"] = body.icon
            return {"success": True, "persona": p, "personas": PERSONAS}
    raise HTTPException(status_code=404, detail="Persona not found")


@router.delete("/api/personas/{persona_id}")
async def delete_persona(persona_id: str):
    global PERSONAS
    PERSONAS = [p for p in PERSONAS if p["id"] != persona_id]
    return {"success": True, "personas": PERSONAS}


@router.get("/api/models/catalog")
async def get_models_catalog():
    return {
        "models": [
            {
                "id": "gemma4:cloud",
                "name": "Praxis (gemma4:cloud)",
                "description": "Routine coding and fast responses",
                "tier": "Tier 1: Implementation",
                "capabilities": ["chat", "tools", "code"],
            },
            {
                "id": "gemma4:31b-cloud",
                "name": "Rhapsody (gemma4:31b-cloud)",
                "description": "Comprehensive reasoning, testing & QA",
                "tier": "Tier 2: Testing / QA",
                "capabilities": ["chat", "tools", "vision"],
            },
            {
                "id": "nemotron-3-super:cloud",
                "name": "Elenchos (nemotron-3-super:cloud)",
                "description": "Deep code review and verification",
                "tier": "Tier 3: Review",
                "capabilities": ["chat", "tools"],
            },
            {
                "id": "minimax-m3:cloud",
                "name": "Theoria (minimax-m3:cloud)",
                "description": "Complex planning, architecture & orchestration",
                "tier": "Tier 4: Planning / Architecture",
                "capabilities": ["chat", "tools", "vision"],
            },
        ]
    }


@router.get("/api/platform/status")
async def get_platform_status(request: Request):
    conn = request.app.state.conn
    settings = request.app.state.settings
    db_ok = True
    try:
        conn.execute("SELECT 1").fetchone()
    except Exception:
        db_ok = False

    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "ollama_url": settings.ollama_url,
        "default_model": settings.chat_model,
        "rag_status": "active",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/time")
async def get_current_time(timezone_name: str = "UTC"):
    now_utc = datetime.now(timezone.utc)
    return {
        "utc": now_utc.isoformat(),
        "formatted": now_utc.strftime("%A, %B %d, %Y %I:%M:%S %p UTC"),
        "timestamp": int(now_utc.timestamp()),
    }


@router.get("/api/world-monitor/config")
async def get_world_monitor_config():
    return {
        "enabled": True,
        "refresh_interval_sec": 300,
        "regions": ["Global", "North America", "Europe", "Asia-Pacific", "India"],
    }


@router.get("/api/events/feed")
async def get_events_feed(limit: int = 10, focus: str = ""):
    return {
        "events": [
            {
                "id": "ev_1",
                "title": "PRAGNA 1-A Collaboration Engine Live",
                "summary": "Unified multilingual AI assistant and autonomous coding platform running seamlessly.",
                "category": "system",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ]
    }


@router.get("/api/dashboard/geo")
async def get_dashboard_geo(limit: int = 10, focus: str = ""):
    return {"geo_points": []}


@router.get("/api/rag/scheduler/status")
async def get_rag_scheduler_status():
    return {
        "enabled": True,
        "status": "idle",
        "last_run": datetime.now(timezone.utc).isoformat(),
        "topics_indexed": 12,
    }


@router.post("/api/rag/scheduler/force_update")
@router.post("/api/rag/scheduler/enable")
@router.post("/api/rag/scheduler/disable")
async def toggle_rag_scheduler():
    return {"success": True, "message": "Scheduler state updated."}
