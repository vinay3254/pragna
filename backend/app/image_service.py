import base64
import logging
import os
import random
import urllib.parse
from typing import Any
import httpx

logger = logging.getLogger("pragna.image")

OMNIROUTE_BASE_URL = os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128").rstrip("/")
OMNIROUTE_API_KEY = os.getenv("OMNIROUTE_API_KEY", "sk-83ef8c640f53be5d-74e79d-e4fe3585")
STABILITY_API_BASE = "https://api.stability.ai/v2beta/stable-image"
MODEL = "sd3.5-large-turbo"


def _error_from_response(resp: httpx.Response) -> str:
    try:
        detail = resp.json().get("errors", [resp.text])
        message = "; ".join(detail) if isinstance(detail, list) else str(detail)
    except Exception:
        message = resp.text
    return f"Stability AI request failed ({resp.status_code}): {message[:300]}"


def _save_base64_image(img_b64: str) -> str:
    try:
        import time
        import uuid
        from pathlib import Path
        possible_dirs = [
            Path("/home/vinay/pragna_main/frontend/public/generated_images"),
            Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "generated_images",
        ]
        target_dir = None
        for p in possible_dirs:
            if p.parent.exists():
                p.mkdir(parents=True, exist_ok=True)
                target_dir = p
                break
        if target_dir:
            filename = f"img_{int(time.time())}_{uuid.uuid4().hex[:6]}.png"
            filepath = target_dir / filename
            filepath.write_bytes(base64.b64decode(img_b64))
            return f"/generated_images/{filename}"
    except Exception as e:
        logger.warning(f"Could not write image to public dir: {e}")
    return f"data:image/png;base64,{img_b64}"


_gemini_blocked_until: float = 0.0


async def generate_image(prompt: str, api_key: str = "", aspect_ratio: str = "1:1") -> dict[str, Any]:
    global _gemini_blocked_until
    import time

    # Calculate optimal size for speed
    size = "512x512"
    if aspect_ratio == "16:9":
        size = "768x512"
    elif aspect_ratio == "9:16":
        size = "512x768"
    elif aspect_ratio == "4:3":
        size = "640x512"
    elif aspect_ratio == "3:4":
        size = "512x640"

    # 1. Primary: OmniRoute Image Generation (using local OmniRoute gateway)
    omni_key = os.getenv("OMNIROUTE_API_KEY") or OMNIROUTE_API_KEY
    if omni_key:
        models_to_try = []
        now = time.time()
        # Only attempt Gemini if not currently quota blocked
        if now >= _gemini_blocked_until:
            models_to_try.append("antigravity/gemini-3.1-flash-image")
        # High-speed models on AI Horde (8+ workers, 5-6s response time)
        models_to_try.append("aihorde/stable_diffusion")
        models_to_try.append("aihorde/AlbedoBase XL (SDXL)")
        models_to_try.append("aihorde/Flux.1-Schnell fp8 (Compact)")

        for model_name in models_to_try:
            try:
                payload: dict[str, Any] = {
                    "model": model_name,
                    "prompt": prompt,
                }
                if "aihorde" in model_name:
                    payload["size"] = size

                async with httpx.AsyncClient(timeout=35.0) as client:
                    resp = await client.post(
                        f"{OMNIROUTE_BASE_URL}/v1/images/generations",
                        headers={"Authorization": f"Bearer {omni_key}", "Content-Type": "application/json"},
                        json=payload,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        item = data.get("data", [{}])[0]
                        img_b64 = item.get("b64_json", "")
                        img_url = item.get("url", "")
                        final_url = _save_base64_image(img_b64) if img_b64 else img_url
                        if final_url:
                            return {
                                "success": True,
                                "prompt": prompt,
                                "summary": f"Generated an image of: {prompt}\n\n![{prompt}]({final_url})",
                                "image_base64": img_b64,
                                "image_url": final_url,
                            }
                    elif resp.status_code == 429 and "gemini" in model_name:
                        # Block Gemini attempts for 15 minutes so requests don't lag
                        _gemini_blocked_until = now + 900
                        logger.warning(f"OmniRoute Gemini quota exhausted, skipping for 15m")
                    else:
                        logger.warning(f"OmniRoute model {model_name} failed ({resp.status_code}): {resp.text[:200]}")
            except Exception as e:
                logger.warning(f"OmniRoute model {model_name} exception ({e}), trying next model")

    # 2. Secondary: Stability AI fallback if API key is provided
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{STABILITY_API_BASE}/generate/sd3",
                    headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
                    files={"none": (None, "")},
                    data={
                        "prompt": prompt,
                        "mode": "text-to-image",
                        "model": MODEL,
                        "aspect_ratio": aspect_ratio,
                        "output_format": "png",
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                img_b64 = data.get("image", "")
                final_url = _save_base64_image(img_b64)
                return {
                    "success": True,
                    "prompt": prompt,
                    "summary": f"Generated an image of: {prompt}\n\n![{prompt}]({final_url})",
                    "image_base64": img_b64,
                    "image_url": final_url,
                }
            else:
                logger.warning(f"Stability error ({resp.status_code}): {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Stability generate exception ({e})")

    return {
        "success": False,
        "error": "Image generation failed in OmniRoute. Please ensure OmniRoute is running.",
    }


async def edit_image(image_base64: str, prompt: str, api_key: str, strength: float = 0.35) -> dict[str, Any]:
    if not api_key:
        return {"success": False, "error": "No Stability AI API key configured (STABILITY_API_KEY)."}
    try:
        image_bytes = base64.b64decode(image_base64)
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{STABILITY_API_BASE}/generate/sd3",
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
                files={"image": ("image.png", image_bytes, "image/png")},
                data={
                    "prompt": prompt,
                    "mode": "image-to-image",
                    "model": MODEL,
                    "strength": str(strength),
                    "output_format": "png",
                },
            )
        if resp.status_code != 200:
            logger.error(f"Stability edit error {resp.status_code}: {resp.text[:500]}")
            return {"success": False, "error": _error_from_response(resp)}
        data = resp.json()
        img_b64 = data.get("image", "")
        data_url = f"data:image/png;base64,{img_b64}"
        return {
            "success": True,
            "prompt": prompt,
            "summary": f"Edited the image: {prompt}\n\n![{prompt}]({data_url})",
            "image_base64": img_b64,
            "image_url": data_url,
        }
    except Exception as e:
        logger.error(f"Stability edit exception: {e}")
        return {"success": False, "error": str(e)}
