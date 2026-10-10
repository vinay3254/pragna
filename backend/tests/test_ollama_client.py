import json
import httpx
import respx
import pytest
from app.ollama_client import chat_stream, embed, key_rotator
from app.config import Settings


@respx.mock
async def test_openai_stream_accepts_usage_frames_without_choices():
    frames = [{'choices': [], 'usage': {'total_tokens': 2}},
              {'choices': [{'delta': {'content': '<main>Ready</main>'}}]},
              {'choices': [], 'usage': {'total_tokens': 8}}]
    body = ''.join('data: ' + json.dumps(frame) + '\n\n' for frame in frames) + 'data: [DONE]\n\n'
    respx.post('http://gateway/v1/chat/completions').mock(return_value=httpx.Response(200, text=body))
    tokens = [token async for token in chat_stream([], 'model', 'http://gateway')]
    assert tokens == ['<main>Ready</main>']


@respx.mock
async def test_openai_stream_reports_gateway_errors_instead_of_empty_success():
    respx.post('http://gateway/v1/chat/completions').mock(return_value=httpx.Response(200,
        text='data: {"error":{"message":"Provider unavailable"}}\n\n'))
    with pytest.raises(RuntimeError, match='streaming error'):
        async for _ in chat_stream([], 'model', 'http://gateway'):
            pass


@respx.mock
async def test_chat_stream_yields_content_tokens():
    lines = [
        json.dumps({"message": {"role": "assistant", "content": "Hel"}, "done": False}),
        json.dumps({"message": {"role": "assistant", "content": "lo"}, "done": False}),
        json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}),
    ]
    body = "\n".join(lines) + "\n"
    respx.post("http://fake-ollama:11434/api/chat").mock(
        return_value=httpx.Response(200, text=body)
    )

    tokens = []
    async for token in chat_stream(
        [{"role": "user", "content": "hi"}], "test-model", "http://fake-ollama:11434"
    ):
        tokens.append(token)

    assert tokens == ["Hel", "lo"]


@respx.mock
async def test_embed_returns_vector():
    respx.post("http://fake-ollama:11434/api/embed").mock(
        return_value=httpx.Response(200, json={"embeddings": [[0.1, 0.2, 0.3]]})
    )

    result = await embed("hello", "test-embed-model", "http://fake-ollama:11434")

    assert result == [0.1, 0.2, 0.3]


@respx.mock
async def test_chat_stream_raises_on_http_error():
    respx.post("http://fake-ollama:11434/api/chat").mock(
        return_value=httpx.Response(500)
    )

    with pytest.raises(httpx.HTTPStatusError):
        async for _ in chat_stream(
            [{"role": "user", "content": "hi"}], "test-model", "http://fake-ollama:11434"
        ):
            pass


@respx.mock
async def test_ollama_client_sends_authorization_header():
    route = respx.post("http://fake-ollama:11434/api/embed").mock(
        return_value=httpx.Response(200, json={"embeddings": [[0.5]]})
    )

    await embed("text", "model", "http://fake-ollama:11434", api_keys=["secret-key-123"])

    assert route.called
    assert route.calls.last.request.headers.get("Authorization") == "Bearer secret-key-123"


@respx.mock
async def test_ollama_client_rotates_and_fails_over_on_rate_limit():
    lines = [json.dumps({"message": {"role": "assistant", "content": "Success"}, "done": True})]
    body = "\n".join(lines) + "\n"

    # First call with key1 returns 429 Too Many Requests
    # Second call with key2 returns 200 OK
    route = respx.post("http://fake-ollama:11434/api/chat").mock(
        side_effect=[
            httpx.Response(429, text="Rate limit reached"),
            httpx.Response(200, text=body),
        ]
    )

    tokens = []
    async for token in chat_stream(
        [{"role": "user", "content": "hi"}],
        "test-model",
        "http://fake-ollama:11434",
        api_keys=["key1", "key2"],
    ):
        tokens.append(token)

    assert tokens == ["Success"]
    assert len(route.calls) == 2
    assert route.calls[0].request.headers.get("Authorization") == "Bearer key1"
    assert route.calls[1].request.headers.get("Authorization") == "Bearer key2"


def test_settings_extracts_all_9_keys():
    settings = Settings(
        _env_file=None,
        jwt_secret="secret123456789012345678901234567890",
        ollama_api_key="main-key",
        ollama_api_key_1="key-1",
        ollama_api_key_2="key-2",
        ollama_api_key_3="key-3",
        ollama_api_key_4="key-4",
        ollama_api_key_5="key-5",
        ollama_api_key_6="key-6",
        ollama_api_key_7="key-7",
        ollama_api_key_8="key-8",
        ollama_api_key_9="key-9",
    )

    keys = settings.get_ollama_api_keys()
    assert keys[0] == "main-key"
    assert keys[1:10] == [f"key-{i}" for i in range(1, 10)]
