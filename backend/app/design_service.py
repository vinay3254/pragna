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
from functools import lru_cache
from collections.abc import Awaitable, Callable
from contextlib import aclosing
from pathlib import Path
from typing import AsyncGenerator

import httpx

from app import design_browser_checks, image_service, repository
from app.design_quality import contrast_ratio, inspect_body
from app.design_imports import design_context
from app.ollama_client import chat_stream

logger = logging.getLogger(__name__)

STOCK = "stock"
# Codex is used for pictures only. Planning needs less reasoning than page construction.
DESIGN_MODEL = "antigravity/gemini-3.7-flash-medium"
PLAN_MODEL = "antigravity/gemini-3.7-flash-low"
DESIGN_MAX_TOKENS = 24576
PLAN_MAX_TOKENS = 2048
PLAN_TIMEOUT_SECONDS = 25
REFINE_TIMEOUT_SECONDS = 60
PHOTO_TIMEOUT_SECONDS = 30
PREVIEW_INTERVAL_SECONDS = .8
FIRST_TOKEN_TIMEOUT_SECONDS = 20
MODEL_COOLDOWN_SECONDS = 90
_model_blocked_until: dict[tuple[str, str], float] = {}
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
    "muted": "#666d7a",
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

@lru_cache(maxsize=1)
def _editor_script(screen_id: int, accent: str) -> str:
    source = Path(__file__).with_name('design_editor.js').read_text(encoding='utf-8')
    return '<script>' + source.replace('__SCREEN_ID__', str(screen_id)).replace('__ACCENT__', accent) + '</script>'


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


@lru_cache(maxsize=1)
def _prototype_script() -> str:
    return Path(__file__).with_name('design_runtime.js').read_text(encoding='utf-8')


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
    script = _editor_script(screen_id, t["primary"]) if interactive else ""
    prototype = f'<script>{_prototype_script()}</script>' if 'data-design-' in body else ''
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<style>html{{background:{t["background"]}}}</style>'
        f'<script src="{_TAILWIND_CDN if standalone else _TAILWIND_LOCAL}"></script>'
        f'<link href="https://fonts.googleapis.com/css2?family={family}:wght@400;500;600;700'
        '&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@400;500&display=swap"'
        ' rel="stylesheet" media="print" onload="this.media=\'all\'">'
        f"<script>tailwind.config = {json.dumps(config)};</script>"
        f"<style>html,body{{margin:0}}*{{scrollbar-width:thin;scrollbar-color:{t['border']} transparent}}"
        "[hidden]{display:none!important}img,svg{max-width:100%}"
        f":focus-visible{{outline:2px solid {t['primary']};outline-offset:3px}}"
        "@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;"
        "animation:none!important;transition:none!important}}</style>"
        f"{script}{prototype}</head>"
        f'<body class="bg-background text-foreground font-theme">{themed_placeholders(body, t)}</body></html>'
    )


def screen_quality(body: str, theme: dict, device: str) -> dict:
    report = inspect_body(body, theme)
    browser = design_browser_checks.cached_report(render_document(body, theme, 0, interactive=False), device)
    if browser:
        report['browser'] = browser
    return report


# --- LLM plumbing ----------------------------------------------------------

