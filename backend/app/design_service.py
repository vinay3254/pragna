"""Pragna Design: prompt -> one complete interactive Tailwind design.

The model writes only a screen's <body>. The server owns everything around it
(Tailwind config, theme tokens, fonts, the editor's selection script), so a
theme change re-renders every screen with no LLM call.
"""
import asyncio
import base64
import json
import logging
import re
import time
import urllib.parse
from typing import AsyncGenerator

import httpx

from app import image_service, repository
from app.ollama_client import chat_stream

logger = logging.getLogger(__name__)

STOCK = "stock"
# Code comes from Gemini 3.7 Flash; Codex is used for pictures only (same models as the chat image tool).
# The same model and output budget the Pragna CLI uses for design work: the high-reasoning variant, 64k tokens.
DESIGN_MODEL = "antigravity/gemini-3.7-flash-high"
DESIGN_MAX_TOKENS = 65536
# Picture sources in order: Codex, then a public-domain photo from Wikimedia Commons, then Gemini image.
IMAGE_SOURCES = ("codex/gpt-5.6-terra", "codex/gpt-5.6-luna", STOCK, "antigravity/gemini-3.1-flash-image")
PROVIDER_COOLDOWN_SECONDS = 60
LLM_TIMEOUT_SECONDS = 300  # a full page from the high-reasoning model takes about 100s
IMAGE_TIMEOUT_SECONDS = 120
MAX_IMAGES_PER_SCREEN = 4
IMAGE_MAX_WIDTH = 1280
MAX_PARALLEL_IMAGES = 1  # Codex and Gemini both answer 429 when sent bursts
_image_gate = asyncio.Semaphore(MAX_PARALLEL_IMAGES)
_provider_blocked_until: dict[str, float] = {}  # "codex" -> monotonic time its 429 cooldown ends
MAX_SCREENS_PER_GENERATE = 1
MAX_SCREENS_PER_PROJECT = 20
MAX_PARALLEL_SCREENS = 3
MAX_BODY_BYTES = 400_000  # a screen written with the full 64k-token budget can pass 200KB
DEFAULT_PROJECT_NAME = "Untitled design"
DEVICES = {"mobile": 390, "web": 1280}

SURFACES = ["Monitor", "Operate", "Compare", "Configure", "Decide/Learn", "Explore", "Inspect"]
FONTS = ["Inter", "Poppins", "DM Sans", "Roboto", "Manrope", "Space Grotesk", "Playfair Display", "Lora"]
COLOR_KEYS = ["primary", "on_primary", "surface", "background", "foreground", "muted", "border"]
DEFAULT_THEME = {
    "primary": "#6d5efc",
    "on_primary": "#ffffff",
    "surface": "#ffffff",
    "background": "#f6f6f9",
    "foreground": "#111827",
    "muted": "#6b7280",
    "border": "#e5e7eb",
    "radius": "12px",
    "font": "Inter",
}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_RADIUS = re.compile(r"^\d{1,2}(px|rem)$")


class DesignError(Exception):
    """A failure whose message is safe to show the user."""


def validate_theme(theme: dict | None) -> dict:
    """Merge over defaults and reject anything that is not a plain token value.

    Theme values are interpolated into the page <head>, so only hex colors, a
    short radius and an allow-listed font are accepted.
    """
    merged = {**DEFAULT_THEME, **(theme or {})}
    for key in COLOR_KEYS:
        if not isinstance(merged[key], str) or not _HEX.match(merged[key]):
            raise DesignError(f"Theme color '{key}' must be a hex value like #1a2b3c")
    if not isinstance(merged["radius"], str) or not _RADIUS.match(merged["radius"]):
        raise DesignError("Theme radius must look like 12px or 1rem")
    if merged["font"] not in FONTS:
        raise DesignError(f"Theme font must be one of: {', '.join(FONTS)}")
    return {k: merged[k] for k in DEFAULT_THEME}


# --- Rendering -------------------------------------------------------------

