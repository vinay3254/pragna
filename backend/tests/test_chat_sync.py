def chat(chat_id, updated_at, text="hi", revision=0):
    return {
        "id": chat_id,
        "title": "t",
        "model": "m",
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": updated_at,
        "historyRevision": revision,
        "messages": [{"id": f"{chat_id}-1", "role": "user", "content": text, "timestamp": updated_at}],
    }


def sync(client, chats=(), deleted=(), since=None):
    res = client.post("/api/chat/sync", json={"chats": list(chats), "deleted_ids": list(deleted), "since": since})
    assert res.status_code == 200, res.text
    return res.json()


def test_new_device_receives_uploaded_chats(client):
    first = sync(client, [chat("a", "2026-01-02T00:00:00Z", "from laptop 1")])
    assert first["chats"] == []  # own upload is not echoed back

    other_device = sync(client)
    assert [c["id"] for c in other_device["chats"]] == ["a"]
    assert other_device["chats"][0]["messages"][0]["content"] == "from laptop 1"


def test_cursor_returns_only_new_changes(client):
    sync(client, [chat("a", "2026-01-02T00:00:00Z")])
    cursor = sync(client)["cursor"]
    sync(client, [chat("b", "2026-01-03T00:00:00Z")])
    later = sync(client, since=cursor)
    assert [c["id"] for c in later["chats"]] == ["b"]


def test_older_upload_does_not_overwrite_newer(client):
    sync(client, [chat("a", "2026-01-05T00:00:00Z", "new")])
    stale = sync(client, [chat("a", "2026-01-02T00:00:00Z", "old")])
    assert stale["chats"][0]["messages"][0]["content"] == "new"


def test_higher_history_revision_wins(client):
    sync(client, [chat("a", "2026-01-05T00:00:00Z", "before edit")])
    sync(client, [chat("a", "2026-01-04T00:00:00Z", "after edit", revision=1)])
    assert sync(client)["chats"][0]["messages"][0]["content"] == "after edit"


def test_deletion_propagates_and_is_permanent(client):
    sync(client, [chat("a", "2026-01-02T00:00:00Z")])
    cursor = sync(client)["cursor"]
    sync(client, deleted=["a"])
    assert sync(client, since=cursor)["deleted_ids"] == ["a"]

    resurrect = sync(client, [chat("a", "2026-02-01T00:00:00Z")])
    assert resurrect["deleted_ids"] == ["a"]
    assert sync(client)["chats"] == []


def test_chats_are_private_per_user(client, test_settings):
    sync(client, [chat("a", "2026-01-02T00:00:00Z")])
    res = client.post("/api/auth/register", json={"email": "other@example.com", "password": "otherpassword123"})
    other = {"Authorization": f"Bearer {res.json()['access_token']}"}
    seen = client.post("/api/chat/sync", json={}, headers=other)
    assert seen.status_code == 200
    assert seen.json()["chats"] == []


def test_sync_requires_login(client):
    res = client.post("/api/chat/sync", json={}, headers={"Authorization": ""})
    assert res.status_code == 401
