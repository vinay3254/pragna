import asyncio
from unittest.mock import AsyncMock
import httpx
import pytest
import respx
from app import search_service as search

REAL_HTML_SEARCH = search._html_search

HIT = {"title": "Official release", "url": "https://example.org/releases", "snippet": "Published release information."}


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    search._cache.clear()
    search._inflight.clear()
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    monkeypatch.delenv("OMNIROUTE_API_KEY", raising=False)
    monkeypatch.setattr(search, "_ddgs", AsyncMock(return_value=[]))
    monkeypatch.setattr(search, "_html_search", AsyncMock(return_value=[]))
    monkeypatch.setattr(search, "_lite_search", AsyncMock(return_value=[]))


async def test_primary_results_and_shared_cache(monkeypatch):
    primary = AsyncMock(return_value=[HIT, HIT])
    monkeypatch.setattr(search, "_ddgs", primary)
    a, b = await asyncio.gather(search.perform_web_search(" Latest version "), search.perform_web_search("latest version"))
    assert a["success"] and b["success"]
    assert len(a["results"]) == 1
    assert a["retrieved_at"]
    primary.assert_awaited_once()
    cached = await search.perform_web_search("latest version")
    assert cached["cached"] is True
    assert cached["retrieved_at"] == a["retrieved_at"]
    primary.assert_awaited_once()


async def test_slow_primary_does_not_block_hedged_provider(monkeypatch):
    cancelled = asyncio.Event()
    async def slow(query):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.set()
    monkeypatch.setattr(search, "_ddgs", slow)
    monkeypatch.setattr(search, "_html_search", AsyncMock(return_value=[HIT]))
    result = await asyncio.wait_for(search.perform_web_search("latest version"), timeout=2)
    assert result["provider"] == "duckduckgo-html"
    assert cancelled.is_set()


async def test_failures_never_return_fake_success_and_can_retry(monkeypatch):
    monkeypatch.setattr(search, "_ddgs", AsyncMock(side_effect=ConnectionError("blocked")))
    monkeypatch.setattr(search, "_html_search", AsyncMock(side_effect=ConnectionError("blocked")))
    monkeypatch.setattr(search, "_lite_search", AsyncMock(side_effect=ConnectionError("blocked")))
    result = await search.perform_web_search("latest version")
    assert result["success"] is False
    assert result["results"] == []
    assert result["error"]
    assert not search._cache
    monkeypatch.setattr(search, "_ddgs", AsyncMock(return_value=[HIT]))
    assert (await search.perform_web_search("latest version"))["success"]


async def test_deadline_cancels_work_and_reports_failure(monkeypatch):
    monkeypatch.setattr(search, "SEARCH_TIMEOUT", .02)
    cancelled = asyncio.Event()
    async def slow(query):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.set()
    monkeypatch.setattr(search, "_ddgs", slow)
    result = await search.perform_web_search("latest version")
    assert result["success"] is False and "timed out" in result["error"]
    assert cancelled.is_set()
    assert not search._inflight


async def test_expired_cache_refreshes(monkeypatch):
    monkeypatch.setattr(search, "_ddgs", AsyncMock(return_value=[HIT]))
    await search.perform_web_search("query")
    timestamp, result = search._cache["query"]
    search._cache["query"] = (timestamp - search.CACHE_TTL - 1, result)
    second = await search.perform_web_search("query")
    assert second["cached"] is False
    assert search._ddgs.await_count == 2


def test_results_require_real_links_and_snippets():
    rows = [HIT, HIT, {"title":"Fake", "url":"https://example.org/fake", "snippet":"Web search results for query"},
            {"title":"Unsafe", "url":"javascript:alert(1)", "snippet":"Text"},
            {"title":{}, "url":"https://example.org", "snippet":"Text"},
            {"title":"Empty", "url":"https://example.org"}]
    assert search._normalize(rows) == [HIT]


async def test_html_parser_and_redirect_url():
    html = '<div class="result__body"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide">Official guide</a><a class="result__snippet">Actual &amp; useful text</a></div>'
    with respx.mock() as mock:
        mock.get("https://html.duckduckgo.com/html/").respond(200, text=html)
        rows = search._normalize(await REAL_HTML_SEARCH("guide"))
    assert rows == [{"title":"Official guide", "url":"https://example.org/guide", "snippet":"Actual & useful text"}]


async def test_cancelled_client_does_not_cancel_shared_request(monkeypatch):
    started, complete = asyncio.Event(), asyncio.Event()
    async def primary(query):
        started.set()
        await complete.wait()
        return [HIT]
    monkeypatch.setattr(search, "_ddgs", primary)
    a = asyncio.create_task(search.perform_web_search("query"))
    await started.wait()
    b = asyncio.create_task(search.perform_web_search("query"))
    await asyncio.sleep(0)
    a.cancel()
    with pytest.raises(asyncio.CancelledError):
        await a
    complete.set()
    assert (await b)["success"]


async def test_configured_brave_provider(monkeypatch):
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "test-key")
    monkeypatch.setattr(search, "_brave", AsyncMock(return_value=[HIT]))
    assert (await search.perform_web_search("query"))["provider"] == "brave"


def test_chat_instructions_are_not_search_terms():
    assert search._search_query('Search the web for the latest Python release. Give a short answer with an official source.') == 'latest Python release official'
    assert search._search_query('What is the latest Python release? Include an official source.') == 'latest Python release official'
    assert search._search_query('site:python.org Python 3.14.8') == 'site:python.org Python 3.14.8'
    assert search._search_query('Search online for Bengaluru weather today') == 'Bengaluru weather today'
    assert search._search_query('Search the web for "climate change"') == '"climate change"'


async def test_omniroute_search_is_preferred_when_configured(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_API_KEY", "sk-test")
    monkeypatch.setenv("OMNIROUTE_BASE_URL", "http://omni.test")
    scraper = AsyncMock(return_value=[HIT])
    monkeypatch.setattr(search, "_ddgs", scraper)
    with respx.mock:
        route = respx.post("http://omni.test/v1/search").mock(
            return_value=httpx.Response(200, json={"results": [HIT]}))
        result = await search.perform_web_search("latest version")
    assert result["provider"] == "omniroute"
    assert route.calls.last.request.headers["authorization"] == "Bearer sk-test"
    assert b"duckduckgo-free" in route.calls.last.request.content
    scraper.assert_not_awaited()


async def test_scrapers_back_up_a_failing_omniroute(monkeypatch):
    monkeypatch.setenv("OMNIROUTE_API_KEY", "sk-test")
    monkeypatch.setenv("OMNIROUTE_BASE_URL", "http://omni.test")
    monkeypatch.setattr(search, "OMNIROUTE_LEAD", 0)
    monkeypatch.setattr(search, "_ddgs", AsyncMock(return_value=[HIT]))
    with respx.mock:
        respx.post("http://omni.test/v1/search").mock(return_value=httpx.Response(502))
        result = await search.perform_web_search("latest version")
    assert result["provider"] == "ddgs"
