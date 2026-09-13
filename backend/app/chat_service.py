import asyncio
import time
from datetime import datetime, timezone
from typing import AsyncGenerator
import httpx
from app import repository, trajectory_service
from app.ollama_client import chat_stream_events
from app.rag import retrieve
from app.memory_service import retrieve_memories, extract_and_save_memory
from app.artifact_service import extract_and_save_artifacts
from app.tools import OLLAMA_TOOLS_SCHEMA, MUTATING_TOOLS, execute_tool

ALLOWED_MODELS = {
    "gemma4:cloud",
    "gemma4:31b-cloud",
    "nemotron-3-super:cloud",
    "minimax-m3:cloud",
}

# Per each model's Ollama /api/show capabilities: all four support "tools",
# but nemotron-3-super:cloud is the one model without "vision" -- it can't
# be sent an image, so browser_screenshot falls back to a text page-read for
# it specifically.
VISION_CAPABLE_MODELS = {
    "gemma4:cloud",
    "gemma4:31b-cloud",
    "minimax-m3:cloud",
}

# Tools whose result can carry a screenshot (image_base64) for the model to
# look at, in addition to the text summary.
SCREENSHOT_TOOLS = {"browser_navigate", "browser_screenshot", "browser_act", "browser_click", "browser_type", "browser_scroll", "browser_exec", "browser_snapshot"}

GENERAL_SYSTEM_PROMPT = (
    "You are Pragna, an intelligent, articulate, and thoughtful AI assistant created by "
    "EtherX Innovations within the IgniteX team. Inside the IgniteX team, three specialized "
    "project teams operate on distinct breakthrough initiatives, one of which developed Pragna. "
    "Pragna is designed with three core interfaces: Pragna Chatbot (conversational AI), "
    "Pragna Code (developer and coding assistant), and Coword (collaborative workspace and document creation). "
    "Answer the user's question directly using your own general knowledge. If you are genuinely unsure "
    "of the answer, say so plainly rather than guessing. Do NOT use or display any emojis anywhere in your replies.\n\n"
    "ARTIFACT CONVENTION: When creating a complete, substantial script/code file "
    "or a long standalone document (essay, report, writeup), wrap it in a fenced block "
    "tagged with `artifact`, specifying a title and optional language attribute:\n"
    "```artifact title=\"Add Numbers\" language=\"python\"\n"
    "def add(a, b):\n    return a + b\n"
    "```\n"
    "For `language=\"html\"` artifacts specifically, the user sees a live rendered "
    "preview, not just the source -- so write a complete, self-contained HTML "
    "document (starting with <!DOCTYPE html>, with any CSS/JS inlined rather than "
    "referencing external files) whenever the user asks for a webpage, UI mockup, "
    "landing page, or similar visual HTML output."
)

GROUNDED_SYSTEM_PROMPT_TEMPLATE = (
    "You are Pragna, an intelligent, articulate, and thoughtful AI assistant created by "
    "EtherX Innovations within the IgniteX team. Inside the IgniteX team, three specialized "
    "project teams operate on distinct breakthrough initiatives, one of which developed Pragna. "
    "Pragna is designed with three core interfaces: Pragna Chatbot (conversational AI), "
    "Pragna Code (developer and coding assistant), and Coword (collaborative workspace and document creation). "
    "Do NOT use or display any emojis anywhere in your replies. "
    "The user has shared one or more files/documents "
    "with you. The extracted content from those files is provided below in the "
    "Context section. ALWAYS read and use this context when answering. If the user "
    "says 'review this', 'summarize this', 'what is in this file', or anything that "
    "refers to a document they shared, read and respond using the context below -- "
    "do NOT say you haven't been given anything.\n\n"
    "ARTIFACT CONVENTION: When creating a complete, substantial script/code file "
    "or a long standalone document (essay, report, writeup), wrap it in a fenced block "
    "tagged with `artifact`, specifying a title and optional language attribute:\n"
    "```artifact title=\"Add Numbers\" language=\"python\"\n"
    "def add(a, b):\n    return a + b\n"
    "```\n"
    "For `language=\"html\"` artifacts specifically, the user sees a live rendered "
    "preview, not just the source -- so write a complete, self-contained HTML "
    "document (starting with <!DOCTYPE html>, with any CSS/JS inlined rather than "
    "referencing external files) whenever the user asks for a webpage, UI mockup, "
    "landing page, or similar visual HTML output."
    "\n\nContext from user's uploaded files:\n{context}"
)


