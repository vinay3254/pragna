import json
import pytest
from unittest.mock import AsyncMock, patch
from app.db import init_db, get_connection
from app import repository
from app.tools import execute_tool, OLLAMA_TOOLS_SCHEMA, MUTATING_TOOLS
from app.chat_service import generate_reply, resume_tool_reply


def make_conn(tmp_path):
    db_path = str(tmp_path / "pragna.db")
    init_db(db_path)
    conn = get_connection(db_path)
    repository.create_user(conn, "test@example.com", "hash")
    return conn


class FakeSettings:
    embed_model = "nomic-embed-text"
    ollama_url = "http://fake"
    rag_similarity_threshold = 0.5


class FakeCollection:
    def count(self):
        return 0


async def test_execute_tool_web_search():
    res = await execute_tool("web_search", {"query": "python"})
    assert res["success"] is True
    assert res["query"] == "python"


async def test_execute_tool_generate_image_no_api_key(tmp_path, monkeypatch):
    monkeypatch.delenv("STABILITY_API_KEY", raising=False)
    res = await execute_tool("generate_image", {"prompt": "a red fox"})
    assert res["success"] is True
    assert "pollinations" in res["image_url"]



async def test_execute_tool_edit_image_without_prior_image(tmp_path, monkeypatch):
    monkeypatch.setenv("STABILITY_API_KEY", "test-key")
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "no image yet", 1)

    res = await execute_tool(
        "edit_image", {"instruction": "make it darker"}, conn=conn, conversation_id=cid
    )
    assert res["success"] is False
    assert "no previously generated image" in res["error"].lower()


async def test_execute_tool_edit_image_finds_latest_generated_image(tmp_path, monkeypatch):
    monkeypatch.setenv("STABILITY_API_KEY", "test-key")
    conn = make_conn(tmp_path)
    cid = repository.create_conversation(conn, "has an image", 1)
    mid = repository.add_message(conn, cid, "assistant", "here you go")
    t_id = repository.create_tool_call(conn, mid, "generate_image", {"prompt": "a fox"}, status="completed")
    repository.update_tool_call(
        conn, t_id, {"success": True, "image_base64": "Zm9vYmFy", "prompt": "a fox"}, status="completed"
    )

    with patch("app.tools.image_service.edit_image", new=AsyncMock(
        return_value={"success": True, "image_base64": "ZWRpdGVk", "prompt": "make it darker"}
    )) as mock_edit:
        res = await execute_tool(
            "edit_image", {"instruction": "make it darker"}, conn=conn, conversation_id=cid
        )

    assert res["success"] is True
    assert res["image_base64"] == "ZWRpdGVk"
    mock_edit.assert_awaited_once_with("Zm9vYmFy", "make it darker", "test-key")


async def test_tool_confirm_required_pause(tmp_path):
    conn = make_conn(tmp_path)

    async def fake_stream_with_mutating_tool(messages, model, ollama_url, tools=None):
        yield {
            "type": "tool_calls",
            "tool_calls": [
                {
                    "function": {
                        "name": "browser_act",
                        "arguments": {
                            "description": "Click submit button",
                            "steps": [{"action": "click", "selector": "#submit"}]
                        }
                    }
                }
            ]
        }

    with patch("app.chat_service.MUTATING_TOOLS", {"browser_act"}), patch(
        "app.chat_service.chat_stream_events", new=fake_stream_with_mutating_tool
    ), patch(
        "app.chat_service.retrieve", new=AsyncMock(return_value=[])
    ), patch(
        "app.chat_service.retrieve_memories", new=AsyncMock(return_value=[])
    ):
        events = [
            e async for e in generate_reply(
                conn, None, FakeSettings(), None, "Perform click action", "gemma4:cloud", user_id=1
            )
        ]

    confirm_events = [e for e in events if e["type"] == "confirm_required"]
    assert len(confirm_events) == 1
    assert confirm_events[0]["tool_name"] == "browser_act"
    assert confirm_events[0]["description"] == "Click submit button"


async def _pause_on_browser_act(tmp_path):
    """Helper: run generate_reply until it pauses on a browser_act confirmation,
    returning (conn, conversation_id, tool_call_id, paused_message_id)."""
    conn = make_conn(tmp_path)

    async def fake_stream_with_mutating_tool(messages, model, ollama_url, tools=None):
        yield {"type": "content", "content": "Sure, I'll do that. "}
        yield {
            "type": "tool_calls",
            "tool_calls": [
                {
                    "function": {
                        "name": "browser_act",
                        "arguments": {
                            "description": "Click submit button",
                            "steps": [{"action": "click", "selector": "#submit"}]
                        }
                    }
                }
            ]
        }

    with patch("app.chat_service.MUTATING_TOOLS", {"browser_act"}), patch(
        "app.chat_service.chat_stream_events", new=fake_stream_with_mutating_tool
    ), patch(
        "app.chat_service.retrieve", new=AsyncMock(return_value=[])
    ), patch(
        "app.chat_service.retrieve_memories", new=AsyncMock(return_value=[])
    ):
        events = [
            e async for e in generate_reply(
                conn, FakeCollection(), FakeSettings(), None, "Please click submit", "gemma4:cloud", user_id=1
            )
        ]

    confirm_event = next(e for e in events if e["type"] == "confirm_required")
    tool_call = repository.get_tool_call(conn, confirm_event["tool_call_id"])
    return conn, tool_call["message_id"], confirm_event["tool_call_id"]


