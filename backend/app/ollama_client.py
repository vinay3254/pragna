import json
import logging
from typing import AsyncGenerator
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)


class KeyRotator:
    """Manages round-robin rotation and failover across multiple Ollama API keys."""

    def __init__(self):
        self._index = 0

    def get_keys(self, custom_keys: list[str] | None = None) -> list[str]:
        if custom_keys is not None:
            return [k.strip() for k in custom_keys if k.strip()]
        try:
            return get_settings().get_ollama_api_keys()
        except Exception:
            return []

    def get_ordered_keys(self, custom_keys: list[str] | None = None) -> list[str | None]:
        """Returns all keys starting from current round-robin index for failover."""
        keys = self.get_keys(custom_keys)
        if not keys:
            return [None]
        n = len(keys)
        start = self._index % n
        self._index = (self._index + 1) % n
        return [keys[(start + i) % n] for i in range(n)]


key_rotator = KeyRotator()


def _normalize_url(url: str) -> str:
    if not url or not str(url).strip():
        return "http://localhost:11434"
    u = str(url).strip().rstrip("/")
    if not u.startswith(("http://", "https://")):
        if "localhost" in u or "127.0.0.1" in u:
            return f"http://{u}"
        return f"https://{u}"
    return u


def _is_openai_compat(url: str) -> bool:
    """Detect if the URL is an OpenAI-compatible endpoint (Omniroute, etc.)."""
    return "20128" in url or "omniroute" in url.lower() or "openrouter" in url.lower()


def _openai_to_ollama_messages(messages: list[dict]) -> list[dict]:
    """Pass-through — both formats use same role/content structure."""
    return messages


async def chat_stream(
    messages: list[dict],
    model: str,
    ollama_url: str,
    api_keys: list[str] | None = None,
    max_tokens: int | None = None,
) -> AsyncGenerator[str, None]:
    ollama_url = _normalize_url(ollama_url)
    keys_to_try = key_rotator.get_ordered_keys(api_keys)
    last_exc = None
    use_openai = _is_openai_compat(ollama_url)

    for i, key in enumerate(keys_to_try):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                if use_openai:
                    endpoint = f"{ollama_url}/v1/chat/completions"
                    body = {"model": model, "messages": messages, "stream": True}
                    if max_tokens:
                        body["max_tokens"] = max_tokens
                else:
                    endpoint = f"{ollama_url}/api/chat"
                    body = {"model": model, "messages": messages, "stream": True}

                async with client.stream("POST", endpoint, json=body, headers=headers) as response:
                    if response.status_code in (401, 403, 429, 503) and i < len(keys_to_try) - 1:
                        logger.warning("chat_stream returned %d with key index %d, rotating", response.status_code, i)
                        continue
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        if use_openai:
                            # SSE: "data: {...}" or "data: [DONE]"
                            if line.startswith("data:"):
                                chunk = line[5:].strip()
                                if chunk == "[DONE]":
                                    break
                                try:
                                    data = json.loads(chunk)
                                    content = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                    if content:
                                        yield content
                                except json.JSONDecodeError:
                                    pass
                        else:
                            data = json.loads(line)
                            content = data.get("message", {}).get("content", "")
                            if content:
                                yield content
                            if data.get("done"):
                                break
                    return
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last_exc = e
            if i < len(keys_to_try) - 1:
                logger.warning("chat_stream error %s, trying next key", e)
                continue
            raise

    if last_exc:
        raise last_exc