_UNSET = object()


MODEL_KNOWLEDGE = {
    "gemma4:cloud": {
        "displayName": "Tvarā",
        "sanskrit": "त्वरा",
        "meaning": "speed",
        "tier": "Tier 1: Implementation / Praxis",
        "architecture": "Google Gemma 4 Cloud",
        "strengths": "Instant response, fast routine coding, concise reasoning, and interactive tools.",
    },
    "gemma4:31b-cloud": {
        "displayName": "Manas",
        "sanskrit": "मनस्",
        "meaning": "intellect / mind",
        "tier": "Tier 2: Testing & QA / Rhapsody",
        "architecture": "Google Gemma 4 31B Cloud",
        "strengths": "Deep multi-step reasoning, comprehensive explanations, and thorough QA verification.",
    },
    "nemotron-3-super:cloud": {
        "displayName": "Bṛhat",
        "sanskrit": "बृहत्",
        "meaning": "vast / immense",
        "tier": "Tier 3: Review / Elenchos",
        "architecture": "NVIDIA Nemotron 3 Super Cloud (120B)",
        "strengths": "Vast scale analytical reasoning, security audits, and deep code review.",
    },
    "minimax-m3:cloud": {
        "displayName": "Pragya",
        "sanskrit": "प्रज्ञा",
        "meaning": "deep wisdom",
        "tier": "Tier 4: Architecture / Theoria",
        "architecture": "MiniMax M3 Cloud",
        "strengths": "High-level architectural planning, long-context document synthesis, and system design.",
    },
}


