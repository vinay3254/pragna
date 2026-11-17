import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app import repository, email_service


@pytest.fixture
def email_auth_settings(tmp_path):
    return Settings(
        _env_file=None,
        db_path=str(tmp_path / "pragna_email_auth.db"),
        chroma_path=str(tmp_path / "chroma"),
        documents_dir=str(tmp_path / "documents"),
        jwt_secret="test-secret-not-for-production",
        email_auth_enabled=True,
        emailjs_service_id="service_test123",
        emailjs_template_id_otp="template_otp123",
        emailjs_template_id_reset="template_reset123",
        emailjs_public_key="public_key_test",
        emailjs_private_key="private_key_test",
        email_cooldown_seconds=60,
        otp_ttl_minutes=10,
        otp_max_attempts=5,
        reset_token_ttl_minutes=30,
    )


@pytest.fixture
def mock_emails(monkeypatch):
    sent = []

    async def _mock_send_email(settings, template_id, to_email, params):
        sent.append({
            "template_id": template_id,
            "to_email": to_email,
            "params": params,
        })

    monkeypatch.setattr(email_service, "send_email", _mock_send_email)
    return sent


def test_four_routes_return_404_when_email_auth_disabled(test_settings):
    # test_settings has email_auth_enabled=False by default
    app = create_app(test_settings)
    with TestClient(app) as client:
        r1 = client.post("/api/auth/register/request-otp", json={"email": "user@example.com"})
        assert r1.status_code == 404
        assert r1.json()["detail"] == "Email auth is disabled"

        r2 = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "user@example.com", "code": "123456", "password": "password123"},
        )
        assert r2.status_code == 404
        assert r2.json()["detail"] == "Email auth is disabled"

        r3 = client.post("/api/auth/forgot-password", json={"email": "user@example.com"})
        assert r3.status_code == 404
        assert r3.json()["detail"] == "Email auth is disabled"

        r4 = client.post("/api/auth/reset-password", json={"token": "some-token", "new_password": "password123"})
        assert r4.status_code == 404
        assert r4.json()["detail"] == "Email auth is disabled"


def test_register_returns_403_when_email_auth_enabled(email_auth_settings):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        res = client.post("/api/auth/register", json={"email": "new@example.com", "password": "password123"})
        assert res.status_code == 403
        assert res.json()["detail"] == "Email verification required"


