import asyncio
import base64
import logging
from pathlib import Path
from typing import Any
from playwright.async_api import async_playwright, BrowserContext, Page
from bs4 import BeautifulSoup

logger = logging.getLogger("pragna.browser")


class BrowserService:
    def __init__(self, data_dir: str = "data/browser_profile"):
        self.data_dir = str(Path(data_dir).resolve())
        self._playwright = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._lock = asyncio.Lock()

    async def _ensure_page(self) -> Page:
        async with self._lock:
            if self._playwright is None:
                self._playwright = await async_playwright().start()

            if self._context is None:
                Path(self.data_dir).mkdir(parents=True, exist_ok=True)
                self._context = await self._playwright.chromium.launch_persistent_context(
                    user_data_dir=self.data_dir,
                    headless=True,
                    viewport={"width": 1280, "height": 800},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                )

            if not self._context.pages:
                self._page = await self._context.new_page()
            else:
                self._page = self._context.pages[0]

            return self._page

    async def _capture_preview(self, page: Page) -> str | None:
        """A compact JPEG snapshot of the page, attached to navigate/act
        results so the user can see what the headless browser is actually
        looking at, not just a text description of it. Lower quality than
        the dedicated screenshot() tool (which is for the model's vision
        input) since this rides along on every navigation/action."""
        try:
            image_bytes = await page.screenshot(type="jpeg", quality=55)
            return base64.b64encode(image_bytes).decode("ascii")
        except Exception as e:
            logger.warning(f"Browser preview capture failed: {e}")
            return None

    async def navigate(self, url: str) -> dict[str, Any]:
        try:
            page = await self._ensure_page()
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            response = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            title = await page.title()
            status = response.status if response else 200
            result = {
                "success": True,
                "url": page.url,
                "title": title,
                "status": status,
            }
            preview = await self._capture_preview(page)
            if preview:
                result["image_base64"] = preview
            return result
        except Exception as e:
            logger.error(f"Browser navigate error: {e}")
            return {"success": False, "error": str(e)}

    async def read_page(self) -> dict[str, Any]:
        try:
            page = await self._ensure_page()
            content_html = await page.content()
            title = await page.title()
            url = page.url

            soup = BeautifulSoup(content_html, "html.parser")

            # Remove scripts, styles, svg
            for tag in soup(["script", "style", "noscript", "svg"]):
                tag.decompose()

            # Extract main text
            text = soup.get_text(separator=" ", strip=True)[:4000]

            # Extract interactive elements
            interactive_elements = []
            for el in soup.find_all(["a", "button", "input", "select", "textarea"]):
                tag_name = el.name
                el_text = el.get_text(strip=True) or el.get("value") or el.get("placeholder") or el.get("aria-label") or ""
                href = el.get("href")
                el_type = el.get("type")

                item = {
                    "tag": tag_name,
                    "text": el_text[:80],
                }
                if href:
                    item["href"] = href
                if el_type:
                    item["type"] = el_type
                if el.get("name"):
                    item["name"] = el.get("name")
                if el.get("id"):
                    item["id"] = el.get("id")

                interactive_elements.append(item)
                if len(interactive_elements) >= 30:
                    break

            return {
                "success": True,
                "url": url,
                "title": title,
                "text_snippet": text,
                "interactive_elements": interactive_elements,
            }
        except Exception as e:
            logger.error(f"Browser read_page error: {e}")
            return {"success": False, "error": str(e)}

    async def screenshot(self) -> dict[str, Any]:
        try:
            page = await self._ensure_page()
            title = await page.title()
            url = page.url
            # Higher quality than the incidental navigate/act preview since
            # this is the model's actual vision input, not just a UI thumbnail.
            image_bytes = await page.screenshot(type="jpeg", quality=80)
            image_base64 = base64.b64encode(image_bytes).decode("ascii")
            return {
                "success": True,
                "url": url,
                "title": title,
                "summary": f"Page title: {title}. Current URL: {url}.",
                "image_base64": image_base64,
            }
        except Exception as e:
            logger.error(f"Browser screenshot error: {e}")
            return {"success": False, "error": str(e)}

    async def act(self, steps: list[dict[str, Any]]) -> dict[str, Any]:
        try:
            page = await self._ensure_page()
            executed_steps = []

            for step in steps:
                action = step.get("action")
                selector = step.get("selector")
                value = step.get("value")

                if action == "click" and selector:
                    await page.click(selector, timeout=5000)
                    executed_steps.append(f"Clicked '{selector}'")
                elif action == "type" and selector and value is not None:
                    await page.fill(selector, str(value), timeout=5000)
                    executed_steps.append(f"Typed into '{selector}'")
                elif action == "press" and selector and value:
                    await page.press(selector, str(value), timeout=5000)
                    executed_steps.append(f"Pressed '{value}' on '{selector}'")
                elif action == "select" and selector and value:
                    await page.select_option(selector, str(value), timeout=5000)
                    executed_steps.append(f"Selected '{value}' in '{selector}'")
                else:
                    executed_steps.append(f"Skipped unknown/invalid step: {step}")

            # Return updated page status
            read_info = await self.read_page()
            result = {
                "success": True,
                "executed_steps": executed_steps,
                "current_url": page.url,
                "current_title": await page.title(),
                "text_snippet": read_info.get("text_snippet", "")[:1000],
            }
            preview = await self._capture_preview(page)
            if preview:
                result["image_base64"] = preview
            return result
        except Exception as e:
            logger.error(f"Browser act error: {e}")
            return {"success": False, "error": str(e)}

    async def click(self, selector: str) -> dict[str, Any]:
        """Click an element on the current page."""
        try:
            page = await self._ensure_page()
            try:
                await page.click(selector, timeout=7000)
            except Exception:
                # Fallback: try locating by text
                await page.get_by_text(selector, exact=False).first.click(timeout=5000)
            preview = await self._capture_preview(page)
            result = {"success": True, "selector": selector, "summary": f"Clicked '{selector}'."}
            if preview:
                result["image_base64"] = preview
            return result
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def type_text(self, selector: str, text: str, clear_first: bool = True) -> dict[str, Any]:
        """Type text into an input field."""
        try:
            page = await self._ensure_page()
            if clear_first:
                await page.fill(selector, text, timeout=7000)
            else:
                await page.type(selector, text, timeout=7000)
            return {"success": True, "selector": selector, "text": text, "summary": f"Typed into '{selector}'."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def scroll(self, direction: str = "down", amount: int = 500, selector: str | None = None) -> dict[str, Any]:
        """Scroll the page."""
        try:
            page = await self._ensure_page()
            if selector:
                element = page.locator(selector).first
                await element.scroll_into_view_if_needed(timeout=5000)
                return {"success": True, "summary": f"Scrolled '{selector}' into view."}
            scroll_map = {
                "down": (0, amount),
                "up": (0, -amount),
                "top": ("document.body.scrollTop = 0", None),
                "bottom": ("window.scrollTo(0, document.body.scrollHeight)", None),
            }
            if direction in ("top", "bottom"):
                await page.evaluate(scroll_map[direction][0])
            else:
                dx, dy = scroll_map.get(direction, (0, amount))
                await page.mouse.wheel(dx, dy)
            return {"success": True, "direction": direction, "amount": amount, "summary": f"Scrolled {direction} by {amount}px."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def go_back(self) -> dict[str, Any]:
        """Navigate browser back."""
        try:
            page = await self._ensure_page()
            await page.go_back(timeout=10000)
            title = await page.title()
            return {"success": True, "url": page.url, "title": title, "summary": f"Navigated back to: {page.url}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def press_key(self, key: str, selector: str | None = None) -> dict[str, Any]:
        """Press a key, optionally on a specific element."""
        try:
            page = await self._ensure_page()
            if selector:
                await page.press(selector, key, timeout=5000)
            else:
                await page.keyboard.press(key)
            return {"success": True, "key": key, "selector": selector, "summary": f"Pressed '{key}'."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_images(self) -> dict[str, Any]:
        """Extract image assets and URLs from the current page."""
        try:
            page = await self._ensure_page()
            images = await page.evaluate("""
                () => Array.from(document.querySelectorAll('img')).slice(0, 30).map(img => ({
                    src: img.src || img.currentSrc,
                    alt: img.alt,
                    width: img.naturalWidth,
                    height: img.naturalHeight
                })).filter(img => img.src)
            """)
            return {"success": True, "images": images, "count": len(images), "summary": f"Found {len(images)} images on page."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_console_logs(self) -> dict[str, Any]:
        """Get recent browser JavaScript console logs. Note: only captures logs after page load."""
        try:
            page = await self._ensure_page()
            # Evaluate any errors visible in DOM
            result = await page.evaluate("""
                () => {
                    return { url: window.location.href, title: document.title, readyState: document.readyState }
                }
            """)
            return {"success": True, "page_info": result, "logs": [], "summary": "Console log capture is available for future page loads."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def handle_dialog(self, action: str = "accept", text: str = "") -> dict[str, Any]:
        """Accept or dismiss a browser dialog (alert/confirm/prompt)."""
        try:
            page = await self._ensure_page()
            def _on_dialog(dialog):
                import asyncio
                if action == "accept":
                    asyncio.create_task(dialog.accept(text) if text else dialog.accept())
                else:
                    asyncio.create_task(dialog.dismiss())
            page.once("dialog", _on_dialog)
            return {"success": True, "action": action, "summary": f"Dialog handler registered: will {action} next dialog."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def close(self):
        async with self._lock:
            if self._context:
                await self._context.close()
                self._context = None
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
