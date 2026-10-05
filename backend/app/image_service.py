import asyncio
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


def generated_images_dir():
    """Where generated pictures are stored (Next serves it as /generated_images), or None if it cannot be found."""
    from pathlib import Path
    for p in (
        Path("/home/vinay/pragna_main/frontend/public/generated_images"),
        Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "generated_images",
    ):
        if p.parent.exists():
            p.mkdir(parents=True, exist_ok=True)
            return p
    return None


def save_base64_image(img_b64: str, max_width: int | None = None) -> str:
    """Store a picture under frontend/public/generated_images and return its URL path.
    With max_width the picture is shrunk to that width and saved as JPEG, so it is light enough to embed."""
    try:
        import time
        import uuid
        target_dir = generated_images_dir()
        if target_dir:
            raw = base64.b64decode(img_b64)
            ext = "png"
            if max_width:
                import io
                from PIL import Image
                img = Image.open(io.BytesIO(raw))
                if img.width > max_width:
                    img = img.resize((max_width, round(img.height * max_width / img.width)), Image.LANCZOS)
                buf = io.BytesIO()
                img.convert("RGB").save(buf, "JPEG", quality=84, optimize=True)
                raw, ext = buf.getvalue(), "jpg"
            filename = f"img_{int(time.time())}_{uuid.uuid4().hex[:6]}.{ext}"
            (target_dir / filename).write_bytes(raw)
            return f"/generated_images/{filename}"
    except Exception as e:
        logger.warning(f"Could not write image to public dir: {e}")
    return f"data:image/png;base64,{img_b64}"


COMMONS_API = "https://commons.wikimedia.org/w/api.php"
STOCK_USER_AGENT = "PragnaDesign/1.0 (local dev; contact via repo owner)"
STOCK_MAX_BYTES = 8_000_000
_stock_gate = asyncio.Semaphore(2)  # Commons answers a burst of searches with an error page
_FREE_LICENSES = ("public domain", "cc0", "pdm")  # no attribution owed, so a design can use the photo as is


_stock_cache: dict[str, list[tuple[float, str]]] = {}  # query -> [(width / height, thumbnail URL)]


async def _stock_candidates(client: httpx.AsyncClient, query: str) -> list[tuple[float, str]] | None:
    """Free-licence photos on Commons for query. Cached, so each phrase is searched once however many slots use it.
    None when Commons could not be asked (not cached, so a later call tries again)."""
    if query in _stock_cache:
        return _stock_cache[query]
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 20,
        "gsrsearch": f"filetype:bitmap {query}", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": 1280,
    }
    async with _stock_gate:
        found = await client.get(COMMONS_API, params=params)
        if found.status_code == 429:  # throttled: wait as long as it asks (at most 10s), then try once more
            await asyncio.sleep(min(float(found.headers.get("retry-after", 3)), 10))
            found = await client.get(COMMONS_API, params=params)
    if found.status_code != 200:
        logger.warning("Stock photo search for %r got HTTP %s", query, found.status_code)
        return None
    candidates = []
    for page in (found.json().get("query", {}).get("pages") or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        license_name = (info.get("extmetadata", {}).get("LicenseShortName", {}).get("value") or "").lower()
        url = info.get("thumburl") or ""
        if (
            info.get("mime") in ("image/jpeg", "image/png")
            and info.get("width", 0) >= 800 and info.get("height")
            and any(f in license_name for f in _FREE_LICENSES)
            and url.startswith("https://upload.wikimedia.org/")
        ):
            candidates.append((info["width"] / info["height"], url))
    _stock_cache[query] = candidates
    return candidates


async def find_stock_photo(query: str, aspect: float, skip: set[str] | None = None) -> str | None:
    """A public-domain or CC0 photo from Wikimedia Commons for query, as base64. The result whose shape is
    closest to `aspect` (width / height) wins. URLs in `skip` are passed over, and the one used is added to it,
    so a design does not show the same photo twice. None when nothing suitable is found."""
    skip = skip if skip is not None else set()
    try:
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": STOCK_USER_AGENT}) as client:
            candidates = await _stock_candidates(client, query)
            usable = [(abs(a - aspect), url) for a, url in candidates or [] if url not in skip]
            if not usable:
                return None
            chosen = min(usable)[1]
            async with _stock_gate:
                resp = await client.get(chosen)
                if resp.status_code == 429:  # same courtesy as the search: wait as asked, once
                    await asyncio.sleep(min(float(resp.headers.get("retry-after", 3)), 10))
                    resp = await client.get(chosen)
            resp.raise_for_status()
            if len(resp.content) > STOCK_MAX_BYTES:
                return None
            skip.add(chosen)
            return base64.b64encode(resp.content).decode()
    except Exception as exc:
        logger.warning("Stock photo search for %r failed: %s", query, exc)
        return None


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
                        final_url = save_base64_image(img_b64) if img_b64 else img_url
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
                final_url = save_base64_image(img_b64)
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
