"""Bounded, isolated smoke checks for generated prototypes. No provider calls."""

import asyncio
import hashlib
import html
import logging
from collections import OrderedDict
from pathlib import Path

_gate = asyncio.Semaphore(1)
_reports: OrderedDict[str, dict] = OrderedDict()
_tailwind = (
    Path(__file__).resolve().parents[2]
    / "frontend/public/vendor/tailwindcss-play-3.4.17.js"
)
if not _tailwind.is_file():
    _tailwind = Path(__file__).with_name("vendor") / "tailwindcss-play-3.4.17.js"
logger = logging.getLogger(__name__)


def cached_report(document: str, device: str) -> dict | None:
    return _reports.get(hashlib.sha256(document.encode()).hexdigest() + ":" + device)


async def check_document(document: str, device: str) -> dict:
    if not _tailwind.is_file():
        return {
            "status": "unavailable",
            "widths": [],
            "buttons_checked": 0,
            "issues": [],
        }
    widths = [390, 768, 1280] if device == "web" else [390]
    key = hashlib.sha256(document.encode()).hexdigest() + ":" + device
    if key in _reports:
        return _reports[key]

    async def run():
        from playwright.async_api import async_playwright

        issues = []

        def issue(code, message):
            entry = {"code": code, "message": str(message)[:300], "severity": "error"}
            if entry not in issues and len(issues) < 12:
                issues.append(entry)

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                context = await browser.new_context()
                shell = (
                    '<iframe sandbox="allow-scripts allow-forms" style="border:0;width:100%;height:100vh" srcdoc="'
                    + html.escape(document, quote=True)
                    + '"></iframe>'
                )

                async def route(request):
                    if request.request.url == "https://design-preview.invalid/":
                        await request.fulfill(
                            content_type="text/html",
                            body="<style>body{margin:0}</style>" + shell,
                        )
                    elif (
                        request.request.url
                        == "https://design-preview.invalid/vendor/tailwindcss-play-3.4.17.js"
                    ):
                        await request.fulfill(
                            content_type="application/javascript", path=str(_tailwind)
                        )
                    else:
                        await request.abort()

                await context.route("**/*", route)
                page = await context.new_page()
                page.on(
                    "pageerror",
                    lambda error: issue(
                        "script_error", f"Prototype script error: {error}"
                    ),
                )
                page.set_default_timeout(2500)
                checked = 0
                for width in widths:
                    await page.set_viewport_size({"width": width, "height": 844})
                    await page.goto(
                        "https://design-preview.invalid/",
                        wait_until="load",
                        timeout=6000,
                    )
                    frame = next(
                        frame for frame in page.frames if frame != page.main_frame
                    )
                    # Tailwind compiles asynchronously after the document has loaded.
                    await frame.wait_for_function(
                        "Array.from(document.querySelectorAll('style')).some(style => style.textContent.includes('.bg-background'))"
                    )
                    dimensions = await frame.evaluate("""() => ({
                      viewport: innerWidth,
                      content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
                    })""")
                    if dimensions["content"] > dimensions["viewport"] + 4:
                        issue(
                            "overflow",
                            f"Layout overflows the {width}px viewport by {dimensions['content'] - dimensions['viewport']}px.",
                        )
                    if width != widths[0]:
                        continue
                    # Sample visible buttons. Each click starts from a fresh local demo.
                    count = min(
                        await frame.locator(
                            'button:not([disabled]):not([type="submit"])'
                        ).count(),
                        6,
                    )
                    for index in range(count):
                        if index:
                            await page.reload(wait_until="load")
                            frame = next(
                                frame
                                for frame in page.frames
                                if frame != page.main_frame
                            )
                            await frame.wait_for_function(
                                "Array.from(document.querySelectorAll('style')).some(style => style.textContent.includes('.bg-background'))"
                            )
                        button = frame.locator(
                            'button:not([disabled]):not([type="submit"])'
                        ).nth(index)
                        if not await button.is_visible():
                            continue
                        if (
                            await button.get_attribute("aria-selected") == "true"
                            or await button.get_attribute("aria-pressed") == "true"
                        ):
                            continue
                        # Native form submission is checked by the browser itself, not this click sampler.
                        if await button.evaluate(
                            '(button) => button.type === "submit" && !!button.form'
                        ):
                            continue
                        # Voice needs real browser permission/audio output, outside this isolated sampler.
                        if await button.evaluate(
                            '(button) => button.hasAttribute("data-design-speak") || button.hasAttribute("data-design-dictate")'
                        ):
                            continue
                        label = (
                            await button.inner_text()
                            or await button.get_attribute("aria-label")
                            or "Unnamed button"
                        )[:60]
                        before = await frame.evaluate(
                            '() => document.body.innerHTML + ":" + scrollX + ":" + scrollY'
                        )
                        try:
                            await button.click(timeout=2500)
                            await frame.wait_for_timeout(100)
                            after = await frame.evaluate(
                                '() => document.body.innerHTML + ":" + scrollX + ":" + scrollY'
                            )
                            checked += 1
                            if before == after:
                                issue(
                                    "inert_button",
                                    f'Button "{label}" produces no visible demo change.',
                                )
                        except Exception as exc:
                            logger.debug("Design button smoke check failed: %s", exc)
                            issue(
                                "button_error",
                                f'Button "{label}" cannot complete its local action.',
                            )
                return {
                    "status": "checked",
                    "widths": widths,
                    "buttons_checked": checked,
                    "issues": issues,
                }
            finally:
                await browser.close()

    async def limited():
        async with _gate:
            return await run()

    try:
        # Include queueing for Chromium in the deadline, not only browser execution.
        report = await asyncio.wait_for(limited(), timeout=20)
    except Exception as exc:
        logger.info("Design browser smoke checks unavailable: %s", type(exc).__name__)
        # Browser binaries are optional in deployments. Never claim an unrun check passed.
        return {
            "status": "unavailable",
            "widths": [],
            "buttons_checked": 0,
            "issues": [],
        }
    _reports[key] = report
    while len(_reports) > 128:
        _reports.popitem(last=False)
    return report
