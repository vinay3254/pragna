from urllib.parse import urlparse, parse_qs
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.db import init_db, get_connection
from app import repository, oauth_providers
from app.main import create_app


def make_conn(tmp_path):
    db_path = str(tmp_path / "pragna.db")
    init_db(db_path)
    return get_connection(db_path)


def test_get_or_create_oauth_user_creates_new_account(tmp_path):
    conn = make_conn(tmp_path)
    user_id, created = repository.get_or_create_oauth_user(
        conn, "new@example.com", "google", "g-123", "New User", "http://example.com/a.png"
    )

    assert created is True
    user = repository.get_user(conn, user_id)
    assert user["email"] == "new@example.com"
    assert user["oauth_provider"] == "google"
    assert user["oauth_id"] == "g-123"
    assert user["name"] == "New User"
    assert user["avatar_url"] == "http://example.com/a.png"
    assert user["password_hash"] is None


def test_get_or_create_oauth_user_links_existing_account(tmp_path):
    conn = make_conn(tmp_path)
    existing_id = repository.create_user(conn, "shared@example.com", "some-hash")

    user_id, created = repository.get_or_create_oauth_user(
        conn, "shared@example.com", "github", "gh-9", "Shared User", None
    )

    assert created is False
    assert user_id == existing_id
    user = repository.get_user(conn, existing_id)
    assert user["oauth_provider"] == "github"
    assert user["oauth_id"] == "gh-9"
    assert user["name"] == "Shared User"
    assert user["password_hash"] == "some-hash"  # untouched


def test_link_oauth_to_user_preserves_existing_name_when_new_value_is_none(tmp_path):
    conn = make_conn(tmp_path)
    user_id = repository.create_user(conn, "a@example.com", "hash")
    repository.link_oauth_to_user(conn, user_id, "google", "g-1", "First Name", "http://x/a.png")

    repository.link_oauth_to_user(conn, user_id, "google", "g-1", None, None)

    user = repository.get_user(conn, user_id)
    assert user["name"] == "First Name"
    assert user["avatar_url"] == "http://x/a.png"


def test_build_authorize_url_google():
    url = oauth_providers.build_authorize_url(
        "google", "cid", "http://localhost:8000/api/auth/google/callback", "state123"
    )
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=cid" in url
    assert "state=state123" in url
    assert "redirect_uri=" in url


def test_build_authorize_url_github():
    url = oauth_providers.build_authorize_url(
        "github", "cid", "http://localhost:8000/api/auth/github/callback", "state456"
    )
    assert url.startswith("https://github.com/login/oauth/authorize?")
    assert "state=state456" in url


async def test_fetch_profile_google():
    import httpx

    req = httpx.Request("GET", "https://www.googleapis.com/oauth2/v3/userinfo")
    response = httpx.Response(
        200, json={"sub": "g-1", "email": "u@example.com", "name": "U Ser", "picture": "http://x/a.png"}, request=req
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=response)):
        profile = await oauth_providers.fetch_profile("google", "fake-token")

    assert profile == {"id": "g-1", "email": "u@example.com", "name": "U Ser", "avatar_url": "http://x/a.png"}


async def test_fetch_profile_github_uses_public_email():
    import httpx

    req = httpx.Request("GET", "https://api.github.com/user")
    response = httpx.Response(
        200,
        json={"id": 42, "login": "octocat", "name": "The Octocat", "avatar_url": "http://x/a.png", "email": "octo@example.com"},
        request=req
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=response)):
        profile = await oauth_providers.fetch_profile("github", "fake-token")

    assert profile == {
        "id": "42",
        "email": "octo@example.com",
        "name": "The Octocat",
        "avatar_url": "http://x/a.png",
    }


async def test_fetch_profile_github_falls_back_to_emails_endpoint_when_email_private():
    import httpx

    req1 = httpx.Request("GET", "https://api.github.com/user")
    req2 = httpx.Request("GET", "https://api.github.com/user/emails")
    user_response = httpx.Response(
        200, json={"id": 42, "login": "octocat", "name": None, "avatar_url": "http://x/a.png", "email": None}, request=req1
    )
    emails_response = httpx.Response(
        200,
        json=[
            {"email": "secondary@example.com", "primary": False, "verified": True},
            {"email": "private@example.com", "primary": True, "verified": True},
        ],
        request=req2
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[user_response, emails_response])):
        profile = await oauth_providers.fetch_profile("github", "fake-token")

    assert profile == {
        "id": "42",
        "email": "private@example.com",
        "name": "octocat",  # falls back to login when name is absent
        "avatar_url": "http://x/a.png",
    }


async def test_exchange_code_posts_to_token_url_and_returns_access_token():
    import httpx

    req = httpx.Request("POST", "https://oauth2.googleapis.com/token")
    response = httpx.Response(200, json={"access_token": "the-access-token"}, request=req)
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=response)):
        token = await oauth_providers.exchange_code(
            "google", "cid", "csecret", "the-code", "http://localhost:8000/api/auth/google/callback"
        )

    assert token == "the-access-token"


def _extract_state(location: str) -> str:
    return parse_qs(urlparse(location).query)["state"][0]


