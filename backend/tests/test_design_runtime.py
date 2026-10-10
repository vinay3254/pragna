"""Exercise real prototype behavior, exports and checks without model/provider calls."""
import html
import json
from pathlib import Path

import pytest
from playwright.async_api import async_playwright

from app import design_browser_checks, design_service
from app.design_quality import contrast_ratio, inspect_body

BODY = '''
<main class="mx-auto max-w-5xl p-6 space-y-6">
  <h1 class="text-3xl font-bold">Fieldnotes workspace</h1>
  <div data-design-tabs>
    <nav role="tablist" aria-label="Workspace views" class="flex gap-4">
      <button type="button" role="tab" aria-selected="true" aria-controls="overview" data-design-action="tab" data-design-target="#overview">Overview</button>
      <button type="button" role="tab" aria-selected="false" aria-controls="projects" data-design-action="tab" data-design-target="#projects">Projects</button>
    </nav>
    <section id="overview" data-design-panel role="tabpanel"><h2>Overview content</h2></section>
    <section id="projects" data-design-panel role="tabpanel" hidden><h2>Projects content</h2></section>
  </div>
  <button type="button" data-design-action="toggle" data-design-target="#menu" aria-expanded="false">Show menu</button>
  <div id="menu" hidden>Workspace settings</div>
  <button type="button" data-design-action="open-dialog" data-design-target="#details">Open details</button>
  <dialog id="details" aria-label="Project details"><p>Launch campaign</p><button type="button" data-design-action="close-dialog">Close details</button></dialog>
  <label>Search projects <input type="search" data-design-filter="#catalog"></label>
  <div data-design-filters>
    <button type="button" aria-pressed="true" data-design-action="filter" data-design-target="#catalog" data-design-value="all">All</button>
    <button type="button" aria-pressed="false" data-design-action="filter" data-design-target="#catalog" data-design-value="active">Active</button>
  </div>
  <div id="catalog">
    <article data-design-item data-design-category="active">Launch campaign</article>
    <article data-design-item data-design-category="done">Brand research</article>
    <p data-design-empty hidden>No projects found</p>
  </div>
  <form data-design-submit="#saved" data-design-success="Saved in this demo.">
    <label>Project name <input name="name" required></label>
    <button type="submit">Save project</button>
    <p id="saved" hidden></p>
  </form>
  <label>Budget <input type="range" min="0" max="100" data-design-output="#budget"></label><output id="budget">50</output>
  <button type="button" data-design-action="toast" data-design-message="Demo export ready">Export demo</button>
</main>'''


@pytest.fixture
async def browser():
    async with async_playwright() as playwright:
        try:
            instance = await playwright.chromium.launch()
        except Exception as exc:
            pytest.skip(f'Chromium is not installed: {exc}')
        try:
            yield instance
        finally:
            await instance.close()


async def preview_frame(browser, body=BODY, interactive=False, standalone=False):
    context = await browser.new_context()
    document = design_service.render_document(body, design_service.DEFAULT_THEME, 7, interactive, standalone)
    tailwind = Path(__file__).resolve().parents[2] / 'frontend/public/vendor/tailwindcss-play-3.4.17.js'
    shell = '<style>body{margin:0}</style><iframe sandbox="allow-scripts allow-forms" style="width:100%;height:900px" srcdoc="' + html.escape(document, quote=True) + '"></iframe>'
    async def route(request):
        if request.request.url == 'https://design-preview.invalid/':
            await request.fulfill(content_type='text/html', body=shell)
        elif '/vendor/' in request.request.url or request.request.url == 'https://cdn.tailwindcss.com/':
            await request.fulfill(content_type='application/javascript', path=str(tailwind))
        else:
            await request.abort()
    await context.route('**/*', route)
    page = await context.new_page()
    await page.goto('https://design-preview.invalid/', wait_until='load')
    frame = next(frame for frame in page.frames if frame != page.main_frame)
    await frame.wait_for_timeout(100)
    return page, frame