async def _llm(
    settings, messages: list[dict], *, stage: str = 'building',
    on_partial: Callable[[str], Awaitable[None]] | None = None,
    max_tokens: int | None = None,
) -> str:
    """Collect a completion while forwarding bounded, throttled draft snapshots."""
    if not settings.omniroute_api_key:
        raise DesignError("OmniRoute is not configured (OMNIROUTE_API_KEY is empty)")

    planning = stage == 'planning'
    model = getattr(settings, 'design_plan_model', PLAN_MODEL) if planning else getattr(settings, 'design_model', DESIGN_MODEL)
    timeout = PLAN_TIMEOUT_SECONDS if planning else REFINE_TIMEOUT_SECONDS if stage == 'refining' else LLM_TIMEOUT_SECONDS
    started = time.monotonic()
    async def tokens():
        candidates = list(dict.fromkeys([model, getattr(settings, 'design_fallback_model', '')]))
        for candidate in filter(None, candidates):
            key = (settings.omniroute_base_url, candidate.split('/')[0])
            if _model_blocked_until.get(key, 0) > time.monotonic():
                continue
            async with aclosing(chat_stream(
                messages, candidate, settings.omniroute_base_url, api_keys=[settings.omniroute_api_key],
                max_tokens=max_tokens or (PLAN_MAX_TOKENS if planning else DESIGN_MAX_TOKENS),
            )) as stream:
                try:
                    first_token = await asyncio.wait_for(anext(stream), 10 if planning else FIRST_TOKEN_TIMEOUT_SECONDS)
                except (TimeoutError, StopAsyncIteration, httpx.HTTPError, RuntimeError) as exc:
                    _model_blocked_until[key] = time.monotonic() + MODEL_COOLDOWN_SECONDS
                    logger.warning('Design %s unavailable before output (%s); trying fallback', candidate, type(exc).__name__)
                    continue
                # Never concatenate two models after a draft has started streaming.
                yield first_token
                async for token in stream:
                    yield token
                return
        raise DesignError('Design models are busy or unavailable. Please retry shortly or configure DESIGN_FALLBACK_MODEL.')

    async def run() -> str:
        parts: list[str] = []
        size = 0
        last_preview = 0.0
        first = True
        async with aclosing(tokens()) as stream:
            async for token in stream:
                if first:
                    logger.info('Design %s first token after %.2fs', stage, time.monotonic() - started)
                    first = False
                parts.append(token)
                size += len(token.encode('utf-8'))
                if size > MAX_BODY_BYTES:
                    raise DesignError('The generated screen is too large')
                now = time.monotonic()
                if on_partial and size >= 120 and now - last_preview >= PREVIEW_INTERVAL_SECONDS:
                    await on_partial(''.join(parts))
                    last_preview = now
        return "".join(parts)

    try:
        result = await asyncio.wait_for(run(), timeout)
        logger.info('Design %s completed after %.2fs', stage, time.monotonic() - started)
        return result
    except asyncio.TimeoutError:
        raise DesignError(f"The model took longer than {timeout}s to answer")
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


