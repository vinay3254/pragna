"""Persisted conversation, direct edits, ownership and handoff exports."""
import io
import json
import zipfile

from app import design_service, repository


def seed_screen(client, body='<main><h1>Original title</h1><p>Some text</p></main>'):
    project_id = client.post('/api/design/projects', json={'device': 'web'}).json()['project']['id']
    conn = client.app.state.conn
    screen_id = repository.create_design_screen(conn, project_id, 'Home', 0)
    version_id = repository.add_screen_version(conn, screen_id, body, 'Initial design')
    return project_id, screen_id, version_id


def test_direct_text_edit_saves_version_and_escapes_markup(client):
    _, screen_id, original_version = seed_screen(client)
    response = client.post(f'/api/design/screens/{screen_id}/text', json={
        'selector': 'body > main:nth-child(1) > h1:nth-child(1)',
        'text': '<script>alert(1)</script> & new title', 'version_id': original_version,
    })
    assert response.status_code == 200
    screen = response.json()
    assert '&lt;script&gt;alert(1)&lt;/script&gt; &amp; new title' in screen['body']
    assert screen['version_id'] != original_version
    assert '<p>Some text</p>' in screen['body']
    assert len(client.get(f'/api/design/screens/{screen_id}/versions').json()) == 2
    restored = client.post(f'/api/design/screens/{screen_id}/restore', json={'version_id': original_version})
    assert restored.status_code == 200 and 'Original title' in restored.json()['body']


def test_direct_text_rejects_stale_versions_and_layout_elements(client):
    _, screen_id, version = seed_screen(client)
    path = f'/api/design/screens/{screen_id}/text'
    assert client.post(path, json={'selector': 'main', 'text': 'destroy layout', 'version_id': version}).status_code == 400
    assert client.post(path, json={'selector': '[', 'text': 'bad selector', 'version_id': version}).status_code == 400
    assert client.post(path, json={'selector': 'h1', 'text': 'stale', 'version_id': version + 1}).status_code == 409
    assert 'Original title' in repository.get_design_screen(client.app.state.conn, 1, screen_id)['body']


def test_workspace_routes_enforce_ownership(client):
    project_id, screen_id, version_id = seed_screen(client)
    other = client.post('/api/auth/register', json={'email': 'workspace-other@example.com', 'password': 'testpassword123'}).json()
    headers = {'Authorization': f"Bearer {other['access_token']}"}
    assert client.post(f'/api/design/screens/{screen_id}/text', headers=headers, json={
        'selector': 'h1', 'text': 'stolen', 'version_id': version_id,
    }).status_code == 404
    assert client.get(f'/api/design/projects/{project_id}/export', headers=headers).status_code == 404
    assert client.get(f'/api/design/projects/{project_id}/preview', headers=headers).status_code == 404


def test_gallery_loads_metadata_then_preview_on_demand(client):
    project_id, _, _ = seed_screen(client)
    metadata = client.get('/api/design/projects?include_previews=false').json()[0]
    assert metadata['has_preview'] and metadata['screen_count'] == 1
    assert 'preview_html' not in metadata
    preview = client.get(f'/api/design/projects/{project_id}/preview').json()['html']
    assert 'Original title' in preview and 'pragna-design' not in preview


def test_zip_exports_built_screens_and_theme_without_editor(client):
    project_id, _, _ = seed_screen(client)
    conn = client.app.state.conn
    second = repository.create_design_screen(conn, project_id, 'Home', 1)
    repository.add_screen_version(conn, second, '<p>Second screen</p>', 'Second')
    repository.create_design_screen(conn, project_id, 'Not built', 2)
    response = client.get(f'/api/design/projects/{project_id}/export')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/zip'
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        assert bundle.namelist() == ['01-Home.html', '02-Home.html', 'theme.json']
        assert 'pragna-design' not in bundle.read('01-Home.html').decode()
        assert 'https://cdn.tailwindcss.com' in bundle.read('01-Home.html').decode()
        assert json.loads(bundle.read('theme.json'))['primary'] == design_service.DEFAULT_THEME['primary']


def test_empty_project_cannot_export(client):
    project_id = client.post('/api/design/projects', json={}).json()['project']['id']
    assert client.get(f'/api/design/projects/{project_id}/export').status_code == 400


def test_generation_and_edits_persist_conversation(client, monkeypatch):
    calls = []
    async def llm(settings, messages, **kwargs):
        calls.append(messages)
        if messages[0]['content'] == design_service._PLAN_SYSTEM:
            return json.dumps({'project_name': 'Example', 'screens': [{'name': 'Home', 'purpose': 'An overview'}]})
        return '```html\n<main><h1>Generated title</h1></main>\n```'

    monkeypatch.setattr(design_service, '_llm', llm)
    project_id = client.post('/api/design/projects', json={}).json()['project']['id']
    response = client.post(f'/api/design/projects/{project_id}/generate', json={'prompt': 'An example dashboard'})
    assert response.status_code == 200
    detail = client.get(f'/api/design/projects/{project_id}').json()
    assert [m['role'] for m in detail['messages']] == ['user', 'assistant']
    assert detail['messages'][0]['content'] == 'An example dashboard'
    assert 'Created 1 screen' in detail['messages'][1]['content']
    screen_id = detail['screens'][0]['id']
    assert client.post(f'/api/design/screens/{screen_id}/edit', json={'instruction': 'Use a larger title'}).status_code == 200
    reloaded = client.get(f'/api/design/projects/{project_id}').json()
    assert [m['role'] for m in reloaded['messages']] == ['user', 'assistant', 'user', 'assistant']
    assert 'Use a larger title' in reloaded['messages'][2]['content']
    assert 'An example dashboard' in calls[-1][-1]['content']
    assert client.get('/api/design/projects').json()[0]['screen_count'] == 1
    assert client.delete(f'/api/design/projects/{project_id}').status_code == 200
    assert repository.list_design_messages(client.app.state.conn, project_id) == []


def test_zip_links_project_screens_and_keeps_local_prototype_code(client):
    project_id, _, _ = seed_screen(client, '<main><a href="Projects">View projects</a><button id="toggle">Toggle</button></main><script>document.getElementById("toggle").onclick=function(){this.textContent="Done";}</script>')
    screen_id = repository.create_design_screen(client.app.state.conn, project_id, 'Projects', 1)
    repository.add_screen_version(client.app.state.conn, screen_id, '<h1>Projects</h1>', 'Projects')
    response = client.get(f'/api/design/projects/{project_id}/export')
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        html = bundle.read('01-Home.html').decode()
        assert 'href="02-Projects.html"' in html
        assert 'this.textContent="Done"' in html
        assert 'pragna-design' not in html
