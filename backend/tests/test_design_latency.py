"""First output, failover and cancellation regressions; no live provider calls."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app import design_service as design, repository
from app.db import get_connection, init_db


def settings():
    return SimpleNamespace(omniroute_api_key='test-key', omniroute_base_url='http://fake-gateway',
        design_model='primary/page', design_plan_model='primary/plan', design_fallback_model='backup/page')


async def test_llm_fails_over_before_content_and_skips_unavailable_provider(monkeypatch):
    calls, closed = [], []
    async def stream(messages, model, url, **kwargs):
        calls.append((model, kwargs['max_tokens']))
        try:
            if model.startswith('primary/'):
                await asyncio.Event().wait()
            yield '<main>Working</main>'
        finally:
            closed.append(model)
    monkeypatch.setattr(design, 'chat_stream', stream)
    monkeypatch.setattr(design, '_model_blocked_until', {})
    monkeypatch.setattr(design, 'FIRST_TOKEN_TIMEOUT_SECONDS', .01)
    assert await design._llm(settings(), []) == '<main>Working</main>'
    assert await design._llm(settings(), [], stage='planning') == '<main>Working</main>'
    assert calls == [('primary/page', design.DESIGN_MAX_TOKENS), ('backup/page', design.DESIGN_MAX_TOKENS),
                     ('backup/page', design.PLAN_MAX_TOKENS)]
    assert closed == ['primary/page', 'backup/page', 'backup/page']


async def test_llm_never_mixes_models_after_output_begins(monkeypatch):
    calls = []
    async def stream(messages, model, url, **kwargs):
        calls.append(model)
        yield '<main>'
        raise RuntimeError('Connection failed mid-body')
    monkeypatch.setattr(design, 'chat_stream', stream)
    monkeypatch.setattr(design, '_model_blocked_until', {})
    with pytest.raises(design.DesignError, match='Connection failed mid-body'):
        await design._llm(settings(), [])
    assert calls == ['primary/page']


def test_preview_removes_incomplete_scripts_and_event_handlers():
    text = '```html\n<main><h1 onclick="alert(1)">Studio</h1><a href="javascript:alert(1)">Link</a><script>throw Error("partial")'
    draft = design.preview_body(text)
    assert '<h1>Studio</h1>' in draft
    assert 'script' not in draft and 'onclick' not in draft and 'javascript:' not in draft
    assert design.preview_body('still thinking') is None


@pytest.fixture
def project(tmp_path):
    path = str(tmp_path / 'design.db')
    init_db(path)
    conn = get_connection(path)
    repository.create_user(conn, 'test@example.test', 'unused')
    pid = repository.create_design_project(conn, 1, 'Untitled design', 'web', design.DEFAULT_THEME)
    yield conn, repository.get_design_project(conn, 1, pid)
    conn.close()


async def test_draft_arrives_before_completion_and_photos_and_clean_design_skips_rewrite(project, monkeypatch):
    conn, item = project
    release, photos_started = asyncio.Event(), asyncio.Event()
    calls = []
    async def stream(messages, model, url, **kwargs):
        calls.append(messages[0]['content'])
        if messages[0]['content'] == design._PLAN_SYSTEM:
            yield json.dumps({'screens': [{'name': 'Studio', 'purpose': 'Show projects'}]})
        else:
            yield '```html\n<main><h1>Studio architecture and thoughtful spaces</h1><p>' + 'Architecture project details. ' * 5 + '</p>'
            await release.wait()
            yield '<img src="https://images.unsplash.com/photo-example?w=1200" alt="Sample project"></main>\n```'
    async def resolve(body):
        photos_started.set()
        return body
    async def illustrate(settings, body, *args):
        return body
    async def check(*args):
        return {'status': 'checked', 'issues': [], 'widths': [390, 768, 1280], 'buttons_checked': 0}
    monkeypatch.setattr(design, 'chat_stream', stream)
    monkeypatch.setattr(design, '_model_blocked_until', {})
    monkeypatch.setattr(design, 'resolve_unsplash', resolve)
    monkeypatch.setattr(design, 'illustrate', illustrate)
    monkeypatch.setattr(design.design_browser_checks, 'check_document', check)
    flow = design.generate_flow(conn, settings(), item, 'Architect portfolio')
    assert (await anext(flow))['type'] == 'plan'
    assert (await anext(flow))['type'] == 'status'
    draft = await asyncio.wait_for(anext(flow), .5)
    assert draft['type'] == 'screen_draft'
    assert repository.get_design_screen(conn, 1, draft['id'])['current_version_id'] is None
    assert not photos_started.is_set()
    release.set()
    saved = await anext(flow)
    assert saved['type'] == 'screen' and saved['version_id']
    remaining = [event async for event in flow]
    assert photos_started.is_set() and remaining[-1]['type'] == 'done'
    assert len(calls) == 2  # plan and build; no unconditional second AI rewrite


async def test_stopping_draft_closes_provider_and_never_persists_partial_body(project, monkeypatch):
    conn, item = project
    closed = asyncio.Event()
    async def stream(messages, model, url, **kwargs):
        if messages[0]['content'] == design._PLAN_SYSTEM:
            yield '{"screens":[{"name":"Home","purpose":"Overview"}]}'
        else:
            try:
                yield '```html\n<main><h1>Home</h1><p>' + 'Draft content. ' * 15 + '</p>'
                await asyncio.Event().wait()
            finally:
                closed.set()
    monkeypatch.setattr(design, 'chat_stream', stream)
    monkeypatch.setattr(design, '_model_blocked_until', {})
    flow = design.generate_flow(conn, settings(), item, 'Dashboard')
    await anext(flow)
    await anext(flow)
    draft = await anext(flow)
    await asyncio.wait_for(flow.aclose(), .5)
    assert closed.is_set()
    assert repository.get_design_screen(conn, 1, draft['id'])['body'] is None


async def test_photography_budget_keeps_saved_screen_and_finishes(project, monkeypatch):
    conn, item = project
    async def llm(settings, messages, **kwargs):
        if kwargs.get('stage') == 'planning':
            return '{"screens":[{"name":"Home","purpose":"Overview"}]}'
        return '```html\n<main><img src="https://placehold.co/600x400?text=Building" alt="Sample building"></main>\n```'
    cancelled = asyncio.Event()
    async def picture(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    async def check(*args):
        return {'status': 'checked', 'issues': [], 'widths': [390], 'buttons_checked': 0}
    monkeypatch.setattr(design, '_llm', llm)
    monkeypatch.setattr(design, 'illustrate', picture)
    monkeypatch.setattr(design, 'PHOTO_TIMEOUT_SECONDS', .01)
    monkeypatch.setattr(design.design_browser_checks, 'check_document', check)
    events = [event async for event in design.generate_flow(conn, settings(), item, 'Building portfolio')]
    assert cancelled.is_set() and events[-1]['type'] == 'done'
    assert any(event['type'] == 'notice' for event in events)
    screen = next(event for event in events if event['type'] == 'screen')
    assert repository.get_design_screen(conn, 1, screen['id'])['current_version_id'] == screen['version_id']


async def test_dead_navigation_still_triggers_automatic_repair(project, monkeypatch):
    conn, item = project
    original = '<main><h1>Studio</h1><a href="#">Projects</a><p>Explore architectural projects.</p></main>'
    repaired = original.replace('href="#"', 'href="#projects"').replace('</main>', '<section id="projects">Sample projects</section></main>')
    calls = []
    async def llm(settings, messages, **kwargs):
        calls.append(kwargs.get('stage', 'building'))
        if kwargs.get('stage') == 'planning':
            return '{"screens":[{"name":"Studio","purpose":"Browse projects"}]}'
        return '```html\n' + (repaired if kwargs.get('stage') == 'refining' else original) + '\n```'
    async def check(*args):
        return {'status': 'checked', 'issues': [], 'widths': [390], 'buttons_checked': 0}
    monkeypatch.setattr(design, '_llm', llm)
    monkeypatch.setattr(design.design_browser_checks, 'check_document', check)
    events = [event async for event in design.generate_flow(conn, settings(), item, 'Studio portfolio')]
    assert calls == ['planning', 'building', 'refining']
    saved = [event for event in events if event['type'] == 'screen'][-1]
    assert saved['body'] == repaired
    assert not design.inspect_body(saved['body'])['issues']