def preview_body(text: str) -> str | None:
    """Render incomplete model markup as an inert draft, never execute partial scripts."""
    from bs4 import BeautifulSoup
    fence = re.search(r'```(?:html)?\s*\n', text)
    candidate = text[fence.end():] if fence else text.lstrip()
    if not candidate.startswith('<'):
        return None
    candidate = candidate.split('```', 1)[0]
    # Cut dangling tags and script/style tails before letting the HTML parser recover nesting.
    candidate = candidate[:candidate.rfind('>') + 1]
    candidate = re.sub(r'<(script|style)\b[\s\S]*?(?:</\1\s*>|$)', '', candidate, flags=re.I)
    soup = BeautifulSoup(candidate, 'html.parser')
    for tag in soup.find_all(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base']):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            value = tag.attrs[attr]
            if attr.lower().startswith('on') or (attr in ('href', 'src', 'action', 'formaction') and str(value).lstrip().lower().startswith('javascript:')):
                del tag.attrs[attr]
    body = strip_emoji(_inner_body(str(soup))).strip()
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
    "- Make it usable as a prototype. Use the built-in interaction attributes below for standard controls. "
    "Include a small, self-contained script at the end only for domain logic such as calculators, charts, "
    "cart totals, CRUD demo data and compound filtering. Use local demo data only; clearly identify sample data. "
    "Never use fetch, network requests, storage, parent/top access, postMessage, or external scripts. "
    "When building a single design, implement all requested views within this one HTML body: "
    "local navigation switches panels, detail actions reveal content, and forms update demo state. "
    "Do not split the brief into separate mockups or link to pages that are not part of the project. "
    "Use real anchors with href equal to the destination screen name for navigation between planned screens. "
    "Keep this prototype code and all interaction states intact when editing.\n"
    "- Web layouts must adapt at 390px, 768px and 1280px. Start with mobile classes, then md:/lg: changes. "
    "Collapse sidebars and stack grids at narrow widths; use min-w-0 for flex children, wrap labels, "
    "and contain wide tables in overflow-x-auto regions. "
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
    "- Build the screen completely: every section a real page of this kind has, written out in full with realistic content. "
    "Depth must come from useful content and behavior, not extra decoration. Dashboards need meaningful SVG charts "
    "with axes/legends, populated tables, filters and object details. Shops need item details, cart and totals. "
    "Marketing sites need a distinct visual story, product proof, useful pricing/FAQ and a working primary action. "
    "Do not use empty chart rectangles, uniform card grids, placeholder headings or fake testimonials.\n"
    "Built-in local interaction contract (the host supplies the runtime; do not reimplement these):\n"
    "- Tabs: one container with data-design-tabs, a role=tablist, buttons role=tab with "
    "data-design-action=tab data-design-target=#panel-id aria-controls=panel-id aria-selected=true/false. "
    "Panels inside the same container have id, data-design-panel, role=tabpanel; put hidden on inactive panels. "
    "Style selected tabs with aria-selected: Tailwind variants. Arrow keys work automatically.\n"
    "- Menus/disclosure: a button with data-design-action=toggle data-design-target=#menu-id "
    "aria-controls=menu-id aria-expanded=false; target initially has hidden. show/hide actions also work.\n"
    "- Dialogs: use native <dialog id=details> (without hidden), opened by "
    "data-design-action=open-dialog data-design-target=#details. Close button inside uses "
    "data-design-action=close-dialog. Escape and focus restoration work automatically.\n"
    "- Search: labeled input data-design-filter=#catalog. Catalog contains data-design-item elements "
    "and an initially hidden data-design-empty empty state. Matching uses each item's text.\n"
    "- Category filters: buttons in data-design-filters with data-design-action=filter "
    "data-design-target=#catalog data-design-value=category (or all). Items have data-design-category. "
    "Use aria-pressed variants for active filters. Search and category filters on the same catalog combine automatically.\n"
    "- Forms: <form data-design-submit=#result data-design-success='Saved in this demo.'> with labeled, "
    "required fields and a submit button. Result is an initially hidden status element with id=result. "
    "Native validation and a success message work automatically. Real record creation needs custom script.\n"
    "- AI demos: <form data-design-ai=#reply> with a labeled input name=prompt, submit button, and reply element. The host brokers real AI calls when its owner enables AI demo. Never call fetch or embed keys. Exports explain how to reopen in Pragna.\n"
    "- Voice input: button data-design-dictate=#input brokers microphone permission through the host (browser support required). Voice playback: button data-design-speak=#text reads that element aloud through browser speech synthesis. Video/audio use native controls with imported asset URLs. Self-contained Canvas/WebGL animations and shaders are allowed without remote libraries or downloads.\n"
    "- Range inputs: data-design-output=#value updates that text node. Checkbox/select controls are native.\n"
    "- Demo-only secondary actions: data-design-action=toast data-design-message='Export prepared in this demo.' "
    "Use this only for incidental actions. Primary flows must reveal real content or change meaningful state.\n"
    "Every displayed control must do something specific, navigate to an existing section/view, "
    "or be explicitly disabled with an explanation. No href=# dead ends. Keep unique IDs. "
    "Every visible input has a label; icon buttons have aria-label. Cover validation, success and empty states."
    " Before returning, check your composition, all interaction targets, mobile layout and requested content. "
    "Keep markup concise: reuse the host runtime instead of verbose custom scripts or repeated decorative SVG paths."
)