@pytest.mark.parametrize('standalone', [False, True])
async def test_local_controls_work_in_sandbox_and_export(browser, standalone):
    page, frame = await preview_frame(browser, standalone=standalone)
    await frame.get_by_role('tab', name='Projects').click()
    assert await frame.locator('#projects').is_visible()
    assert not await frame.locator('#overview').is_visible()
    await frame.get_by_role('tab', name='Projects').press('ArrowLeft')
    assert await frame.locator('#overview').is_visible()
    assert await frame.get_by_role('tab', name='Overview').get_attribute('aria-selected') == 'true'
    await frame.get_by_role('button', name='Show menu').click()
    assert await frame.locator('#menu').is_visible()
    assert await frame.get_by_role('button', name='Show menu').get_attribute('aria-expanded') == 'true'
    await frame.get_by_role('button', name='Open details').click()
    assert await frame.locator('#details').is_visible()
    await frame.get_by_role('button', name='Close details').click()
    assert not await frame.locator('#details').is_visible()
    assert await frame.get_by_role('button', name='Open details').evaluate('(button) => button === document.activeElement')
    await frame.get_by_label('Search projects').fill('Launch')
    assert await frame.locator('#catalog').get_by_text('Launch campaign', exact=True).is_visible()
    assert not await frame.get_by_text('Brand research', exact=True).is_visible()
    await frame.get_by_label('Search projects').fill('nothing matches')
    assert await frame.get_by_text('No projects found').is_visible()
    await frame.get_by_role('button', name='Active', exact=True).click()
    assert await frame.get_by_text('No projects found').is_visible()
    await frame.get_by_label('Search projects').fill('')
    assert await frame.locator('#catalog').get_by_text('Launch campaign', exact=True).is_visible()
    assert not await frame.get_by_text('No projects found').is_visible()
    await frame.get_by_role('button', name='Save project').click()
    assert not await frame.locator('#saved').is_visible()
    await frame.get_by_label('Project name').fill('New project')
    await frame.get_by_role('button', name='Save project').click()
    assert await frame.locator('#saved').inner_text() == 'Saved in this demo.'
    await frame.get_by_role('button', name='Export demo').click()
    assert await frame.get_by_role('status').filter(has_text='Demo export ready').is_visible()
    await frame.get_by_label('Budget').evaluate('(input) => { input.value="75"; input.dispatchEvent(new Event("input", {bubbles:true})); }')
    assert await frame.locator('#budget').inner_text() == '75'
    await page.context.close()


async def test_editor_blocks_actions_until_preview_and_reports_runtime_errors(browser):
    page, frame = await preview_frame(browser, BODY + '<script>throw new Error("Broken chart")</script>', interactive=True)
    # Reload with a listener installed in the parent before the iframe scripts run.
    await page.add_init_script('window.demoEvents=[]; window.addEventListener("message",e=>window.demoEvents.push(e.data));')
    await page.reload(wait_until='load')
    frame = next(frame for frame in page.frames if frame != page.main_frame)
    await frame.get_by_role('button', name='Show menu').click()
    assert not await frame.locator('#menu').is_visible()
    await page.wait_for_function('window.demoEvents.some(event => event.type === "select")')
    messages = await page.evaluate('window.demoEvents')
    assert any(event.get('type') == 'select' for event in messages)
    assert any(event.get('type') == 'runtime-error' and 'Broken chart' in event.get('error', '') for event in messages)
    await page.evaluate('document.querySelector("iframe").contentWindow.postMessage({type:"mode",mode:"preview"},"*")')
    await frame.get_by_role('button', name='Show menu').click()
    assert await frame.locator('#menu').is_visible()
    await page.context.close()


def test_source_checks_detect_broken_controls_and_labels():
    report = inspect_body('<button data-design-action="tab" data-design-target="#missing"></button><input><a href="#unknown">Details</a>')
    assert {'missing_target', 'unnamed_control', 'unlabeled_field', 'broken_anchor'} <= {issue['code'] for issue in report['issues']}
    assert not inspect_body(BODY, design_service.DEFAULT_THEME)['issues']


