from datetime import datetime, timedelta, timezone
from app import repository


def test_create_order_requires_auth(client):
    res = client.post("/api/billing/create-order", headers={"Authorization": ""})
    assert res.status_code == 401


def test_create_order_authenticated(client):
    res = client.post("/api/billing/create-order")
    assert res.status_code == 200
    data = res.json()
    assert data["order_id"] > 0
    assert data["amount"] == 29900
    assert data["currency"] == "INR"
    assert data["provider"] == "demo"


def test_confirm_demo_payment_upgrades_user(client):
    # Check initial status is free
    status_res = client.get("/api/billing/status")
    assert status_res.status_code == 200
    assert status_res.json()["plan"] == "free"

    # Create order
    order_res = client.post("/api/billing/create-order")
    assert order_res.status_code == 200
    order_id = order_res.json()["order_id"]

    # Confirm demo payment
    confirm_res = client.post(
        "/api/billing/confirm-demo-payment",
        json={"order_id": order_id},
    )
    assert confirm_res.status_code == 200
    confirm_data = confirm_res.json()
    assert confirm_data["success"] is True
    assert confirm_data["plan"] == "pro"
    assert confirm_data["current_period_end"] is not None

    # Verify billing status is now pro
    status_after = client.get("/api/billing/status")
    assert status_after.status_code == 200
    assert status_after.json()["plan"] == "pro"
    assert status_after.json()["current_period_end"] == confirm_data["current_period_end"]


def test_confirm_demo_payment_wrong_user(client):
    # Register a second user
    reg_res = client.post(
        "/api/auth/register",
        json={"email": "otheruser@example.com", "password": "password123"},
    )
    token2 = reg_res.json()["access_token"]

    # User 1 (initial client token was for test@example.com)
    conn = client.app.state.conn
    user1 = repository.get_user_by_email(conn, "test@example.com")
    order_id = repository.create_subscription_order(conn, user1["id"], "pro", 29900, "demo")

    # User 2 tries to confirm User 1's order
    confirm_res = client.post(
        "/api/billing/confirm-demo-payment",
        json={"order_id": order_id},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert confirm_res.status_code == 404


def test_confirm_demo_payment_already_paid(client):
    order_res = client.post("/api/billing/create-order")
    order_id = order_res.json()["order_id"]

    # First confirm succeeds
    confirm1 = client.post(
        "/api/billing/confirm-demo-payment",
        json={"order_id": order_id},
    )
    assert confirm1.status_code == 200

    # Second confirm fails with 400
    confirm2 = client.post(
        "/api/billing/confirm-demo-payment",
        json={"order_id": order_id},
    )
    assert confirm2.status_code == 400


def test_status_reports_free_once_expired(client):
    # Create and pay order
    order_res = client.post("/api/billing/create-order")
    order_id = order_res.json()["order_id"]
    client.post("/api/billing/confirm-demo-payment", json={"order_id": order_id})

    # Verify user is pro
    assert client.get("/api/billing/status").json()["plan"] == "pro"

    # Simulate past expiry date in database
    conn = client.app.state.conn
    user = repository.get_user_by_email(conn, "test@example.com")
    past_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    conn.execute(
        "UPDATE subscriptions SET current_period_end = ? WHERE user_id = ?",
        (past_date, user["id"]),
    )
    conn.commit()

    # Check status again -> should detect expiration and revert to free
    status_expired = client.get("/api/billing/status").json()
    assert status_expired["plan"] == "free"
    assert status_expired["current_period_end"] is None