_PLAN_SYSTEM = (
    "You are an art director planning one complete interactive app or website. "
    "Reply with ONLY a JSON object, no prose:\n"
    '{"project_name": "short name", "direction": "one sentence: the visual mood, layout style and photography style", '
    '"theme": {"primary": "#hex", "on_primary": "#hex", "surface": "#hex", "background": "#hex", "foreground": "#hex", '
    '"muted": "#hex", "border": "#hex", "radius": "12px", "font": "one of: ' + ", ".join(FONTS) + '"}, '
    '"photo_terms": ["2-4 word generic phrases a photo library would match for this brand, e.g. tropical modern house"], '
    '"design_brief": {"audience": "who uses it", "goal": "primary user task", '
    '"sections": ["specific content/views needed to satisfy this brief"], '
    '"interactions": [{"trigger": "specific user action", "result": "visible state/data change"}], '
    '"states": ["useful validation, success, empty and detail states"], '
    '"responsive": "how navigation and content adapt on phone, tablet and desktop"}, '
    '"screens": [{"name": "Home", "surface": "one of: ' + ", ".join(SURFACES) + '", '
    '"purpose": "what the complete design includes and how its views interact", "composition": "one sentence: the layout, e.g. split screen, full-bleed image with overlay, asymmetric grid, editorial columns"}]}\n'
    "Return exactly one item in screens. Cover the entire brief in that design, including local navigation "
    "and interactive panels for requested app views, or sections for a website. Never propose multiple mockups. "
    "Theme rules: derive the palette from the brand and industry in the brief, never a generic purple/indigo/blue default. "
    "Use hex colors only, keep foreground and muted text at least 4.5:1 on both background and surface, "
    "and on_primary at least 4.5:1 on primary. Pick a dark theme when the brand suits it. "
    "Plan 4-8 meaningful sections/views and 3-6 concrete interactions when appropriate for the request. "
    "For each interaction describe both the trigger and visible result, not just 'button works'. "
    "Honor short briefs without padding. Use industry-specific details and a distinctive composition. "
    "Each screen must have a different surface or a clearly different composition. Surfaces: Monitor (watch state), "
    "Operate (take action), Compare (weigh options), Configure (set up), Decide/Learn (convince or teach, the only surface "
    "where a hero fits), Explore (browse a catalog or gallery), Inspect (drill into one object)."
)

def _planned_theme(theme) -> dict | None:
    """The planner's theme if it is valid, else None so the project keeps its current one."""
    if not isinstance(theme, dict):
        return None
    try:
        planned = validate_theme(theme)
    except DesignError:
        return None
    # Correct generated text tokens before building. User-selected themes stay untouched.
    for key, backgrounds in (
        ('foreground', ('background', 'surface')), ('muted', ('background', 'surface')),
        ('on_primary', ('primary',)),
    ):
        def minimum(color):
            return min(contrast_ratio(color, planned[background]) for background in backgrounds)
        if minimum(planned[key]) < 4.5:
            channels = [int(planned[key][i:i + 2], 16) for i in (1, 3, 5)]
            candidates = [planned[key]]
            for step in range(1, 101):
                for endpoint in (0, 255):
                    color = '#' + ''.join(f'{round(c + (endpoint - c) * step / 100):02x}' for c in channels)
                    candidates.append(color)
                valid = next((c for c in candidates[-2:] if minimum(c) >= 4.5), None)
                if valid:
                    planned[key] = valid
                    break
            else:
                planned[key] = max(candidates, key=minimum)
    return planned


def _brief(data) -> dict:
    """Keep useful planner detail without trusting its types or size."""
    if not isinstance(data, dict):
        return {}
    def items(key):
        value = data.get(key)
        return [str(item).strip()[:240] for item in value if isinstance(item, str) and item.strip()][:10] if isinstance(value, list) else []
    interactions = data.get('interactions')
    return {
        'audience': str(data.get('audience') or '').strip()[:240],
        'goal': str(data.get('goal') or '').strip()[:400],
        'sections': items('sections'), 'states': items('states'),
        'responsive': str(data.get('responsive') or '').strip()[:500],
        'interactions': [
            {'trigger': str(item['trigger']).strip()[:200], 'result': str(item['result']).strip()[:300]}
            for item in interactions if isinstance(item, dict) and item.get('trigger') and item.get('result')
        ][:10] if isinstance(interactions, list) else [],
    }