def _build_system_prompt(sources: list[dict], user_memories: list[str], model: str | None = None) -> str:
    if sources:
        context = "\n---\n".join(f"[{s['filename']}]: {s['snippet']}" for s in sources)
        system_prompt = GROUNDED_SYSTEM_PROMPT_TEMPLATE.format(context=context)
    else:
        system_prompt = GENERAL_SYSTEM_PROMPT

    if model and model in MODEL_KNOWLEDGE:
        m = MODEL_KNOWLEDGE[model]
        model_block = (
            f"ACTIVE MODEL AWARENESS:\n"
            f"- Model Name: {m['displayName']} ({m['sanskrit']})\n"
            f"- Sanskrit Meaning: '{m['meaning']}'\n"
            f"- Tier / Label: {m['tier']}\n"
            f"- Underlying Architecture: {m['architecture']}\n"
            f"- Core Strengths: {m['strengths']}\n"
            f"If the user asks what model you are using, what model is active, or asks about your AI engine, "
            f"explain clearly that you are running on {m['displayName']} ({m['sanskrit']}), describe its meaning "
            f"('{m['meaning']}'), its underlying architecture ({m['architecture']}), and its specific role in Pragna. "
            f"Never claim to be an unknown or generic model.\n\n"
        )
        system_prompt = model_block + system_prompt

    if user_memories:
        memory_block = "What you know about this user:\n" + "\n".join(f"- {m}" for m in user_memories) + "\n\n"
        system_prompt = memory_block + system_prompt

    current_time_block = (
        "Current date and time: "
        + datetime.now(timezone.utc).strftime("%A, %Y-%m-%d %H:%M UTC")
        + ". Treat this as ground truth for the current date, day of the week, or the time in "
        "any timezone -- compute it yourself from this UTC value instead of guessing or trusting "
        "web search result snippets, which are static page descriptions and rarely contain a live "
        "time value.\n\n"
        "Your own knowledge has a training cutoff well before the current date above, so anything "
        "you 'know' about news, sports results, scores, elections, prices, releases, or the status "
        "of a scheduled event may be outdated or simply wrong by now. For any question about "
        "something that could have happened, changed, or concluded between your training cutoff "
        "and the current date, call web_search and check before answering -- don't reason from what "
        "was scheduled or expected; find out what actually happened. Only skip the search if the "
        "question is about a fact that cannot change (e.g. general knowledge, math, or writing "
        "code).\n\n"
        "BROWSER TOOL SELECTION — read this carefully and follow it exactly:\n"
        "You have two completely different kinds of web access. Choosing the wrong one means you FAIL the task:\n\n"
        "A) open_url — ONLY use this when the user simply wants to OPEN or VISIT a site themselves to use it.\n"
        "   Examples: 'open instagram', 'go to youtube', 'launch spotify'.\n"
        "   This just opens a tab for the user. YOU cannot see, read, or check anything with this tool.\n"
        "   NEVER use open_url when the user wants you to CHECK, READ, FIND, SEE, or LOOK AT content.\n\n"
        "B) browser_navigate → browser_read_page / browser_screenshot — use these whenever you need to\n"
        "   ACTUALLY visit a page and READ or REPORT its content back to the user.\n"
        "   Examples: 'check my instagram inbox', 'who messaged me', 'what are the trending topics',\n"
        "   'read this article', 'search for X on google', 'what does this page say',\n"
        "   'go to site X and find Y', 'check the price of X'.\n"
        "   After browser_navigate, ALWAYS call browser_read_page or browser_screenshot to get the content.\n"
        "   Then report what you found. Never just open_url when the user wants you to CHECK something.\n\n"
        "C) For INTERACTIONS on pages (clicking, typing, scrolling, form filling), use:\n"
        "   browser_click, browser_type, browser_scroll, browser_press, browser_back, browser_dialog.\n"
        "   These require user confirmation before executing.\n\n"
        "RULE: If the user says 'check', 'see', 'find', 'read', 'who', 'what', 'show me', 'look at',\n"
        "'search on', 'get from' — always use browser_navigate + browser_read_page, NEVER open_url.\n"
        "Never say you cannot access the internet, open websites, or browse — that is false here.\n\n"
        "You also have file operation tools: read_file (read any local file), write_file (create/overwrite "
        "files, requires confirmation), patch (apply diffs, requires confirmation), search_files "
        "(search across directories). Use these to read code, configs, and documents the user mentions.\n\n"
        "You have terminal access: the 'terminal' tool runs PowerShell/Bash commands (requires "
        "confirmation for destructive ops). Use process to inspect running services.\n\n"
        "You have productivity tools: todo (task checklist), memory (persistent key-value notes), "
        "session_search (search past chats), cronjob (schedule recurring tasks), clarify (ask "
        "structured questions).\n\n"
        "You have skills tools: skills_list, skill_view, skill_manage, use_skill — use these to "
        "view, create, and execute reusable skill instruction documents.\n\n"
        "You have media tools: vision_analyze (describe images), image_generate / generate_image "
        "(create images), edit_image (modify last generated image), video_generate (create videos), "
        "text_to_speech (synthesize audio).\n\n"
        "You also have real image tools: generate_image creates a new image from a text "
        "description, and edit_image modifies the most recently generated image using a "
        "natural-language instruction. When the user asks you to create, draw, make, generate, or "
        "edit an image or picture, call these tools and actually do it -- don't say you can't "
        "generate images or describe what an image would look like instead of making one.\n\n"
        "IMPORTANT: make tool calls only through the tool-calling mechanism you were given, never "
        "as text. After a tool result comes back, respond with a normal, short, plain-language "
        "sentence about what happened -- never write out a JSON object, an {\"action\": ..., "
        "\"action_input\": ...} block, or any other textual imitation of a tool call. If you need "
        "to call a tool again, use the real mechanism again; do not type it out.\n\n"
    )
    return current_time_block + system_prompt


