from fastapi.testclient import TestClient
from app.main import create_app


def test_auth_path_blocks_after_limit(test_settings):
    with TestClient(create_app(test_settings)) as c:
        for _ in range(10):
            res = c.get("/api/auth/me")
            assert res.status_code == 401

        blocked = c.get("/api/auth/me")
        assert blocked.status_code == 429
        assert "Retry-After" in blocked.headers


def test_default_path_uses_higher_limit(test_settings):
    with TestClient(create_app(test_settings)) as c:
        for _ in range(11):
            res = c.get("/api/profile")
            assert res.status_code == 401


def test_health_check_is_exempt(test_settings):
    with TestClient(create_app(test_settings)) as c:
        for _ in range(15):
            res = c.get("/api/health")
            assert res.status_code == 200


def test_workspace_requests_have_separate_model_budget(client):
    for _ in range(70):
        assert client.get('/api/design/projects').status_code == 200
    for _ in range(20):
        assert client.post('/api/design/screens/999999/assistant', json={'prompt':'Example'}).status_code == 404
    blocked = client.post('/api/design/screens/999999/assistant', json={'prompt':'Example'})
    assert blocked.status_code == 429 and 'Retry-After' in blocked.headers
    assert client.get('/api/design/projects').status_code == 200
    assert client.get('/api/auth/me').status_code == 200