_SELECT_SCRIPT = """
<script>
(function () {
  var SID = %(screen_id)d, hover = null, picked = null, mode = 'select', ACCENT = '%(accent)s';
  var originals = new WeakMap();
  function send(type, data) { parent.postMessage(Object.assign({ source: 'pragna-design', type: type, screenId: SID }, data || {}), '*'); }
  function mark(el, on) {
    if (!el || !el.style) return;
    if (on) {
      if (!originals.has(el)) originals.set(el, [el.style.outline, el.style.outlineOffset]);
      el.style.outline = '2px solid ' + ACCENT; el.style.outlineOffset = '-2px';
    } else if (originals.has(el)) {
      var old = originals.get(el); el.style.outline = old[0]; el.style.outlineOffset = old[1]; originals.delete(el);
    }
  }
  function clear() { mark(hover, false); mark(picked, false); hover = null; picked = null; }
  function path(el) {
    var parts = [];
    while (el && el !== document.body) {
      var index = Array.prototype.indexOf.call(el.parentElement.children, el) + 1;
      parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + index + ')'); el = el.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }
  document.addEventListener('mouseover', function (e) {
    if (mode !== 'select') return;
    if (hover && hover !== picked) mark(hover, false);
    hover = e.target; if (hover !== picked) mark(hover, true);
  });
  document.addEventListener('mouseleave', function () { if (hover !== picked) mark(hover, false); hover = null; });
  document.addEventListener('click', function (e) {
    if (mode === 'preview') {
      var link = e.target.closest('a');
      if (link) {
        e.preventDefault();
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) === '#') {
          var target = document.getElementById(href.slice(1));
          if (target) { target.scrollIntoView({ behavior: 'smooth' }); return; }
        }
        send('navigate', { href: href, label: link.textContent.trim() });
      }
      return;
    }
    if (e.target === document.body || e.target === document.documentElement) return;
    e.preventDefault(); e.stopPropagation(); clear(); picked = e.target;
    var canEdit = picked.children.length === 0 && ['SCRIPT','STYLE','INPUT','TEXTAREA','IMG','SVG','PATH','IFRAME'].indexOf(picked.tagName) < 0;
    send('select', { tag: picked.tagName.toLowerCase(), html: picked.outerHTML.slice(0, 6000),
      selector: path(picked), text: picked.textContent.trim().slice(0,4000), canEdit: canEdit });
    mark(picked, true);
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); });
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data || {};
    if (m.type === 'clear') clear();
    if (m.type === 'mode') { clear(); mode = m.mode === 'preview' ? 'preview' : 'select'; }
    if (m.type === 'capture') {
      clear();
      function capture() {
        window.htmlToImage.toPng(document.body, { pixelRatio: 2 }).then(function (url) {
          send('png', { url: url });
        }).catch(function (err) { send('png-error', { error: String(err) }); });
      }
      if (window.htmlToImage) capture();
      else {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
        script.onload = capture; script.onerror = function () { send('png-error', { error: 'Could not load the image exporter' }); };
        document.head.appendChild(script);
      }
    }
  });
  send('ready');
})();
</script>
"""


def _inner_body(html: str) -> str:
    """Contents of <body> if the model returned a whole document, else unchanged."""
    m = re.search(r"<body[^>]*>([\s\S]*?)</body>", html, re.IGNORECASE)
    return (m.group(1) if m else html).strip()


_PLACEHOLDER_BASE = re.compile(r"(https://placehold\.co/\d+x\d+)(?:/[0-9a-fA-F]{3,8}){0,2}(?=[?\"'\s)])")


def themed_placeholders(body: str, theme: dict) -> str:
    """Colour unfilled photo slots from the project theme, so they read as designed blocks, not grey boxes."""
    colours = f"/{theme['border'].lstrip('#')}/{theme['muted'].lstrip('#')}"
    return _PLACEHOLDER_BASE.sub(lambda m: m.group(1) + colours, body)


# The editor and gallery load a pinned copy served by the frontend, because the CDN holds first paint for seconds.
# A downloaded file has no frontend to ask, so exports keep the CDN link.
_TAILWIND_LOCAL = "/vendor/tailwindcss-play-3.4.17.js"
_TAILWIND_CDN = "https://cdn.tailwindcss.com"