async def _build_ollama_messages(
    conn, collection, settings, memories_collection, query_text: str, parent_id: int | None,
    document_ids: list[int] | None = None,
    user_id: int | None = None,
    model: str | None = None,
) -> tuple[list[dict], list[dict]]:
    top_k = 6
    threshold = settings.rag_similarity_threshold

    # Scope retrieval to specific document IDs if the user attached files
    where_filter = {"document_id": {"$in": [int(d) for d in document_ids]}} if document_ids else None

    # Real sources — semantically matched, shown as source chips in the UI
    display_sources = await retrieve(
        query_text if query_text.strip() else "document content summary",
        collection,
        settings.embed_model,
        settings.ollama_url,
        top_k=top_k,
        threshold=threshold,
        where=where_filter,
    )

    # Context sources — what actually goes into the system prompt.
    # If nothing matched by similarity but the collection (or attached files) has content,
    # force-include top chunks so the model can still read the file.
    # These are NOT shown as source chips (they'd be noise for unrelated questions).
    context_sources = display_sources
    collection_count = collection.count() if collection else 0
    if not display_sources and collection_count > 0:
        context_sources = await retrieve(
            "document",
            collection,
            settings.embed_model,
            settings.ollama_url,
            top_k=top_k,
            threshold=0.0,  # accept any chunk for grounding
            where=where_filter,
        )

    user_memories = await retrieve_memories(
        query_text,
        memories_collection,
        settings.embed_model,
        settings.ollama_url,
        top_k=5,
        threshold=threshold,
        conn=conn,
        user_id=user_id,
    )

    # Build system prompt with context_sources (may include forced fallback)
    system_prompt = _build_system_prompt(context_sources, user_memories, model=model)

    history = repository.get_path_to_root(conn, parent_id) if parent_id is not None else []
    ollama_messages = [{"role": "system", "content": system_prompt}]
    ollama_messages += [{"role": m["role"], "content": m["content"]} for m in history]
    # Return display_sources — only genuine matches — so chips don't appear for every message
    return ollama_messages, display_sources


def _tool_text_summary(t_name: str, res: dict) -> str:
    """A text description of a tool result, excluding any image -- used both
    as the caption sent alongside a screenshot to vision models, and as the
    entire tool response (image or not) for non-vision models."""
    if res.get("success") is False:
        return res.get("error", "The action did not succeed.")
    if t_name == "open_url":
        return res.get("summary", f"Opened {res.get('url', '?')} in a new tab.")
    if t_name == "browser_navigate":
        return f"Navigated to {res.get('url', '?')} (status {res.get('status', '?')}). Page title: {res.get('title', '?')}."
    if t_name == "browser_screenshot":
        return res.get("summary", "Screenshot captured.")
    if t_name == "browser_act":
        steps = "; ".join(res.get("executed_steps", [])) or "no steps executed"
        return f"Executed: {steps}. Now at {res.get('current_url', '?')} ({res.get('current_title', '?')})."
    if t_name in ("generate_image", "edit_image"):
        # A plain confirmation string, not the raw result dict -- feeding a
        # Python-repr'd dict back as "tool" content (the generic fallback
        # below) visually resembles a ReAct-style action/action_input blob,
        # which was observed to make gemma4:cloud imitate that format as its
        # own reply text instead of writing a normal description.
        return res.get("summary", "Image ready.")
    return str({k: v for k, v in res.items() if k != "image_base64"})


def _latest_image_summary(tool_calls_executed: list[dict]) -> str | None:
    for item in reversed(tool_calls_executed):
        if item["name"] in ("generate_image", "edit_image") and item["result"].get("success"):
            return item["result"].get("summary")
    return None


