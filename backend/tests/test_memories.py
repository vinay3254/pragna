from unittest.mock import AsyncMock, patch
import json
from app.memory_service import prepare_memories, retrieve_memories, save_fact
from app.db import init_db, get_connection
from app import repository
from app.memory_service import extract_and_save_memory, delete_memory_record


def make_conn(tmp_path):
    db_path = str(tmp_path / "pragna.db")
    init_db(db_path)
    conn = get_connection(db_path)
    repository.create_user(conn, "test@example.com", "hash")
    return conn


class FakeSettings:
    chat_model = "fake"
    embed_model = "nomic-embed-text"
    ollama_url = "http://fake"


async def test_extract_and_save_memory(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Mem Test", 1)

    async def fake_stream(messages, model, ollama_url, **kwargs):
        yield '[{"key":"work.role","content":"User works as a software engineer."}]'

    with patch("app.memory_service.chat_stream", new=fake_stream):
        mem_id = await extract_and_save_memory(
            conn, None, FakeSettings(), cid, "I work as a software engineer.", "That sounds interesting.", user_id=1
        )

    assert mem_id is not None
    mems = repository.list_memories(conn, 1)
    assert len(mems) == 1
    assert mems[0]["content"] == "User works as a software engineer."


async def test_extract_none_saved(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Mem Test 2", 1)

    async def fake_stream_none(messages, model, ollama_url, **kwargs):
        yield "[]"

    with patch("app.memory_service.chat_stream", new=fake_stream_none):
        mem_id = await extract_and_save_memory(
            conn, None, FakeSettings(), cid, "Hi", "Hello", user_id=1
        )

    assert mem_id is None
    assert len(repository.list_memories(conn, 1)) == 0


def test_memories_api(client):
    conn = client.app.state.conn
    user_id = repository.get_user_by_email(conn, "test@example.com")["id"]
    mid = repository.create_memory(conn, "User likes pizza.", user_id=user_id)

    res = client.get("/api/memories")
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["content"] == "User likes pizza."

    del_res = client.delete(f"/api/memories/{mid}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    res_after = client.get("/api/memories")
    assert len(res_after.json()) == 0

    del_404 = client.delete("/api/memories/9999")
    assert del_404.status_code == 404



def _second_user_headers(client):
    res = client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "password": "otherpassword123"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_memories_are_private_to_each_user(client):
    other = _second_user_headers(client)

    client.post("/api/memories", json={"content": "User's nickname is Sigma."})
    assert [m["content"] for m in client.get("/api/memories").json()] == ["User's nickname is Sigma."]

    # A second account must not see the first account's memories.
    assert client.get("/api/memories", headers=other).json() == []

    # The same fact can exist independently for each user.
    other_post = client.post("/api/memories", json={"content": "User's nickname is Sigma."}, headers=other)
    assert other_post.json()["success"] is True
    assert len(client.get("/api/memories", headers=other).json()) == 1
    assert len(client.get("/api/memories").json()) == 1


def test_cannot_delete_another_users_memory(client):
    other = _second_user_headers(client)
    mid = client.post("/api/memories", json={"content": "User likes tea."}).json()["id"]

    assert client.delete(f"/api/memories/{mid}", headers=other).status_code == 404
    assert len(client.get("/api/memories").json()) == 1
    assert client.delete(f"/api/memories/{mid}").status_code == 200


def test_clear_all_only_clears_own_memories(client):
    other = _second_user_headers(client)
    client.post("/api/memories", json={"content": "Mine."})
    client.post("/api/memories", json={"content": "Theirs."}, headers=other)

    assert client.delete("/api/memories").status_code == 200
    assert client.get("/api/memories").json() == []
    assert [m["content"] for m in client.get("/api/memories", headers=other).json()] == ["Theirs."]


async def test_retrieve_memories_only_returns_own(tmp_path):
    from app.memory_service import retrieve_memories

    conn = make_conn(tmp_path)
    repository.create_user(conn, "other@example.com", "hash")
    repository.create_memory(conn, "User's nickname is Sigma.", user_id=1)
    repository.create_memory(conn, "User's nickname is Pookie.", user_id=2)

    mine = await retrieve_memories("nickname", None, "m", "http://fake", conn=conn, user_id=1)
    theirs = await retrieve_memories("nickname", None, "m", "http://fake", conn=conn, user_id=2)
    nobody = await retrieve_memories("nickname", None, "m", "http://fake", conn=conn, user_id=None)

    assert "User's nickname is Sigma." in mine and "User's nickname is Pookie." not in mine
    assert "User's nickname is Pookie." in theirs and "User's nickname is Sigma." not in theirs
    assert nobody == []



async def test_relationship_remembered_across_chats_and_restart(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Original", 1)
    history = [
        {"role": "user", "content": "uk i have a girlfriend"},
        {"role": "assistant", "content": "Her name is Invented."},
        {"role": "user", "content": "she's my babe, her name is reshma, remember"},
    ]
    with patch("app.memory_service.chat_stream") as model:
        result = await prepare_memories(conn, FakeSettings(), 1, history, cid)
        assert result["saved"] == ["User's girlfriend is reshma."]
        model.assert_not_called()
    history.extend([{"role": "assistant", "content": "Saved."}, {"role": "user", "content": "save it"}])
    await prepare_memories(conn, FakeSettings(), 1, history, cid)
    assert len(repository.list_memories(conn, 1)) == 1
    conn.close()
    reopened = get_connection(str(tmp_path / "pragna.db"))
    result = await prepare_memories(reopened, FakeSettings(), 1,
                                    [{"role":"user", "content":"Who is my gf?"}])
    assert "User's girlfriend is reshma." in result["memories"]
    assert "Invented" not in str(result)
    assert result["saved"] == []


async def test_multiple_facts_and_corrections(tmp_path):
    conn = make_conn(tmp_path)
    async def stream(messages, *args, **kwargs):
        payload = json.loads(messages[-1]["content"])
        assert "Assistant" not in str(payload["prior_user_messages"])
        yield json.dumps([
            {"key":"work.role", "content":"User is a designer."},
            {"key":"preference.language", "content":"User prefers Telugu."},
        ])
    with patch("app.memory_service.chat_stream", new=stream):
        result = await prepare_memories(conn, FakeSettings(), 1, [
            {"role":"assistant", "content":"Assistant invented a job."},
            {"role":"user", "content":"I am a designer and prefer Telugu."},
        ])
    assert len(result["saved"]) == 2
    save_fact(conn, 1, "User prefers English.", "preference.language")
    assert "User prefers Telugu." not in [m["content"] for m in repository.list_memories(conn, 1)]
    save_fact(conn, 1, "User's girlfriend is Reshma.")
    result = await prepare_memories(conn, FakeSettings(), 1,
        [{"role":"user", "content":"My girlfriend is Priya."}])
    assert "User's girlfriend is Priya." in result["memories"]
    assert "User's girlfriend is Reshma." not in result["memories"]


async def test_recall_old_relevant_fact_without_embeddings(tmp_path):
    conn = make_conn(tmp_path)
    save_fact(conn, 1, "User's girlfriend is Reshma.")
    for i in range(150):
        repository.create_memory(conn, f"User project {i} uses Python.", user_id=1)
    with patch("app.memory_service.chat_stream") as model:
        result = await retrieve_memories("what is my gf name?", object(), "m", "http://offline", top_k=5, conn=conn, user_id=1)
        model.assert_not_called()
    assert result[0] == "User's girlfriend is Reshma."
    assert len(result) == 5


async def test_memories_survive_chat_deletion_but_explicit_forget_sticks(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Source", 1)
    mid = save_fact(conn, 1, "User's girlfriend is Reshma.", conversation_id=cid)
    assert repository.delete_conversation(conn, cid)
    assert repository.get_memory(conn, mid, 1)["source_conversation_id"] is None
    assert delete_memory_record(conn, None, mid, 1)
    class StaleVector:
        def count(self):
            raise AssertionError("Recall must not use deleted vector records")
    assert await retrieve_memories("gf", StaleVector(), "m", "offline", conn=conn, user_id=1) == []


async def test_extraction_failure_keeps_old_memory_without_confirming_save(tmp_path):
    conn = make_conn(tmp_path)
    save_fact(conn, 1, "User's girlfriend is Reshma.")
    async def broken(*args, **kwargs):
        raise RuntimeError("Offline")
        yield ""
    with patch("app.memory_service.chat_stream", new=broken):
        result = await prepare_memories(conn, FakeSettings(), 1,
            [{"role":"user", "content":"Remember I prefer tea."}])
    assert result["saved"] == []
    assert result["error"]
    assert "User's girlfriend is Reshma." in result["memories"]


def test_prepare_api_account_isolation_and_immediate_recall(client):
    other = _second_user_headers(client)
    res = client.post("/api/memories/prepare", json={"messages":[
        {"role":"user", "content":"I have a girlfriend"},
        {"role":"user", "content":"Her name is Reshma, remember"},
    ]})
    assert res.status_code == 200
    assert res.json()["saved"] == ["User's girlfriend is Reshma."]
    query = {"messages":[{"role":"user", "content":"Who is my gf?"}]}
    assert "User's girlfriend is Reshma." in client.post("/api/memories/prepare", json=query).json()["memories"]
    assert "User's girlfriend is Reshma." not in client.post("/api/memories/prepare", json=query, headers=other).json()["memories"]
    assert client.post("/api/memories/prepare", json=query, headers={"Authorization":"Bearer invalid"}).status_code == 401


async def test_assistant_claims_never_become_user_facts(tmp_path):
    conn = make_conn(tmp_path)
    result = await prepare_memories(conn, FakeSettings(), 1, [
        {"role":"assistant", "content":"Your girlfriend is Madeup."},
        {"role":"user", "content":"save it"},
    ])
    assert result["saved"] == []
    assert repository.list_memories(conn, 1) == []


async def test_new_backend_chat_receives_saved_facts(tmp_path, test_settings):
    from app.chat_service import _build_ollama_messages
    conn = make_conn(tmp_path)
    await prepare_memories(conn, FakeSettings(), 1,
        [{"role":"user", "content":"My girlfriend is Reshma."}])
    cid = repository.create_conversation(conn, "New chat", 1)
    mid = repository.add_message(conn, cid, "user", "Who is my gf?")
    with patch("app.chat_service.retrieve", new=AsyncMock(return_value=[])):
        messages, _ = await _build_ollama_messages(
            conn, None, test_settings, None, "Who is my gf?", mid, user_id=1
        )
    assert "User's girlfriend is Reshma." in "\n".join(m["content"] for m in messages if m["role"] == "system")


async def test_failed_write_never_reports_saved(tmp_path):
    conn = make_conn(tmp_path)
    with patch("app.memory_service.save_fact", side_effect=RuntimeError("Disk unavailable")):
        result = await prepare_memories(conn, FakeSettings(), 1,
            [{"role":"user", "content":"My girlfriend is Reshma."}])
    assert result["saved"] == []
    assert result["error"]
    assert "User's girlfriend is Reshma." not in result["memories"]


async def test_general_extraction_falls_back_to_cloud(tmp_path):
    conn = make_conn(tmp_path)
    class RoutedSettings(FakeSettings):
        ollama_url = 'http://127.0.0.1:20128'
        omniroute_api_key = 'test-gateway-key'
        def get_ollama_api_keys(self):
            return ['test-cloud-key']
    calls = []
    async def stream(messages, model, url, **kwargs):
        calls.append(url)
        if '20128' in url:
            raise ConnectionError('Gateway unavailable')
        yield '[{"key":"preference.drink","content":"User prefers tea."}]'
    with patch('app.memory_service.chat_stream', new=stream):
        result = await prepare_memories(conn, RoutedSettings(), 1,
            [{'role':'user', 'content':'I prefer tea.'}])
    assert calls == ['http://127.0.0.1:20128', 'https://api.ollama.com']
    assert result['saved'] == ['User prefers tea.']
    assert result['error'] is None


async def test_related_person_facts_do_not_overwrite_their_name(tmp_path):
    conn = make_conn(tmp_path)
    save_fact(conn, 1, "User's girlfriend is Reshma.")
    save_fact(conn, 1, "User's girlfriend likes tea.", "relationship.girlfriend.drink")
    facts = await retrieve_memories('girlfriend', None, 'm', 'offline', conn=conn, user_id=1)
    assert "User's girlfriend is Reshma." in facts
    assert "User's girlfriend likes tea." in facts


async def test_bare_reply_to_nickname_question_is_saved_and_recalled(tmp_path):
    conn = make_conn(tmp_path)
    with patch("app.memory_service.chat_stream") as model:
        result = await prepare_memories(conn, FakeSettings(), 1, [
            {"role": "user", "content": "do u know my nickname?"},
            {"role": "assistant", "content": "I don't have a nickname on file for you."},
            {"role": "user", "content": "its sigmaslayer"},
        ])
        assert result["saved"] == ["User's nickname is sigmaslayer."]
        model.assert_not_called()
    recalled = await prepare_memories(conn, FakeSettings(), 1, [{"role": "user", "content": "whats my nickname?"}])
    assert "User's nickname is sigmaslayer." in recalled["memories"]


async def test_bare_reply_without_nickname_question_is_not_saved(tmp_path):
    conn = make_conn(tmp_path)
    result = await prepare_memories(conn, FakeSettings(), 1, [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello! How can I help?"},
        {"role": "user", "content": "its sigmaslayer"},
    ])
    assert result["saved"] == []
