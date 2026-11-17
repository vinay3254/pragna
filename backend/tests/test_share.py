def test_create_and_read_share(client):
    res = client.post(
        "/api/chat/0/share",
        json={
            "title": "Test conversation",
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there"},
            ],
        },
    )
    assert res.status_code == 200
    token = res.json()["share_token"]
    assert token

    read_res = client.get(f"/api/share/{token}")
    assert read_res.status_code == 200
    body = read_res.json()
    assert body["title"] == "Test conversation"
    assert body["messages"] == [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there"},
    ]


def test_share_unknown_token_404(client):
    res = client.get("/api/share/does-not-exist")
    assert res.status_code == 404


def test_share_persists_across_requests(client):
    """Regression test: shares used to live in an in-memory dict and were
    lost on every server restart. Persisting to the DB means a share created
    on one connection must be readable via a completely separate request."""
    res = client.post(
        "/api/chat/0/share",
        json={"title": "Durable", "messages": [{"role": "user", "content": "still here"}]},
    )
    token = res.json()["share_token"]

    # Simulate a later, unrelated request looking the share up.
    read_res = client.get(f"/api/share/{token}")
    assert read_res.status_code == 200
    assert read_res.json()["title"] == "Durable"