def _record_tool_result(ollama_messages: list[dict], tc: dict, t_name: str, model: str, res: dict) -> None:
    """Append the assistant tool-call + its result to ollama_messages, routing
    a screenshot to the model as an image if it supports vision."""
    ollama_messages.append({
        "role": "assistant",
        "content": "",
        "tool_calls": [tc]
    })

    image_b64 = res.get("image_base64") if t_name in SCREENSHOT_TOOLS else None
    text_summary = _tool_text_summary(t_name, res)
    ollama_messages.append({
        "role": "tool",
        "name": t_name,
        "content": text_summary,
    })
    if image_b64 and model in VISION_CAPABLE_MODELS:
        ollama_messages.append({
            "role": "user",
            "content": "Here is the screenshot you just requested.",
            "images": [image_b64],
        })


async def _run_generation_loop(
    conn,
    conversation_id: int,
    parent_id: int | None,
    model: str,
    sources: list[dict],
    query_text: str,
    ollama_messages: list[dict],
    settings,
    memories_collection,
    browser_service,
    full_response: str = "",
    tool_calls_executed: list[dict] | None = None,
    message_id: int | None = None,
    user_id: int | None = None,
) -> AsyncGenerator[dict, None]:
    """Drives the model<->tool loop and persists the result. Shared by fresh
    generation (message_id=None -> a new message row is created) and by
    resuming after a browser_act approval/denial (message_id=<the message the
    tool call is attached to> -> that row is updated in place instead of
    branching a sibling message)."""
    if tool_calls_executed is None:
        tool_calls_executed = []

    def _persist(text: str) -> int:
        nonlocal message_id
        if message_id is None:
            message_id = repository.add_message(
                conn, conversation_id, "assistant", text,
                parent_id=parent_id, sources=sources, model=model,
            )
        else:
            repository.update_message_content(conn, message_id, text)
            repository.set_active_leaf(conn, conversation_id, message_id)
        return message_id

    used_image_tool_last_round = False

    try:
        MAX_TOOL_ROUNDS = 15
        for _round in range(MAX_TOOL_ROUNDS):
            pending_tool_calls = []
            round_tokens = ""
            # A round right after generate_image/edit_image is buffered
            # instead of streamed live: gemma4:cloud in particular sometimes
            # echoes a malformed pseudo tool-call ({"action": ...,
            # "action_input": ...}) here instead of a normal reply, and once
            # tokens have streamed to the user there's no taking them back.
            # Buffering lets a bad one be swapped for a clean fallback first.
            buffer_this_round = used_image_tool_last_round

            # On the final round, don't supply tools schema so the model is forced to synthesize the final response
            schema_for_round = OLLAMA_TOOLS_SCHEMA if _round < MAX_TOOL_ROUNDS - 1 else None

            async for event in chat_stream_events(
                ollama_messages, model, settings.ollama_url, tools=schema_for_round
            ):
                if event["type"] == "content":
                    round_tokens += event["content"]
                    if not buffer_this_round:
                        full_response += event["content"]
                        yield {"type": "token", "content": event["content"]}
                elif event["type"] == "tool_calls":
                    pending_tool_calls.extend(event["tool_calls"])

            if buffer_this_round:
                cleaned = round_tokens
                stripped = round_tokens.strip()
                if stripped.startswith("{") and '"action"' in stripped and '"action_input"' in stripped:
                    cleaned = _latest_image_summary(tool_calls_executed) or "Here's the image."
                if cleaned:
                    full_response += cleaned
                    yield {"type": "token", "content": cleaned}

            if not pending_tool_calls:
                # Model output plain text without tool calls -> finished loop
                break

            # If tool calls were generated
            used_image_tool_last_round = False
            for tc in pending_tool_calls:
                function_info = tc.get("function", {})
                t_name = function_info.get("name")
                t_args = function_info.get("arguments", {})

                if t_name in MUTATING_TOOLS:
                    # Require user confirmation: yield confirm_required and stop loop
                    mid = _persist(full_response)
                    tc_id = repository.create_tool_call(
                        conn, mid, t_name, t_args, status="pending"
                    )
                    yield {
                        "type": "confirm_required",
                        "conversation_id": conversation_id,
                        "tool_call_id": tc_id,
                        "tool_name": t_name,
                        "description": t_args.get("description", "Perform browser actions"),
                        "steps": t_args.get("steps", []),
                    }
                    return

                # Auto-run tool
                yield {"type": "tool_call", "tool_name": t_name, "arguments": t_args}
                t_start = time.time()
                res = await execute_tool(
                    t_name, t_args, browser_service=browser_service,
                    conn=conn, conversation_id=conversation_id,
                )
                t_duration = round((time.time() - t_start) * 1000, 2)
                try:
                    trajectory_service.record_trajectory_step(
                        conn, str(conversation_id), None, t_name, t_args, res, t_duration
                    )
                except Exception:
                    pass

                # image_base64, when present, is a JPEG preview the frontend
                # renders inline so the user can see what the headless
                # browser navigated to -- kept in the display payload
                # (unlike the earlier approach of stripping it), since that's
                # the whole point of capturing it.
                res_for_display = dict(res)
                yield {"type": "tool_result", "tool_name": t_name, "result": res_for_display}

                _record_tool_result(ollama_messages, tc, t_name, model, res)
                tool_calls_executed.append({"name": t_name, "args": t_args, "result": res_for_display})
                if t_name in ("generate_image", "edit_image"):
                    used_image_tool_last_round = True

    except httpx.HTTPError as err:
        yield {
            "type": "error",
            "message": f"Model connection error: {err}. Please check if Ollama or internet cloud connection is active.",
        }
        return
    except (GeneratorExit, asyncio.CancelledError):
        if full_response:
            mid = _persist(full_response)
            extract_and_save_artifacts(conn, mid, full_response)
        raise

    if full_response:
        mid = _persist(full_response)

        # Save tool call records to database for this message
        for tc_item in tool_calls_executed:
            t_id = repository.create_tool_call(conn, mid, tc_item["name"], tc_item["args"], status="completed")
            repository.update_tool_call(conn, t_id, tc_item["result"], status="completed")

        # Parse & persist artifacts
        extract_and_save_artifacts(conn, mid, full_response)

        # Extract & persist memory in background
        asyncio.create_task(
            extract_and_save_memory(
                conn, memories_collection, settings, conversation_id, query_text, full_response,
                user_id=user_id,
            )
        )

        yield {
            "type": "done",
            "conversation_id": conversation_id,
            "message_id": mid,
            "sources": sources,
            "model": model,
        }


