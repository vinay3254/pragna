import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings


@pytest.fixture
def test_settings(tmp_path):
    return Settings(
        _env_file=None,
        email_auth_enabled=False,
        db_path=str(tmp_path / "pragna.db"),
        chroma_path=str(tmp_path / "chroma"),
        documents_dir=str(tmp_path / "documents"),
        jwt_secret="test-secret-not-for-production",
        frontend_public_url="",
    )


@pytest.fixture
def client(test_settings):
    app = create_app(test_settings)
    with TestClient(app) as c:
        register_res = c.post(
            "/api/auth/register",
            json={"email": "test@example.com", "password": "testpassword123"},
        )
        token = register_res.json()["access_token"]
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c