def test_missing_emailjs_config_returns_503(tmp_path):
    settings = Settings(
        _env_file=None,
        db_path=str(tmp_path / "pragna_unconfigured.db"),
        chroma_path=str(tmp_path / "chroma"),
        documents_dir=str(tmp_path / "documents"),
        jwt_secret="test-secret",
        email_auth_enabled=True,
        # Missing EmailJS credentials
        emailjs_service_id=None,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        res = client.post("/api/auth/register/request-otp", json={"email": "user@example.com"})
        assert res.status_code == 503
        assert res.json()["detail"] == "Email service not configured"


def test_registration_via_otp_happy_path(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        # 1. Request OTP
        req_res = client.post(
            "/api/auth/register/request-otp",
            json={"email": "newuser@example.com", "name": "New User"},
        )
        assert req_res.status_code == 200
        req_body = req_res.json()
        assert req_body["success"] is True
        assert len(mock_emails) == 1
        otp_sent = mock_emails[0]["params"]["otp_code"]
        assert len(otp_sent) == 6

        # 2. Verify OTP and create user
        verify_res = client.post(
            "/api/auth/register/verify-otp",
            json={
                "email": "newuser@example.com",
                "code": otp_sent,
                "password": "SecurePassword123!",
                "name": "New User",
            },
        )
        assert verify_res.status_code == 200
        verify_body = verify_res.json()
        assert verify_body["success"] is True
        assert verify_body["email"] == "newuser@example.com"
        assert verify_body["access_token"]
        assert verify_body["user"]["name"] == "New User"

        # 3. Access authenticated endpoint
        token = verify_body["access_token"]
        me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        assert me_res.json()["email"] == "newuser@example.com"


def test_request_otp_duplicate_email_409(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        # Create user first via verify-otp
        client.post("/api/auth/register/request-otp", json={"email": "existing@example.com"})
        code = mock_emails[0]["params"]["otp_code"]
        client.post(
            "/api/auth/register/verify-otp",
            json={"email": "existing@example.com", "code": code, "password": "password123"},
        )

        # Request OTP again with same email
        res = client.post("/api/auth/register/request-otp", json={"email": "existing@example.com"})
        assert res.status_code == 409
        assert res.json()["detail"] == "Email already registered"


def test_verify_otp_duplicate_email_409_and_no_token(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        # Register user
        client.post("/api/auth/register/request-otp", json={"email": "user1@example.com"})
        code1 = mock_emails[0]["params"]["otp_code"]
        client.post(
            "/api/auth/register/verify-otp",
            json={"email": "user1@example.com", "code": code1, "password": "password123"},
        )

        # Try to verify-otp again for existing email
        res = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "user1@example.com", "code": "123456", "password": "password123"},
        )
        assert res.status_code == 409
        assert res.json()["detail"] == "Email already registered"


def test_verify_otp_wrong_code(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        client.post("/api/auth/register/request-otp", json={"email": "wrongcode@example.com"})
        res = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "wrongcode@example.com", "code": "000000", "password": "password123"},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Invalid or expired code"


def test_verify_otp_lockout_after_max_attempts(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        client.post("/api/auth/register/request-otp", json={"email": "lockout@example.com"})
        actual_code = mock_emails[0]["params"]["otp_code"]

        # Send wrong codes 4 times (returns 400)
        for _ in range(4):
            res = client.post(
                "/api/auth/register/verify-otp",
                json={"email": "lockout@example.com", "code": "999999", "password": "password123"},
            )
            assert res.status_code == 400

        # 5th attempt is locked out (returns 429)
        res5 = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "lockout@example.com", "code": "999999", "password": "password123"},
        )
        assert res5.status_code == 429
        assert "Too many failed attempts" in res5.json()["detail"]

        # Even correct code is locked out now
        res_correct = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "lockout@example.com", "code": actual_code, "password": "password123"},
        )
        assert res_correct.status_code == 429


def test_verify_otp_code_reuse_fails(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        client.post("/api/auth/register/request-otp", json={"email": "reuse@example.com"})
        code = mock_emails[0]["params"]["otp_code"]

        # First verification succeeds
        res1 = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "reuse@example.com", "code": code, "password": "password123"},
        )
        assert res1.status_code == 200

        # Attempt to reuse code fails with 409 (since user already exists)
        res2 = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "reuse@example.com", "code": code, "password": "password123"},
        )
        assert res2.status_code == 409