async def plan_flow(settings, prompt: str, device: str, max_screens: int, existing_names: list[str], kind: str = 'prototype') -> dict:
    """Screen plan {project_name, screens}. Falls back to one screen if the model will not give valid JSON."""
    ask = (
        f"Design brief: {prompt}\nTarget: {_device_hint(device)}\n"
        "Plan exactly 1 complete design. Include the full brief in one interactive app or website, "
        "with local navigation and view switching where needed. Do not create separate screen mockups."
    )
    if existing_names:
        ask += f"\nThe project already has these screens, do not repeat them: {', '.join(existing_names)}."
    system = _PLAN_SYSTEM
    if kind == 'presentation':
        system = system.replace('Return exactly one item in screens.', f'Return up to {max_screens} items in screens, one per presentation slide.')
        system = system.replace('Never propose multiple mockups.', 'Plan a coherent sequence of presentation slides, not app screens.')
        system += '\nPresentation-specific rules override app examples: distribute the story across slides; each slide has one clear point and restrained text, no app navigation or forced interaction lists.'
        ask = f'Create an on-brand presentation with up to {max_screens} slides. Give every slide a distinct title and concrete content.\nBrief: {prompt}'
    elif kind == 'variants':
        system = system.replace('Never propose multiple mockups.', 'Each alternative is a complete usable design for the same brief.')
        system = system.replace('Return exactly one item in screens.', f'Return exactly {max_screens} items in screens, one per alternative design direction.')
        ask = f'Plan {max_screens} complete alternative designs for the SAME content and function. Use distinct compositions; each must fulfill the full brief. Name each direction and describe its layout.\nBrief: {prompt}'
    elif kind in {'document', 'marketing'}:
        ask += f'\nArtifact format: {kind}. Plan readable visual content rather than unnecessary app controls.'
    for attempt in range(1):
        try:
            data = _parse_json_object(
                await _llm(settings, [{"role": "system", "content": system}, {"role": "user", "content": ask}], stage='planning')
            )
        except DesignError as exc:
            logger.warning("Design planner attempt %d failed: %s", attempt + 1, exc)
            continue
        raw_screens = (data or {}).get('screens')
        screens = [
            {
                "name": str(s["name"]).strip()[:60],
                "purpose": str(s.get("purpose", "")).strip()[:1200],
                "surface": str(s.get("surface", "")).strip()[:30],
                "composition": str(s.get("composition", "")).strip()[:600],
            }
            for s in (raw_screens if isinstance(raw_screens, list) else [])
            if isinstance(s, dict) and str(s.get("name", "")).strip()
        ][:max_screens]
        if screens:
            return {
                "project_name": str((data or {}).get("project_name") or "").strip()[:60],
                "direction": str((data or {}).get("direction") or "").strip()[:800],
                "theme": _planned_theme((data or {}).get("theme")),
                "design_brief": _brief((data or {}).get('design_brief')),
                "photo_terms": [str(t).strip()[:40] for t in ((data or {}).get("photo_terms") or []) if isinstance(t, str) and t.strip()][:6]
                    if isinstance((data or {}).get('photo_terms'), list) else [],
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


async def finish_photography(
    settings, body: str, context: str = '', terms: tuple[str, ...] = (), used: set[str] | None = None,
) -> tuple[str, bool]:
    """Best-effort photography with one shared deadline; keep any resolved photos on timeout."""
    resolved = body
    try:
        async with asyncio.timeout(PHOTO_TIMEOUT_SECONDS):
            resolved = await resolve_unsplash(body)
            return await illustrate(settings, resolved, context, terms, used), False
    except TimeoutError:
        logger.info('Design photography budget reached')
        return resolved, True


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
    design_brief: dict | None = None,
    theme: dict | None = None,
    on_partial: Callable[[str], Awaitable[None]] | None = None,
    kind: str = 'prototype',
) -> str:
    context = "\n".join(f"- {s['name']}: {s['purpose']}" for s in flow)
    text = (
        f"Overall brief: {prompt}\nScreens in this flow:\n{context}\n\n"
        f"Build the design \"{screen['name']}\" ({screen['purpose']}) as {_device_hint(device)}. "
        "Implement the full brief in this one design, including working local navigation between "
        "requested views and meaningful demo interactions. Do not output multiple page mockups."
    )
    if kind == 'presentation':
        text = (f"Deck brief: {prompt}\nSlide outline:\n{context}\n"
                f"Build ONLY slide {screen['name']}: {screen['purpose']}. Use a complete 1280 by 720 composition, "
                "large readable typography, restrained text, meaningful diagrams or data, and a consistent deck visual language. "
                "Do not combine the other slides into this slide. Avoid webpage navigation and scrolling.")
    if screen.get("surface"):
        text += f"\nSurface: {screen['surface']}. Composition: {screen.get('composition') or 'your choice, distinct from the other screens'}."
    if direction:
        text += f"\nArt direction: {direction}"
    if design_brief:
        text += f"\nDesign specification (implement every requested section and trigger/result pair):\n{json.dumps(design_brief)}"
    if theme:
        text += f"\nActual project theme tokens (already provided by the host):\n{json.dumps(theme)}"
    if style_reference:
        text += f"\n\nKeep the same nav, components and tokens as an existing screen, but not its layout:\n```html\n{style_reference[:6000]}\n```"
    if image:
        text += "\n\nUse the attached image as visual reference while following the brief and theme tokens. Recreate its layout faithfully when the brief asks for a recreation."
        user_content: str | list = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": image}}]
    else:
        user_content = text
    system = _SCREEN_SYSTEM
    if kind != 'prototype':
        system += f"\nArtifact-specific rules take precedence over generic product examples: format {kind}. "
        system += "Build only the planned artifact; use visual content and restrained text. Do not add website navigation, app controls, pricing or other sections unless the brief asks for them."
    if kind == 'presentation':
        system += " Desktop slide composition is 1280x720. Keep all slide content within that height at desktop width; narrow previews may reflow accessibly."
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_content}]
    for attempt in range(2):
        body = parse_html_block(await _llm(settings, messages, on_partial=on_partial))
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
    "2. Also check functionality and completeness: missing requested views, dead navigation, unwired buttons, "
    "empty chart boxes, non-working search, missing validation/empty/success states, duplicate IDs, "
    "script errors, inaccessible controls, fixed widths causing mobile overflow. "
    "If N is 2 or less AND no functional/accessibility issues remain, reply with the one audit line and nothing else.\n"
    "3. Otherwise return the repaired body in one ```html block. Fix composition first (re-layout, do not just recolour), "
    "then type and colour, then remove decoration. Keep the brand, copy, theme tokens, the screen's purpose and every "
    "photo placeholder URL. Keep about the same length and preserve all existing functionality, scripts, "
    "data-design attributes, target IDs and form fields. Fix broken controls using the built-in interaction contract. "
    "Add missing content or states required by the design specification. Do not hide overflowing content as a fix."
)