def test_oauth_login_redirects_to_provider_and_sets_state_cookie(test_settings):
    test_settings.google_client_id = "test-client-id"
    test_settings.google_client_secret = "test-client-secret"
    app = create_app(test_settings)
    with TestClient(app, follow_redirects=False) as client:
        res = client.get("/api/auth/google/login")
        assert res.status_code in (302, 307)
        assert "accounts.google.com" in res.headers["location"]
        assert "oauth_state" in res.cookies


def test_oauth_login_without_credentials_returns_503(test_settings):
    test_settings.google_client_id = None
    test_settings.google_client_secret = None
    app = create_app(test_settings)
    with TestClient(app, follow_redirects=False) as client:
        res = client.get("/api/auth/google/login")
        assert res.status_code == 503


def test_oauth_login_unknown_provider_404(test_settings):
    app = create_app(test_settings)
    with TestClient(app, follow_redirects=False) as client:
        res = client.get("/api/auth/twitter/login")
        assert res.status_code == 404


def test_oauth_callback_creates_new_user_and_redirects_with_token(test_settings):
    test_settings.google_client_id = "test-client-id"
    test_settings.google_client_secret = "test-client-secret"
    app = create_app(test_settings)

    fake_profile = {
        "id": "g-123",
        "email": "newuser@example.com",
        "name": "New User",
        "avatar_url": "http://example.com/a.png",
    }

    with TestClient(app, follow_redirects=False) as client:
        conn = app.state.conn
        login_res = client.get("/api/auth/google/login")
        state = _extract_state(login_res.headers["location"])

        with patch(
            "app.routes.oauth.oauth_providers.exchange_code", new=AsyncMock(return_value="fake-access-token")
        ), patch("app.routes.oauth.oauth_providers.fetch_profile", new=AsyncMock(return_value=fake_profile)):
            callback_res = client.get(f"/api/auth/google/callback?code=abc&state={state}")

        assert callback_res.status_code in (302, 307)
        location = callback_res.headers["location"]
        assert location.startswith("https://frontend-mcce.onrender.com/auth/callback#token=")

        user = repository.get_user_by_email(conn, "newuser@example.com")
        assert user is not None
        assert user["oauth_provider"] == "google"
        assert user["oauth_id"] == "g-123"
        assert user["name"] == "New User"
        assert user["avatar_url"] == "http://example.com/a.png"
        assert user["password_hash"] is None


def test_oauth_callback_links_to_existing_password_account(test_settings):
    from app.auth import hash_password

    test_settings.github_client_id = "test-id"
    test_settings.github_client_secret = "test-secret"
    app = create_app(test_settings)

    fake_profile = {"id": "gh-99", "email": "shared@example.com", "name": "Shared User", "avatar_url": None}

    with TestClient(app, follow_redirects=False) as client:
        conn = app.state.conn
        existing_id = repository.create_user(conn, "shared@example.com", hash_password("password123"))

        login_res = client.get("/api/auth/github/login")
        state = _extract_state(login_res.headers["location"])

        with patch(
            "app.routes.oauth.oauth_providers.exchange_code", new=AsyncMock(return_value="tok")
        ), patch("app.routes.oauth.oauth_providers.fetch_profile", new=AsyncMock(return_value=fake_profile)):
            client.get(f"/api/auth/github/callback?code=abc&state={state}")

        assert repository.count_users(conn) == 1
        user = repository.get_user_by_email(conn, "shared@example.com")
        assert user["id"] == existing_id
        assert user["oauth_provider"] == "github"
        assert user["password_hash"] is not None  # original password untouched


def test_oauth_callback_first_user_backfills_legacy_conversations(test_settings):
    test_settings.google_client_id = "id"
    test_settings.google_client_secret = "secret"
    app = create_app(test_settings)

    fake_profile = {"id": "g-1", "email": "first@example.com", "name": None, "avatar_url": None}

    with TestClient(app, follow_redirects=False) as client:
        conn = app.state.conn
        conn.execute("INSERT INTO conversations (title, created_at) VALUES ('legacy', '2026-01-01')")
        conn.commit()

        login_res = client.get("/api/auth/google/login")
        state = _extract_state(login_res.headers["location"])

        with patch(
            "app.routes.oauth.oauth_providers.exchange_code", new=AsyncMock(return_value="tok")
        ), patch("app.routes.oauth.oauth_providers.fetch_profile", new=AsyncMock(return_value=fake_profile)):
            client.get(f"/api/auth/google/callback?code=abc&state={state}")

        user = repository.get_user_by_email(conn, "first@example.com")
        conversations = repository.list_conversations(conn, user["id"])
        assert any(c["title"] == "legacy" for c in conversations)


def test_oauth_callback_state_mismatch_redirects_with_error(test_settings):
    test_settings.google_client_id = "id"
    test_settings.google_client_secret = "secret"
    app = create_app(test_settings)

    with TestClient(app, follow_redirects=False) as client:
        client.get("/api/auth/google/login")  # sets a real state cookie
        res = client.get("/api/auth/google/callback?code=abc&state=totally-wrong-state")
        assert res.status_code in (302, 307)
        assert "error=" in res.headers["location"]