def render_document(body: str, theme: dict, screen_id: int, interactive: bool, standalone: bool = False) -> str:
    """Full HTML page for one screen. interactive adds the editor's selection and capture script.
    standalone makes the file work without the Pragna frontend (an export)."""
    t = theme
    font = t["font"]
    family = font.replace(" ", "+")
    config = {
        "theme": {
            "extend": {
                "colors": {
                    "primary": t["primary"],
                    "on-primary": t["on_primary"],
                    "surface": t["surface"],
                    "background": t["background"],
                    "foreground": t["foreground"],
                    "muted": t["muted"],
                    "border": t["border"],
                },
                "borderRadius": {"theme": t["radius"]},
                "fontFamily": {
                    "theme": [font, "sans-serif"],
                    "display": ["Playfair Display", "serif"],
                    "mono": ["JetBrains Mono", "monospace"],
                },
            }
        }
    }
    script = _SELECT_SCRIPT % {"screen_id": screen_id, "accent": t["primary"]} if interactive else ""
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<style>html{{background:{t["background"]}}}</style>'
        f'<script src="{_TAILWIND_CDN if standalone else _TAILWIND_LOCAL}"></script>'
        f'<link href="https://fonts.googleapis.com/css2?family={family}:wght@400;500;600;700'
        '&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@400;500&display=swap"'
        ' rel="stylesheet" media="print" onload="this.media=\'all\'">'
        f"<script>tailwind.config = {json.dumps(config)};</script>"
        f"<style>html,body{{margin:0}}*{{scrollbar-width:thin;scrollbar-color:{t['border']} transparent}}</style></head>"
        f'<body class="bg-background text-foreground font-theme">{themed_placeholders(body, t)}{script}</body></html>'
    )


# --- LLM plumbing ----------------------------------------------------------

async def _llm(settings, messages: list[dict]) -> str:
    """One OmniRoute completion, collected. Tests replace this."""
    if not settings.omniroute_api_key:
        raise DesignError("OmniRoute is not configured (OMNIROUTE_API_KEY is empty)")

    async def run() -> str:
        parts: list[str] = []
        async for token in chat_stream(
            messages, DESIGN_MODEL, settings.omniroute_base_url, api_keys=[settings.omniroute_api_key],
            max_tokens=DESIGN_MAX_TOKENS,
        ):
            parts.append(token)
        return "".join(parts)

    try:
        return await asyncio.wait_for(run(), LLM_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise DesignError(f"The model took longer than {LLM_TIMEOUT_SECONDS}s to answer")
    except DesignError:
        raise
    except Exception as exc:
        raise DesignError(f"The model could not be reached: {exc}")


# Emoji only: pictographs and the BMP characters that default to emoji. Check marks, stars and the joiners that
# Indic scripts need are left alone.
_EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\u231A\u231B\u23E9-\u23F3\u23F8-\u23FA\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1"
    "\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B"
    "\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55\uFE0F]"
)


def strip_emoji(text: str) -> str:
    """This project shows no emoji, so none is ever stored in a design."""
    return _EMOJI.sub("", text)


def parse_html_block(text: str) -> str | None:
    """The first fenced html block, falling back to any fence, then to raw markup."""
    m = re.search(r"```html\s*\n([\s\S]*?)```", text) or re.search(r"```\w*\s*\n([\s\S]*?)```", text)
    candidate = m.group(1) if m else (text if text.lstrip().startswith("<") else "")
    body = strip_emoji(_inner_body(candidate))
    return body if body else None


def _checked(body: str | None) -> str:
    if not body:
        raise DesignError("The model did not return any HTML")
    if len(body.encode("utf-8")) > MAX_BODY_BYTES:
        raise DesignError("The generated screen is too large")
    return body