async def refine_screen_body(
    settings, body: str, screen: dict, direction: str, design_brief: dict | None = None,
    browser_issues: list[dict] | None = None,
) -> str:
    """One audit-then-repair pass (Claude Design's slop diagnostic). Returns the original body when the audit
    finds it clean or the repair is unusable, so a refine can never make a screen worse by failing."""
    original_checks = inspect_body(body)
    ask = (
        f"Screen: {screen['name']} ({screen['purpose']}). Surface: {screen.get('surface') or 'unspecified'}. "
        f"Composition asked for: {screen.get('composition') or 'unspecified'}. Art direction: {direction or 'unspecified'}.\n\n"
        f"Design specification: {json.dumps(design_brief or {})}\n"
        f"Source checks to repair: {json.dumps(original_checks['issues'])}\n\n"
        f"Browser smoke-check findings to repair: {json.dumps(browser_issues or [])}\n\n"
        f"```html\n{body}\n```\n\n{_AUDIT_TASK}"
    )
    try:
        reply = await _llm(settings, [{"role": "system", "content": _SCREEN_SYSTEM}, {"role": "user", "content": ask}], stage='refining')
    except DesignError as exc:
        logger.warning("Design refine skipped: %s", exc)
        return body
    audit = next((line.strip() for line in reply.splitlines() if line.strip().startswith("Audit")), "no audit line")
    repaired = parse_html_block(reply)
    logger.info("Design audit of %r: %s (%s)", screen["name"], audit[:200], "repaired" if repaired else "unchanged")
    if not repaired or len(repaired) < len(body) * 0.5 or len(repaired.encode("utf-8")) > MAX_BODY_BYTES:
        return body
    repaired_checks = inspect_body(repaired)
    original_errors = [i for i in original_checks['issues'] if i['severity'] == 'error']
    repaired_errors = [i for i in repaired_checks['issues'] if i['severity'] == 'error']
    if len(repaired_errors) > len(original_errors) or ({i['code'] for i in repaired_errors} - {i['code'] for i in original_errors}):
        logger.warning('Design repair rejected: introduced broken interaction targets')
        return body
    if original_checks['has_custom_script'] and not repaired_checks['has_custom_script']:
        logger.warning('Design repair rejected: removed prototype behavior')
        return body
    return repaired


# --- Flow generation -------------------------------------------------------