async def generate_reply(
    conn,
    collection,
    settings,
    conversation_id: int | None,
    user_message: str | None,
    model: str,
    parent_id=_UNSET,
    *,
    user_id: int,
    memories_collection=None,
    browser_service=None,
    document_ids: list[int] | None = None,
) -> AsyncGenerator[dict, None]:
    if model not in ALLOWED_MODELS:
        yield {"type": "error", "message": f"Unknown model: {model}"}
        return

    if conversation_id is None:
        title = (user_message or "New conversation")[:40]
        if user_message and len(user_message) > 40:
            title += "..."
        conversation_id = repository.create_conversation(conn, title, user_id)
        conversation = repository.get_conversation(conn, conversation_id)
    else:
        conversation = repository.get_conversation(conn, conversation_id)
        if not conversation or conversation["user_id"] != user_id:
            yield {"type": "error", "message": "Conversation not found."}
            return

    if user_message is not None:
        if parent_id is _UNSET:
            parent_id = conversation["active_leaf_id"] if conversation else None
        parent_id = repository.add_message(
            conn, conversation_id, "user", user_message, parent_id=parent_id
        )
    elif parent_id is _UNSET:
        parent_id = conversation["active_leaf_id"] if conversation else None

    if parent_id is None:
        yield {"type": "error", "message": "No message to generate a reply for."}
        return

    trigger_message = repository.get_message(conn, parent_id)
    query_text = trigger_message["content"] if trigger_message else ""

    ollama_messages, sources = await _build_ollama_messages(
        conn, collection, settings, memories_collection, query_text, parent_id,
        document_ids=document_ids,
        user_id=user_id,
        model=model,
    )

    # `async for` over a delegate generator doesn't forward athrow/aclose the
    # way `yield from` does for sync generators -- without the explicit
    # aclose() here, a CancelledError raised at our `yield event` propagates
    # straight out without ever reaching _run_generation_loop's own
    # try/except, so its partial-content persistence on cancellation never
    # runs.
    inner = _run_generation_loop(
        conn, conversation_id, parent_id, model, sources, query_text, ollama_messages,
        settings, memories_collection, browser_service,
        user_id=user_id,
    )
    try:
        async for event in inner:
            yield event
    finally:
        await inner.aclose()