async def test_resume_tool_reply_approved_executes_and_continues(tmp_path):
    conn, paused_message_id, tool_call_id = await _pause_on_browser_act(tmp_path)

    paused = repository.get_message(conn, paused_message_id)
    assert paused["content"] == "Sure, I'll do that. "
    assert repository.get_tool_call(conn, tool_call_id)["status"] == "pending"

    async def fake_continuation(messages, model, ollama_url, tools=None):
        # The tool result should have been fed back into the conversation.
        assert any(m.get("role") == "tool" for m in messages)
        yield {"type": "content", "content": "Done, I clicked it."}

    with patch("app.chat_service.chat_stream_events", new=fake_continuation), patch(
        "app.chat_service.retrieve", new=AsyncMock(return_value=[])
    ), patch(
        "app.chat_service.retrieve_memories", new=AsyncMock(return_value=[])
    ):
        events = [
            e async for e in resume_tool_reply(
                conn, FakeCollection(), tool_call_id, True, FakeSettings(), user_id=1
            )
        ]

    tool_result_events = [e for e in events if e["type"] == "tool_result"]
    done_events = [e for e in events if e["type"] == "done"]
    assert len(tool_result_events) == 1
    assert len(done_events) == 1

    # Same message row updated in place, not a new sibling.
    assert done_events[0]["message_id"] == paused_message_id
    final = repository.get_message(conn, paused_message_id)
    assert final["content"] == "Sure, I'll do that. Done, I clicked it."
    assert repository.get_tool_call(conn, tool_call_id)["status"] == "completed"


async def test_resume_tool_reply_denied_feeds_denial_and_continues(tmp_path):
    conn, paused_message_id, tool_call_id = await _pause_on_browser_act(tmp_path)

    async def fake_continuation(messages, model, ollama_url, tools=None):
        tool_msg = next(m for m in messages if m.get("role") == "tool")
        assert "denied" in tool_msg["content"].lower()
        yield {"type": "content", "content": "Understood, I won't do that."}

    with patch("app.chat_service.chat_stream_events", new=fake_continuation), patch(
        "app.chat_service.retrieve", new=AsyncMock(return_value=[])
    ), patch(
        "app.chat_service.retrieve_memories", new=AsyncMock(return_value=[])
    ):
        events = [
            e async for e in resume_tool_reply(
                conn, FakeCollection(), tool_call_id, False, FakeSettings(), user_id=1
            )
        ]

    done_events = [e for e in events if e["type"] == "done"]
    assert len(done_events) == 1
    assert repository.get_tool_call(conn, tool_call_id)["status"] == "denied"
    final = repository.get_message(conn, paused_message_id)
    assert final["content"] == "Sure, I'll do that. Understood, I won't do that."


async def test_resume_tool_reply_rejects_non_pending(tmp_path):
    conn = make_conn(tmp_path)
    mid = repository.add_message(conn, repository.create_conversation(conn, "x", 1), "assistant", "test")
    t_id = repository.create_tool_call(conn, mid, "browser_act", {"description": "x"}, status="completed")

    events = [
        e async for e in resume_tool_reply(conn, FakeCollection(), t_id, True, FakeSettings(), user_id=1)
    ]
    assert events == [{"type": "error", "message": "Tool call is not pending approval."}]


def test_resume_tool_route(client):
    conn = client.app.state.conn
    cid = repository.create_conversation(conn, "Resume test", 1)
    mid = repository.add_message(conn, cid, "assistant", "test", model="gemma4:cloud")
    t_id = repository.create_tool_call(
        conn, mid, "browser_act", {"description": "Click button"}, status="pending"
    )

    async def fake_continuation(messages, model, ollama_url, tools=None):
        yield {"type": "content", "content": "Done."}

    with patch("app.chat_service.chat_stream_events", new=fake_continuation):
        res_approve = client.post(
            f"/api/conversations/{cid}/resume-tool",
            json={"tool_call_id": t_id, "approved": True}
        )
    assert res_approve.status_code == 200
    events = [
        json.loads(line[len("data: "):])
        for line in res_approve.text.split("\n\n")
        if line.startswith("data: ")
    ]
    assert any(e["type"] == "done" for e in events)
    assert repository.get_tool_call(conn, t_id)["status"] == "completed"

    # Second call should fail with 409 since status is no longer pending
    res_conflict = client.post(
        f"/api/conversations/{cid}/resume-tool",
        json={"tool_call_id": t_id, "approved": True}
    )
    assert res_conflict.status_code == 409