async def generate_flow(
    conn, settings, project: dict, prompt: str, image: str | None = None, add: bool = False,
    polish: bool = False, variants: int = 1,
) -> AsyncGenerator[dict, None]:
    """Plan screens, then build them in parallel. Yields events as each finishes:
    plan -> (screen | screen_error)* -> done."""
    existing = repository.list_design_screens(conn, project["id"])
    kind = project.get('kind') or 'prototype'
    max_new = 1 if (add or image) else 6 if kind == 'presentation' else MAX_SCREENS_PER_GENERATE
    if variants > 1 and kind != 'presentation' and not image:
        max_new = min(3, variants)
    max_new = min(max_new, MAX_SCREENS_PER_PROJECT - len(existing))
    if max_new < 1:
        yield {"type": "error", "error": f"A project can hold at most {MAX_SCREENS_PER_PROJECT} screens"}
        return

    build_image = image
    if not build_image:
        imported_image = conn.execute("SELECT content FROM design_sources WHERE project_id=? AND media_type LIKE ? ORDER BY id LIMIT 1", (project['id'],'image/%')).fetchone()
        if imported_image:
            build_image = imported_image['content']
    model_prompt = prompt + design_context(conn, project)
    model_prompt += {
        'presentation': '\nCreate an individual presentation slide, not a whole website. Use a 16:9 composition at 1280x720, meaningful visuals and concise speaker-ready content. Keep content within the slide and adapt at narrow widths. No app navigation chrome or decorative fake controls.',
        'document': '\nCreate a polished, print-friendly visual document or one-pager. Use readable editorial sections, real content and restrained typography. No decorative fake app controls.',
        'marketing': '\nCreate a finished campaign visual, social asset or marketing collateral. Prioritize the message, a distinct composition and brand consistency. Avoid unnecessary application chrome.',
    }.get(kind, '')
    if image:
        plan = {"project_name": "", "direction": "", "theme": None, "photo_terms": [], "screens": [{"name": "From image", "purpose": prompt or "Recreate the uploaded design"}]}
    else:
        if variants > 1:
            plan = await plan_flow(settings, model_prompt, project['device'], max_new, [s['name'] for s in existing], kind='variants')
        elif kind == 'prototype':
            plan = await plan_flow(settings, model_prompt, project["device"], max_new, [s["name"] for s in existing])
        else:
            plan = await plan_flow(settings, model_prompt, project["device"], max_new, [s["name"] for s in existing], kind=kind)

    if plan.get("theme") and not existing and not project.get('design_system_id'):
        repository.update_design_project(conn, project["id"], theme=plan["theme"])
        project["theme"] = plan["theme"]  # the route renders every screen with this

    if plan["project_name"] and project["name"] == DEFAULT_PROJECT_NAME and not existing:
        repository.update_design_project(conn, project["id"], name=plan["project_name"])
        project = {**project, "name": plan["project_name"]}

    start = len(existing)
    screens = []
    for i, s in enumerate(plan["screens"]):
        sid = repository.create_design_screen(conn, project["id"], s["name"], start + i)
        dimensions = {'presentation': {'width':1280,'height':720}, 'document': {'width':816,'height':1056}, 'marketing': {'width':1080,'height':1080}}.get(kind)
        if dimensions:
            conn.execute('INSERT INTO design_artboards (screen_id,layout) VALUES (?,?)',(sid,json.dumps(dimensions)))
            conn.commit()
        screens.append({"id": sid, **s})
    yield {
        "type": "plan",
        "project_name": project["name"],
        "theme": project["theme"],
        "direction": plan.get('direction', ''),
        "design_brief": plan.get('design_brief', {}),
        "screens": [{"id": s["id"], "name": s["name"], "purpose": s["purpose"]} for s in screens],
    }
    yield {'type': 'status', 'stage': 'building', 'message': 'Building layouts and working interactions'}

    style_reference = next((s["body"] for s in existing if s.get("body")), None)
    flow = plan["screens"]
    gate = asyncio.Semaphore(MAX_PARALLEL_SCREENS)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)

    async def build(screen: dict) -> dict:
        async def partial(text: str) -> None:
            draft = preview_body(text)
            if draft:
                await queue.put({'type': 'screen_draft', 'id': screen['id'], 'body': draft})
        try:
            async with gate:
                body = await generate_screen_body(
                    settings, model_prompt, project["device"], screen, flow, style_reference, build_image, plan.get("direction", ""),
                    design_brief=plan.get('design_brief'), theme=project['theme'], on_partial=partial,
                    **({'kind': kind} if kind != 'prototype' else {}),
                )
            version_id = repository.add_screen_version(conn, screen["id"], body, prompt)
            return {"type": "screen", "id": screen["id"], "version_id": version_id, "body": body}
        except DesignError as exc:
            return {"type": "screen_error", "id": screen["id"], "error": str(exc)}
        except Exception as exc:  # a bug in one screen must not sink the others
            logger.exception("Design screen %s failed", screen["id"])
            return {"type": "screen_error", "id": screen["id"], "error": f"Unexpected error: {exc}"}

    used_photos: set[str] = set()  # shared by every screen of this generation

    async def finish(built: dict, screen: dict) -> None:
        """After a screen is on the canvas: repair its design, then swap placeholders for pictures.
        Each step that changes the body is saved in place and streamed as an updated screen."""
        async def refine(body: str) -> str:
            await queue.put({'type': 'status', 'stage': 'refining', 'id': built['id'], 'message': 'Checking content, controls and responsive layouts'})
            report = await design_browser_checks.check_document(
                render_document(body, project['theme'], 0, interactive=False), project['device'],
            )
            # Clean prototypes finish with checks, rather than always paying for a second full rewrite.
            source_issues = inspect_body(body, project['theme'])['issues']
            repaired = body
            if polish or report['issues'] or source_issues:
                async with gate:
                    repaired = await refine_screen_body(
                        settings, body, screen, plan.get("direction", ""), plan.get('design_brief'), report['issues'],
                    )
            if repaired != body:
                updated_report = await design_browser_checks.check_document(
                    render_document(repaired, project['theme'], 0, interactive=False), project['device'],
                )
                new_failures = {i['code'] for i in updated_report['issues']} - {i['code'] for i in report['issues']}
                if report['status'] == 'checked' and (updated_report['status'] != 'checked' or new_failures or len(updated_report['issues']) > len(report['issues'])):
                    logger.warning('Design repair rejected: browser checks regressed')
                    repaired = body
                    updated_report = report
                report = updated_report
            await queue.put({'type': 'quality', 'id': built['id'], 'version_id': built['version_id'], 'browser': report})
            return repaired

        async def picture(body: str) -> str:
            if not _PLACEHOLDER.search(body) and not _UNSPLASH.search(body):
                return body
            await queue.put({'type': 'status', 'stage': 'images', 'id': built['id'], 'message': 'Adding final photography and visual details'})
            # Photos never delay the initial screen, and cannot hold the editor busy for minutes.
            resolved, timed_out = await finish_photography(
                settings, body, f"{prompt[:200]}. {plan.get('direction', '')}", tuple(plan.get("photo_terms") or ()), used_photos,
            )
            if timed_out:
                await queue.put({'type': 'notice', 'message': 'Photography timed out. Your design is saved; some image slots may remain unfilled.'})
            return resolved

        try:
            for step in (refine, picture):
                body = await step(built["body"])
                if body != built["body"] and len(body.encode("utf-8")) <= MAX_BODY_BYTES:
                    repository.update_screen_version_body(conn, built["version_id"], body)
                    built = {**built, "body": body}
                    await queue.put(built)
            report = await design_browser_checks.check_document(
                render_document(built['body'], project['theme'], 0, interactive=False), project['device'],
            )
            await queue.put({'type': 'quality', 'id': built['id'], 'version_id': built['version_id'], 'browser': report})
        except Exception:
            logger.exception("Design finishing for screen %s failed", built["id"])

    async def produce(screen: dict) -> None:
        try:
            built = await build(screen)
            await queue.put(built)
            if built['type'] == 'screen':
                await finish(built, screen)
        finally:
            # Cancellation must not block trying to write to an abandoned full queue.
            if not asyncio.current_task().cancelling():
                await queue.put(None)

    tasks = [asyncio.create_task(produce(s)) for s in screens]
    ended = 0
    try:
        while ended < len(tasks):
            item = await queue.get()
            if item is None:
                ended += 1
            else:
                yield item
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    yield {"type": "done"}