async def chat_stream_events(
    messages: list[dict],
    model: str,
    ollama_url: str,
    tools: list[dict] | None = None,
    api_keys: list[str] | None = None,
) -> AsyncGenerator[dict, None]:
    ollama_url = _normalize_url(ollama_url)
    use_openai = _is_openai_compat(ollama_url)

    body: dict = {"model": model, "messages": messages, "stream": True}
    if tools:
        body["tools"] = tools

    keys_to_try = key_rotator.get_ordered_keys(api_keys)
    last_exc = None

    for i, key in enumerate(keys_to_try):
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                endpoint = f"{ollama_url}/v1/chat/completions" if use_openai else f"{ollama_url}/api/chat"
                async with client.stream("POST", endpoint, json=body, headers=headers) as response:
                    if response.status_code in (401, 403, 429, 503) and i < len(keys_to_try) - 1:
                        logger.warning("chat_stream_events %d key %d, rotating", response.status_code, i)
                        continue
                    response.raise_for_status()

                    if use_openai:
                        # Accumulate tool_calls across chunks (OpenAI sends them fragmented)
                        accumulated_tool_calls: dict[int, dict] = {}
                        async for line in response.aiter_lines():
                            if not line.strip():
                                continue
                            if not line.startswith("data:"):
                                continue
                            chunk = line[5:].strip()
                            if chunk == "[DONE]":
                                # Flush any accumulated tool calls
                                if accumulated_tool_calls:
                                    tc_list = []
                                    for idx in sorted(accumulated_tool_calls):
                                        tc = accumulated_tool_calls[idx]
                                        tc_list.append({
                                            "function": {
                                                "name": tc.get("name", ""),
                                                "arguments": tc.get("arguments", "{}"),
                                            }
                                        })
                                    yield {"type": "tool_calls", "tool_calls": tc_list}
                                yield {"type": "done"}
                                break
                            try:
                                data = json.loads(chunk)
                            except json.JSONDecodeError:
                                continue
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield {"type": "content", "content": content}
                            # Accumulate streaming tool_calls
                            for tc_delta in delta.get("tool_calls", []):
                                idx = tc_delta.get("index", 0)
                                if idx not in accumulated_tool_calls:
                                    accumulated_tool_calls[idx] = {"name": "", "arguments": ""}
                                fn = tc_delta.get("function", {})
                                accumulated_tool_calls[idx]["name"] += fn.get("name", "")
                                accumulated_tool_calls[idx]["arguments"] += fn.get("arguments", "")
                            finish = data.get("choices", [{}])[0].get("finish_reason")
                            if finish == "stop" and not accumulated_tool_calls:
                                yield {"type": "done"}
                    else:
                        async for line in response.aiter_lines():
                            if not line.strip():
                                continue
                            data = json.loads(line)
                            message = data.get("message", {})
                            content = message.get("content", "")
                            if content:
                                yield {"type": "content", "content": content}
                            tool_calls = message.get("tool_calls")
                            if tool_calls:
                                yield {"type": "tool_calls", "tool_calls": tool_calls}
                            if data.get("done"):
                                yield {"type": "done"}
                                break
                    return
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last_exc = e
            if i < len(keys_to_try) - 1:
                logger.warning("chat_stream_events error %s, trying next key", e)
                continue
            raise

    if last_exc:
        raise last_exc


async def embed(
    text: str,
    model: str,
    ollama_url: str,
    api_keys: list[str] | None = None,
) -> list[float]:
    ollama_url = _normalize_url(ollama_url)
    keys_to_try = key_rotator.get_ordered_keys(api_keys)
    last_exc = None

    # Try configured ollama_url
    for i, key in enumerate(keys_to_try):
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 1. Try modern /api/embed endpoint
                r_embed = await client.post(
                    f"{ollama_url}/api/embed",
                    json={"model": model, "input": text},
                    headers=headers,
                )
                if r_embed.status_code == 200:
                    data = r_embed.json()
                    if "embeddings" in data and len(data["embeddings"]) > 0:
                        return data["embeddings"][0]
                    if "embedding" in data:
                        return data["embedding"]

                # 2. Try legacy /api/embeddings endpoint
                r_embeddings = await client.post(
                    f"{ollama_url}/api/embeddings",
                    json={"model": model, "prompt": text},
                    headers=headers,
                )
                if r_embeddings.status_code == 200:
                    data = r_embeddings.json()
                    if "embedding" in data:
                        return data["embedding"]
                    if "embeddings" in data and len(data["embeddings"]) > 0:
                        return data["embeddings"][0]

                if r_embed.status_code == 401:
                    # Remote keys are not authorized for embeddings, fast-fail without burning retry time
                    break
                if r_embed.status_code in (403, 429, 503) and i < len(keys_to_try) - 1:
                    continue
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last_exc = e
            if i < len(keys_to_try) - 1:
                continue

    # Fallback to local Ollama if remote cloud fails or 404s
    if ollama_url != "http://localhost:11434":
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r_local = await client.post(
                    "http://localhost:11434/api/embeddings",
                    json={"model": model, "prompt": text},
                )
                if r_local.status_code == 200:
                    data = r_local.json()
                    if "embedding" in data:
                        return data["embedding"]
                    if "embeddings" in data and len(data["embeddings"]) > 0:
                        return data["embeddings"][0]
        except Exception:
            pass

    logger.warning("Embedding could not be generated for text: %s", last_exc)
    return []