def _parse_json_object(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


# --- Prompts ---------------------------------------------------------------

def _device_hint(device: str) -> str:
    if device == "mobile":
        return "a 390px wide phone screen: single column, thumb-friendly, a bottom tab bar when it is an app"
    return "a 1280px wide desktop web page: a real layout with a top nav or sidebar, sections and a footer where it fits"


_SCREEN_SYSTEM = (
    "You are a senior product designer who writes polished Tailwind CSS HTML.\n"
    "Reply with ONLY the contents of <body> in a single ```html fenced block. No <html> or <head> tags.\n"
    "Rules:\n"
    "- Tailwind utility classes only. For brand styling use these theme tokens, never raw hex: "
    "bg-primary, text-primary, text-on-primary, bg-surface, bg-background, text-foreground, text-muted, "
    "border-border, rounded-theme, font-theme.\n"
    "- Realistic content (names, prices, copy). Never lorem ipsum.\n"
    "- Photos: where you are sure a real Unsplash photo exists for the subject, use "
    "https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1200&q=80 with its real id. Otherwise use "
    "https://placehold.co/WIDTHxHEIGHT?text=Short+description+of+the+photo (the description is used to find or "
    "generate the real picture, so make it specific). Icons: inline SVG. No other external URLs.\n"
    "- Make it look finished: spacing, hierarchy, states, consistent components across screens.\n"
    "- Make it usable as a prototype: include a small, self-contained script at the end for tabs, filters, "
    "menus, dialogs, toggles and demo forms when these controls are present. Use local demo data only. "
    "Never use fetch, network requests, storage, parent/top access, postMessage, or external scripts. "
    "When building a single design, implement all requested views within this one HTML body: "
    "local navigation switches panels, detail actions reveal content, and forms update demo state. "
    "Do not split the brief into separate mockups or link to pages that are not part of the project. "
    "Use real anchors with href equal to the destination screen name for navigation between planned screens. "
    "Keep this prototype code and all interaction states intact when editing.\n"
    "- Web layouts must adapt at 390px, 768px and 1280px. Collapse sidebars and stack grids at narrow widths; "
    "never leave text or controls outside the viewport.\n"
    "Design doctrine (from the Claude Design and Apple HIG skills):\n"
    "- Composition first. You are given this screen's surface and composition: follow them. A centered hero plus three equal "
    "feature cards is only right for a Decide/Learn page, never elsewhere. No icon-in-rounded-square above every heading.\n"
    "- Type: font-theme is the body face. Add font-display (a high-contrast serif) for big editorial headlines and "
    "font-mono (JetBrains Mono) for small labels, figures and data when the brand suits them; mix at most these three.\n"
    "- Hierarchy comes from type, not boxes: one clear focal point per section, size and weight contrast (at least 3:1 between "
    "headline and body), tight tracking and leading on large headings (tracking-tight, leading-[1.05]), relaxed leading on body.\n"
    "- Restraint: one accent used sparingly, generous whitespace, align to a consistent grid. Layered depth only where it "
    "separates real layers; no glassmorphism or gradients by default, no left-border accent cards.\n"
    "- Content discipline: real, specific copy that fits the brand. No invented stats, fake metrics or filler sections. "
    "Do not use large numbers just to fill space.\n"
    "- Text over photos always sits on a scrim (for example bg-gradient-to-t from-black/70 via-black/30 to-transparent, or "
    "bg-black/45) with light text, or in a solid panel; never put dark text straight on a photo.\n"
    "- Never use emoji characters anywhere in the page; draw icons as inline SVG.\n"
    "- Usable: text contrast at least 4.5:1, tap targets at least 44px, visible hover and focus states, clear primary action.\n"
    "- Build the screen completely: every section a real page of this kind has, written out in full with realistic content."
)

_PLAN_SYSTEM = (
    "You are an art director planning one complete interactive app or website. "
    "Reply with ONLY a JSON object, no prose:\n"
    '{"project_name": "short name", "direction": "one sentence: the visual mood, layout style and photography style", '
    '"theme": {"primary": "#hex", "on_primary": "#hex", "surface": "#hex", "background": "#hex", "foreground": "#hex", '
    '"muted": "#hex", "border": "#hex", "radius": "12px", "font": "one of: ' + ", ".join(FONTS) + '"}, '
    '"photo_terms": ["2-4 word generic phrases a photo library would match for this brand, e.g. tropical modern house"], '
    '"screens": [{"name": "Home", "surface": "one of: ' + ", ".join(SURFACES) + '", '
    '"purpose": "what the complete design includes and how its views interact", "composition": "one sentence: the layout, e.g. split screen, full-bleed image with overlay, asymmetric grid, editorial columns"}]}\n'
    "Return exactly one item in screens. Cover the entire brief in that design, including local navigation "
    "and interactive panels for requested app views, or sections for a website. Never propose multiple mockups. "
    "Theme rules: derive the palette from the brand and industry in the brief, never a generic purple/indigo/blue default. "
    "Use hex colors only, keep foreground readable on background, and pick a dark theme when the brand suits it. "
    "Each screen must have a different surface or a clearly different composition. Surfaces: Monitor (watch state), "
    "Operate (take action), Compare (weigh options), Configure (set up), Decide/Learn (convince or teach, the only surface "
    "where a hero fits), Explore (browse a catalog or gallery), Inspect (drill into one object)."
)

def _planned_theme(theme) -> dict | None:
    """The planner's theme if it is valid, else None so the project keeps its current one."""
    if not isinstance(theme, dict):
        return None
    try:
        return validate_theme(theme)
    except DesignError:
        return None


async def plan_flow(settings, prompt: str, device: str, max_screens: int, existing_names: list[str]) -> dict:
    """Screen plan {project_name, screens}. Falls back to one screen if the model will not give valid JSON."""
    ask = (
        f"Design brief: {prompt}\nTarget: {_device_hint(device)}\n"
        "Plan exactly 1 complete design. Include the full brief in one interactive app or website, "
        "with local navigation and view switching where needed. Do not create separate screen mockups."
    )
    if existing_names:
        ask += f"\nThe project already has these screens, do not repeat them: {', '.join(existing_names)}."
    for attempt in range(2):
        try:
            data = _parse_json_object(
                await _llm(settings, [{"role": "system", "content": _PLAN_SYSTEM}, {"role": "user", "content": ask}])
            )
        except DesignError as exc:
            logger.warning("Design planner attempt %d failed: %s", attempt + 1, exc)
            continue
        screens = [
            {
                "name": str(s["name"]).strip()[:60],
                "purpose": str(s.get("purpose", "")).strip()[:300],
                "surface": str(s.get("surface", "")).strip()[:30],
                "composition": str(s.get("composition", "")).strip()[:200],
            }
            for s in (data or {}).get("screens", [])
            if isinstance(s, dict) and str(s.get("name", "")).strip()
        ][:max_screens]
        if screens:
            return {
                "project_name": str((data or {}).get("project_name") or "").strip()[:60],
                "direction": str((data or {}).get("direction") or "").strip()[:300],
                "theme": _planned_theme((data or {}).get("theme")),
                "photo_terms": [str(t).strip()[:40] for t in ((data or {}).get("photo_terms") or []) if str(t).strip()][:6],
                "screens": screens,
            }
    return {
        "project_name": "", "direction": "", "theme": None, "photo_terms": [],
        "screens": [{"name": prompt[:40].strip() or "Screen 1", "purpose": prompt[:300]}],
    }


_PLACEHOLDER = re.compile(r"https://placehold\.co/(\d+)x(\d+)[^\s\"'()]*?[?&]text=([^\s\"'()&]+)[^\s\"'()]*")


_STOPWORDS = {"a", "an", "the", "of", "in", "on", "at", "with", "and", "for", "to", "by", "from", "under", "over", "into"}


def _stock_queries(label: str, terms: tuple[str, ...] = ()) -> list[str]:
    """Search phrases for a photo. The brand's generic photo terms come first, the ones sharing a word with the
    label ahead of the rest: there are few of them, so Commons is asked about each once and the answers are cached.
    The label's own words come last, since a phrase that specific rarely matches anything."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z-]+", label) if w.lower() not in _STOPWORDS]
    mine = {w.lower() for w in words}
    queries = sorted(terms, key=lambda t: -len(mine & {w.lower() for w in t.split()}))
    queries += [" ".join(words[:n]) for n in ((5, 3) if len(words) > 3 else (len(words),)) if words]
    return list(dict.fromkeys(queries))


async def _picture(
    settings, label: str, context: str, width: int, height: int, terms: tuple[str, ...] = (), used: set[str] | None = None
) -> str | None:
    """One picture for a placeholder, saved as a file. Tries IMAGE_SOURCES in order and returns the first hit:
    Codex, a public-domain photo from Wikimedia Commons, Gemini image. A provider that answers 429 is skipped
    for a while rather than retried for every picture."""
    prompt = f"{label}. For: {context}. Photographic, well lit, no text, no watermark."
    for source in IMAGE_SOURCES:
        if source == STOCK:
            for query in _stock_queries(label, terms):
                b64 = await image_service.find_stock_photo(query, width / height, used)
                if b64:
                    return image_service.save_base64_image(b64, max_width=IMAGE_MAX_WIDTH)
            continue
        provider = source.split("/")[0]
        if _provider_blocked_until.get(provider, 0) > time.monotonic():
            continue
        try:
            async with _image_gate, httpx.AsyncClient(timeout=IMAGE_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{settings.omniroute_base_url.rstrip('/')}/v1/images/generations",
                    headers={"Authorization": f"Bearer {settings.omniroute_api_key}"},
                    json={"model": source, "prompt": prompt},
                )
            if resp.status_code in (429, 502):  # rate limited, or the upstream declined: stop spending requests on it
                _provider_blocked_until[provider] = time.monotonic() + PROVIDER_COOLDOWN_SECONDS
                logger.warning(
                    "Design images: %s answered %s, skipping it for %ds", provider, resp.status_code, PROVIDER_COOLDOWN_SECONDS
                )
                continue
            resp.raise_for_status()
            item = resp.json()["data"][0]
            b64 = item.get("b64_json") or item.get("url", "").partition("base64,")[2]
            if b64:
                return image_service.save_base64_image(b64, max_width=IMAGE_MAX_WIDTH)
        except Exception as exc:
            logger.warning("Design image via %s failed: %s", source, exc)
    return None


async def illustrate(
    settings, body: str, context: str = "", terms: tuple[str, ...] = (), used: set[str] | None = None
) -> str:
    """Swap placehold.co photos for real pictures. A picture that cannot be found keeps its placeholder."""
    if not settings.omniroute_api_key:
        return body
    slots: dict[str, tuple[str, int, int]] = {}  # placeholder URL -> (label, width, height)
    for m in _PLACEHOLDER.finditer(body):
        slots.setdefault(m.group(0), (urllib.parse.unquote_plus(m.group(3)), int(m.group(1)), int(m.group(2))))
    urls = list(slots)[:MAX_IMAGES_PER_SCREEN]
    if not urls:
        return body
    used = used if used is not None else set()  # stock photos already placed, so none repeats
    made = await asyncio.gather(
        *(_picture(settings, label, context, w, h, terms, used) for label, w, h in (slots[u] for u in urls))
    )
    for url, path in zip(urls, made):
        if path:
            body = body.replace(url, path)
    return body


_UNSPLASH = re.compile(r"https://images\.unsplash\.com/photo-[A-Za-z0-9_-]+[^\s\"'()<>]*")
_unsplash_gate = asyncio.Semaphore(3)


async def _fetch_unsplash(url: str) -> str | None:
    """The photo behind an Unsplash URL as base64, or None when the model made the id up (404) or it is not an image."""
    try:
        async with _unsplash_gate, httpx.AsyncClient(timeout=20.0, headers={"User-Agent": image_service.STOCK_USER_AGENT}) as client:
            resp = await client.get(url)  # redirects are not followed, so this never leaves images.unsplash.com
        if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image/") and len(resp.content) <= image_service.STOCK_MAX_BYTES:
            return base64.b64encode(resp.content).decode()
    except Exception as exc:
        logger.warning("Unsplash photo check failed for %s: %s", url[:80], exc)
    return None


async def resolve_unsplash(body: str) -> str:
    """Keep the Unsplash photos the model named that really exist, saved locally so they survive an export and
    never break later. One that does not exist becomes a placeholder, which the picture step then fills."""
    urls = list(dict.fromkeys(_UNSPLASH.findall(body)))[:8]
    if not urls:
        return body
    fetched = await asyncio.gather(*(_fetch_unsplash(u) for u in urls))
    for url, b64 in zip(urls, fetched):
        if b64:
            body = body.replace(url, image_service.save_base64_image(b64, max_width=IMAGE_MAX_WIDTH))
        else:
            width = int(m.group(1)) if (m := re.search(r"[?&]w=(\d+)", url)) else 1200
            body = body.replace(url, f"https://placehold.co/{width}x{round(width * 0.66)}?text=Photo")
    return body


_STORED_IMAGE = re.compile(r"/generated_images/(img_[A-Za-z0-9_]+\.(png|jpg))")


def inline_images(html: str) -> str:
    """Embed stored pictures as data URIs so an exported file works anywhere. Missing files keep their path."""
    folder = image_service.generated_images_dir()

    def embed(m: re.Match) -> str:
        path = folder / m.group(1) if folder else None
        if path and path.is_file():
            mime = "jpeg" if m.group(2) == "jpg" else "png"
            return f"data:image/{mime};base64," + base64.b64encode(path.read_bytes()).decode()
        return m.group(0)

    return _STORED_IMAGE.sub(embed, html)


async def generate_screen_body(
    settings,
    prompt: str,
    device: str,
    screen: dict,
    flow: list[dict],
    style_reference: str | None = None,
    image: str | None = None,
    direction: str = "",
) -> str:
    context = "\n".join(f"- {s['name']}: {s['purpose']}" for s in flow)
    text = (
        f"Overall brief: {prompt}\nScreens in this flow:\n{context}\n\n"
        f"Build the design \"{screen['name']}\" ({screen['purpose']}) as {_device_hint(device)}. "
        "Implement the full brief in this one design, including working local navigation between "
        "requested views and meaningful demo interactions. Do not output multiple page mockups."
    )
    if screen.get("surface"):
        text += f"\nSurface: {screen['surface']}. Composition: {screen.get('composition') or 'your choice, distinct from the other screens'}."
    if direction:
        text += f"\nArt direction: {direction}"
    if style_reference:
        text += f"\n\nKeep the same nav, components and tokens as an existing screen, but not its layout:\n```html\n{style_reference[:6000]}\n```"
    if image:
        text += "\n\nRebuild the UI in the attached image as faithfully as you can, using the theme tokens."
        user_content: str | list = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": image}}]
    else:
        user_content = text
    messages = [{"role": "system", "content": _SCREEN_SYSTEM}, {"role": "user", "content": user_content}]
    for attempt in range(2):
        body = parse_html_block(await _llm(settings, messages))
        if body:
            return _checked(body)
    raise DesignError("The model did not return any HTML")


async def edit_screen_body(settings, body: str, instruction: str, element_html: str | None, context: str = "") -> str:
    if element_html:
        task = (
            f"Change ONLY this element (the first one matching it if several do), keep everything else identical:\n"
            f"```html\n{element_html}\n```\nChange: {instruction}"
        )
    else:
        task = f"Change: {instruction}\nKeep everything the user did not mention identical."
    messages = [
        {"role": "system", "content": _SCREEN_SYSTEM},
        {"role": "user", "content": (f"Recent design conversation (context for the current request):\n{context}\n\n" if context else "")
            + f"Current screen body:\n```html\n{body}\n```\n\n{task}\n\nReturn the complete updated body."},
    ]
    for attempt in range(2):
        updated = parse_html_block(await _llm(settings, messages))
        if updated:
            return _checked(updated)
    raise DesignError("The model did not return any HTML")


_AUDIT_TASK = (
    "Audit this screen like a design director, then repair it.\n"
    "1. First write one line: \"Audit: N/10. Tells: ...\" (1 point per tell that fires): tech gradient; default "
    "indigo/violet accent; icon+heading+sentence feature-tile grid; coloured left-border accent cards; unearned blur or "
    "glass; oversized stat numbers filling space; rounded-square icon above every heading; everything centred with no "
    "real composition; flat type hierarchy; composition that does not fit the screen's surface.\n"
    "2. If N is 2 or less, reply with the one audit line and nothing else.\n"
    "3. Otherwise return the repaired body in one ```html block. Fix composition first (re-layout, do not just recolour), "
    "then type and colour, then remove decoration. Keep the brand, copy, theme tokens, the screen's purpose and every "
    "photo placeholder URL. Do not add or remove sections; keep about the same length."
)


async def refine_screen_body(settings, body: str, screen: dict, direction: str) -> str:
    """One audit-then-repair pass (Claude Design's slop diagnostic). Returns the original body when the audit
    finds it clean or the repair is unusable, so a refine can never make a screen worse by failing."""
    ask = (
        f"Screen: {screen['name']} ({screen['purpose']}). Surface: {screen.get('surface') or 'unspecified'}. "
        f"Composition asked for: {screen.get('composition') or 'unspecified'}. Art direction: {direction or 'unspecified'}.\n\n"
        f"```html\n{body}\n```\n\n{_AUDIT_TASK}"
    )
    try:
        reply = await _llm(settings, [{"role": "system", "content": _SCREEN_SYSTEM}, {"role": "user", "content": ask}])
    except DesignError as exc:
        logger.warning("Design refine skipped: %s", exc)
        return body
    audit = next((line.strip() for line in reply.splitlines() if line.strip().startswith("Audit")), "no audit line")
    repaired = parse_html_block(reply)
    logger.info("Design audit of %r: %s (%s)", screen["name"], audit[:200], "repaired" if repaired else "unchanged")
    if not repaired or len(repaired) < len(body) * 0.5 or len(repaired.encode("utf-8")) > MAX_BODY_BYTES:
        return body
    return repaired


# --- Flow generation -------------------------------------------------------

async def generate_flow(
    conn, settings, project: dict, prompt: str, image: str | None = None, add: bool = False
) -> AsyncGenerator[dict, None]:
    """Plan screens, then build them in parallel. Yields events as each finishes:
    plan -> (screen | screen_error)* -> done."""
    existing = repository.list_design_screens(conn, project["id"])
    max_new = 1 if (add or image) else MAX_SCREENS_PER_GENERATE
    if len(existing) + max_new > MAX_SCREENS_PER_PROJECT:
        yield {"type": "error", "error": f"A project can hold at most {MAX_SCREENS_PER_PROJECT} screens"}
        return

    if image:
        plan = {"project_name": "", "direction": "", "theme": None, "photo_terms": [], "screens": [{"name": "From image", "purpose": prompt or "Recreate the uploaded design"}]}
    else:
        plan = await plan_flow(settings, prompt, project["device"], max_new, [s["name"] for s in existing])

    if plan.get("theme") and not existing:
        repository.update_design_project(conn, project["id"], theme=plan["theme"])
        project["theme"] = plan["theme"]  # the route renders every screen with this

    if plan["project_name"] and project["name"] == DEFAULT_PROJECT_NAME and not existing:
        repository.update_design_project(conn, project["id"], name=plan["project_name"])
        project = {**project, "name": plan["project_name"]}

    start = len(existing)
    screens = []
    for i, s in enumerate(plan["screens"]):
        sid = repository.create_design_screen(conn, project["id"], s["name"], start + i)
        screens.append({"id": sid, **s})
    yield {
        "type": "plan",
        "project_name": project["name"],
        "theme": project["theme"],
        "screens": [{"id": s["id"], "name": s["name"], "purpose": s["purpose"]} for s in screens],
    }

    style_reference = next((s["body"] for s in existing if s.get("body")), None)
    flow = plan["screens"]
    gate = asyncio.Semaphore(MAX_PARALLEL_SCREENS)

    async def build(screen: dict) -> dict:
        try:
            async with gate:
                body = await generate_screen_body(
                    settings, prompt, project["device"], screen, flow, style_reference, image, plan.get("direction", "")
                )
            body = await resolve_unsplash(body)
            version_id = repository.add_screen_version(conn, screen["id"], body, prompt)
            return {"type": "screen", "id": screen["id"], "version_id": version_id, "body": body}
        except DesignError as exc:
            return {"type": "screen_error", "id": screen["id"], "error": str(exc)}
        except Exception as exc:  # a bug in one screen must not sink the others
            logger.exception("Design screen %s failed", screen["id"])
            return {"type": "screen_error", "id": screen["id"], "error": f"Unexpected error: {exc}"}

    queue: asyncio.Queue = asyncio.Queue()
    used_photos: set[str] = set()  # shared by every screen of this generation

    async def finish(built: dict, screen: dict) -> None:
        """After a screen is on the canvas: repair its design, then swap placeholders for pictures.
        Each step that changes the body is saved in place and streamed as an updated screen."""
        async def refine(body: str) -> str:
            async with gate:  # an LLM call like the first build; pictures are limited by their own gate instead
                return await refine_screen_body(settings, body, screen, plan.get("direction", ""))

        async def picture(body: str) -> str:
            return await illustrate(
                settings, body, f"{prompt[:200]}. {plan.get('direction', '')}", tuple(plan.get("photo_terms") or ()), used_photos
            )

        try:
            for step in (refine, picture):
                body = await step(built["body"])
                if body != built["body"] and len(body.encode("utf-8")) <= MAX_BODY_BYTES:
                    repository.update_screen_version_body(conn, built["version_id"], body)
                    built = {**built, "body": body}
                    await queue.put(built)
        except Exception:
            logger.exception("Design finishing for screen %s failed", built["id"])
        finally:
            await queue.put(None)

    by_id = {s["id"]: s for s in screens}
    tasks = [asyncio.create_task(build(s)) for s in screens]
    finishing: list[asyncio.Task] = []
    ended = 0  # finishing tasks that have put their closing None on the queue
    try:
        for finished in asyncio.as_completed(tasks):
            event = await finished
            yield event
            if event["type"] == "screen":
                finishing.append(asyncio.create_task(finish(event, by_id[event["id"]])))
            while not queue.empty():  # stream repaired screens as soon as they exist
                item = queue.get_nowait()
                if item is None:
                    ended += 1
                else:
                    yield item
        while ended < len(finishing):
            item = await queue.get()
            if item is None:
                ended += 1
            else:
                yield item
    finally:
        for task in tasks + finishing:
            task.cancel()
    yield {"type": "done"}