async def resume_tool_reply(
    conn,
    collection,
    tool_call_id: int,
    approved: bool,
    settings,
    *,
    user_id: int,
    memories_collection=None,
    browser_service=None,
) -> AsyncGenerator[dict, None]:
    """Continues generation after a browser_act confirm_required pause: runs
    (or denies) the tool, feeds the result back to the model, and keeps
    streaming from there -- exactly what approving/denying was always
    supposed to do, rather than just flipping a status flag with no
    follow-through."""
    tool_call = repository.get_tool_call(conn, tool_call_id)
    if not tool_call or tool_call["status"] != "pending":
        yield {"type": "error", "message": "Tool call is not pending approval."}
        return

    message = repository.get_message(conn, tool_call["message_id"])
    if not message:
        yield {"type": "error", "message": "The paused message no longer exists."}
        return

    conversation = repository.get_conversation(conn, message["conversation_id"])
    if not conversation or conversation["user_id"] != user_id:
        yield {"type": "error", "message": "Tool call is not pending approval."}
        return

    conversation_id = message["conversation_id"]
    parent_id = message["parent_id"]
    model = message["model"]
    full_response = message["content"] or ""

    trigger_message = repository.get_message(conn, parent_id) if parent_id is not None else None
    query_text = trigger_message["content"] if trigger_message else ""

    ollama_messages, sources = await _build_ollama_messages(
        conn, collection, settings, memories_collection, query_text, parent_id,
        user_id=user_id,
    )

    t_name = tool_call["tool_name"]
    t_args = tool_call["arguments"] if isinstance(tool_call["arguments"], dict) else {}
    tc = {"function": {"name": t_name, "arguments": t_args}}

    tool_calls_executed = []

    if approved:
        res = await execute_tool(
            t_name, t_args, browser_service=browser_service,
            conn=conn, conversation_id=conversation_id,
        )
        status = "completed"
    else:
        res = {"success": False, "denied": True, "error": "The user denied this action; it was not performed."}
        status = "denied"

    res_for_display = dict(res)
    yield {"type": "tool_result", "tool_name": t_name, "result": res_for_display}

    repository.update_tool_call(conn, tool_call_id, res_for_display, status=status)
    _record_tool_result(ollama_messages, tc, t_name, model, res)
    tool_calls_executed.append({"name": t_name, "args": t_args, "result": res_for_display})

    inner = _run_generation_loop(
        conn, conversation_id, parent_id, model, sources, query_text, ollama_messages,
        settings, memories_collection, browser_service,
        full_response=full_response,
        tool_calls_executed=tool_calls_executed,
        message_id=message["id"],
        user_id=user_id,
    )
    try:
        async for event in inner:
            yield event
    finally:
        await inner.aclose()