def test_verify_otp_expired_code(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        client.post("/api/auth/register/request-otp", json={"email": "expired@example.com"})
        code = mock_emails[0]["params"]["otp_code"]

        # Manually expire the OTP in database
        conn = app.state.conn
        past = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        conn.execute("UPDATE email_otps SET expires_at = ? WHERE email = ?", (past, "expired@example.com"))
        conn.commit()

        res = client.post(
            "/api/auth/register/verify-otp",
            json={"email": "expired@example.com", "code": code, "password": "password123"},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Invalid or expired code"


def test_request_otp_cooldown(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        res1 = client.post("/api/auth/register/request-otp", json={"email": "cooldown@example.com"})
        assert res1.status_code == 200

        # Immediately requesting again triggers cooldown 429
        res2 = client.post("/api/auth/register/request-otp", json={"email": "cooldown@example.com"})
        assert res2.status_code == 429
        assert "Please wait" in res2.json()["detail"]
        assert "Retry-After" in res2.headers


def test_request_otp_hourly_limit(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        conn = app.state.conn
        # Insert 5 previous OTPs within the last hour
        for i in range(5):
            conn.execute(
                "INSERT INTO email_otps (email, code_hash, expires_at, attempts, created_at, consumed_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "hourly@example.com",
                    f"hash_{i}",
                    (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
                    0,
                    (datetime.now(timezone.utc) - timedelta(minutes=5 * i + 2)).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        conn.commit()

        res = client.post("/api/auth/register/request-otp", json={"email": "hourly@example.com"})
        assert res.status_code == 429
        assert "Too many code requests" in res.json()["detail"]


def test_forgot_password_generic_response_for_known_and_unknown_emails(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        # 1. Register a user
        client.post("/api/auth/register/request-otp", json={"email": "known@example.com"})
        code = mock_emails[0]["params"]["otp_code"]
        client.post(
            "/api/auth/register/verify-otp",
            json={"email": "known@example.com", "code": code, "password": "password123"},
        )

        # 2. Forgot password for known email
        r_known = client.post("/api/auth/forgot-password", json={"email": "known@example.com"})
        assert r_known.status_code == 200
        assert r_known.json()["success"] is True

        # 3. Forgot password for unknown email
        r_unknown = client.post("/api/auth/forgot-password", json={"email": "unknown@example.com"})
        assert r_unknown.status_code == 200
        assert r_unknown.json()["success"] is True

        # Responses must be identical
        assert r_known.json() == r_unknown.json()


def test_reset_password_flow_and_old_password_invalidation(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        # Register user
        client.post("/api/auth/register/request-otp", json={"email": "resetme@example.com"})
        code = mock_emails[0]["params"]["otp_code"]
        client.post(
            "/api/auth/register/verify-otp",
            json={"email": "resetme@example.com", "code": code, "password": "OldPassword123!"},
        )

        # Request password reset
        mock_emails.clear()
        res_forgot = client.post("/api/auth/forgot-password", json={"email": "resetme@example.com"})
        assert res_forgot.status_code == 200

        # Check that reset email was queued/sent
        assert len(mock_emails) == 1
        reset_link = mock_emails[0]["params"]["reset_link"]
        token = reset_link.split("token=")[-1]
        assert token

        # Reset password with valid token
        res_reset = client.post(
            "/api/auth/reset-password",
            json={"token": token, "new_password": "NewPassword123!"},
        )
        assert res_reset.status_code == 200
        assert res_reset.json()["success"] is True

        # Old password should no longer work
        login_old = client.post("/api/auth/login", json={"email": "resetme@example.com", "password": "OldPassword123!"})
        assert login_old.status_code == 401

        # New password should work
        login_new = client.post("/api/auth/login", json={"email": "resetme@example.com", "password": "NewPassword123!"})
        assert login_new.status_code == 200
        assert login_new.json()["user"]["email"] == "resetme@example.com"

        # Reusing the same reset token should fail
        res_reuse = client.post(
            "/api/auth/reset-password",
            json={"token": token, "new_password": "AnotherPassword123!"},
        )
        assert res_reuse.status_code == 400


def test_reset_password_expired_token(email_auth_settings, mock_emails):
    app = create_app(email_auth_settings)
    with TestClient(app) as client:
        client.post("/api/auth/register/request-otp", json={"email": "expreset@example.com"})
        code = mock_emails[0]["params"]["otp_code"]
        client.post(
            "/api/auth/register/verify-otp",
            json={"email": "expreset@example.com", "code": code, "password": "password123"},
        )

        mock_emails.clear()
        client.post("/api/auth/forgot-password", json={"email": "expreset@example.com"})
        token = mock_emails[0]["params"]["reset_link"].split("token=")[-1]

        # Expire token in database
        conn = app.state.conn
        past = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
        conn.execute("UPDATE password_resets SET expires_at = ?", (past,))
        conn.commit()

        res = client.post(
            "/api/auth/reset-password",
            json={"token": token, "new_password": "NewPassword123!"},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Invalid or expired reset link"


def test_emailjs_payload_aliases_and_logging_security(email_auth_settings, monkeypatch, caplog):
    import logging
    import httpx

    captured_payloads = []

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        async def post(self, url, json=None, **kwargs):
            captured_payloads.append({"url": url, "json": json})
            return httpx.Response(200, json={"status": "OK"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    app = create_app(email_auth_settings)
    with caplog.at_level(logging.DEBUG):
        with TestClient(app) as client:
            res = client.post(
                "/api/auth/register/request-otp",
                json={"email": "tester@example.com"},
            )
            assert res.status_code == 200
            assert res.json()["success"] is True

    # Assert HTTP call was made
    assert len(captured_payloads) == 1
    call = captured_payloads[0]
    assert call["url"] == email_service.EMAILJS_API_URL
    payload = call["json"]

    # Check top-level payload structure
    assert payload["service_id"] == email_auth_settings.emailjs_service_id
    assert payload["template_id"] == email_auth_settings.emailjs_template_id_otp
    assert payload["user_id"] == email_auth_settings.emailjs_public_key
    assert payload["accessToken"] == email_auth_settings.emailjs_private_key

    # Check template_params contains all aliases
    tp = payload["template_params"]

    # Code aliases
    code = tp["code"]
    assert isinstance(code, str) and len(code) == 6 and code.isdigit()
    for code_key in ["otp_code", "otp", "code", "passcode", "access_code", "verification_code"]:
        assert code_key in tp, f"Missing code alias: {code_key}"
        assert tp[code_key] == code

    # Expiry aliases
    for exp_key in ["expires_in_minutes", "expires_in", "expiry", "expiry_minutes", "expires_minutes"]:
        assert exp_key in tp, f"Missing expiry alias: {exp_key}"
        assert tp[exp_key] == 10  # number only

    # Recipient aliases
    for rec_key in ["to_email", "email", "user_email"]:
        assert rec_key in tp, f"Missing recipient alias: {rec_key}"
        assert tp[rec_key] == "tester@example.com"

    # App alias
    assert tp["app_name"] == "Pragna-1 A"

    # Security check on logs
    log_text = caplog.text
    # 1. Parameter key names should be in the debug log
    assert "EmailJS sending template_params keys:" in log_text
    assert "access_code" in log_text
    assert "verification_code" in log_text

    # 2. Secret EmailJS keys and code value must NEVER be logged
    assert email_auth_settings.emailjs_private_key not in log_text
    assert email_auth_settings.emailjs_public_key not in log_text
    assert email_auth_settings.jwt_secret not in log_text
    assert code not in log_text


def test_password_reset_emailjs_payload_aliases(email_auth_settings, monkeypatch, caplog):
    import logging
    import httpx

    captured_payloads = []

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        async def post(self, url, json=None, **kwargs):
            captured_payloads.append({"url": url, "json": json})
            return httpx.Response(200, json={"status": "OK"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)

    app = create_app(email_auth_settings)
    with caplog.at_level(logging.DEBUG):
        with TestClient(app) as client:
            conn = app.state.conn
            repository.create_user(conn, "forgot@example.com", "dummyhash", name="Forgot User")
            res = client.post("/api/auth/forgot-password", json={"email": "forgot@example.com"})
            assert res.status_code == 200

    assert len(captured_payloads) == 1
    payload = captured_payloads[0]["json"]
    tp = payload["template_params"]

    # Reset link aliases
    reset_link = tp["reset_link"]
    assert "token=" in reset_link
    for link_key in ["reset_link", "link", "reset_url", "url"]:
        assert link_key in tp, f"Missing link alias: {link_key}"
        assert tp[link_key] == reset_link

    # Expiry aliases
    for exp_key in ["expires_in_minutes", "expires_in", "expiry", "expiry_minutes", "expires_minutes"]:
        assert exp_key in tp, f"Missing expiry alias: {exp_key}"
        assert tp[exp_key] == 30

    # Recipient aliases
    for rec_key in ["to_email", "email", "user_email"]:
        assert rec_key in tp, f"Missing recipient alias: {rec_key}"
        assert tp[rec_key] == "forgot@example.com"

    assert tp["app_name"] == "Pragna-1 A"

    # Security check on logs
    log_text = caplog.text
    assert email_auth_settings.emailjs_private_key not in log_text
    assert email_auth_settings.emailjs_public_key not in log_text
    assert email_auth_settings.jwt_secret not in log_text
