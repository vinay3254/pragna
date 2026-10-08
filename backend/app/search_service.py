"""Bounded, shared web search. Only genuine linked search results count as success."""
import asyncio
import html
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("pragna.search")
SEARCH_TIMEOUT = 12
OMNIROUTE_SEARCH_PROVIDER = "duckduckgo-free"
OMNIROUTE_LEAD = 3  # seconds OmniRoute gets before the direct scrapers start
CACHE_TTL = 30
CACHE_LIMIT = 128
_cache: dict[str, tuple[float, dict]] = {}
_inflight: dict[str, asyncio.Task] = {}
_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="pragna-search")
_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"}


def _clean_url(raw: str) -> str:
    raw = html.unescape(raw)
    if raw.startswith("//"):
        raw = "https:" + raw
    parsed = urlparse(raw)
    if parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
        target = parse_qs(parsed.query).get("uddg")
        if target:
            raw = target[0]
    return raw


def _normalize(rows) -> list[dict]:
    results, seen = [], set()
    if not isinstance(rows, list):
        return results
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw_title = row.get("title")
        raw_snippet = row.get("snippet") or row.get("body") or row.get("description")
        raw_url = row.get("url") or row.get("href")
        if not all(isinstance(value, str) for value in (raw_title, raw_snippet, raw_url)):
            continue
        title = html.unescape(re.sub(r"<[^>]*>", "", raw_title)).strip()
        snippet = html.unescape(re.sub(r"<[^>]*>", "", raw_snippet)).strip()
        url = _clean_url(raw_url)
        parsed = urlparse(url)
        if (not title or not snippet or parsed.scheme not in {"https", "http"}
                or not parsed.hostname or url in seen):
            continue
        if snippet.lower().startswith(("results for '", "search completed for", "web search results for")):
            continue
        seen.add(url)
        results.append({"title": title[:250], "url": url, "snippet": snippet[:2000]})
        if len(results) >= 8:
            break
    return results


async def _ddgs(query):
    def fetch():
        from ddgs import DDGS
        with DDGS(timeout=4) as client:
            return list(client.text(query, max_results=8, backend="bing,brave,duckduckgo"))
    return await asyncio.get_running_loop().run_in_executor(_pool, fetch)


async def _html_search(query):
    async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=_HEADERS) as client:
        response = await client.get("https://html.duckduckgo.com/html/", params={"q": query})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        rows = []
        for block in soup.select(".result__body")[:8]:
            link, snippet = block.select_one("a.result__a"), block.select_one(".result__snippet")
            if link and snippet:
                rows.append({"title": link.get_text(" ", strip=True), "url": link.get("href", ""), "snippet": snippet.get_text(" ", strip=True)})
        return rows


async def _lite_search(query):
    async with httpx.AsyncClient(timeout=6, follow_redirects=True, headers=_HEADERS) as client:
        response = await client.get("https://lite.duckduckgo.com/lite/", params={"q": query})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        links, snippets = soup.select("a.result-link"), soup.select("td.result-snippet")
        return [{"title": link.get_text(" ", strip=True), "url": link.get("href", ""),
                 "snippet": snippets[i].get_text(" ", strip=True) if i < len(snippets) else ""}
                for i, link in enumerate(links[:8])]


async def _brave(query):
    async with httpx.AsyncClient(timeout=6) as client:
        response = await client.get("https://api.search.brave.com/res/v1/web/search",
                                    params={"q": query, "count": 8},
                                    headers={"X-Subscription-Token": os.environ["BRAVE_SEARCH_API_KEY"]})
        response.raise_for_status()
        return response.json().get("web", {}).get("results", [])


async def _omniroute(query):
    # OmniRoute searches from its own host, so hosted backends avoid blocked datacenter IPs.
    base = os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128").rstrip("/")
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.post(f"{base}/v1/search",
                                     json={"query": query, "provider": OMNIROUTE_SEARCH_PROVIDER, "max_results": 8},
                                     headers={"Authorization": f"Bearer {os.environ['OMNIROUTE_API_KEY']}"})
        response.raise_for_status()
        return response.json().get("results", [])


def _failure(query, reason):
    return {"success": False, "query": query, "provider": None, "results": [], "count": 0,
            "error": reason, "summary": reason}


def _search_query(message: str) -> str:
    """Keep the topic; answer-format instructions belong to the chat model."""
    query = " ".join(message.split())
    query = re.sub(r"^(?:can you|could you|would you)\s+(?:please\s+)?", "", query, flags=re.I)
    official = bool(re.search(r"\bofficial (?:source|site|website|documentation)\b", query, re.I))
    query = re.split(r"[.!?,;]\s*(?:give|answer|respond|reply|include|cite|keep|provide)\b", query, maxsplit=1, flags=re.I)[0]
    query = re.sub(r"^(?:please\s+)?(?:search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?|look\s*up|google(?:\s+for)?|research)\s+", "", query, flags=re.I)
    query = re.sub(r"^(?:the\s+|what(?:'s| is| are)\s+(?:the\s+)?)", "", query, flags=re.I)
    query = query.strip(" .!?")
    if official and not re.search(r"\bofficial\b", query, re.I):
        query += " official"
    return query[:500]


async def _run(query):
    # Hedge slower/blocked providers; the first provider with usable results wins.
    async def attempt(name, search, delay=0):
        if delay:
            await asyncio.sleep(delay)
        try:
            rows = _normalize(await asyncio.wait_for(search(query), timeout=8))
            if rows:
                return {"success": True, "query": query, "provider": name, "results": rows,
                        "count": len(rows), "cached": False,
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                        "summary": f"Found {len(rows)} web search results."}
        except Exception as exc:
            logger.info("Search provider %s failed: %s", name, type(exc).__name__)
        return None

    tasks = []
    lead = 0
    if os.getenv("OMNIROUTE_API_KEY", "").strip():
        tasks.append(asyncio.create_task(attempt("omniroute", _omniroute)))
        lead = OMNIROUTE_LEAD
    tasks += [asyncio.create_task(attempt("ddgs", _ddgs, lead)),
              asyncio.create_task(attempt("duckduckgo-html", _html_search, lead + 1)),
              asyncio.create_task(attempt("duckduckgo-lite", _lite_search, lead + 2))]
    key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    if key and not key.lower().startswith(("your", "placeholder")):
        tasks.append(asyncio.create_task(attempt("brave", _brave)))
    try:
        async with asyncio.timeout(SEARCH_TIMEOUT):
            for future in asyncio.as_completed(tasks):
                result = await future
                if result:
                    return result
        return _failure(query, "Live web search returned no usable results. Please retry or narrow the query.")
    except TimeoutError:
        return _failure(query, "Live web search timed out. Please retry; current facts could not be verified.")
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def perform_web_search(query: str) -> dict:
    query = _search_query(query)
    if not query:
        return _failure(query, "Search query cannot be empty.")
    key = query.casefold()
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL:
        return {**cached[1], "query": query, "cached": True}

    async def run_and_cache():
        try:
            result = await _run(query)
            if result["success"]:
                if len(_cache) >= CACHE_LIMIT:
                    _cache.pop(next(iter(_cache)))
                _cache[key] = (time.monotonic(), result)
            return result
        finally:
            _inflight.pop(key, None)

    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(run_and_cache())
        _inflight[key] = task
    # One disconnected caller must not cancel another caller's shared search.
    return {**await asyncio.shield(task), "query": query}
