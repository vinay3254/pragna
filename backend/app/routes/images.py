import os
import time
import uuid
import urllib.parse
from typing import Optional
from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_user
from app.image_service import generate_image as generate_stability_image

router = APIRouter()

# In-memory image history store
IMAGE_HISTORY: list[dict] = []


class ImageGenerateRequest(BaseModel):
    prompt: str
    style: Optional[str] = "cinematic"
    quality: Optional[str] = "hd"
    size: Optional[str] = "1024x1024"
    user_id: Optional[str] = None


@router.get("/api/images/config")
async def get_images_config():
    return {
        "styles": [
            {"value": "cinematic", "label": "Cinematic"},
            {"value": "photo", "label": "Photorealistic"},
            {"value": "illustration", "label": "Illustration"},
            {"value": "concept_art", "label": "Concept Art"},
            {"value": "product", "label": "Product Shot"},
            {"value": "anime", "label": "Anime / Manga"},
            {"value": "digital_art", "label": "Digital Art"},
            {"value": "fantasy", "label": "Fantasy Landscape"},
        ],
        "qualities": [
            {"value": "hd", "label": "HD Quality"},
            {"value": "standard", "label": "Standard"},
            {"value": "draft", "label": "Draft / Fast"},
        ],
        "sizes": [
            {"value": "1024x1024", "label": "Square (1024x1024)"},
            {"value": "1024x1536", "label": "Portrait (1024x1536)"},
            {"value": "1536x1024", "label": "Landscape (1536x1024)"},
        ],
        "providers": ["stability", "pollinations"],
    }


@router.post("/api/images/generate")
@router.post("/api/generate_image")
async def generate_image_endpoint(
    request: Request, body: ImageGenerateRequest
):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    style_prompt = f"{prompt}, {body.style} style, high quality, detailed"
    stability_key = os.getenv("STABILITY_API_KEY")

    image_url = None
    image_base64 = None
    provider = "pollinations"

    if stability_key:
        ratio = "1:1"
        if body.size == "1024x1536":
            ratio = "2:3"
        elif body.size == "1536x1024":
            ratio = "3:2"
        res = await generate_stability_image(style_prompt, stability_key, aspect_ratio=ratio)
        if res.get("success") and res.get("image_base64"):
            image_base64 = res["image_base64"]
            image_url = f"data:image/png;base64,{image_base64}"
            provider = "stability"

    if not image_url:
        # Fallback to Pollinations.ai
        w, h = 1024, 1024
        if body.size == "1024x1536":
            w, h = 1024, 1536
        elif body.size == "1536x1024":
            w, h = 1536, 1024
        encoded = urllib.parse.quote(style_prompt)
        seed = int(time.time() * 1000) % 1000000
        image_url = f"https://image.pollinations.ai/prompt/{encoded}?width={w}&height={h}&seed={seed}&nologo=true"
        provider = "pollinations-fallback"

    image_id = str(uuid.uuid4())
    record = {
        "id": image_id,
        "image_id": image_id,
        "prompt": prompt,
        "style": body.style,
        "quality": body.quality,
        "size": body.size,
        "image_url": image_url,
        "image_base64": image_base64,
        "provider": provider,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "user_id": body.user_id,
    }
    IMAGE_HISTORY.insert(0, record)

    return {
        "success": True,
        "image_url": image_url,
        "image_base64": image_base64,
        "image": image_url,
        "prompt": prompt,
        "provider": provider,
        "id": image_id,
    }


@router.get("/api/images/history")
async def get_image_history(request: Request, limit: int = 50):
    return {"success": True, "history": IMAGE_HISTORY[:limit]}


@router.delete("/api/images/history/{image_id}")
async def delete_image_history_item(image_id: str):
    global IMAGE_HISTORY
    IMAGE_HISTORY = [item for item in IMAGE_HISTORY if item.get("id") != image_id and item.get("image_id") != image_id]
    return {"success": True, "deleted": image_id}


@router.delete("/api/images/history")
async def clear_image_history():
    global IMAGE_HISTORY
    IMAGE_HISTORY = []
    return {"success": True, "cleared": True}