def test_planned_theme_repairs_contrast_without_changing_brand_accent():
    theme = design_service._planned_theme({'primary': '#eeeeee', 'on_primary': '#ffffff', 'foreground': '#dddddd', 'muted': '#cccccc'})
    assert theme['primary'] == '#eeeeee'
    for text, backgrounds in [('foreground', ['surface', 'background']), ('muted', ['surface', 'background']), ('on_primary', ['primary'])]:
        assert all(contrast_ratio(theme[text], theme[background]) >= 4.5 for background in backgrounds)


async def test_browser_checks_find_script_errors_overflow_and_inert_controls(browser):
    body = '<main class="w-[1500px]"><button type="button">Dead control</button></main><script>throw new Error("Chart failed")</script>'
    document = design_service.render_document(body, design_service.DEFAULT_THEME, 0, False)
    report = await design_browser_checks.check_document(document, 'web')
    assert report['status'] == 'checked' and report['widths'] == [390, 768, 1280]
    assert {'script_error', 'overflow', 'inert_button'} <= {issue['code'] for issue in report['issues']}
    assert any('Chart failed' in issue['message'] for issue in report['issues'])
    assert not any('serviceWorker' in issue['message'] for issue in report['issues'])


async def test_browser_checks_do_not_report_active_tabs_or_working_buttons(browser):
    document = design_service.render_document(BODY, design_service.DEFAULT_THEME, 0, False)
    report = await design_browser_checks.check_document(document, 'web')
    assert report['status'] == 'checked' and not report['issues']
    assert report['buttons_checked'] > 0


async def test_full_planner_spec_reaches_builder_and_invalid_lists_fall_back(monkeypatch):
    seen = []
    async def llm(settings, messages, **kwargs):
        seen.append(messages[-1]['content'])
        if messages[0]['content'] == design_service._PLAN_SYSTEM:
            return json.dumps({'screens': [{'name': 'Studio', 'purpose': 'Project management'}],
                'design_brief': {'goal': 'Track active projects', 'interactions': [{'trigger': 'Search projects', 'result': 'Filter matching projects'}]}})
        return '```html\n' + BODY + '\n```'
    monkeypatch.setattr(design_service, '_llm', llm)
    plan = await design_service.plan_flow(None, 'Project workspace', 'web', 1, [])
    await design_service.generate_screen_body(None, 'Project workspace', 'web', plan['screens'][0], plan['screens'],
        design_brief=plan['design_brief'], theme=design_service.DEFAULT_THEME)
    assert 'Filter matching projects' in seen[-1] and 'Actual project theme tokens' in seen[-1]
    async def malformed(settings, messages, **kwargs):
        return '{"screens": null, "photo_terms": 42}'
    monkeypatch.setattr(design_service, '_llm', malformed)
    fallback = await design_service.plan_flow(None, 'Small website', 'web', 1, [])
    assert fallback['screens'][0]['name'] == 'Small website'


async def test_refine_rejects_a_repair_that_removes_behavior(monkeypatch):
    original = '<main><button id="save">Save</button></main><script>document.getElementById("save").onclick=function(){this.textContent="Saved"}</script>'
    async def llm(settings, messages, **kwargs):
        return 'Audit: 5/10\n```html\n<main class="p-8"><h1>Workspace overview</h1><button id="save">Save</button><p>Manage your project settings here.</p></main>\n```'
    monkeypatch.setattr(design_service, '_llm', llm)
    assert await design_service.refine_screen_body(None, original, {'name': 'Workspace', 'purpose': 'Save settings'}, '') == original


def test_sse_heartbeats_keep_slow_generation_alive(client, monkeypatch):
    import asyncio
    from app.routes import design as routes
    original_wait = asyncio.wait
    async def short_wait(tasks, *, timeout):
        return await original_wait(tasks, timeout=min(timeout, .01))
    async def slow_flow(*args, **kwargs):
        await asyncio.sleep(.04)
        yield {'type': 'done'}
    monkeypatch.setattr(routes.asyncio, 'wait', short_wait)
    monkeypatch.setattr(design_service, 'generate_flow', slow_flow)
    project_id = client.post('/api/design/projects', json={}).json()['project']['id']
    response = client.post(f'/api/design/projects/{project_id}/generate', json={'prompt': 'A workspace'})
    assert response.status_code == 200 and ': keep-alive\n\n' in response.text
    assert response.text.count('"type": "done"') == 1
