import pytest
from app.db import init_db, get_connection
from app import repository


def make_conn(tmp_path):
    db_path = str(tmp_path / "pragna.db")
    init_db(db_path)
    conn = get_connection(db_path)
    repository.create_user(conn, "test@example.com", "hash")
    return conn


def test_artifacts_crud(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Test Artifact", 1)
    mid = repository.add_message(conn, cid, "assistant", "Here is an artifact")

    art_id = repository.create_artifact(conn, mid, "Add Numbers", "python", "def add(a, b): return a + b")
    assert art_id is not None

    art = repository.get_artifact(conn, art_id)
    assert art["title"] == "Add Numbers"
    assert art["language"] == "python"
    assert art["content"] == "def add(a, b): return a + b"

    msg = repository.get_message(conn, mid)
    assert len(msg["artifacts"]) == 1
    assert msg["artifacts"][0]["title"] == "Add Numbers"


def test_memories_crud(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Test Memory", 1)

    mem_id = repository.create_memory(conn, "User prefers dark mode.", source_conversation_id=cid, user_id=1)
    assert mem_id is not None

    mems = repository.list_memories(conn, 1)
    assert len(mems) == 1
    assert mems[0]["content"] == "User prefers dark mode."
    assert mems[0]["source_conversation_id"] == cid

    deleted = repository.delete_memory(conn, mem_id, 1)
    assert deleted is True
    assert len(repository.list_memories(conn, 1)) == 0


def test_tool_calls_crud(tmp_path):
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "Test Tools", 1)
    mid = repository.add_message(conn, cid, "assistant", "Tool message")

    t_id = repository.create_tool_call(conn, mid, "web_search", {"query": "pragna chatbot"}, status="completed")
    repository.update_tool_call(conn, t_id, {"results": ["found!"]}, status="completed")

    t_call = repository.get_tool_call(conn, t_id)
    assert t_call["tool_name"] == "web_search"
    assert t_call["arguments"] == {"query": "pragna chatbot"}
    assert t_call["result"] == {"results": ["found!"]}
    assert t_call["status"] == "completed"

    msg = repository.get_message(conn, mid)
    assert len(msg["tool_calls"]) == 1
    assert msg["tool_calls"][0]["tool_name"] == "web_search"
