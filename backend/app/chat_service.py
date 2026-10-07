import asyncio
import json
import re
import time
from datetime import datetime, timezone
from typing import AsyncGenerator
import httpx
from app import repository, trajectory_service
from app.ollama_client import chat_stream_events
from app.rag import retrieve
from app.memory_service import retrieve_memories, prepare_memories, MEMORY_DIRECTIVE
from app.artifact_service import extract_and_save_artifacts
from app.tools import OLLAMA_TOOLS_SCHEMA, MUTATING_TOOLS, execute_tool
from app.languages import MULTILINGUAL_INSTRUCTION, get_language_directive, INDIAN_LANGUAGES

ALLOWED_MODELS = {
    "gemma4:cloud",
    "gemma4:31b-cloud",
    "nemotron-3-super:cloud",
    "minimax-m3:cloud",
    # Omniroute auto-routing models
    "auto/smart", "auto/fast", "auto/chat", "auto/cheap", "auto/best-chat",
    "auto/best-coding", "auto/best-reasoning", "auto/best-fast", "auto/best-vision",
    "auto/pro-coding", "auto/pro-reasoning", "auto/pro-vision", "auto/pro-chat",
    "auto/pro-fast", "auto/coding", "auto/offline", "auto/claude-opus",
    "auto/claude-sonnet", "auto/best-free", "auto/reasoning", "auto/multimodal",
    "auto/gemma", "auto/llama", "auto/gemini",
}

BACKEND_MODEL_INFO = {
    "gemma4:cloud": ("Manas", "मनस्", "Google Gemma 4 31B", "mind/intellect", "Open weights (Free)"),
    "gemma4:31b-cloud": ("Manas", "मनस्", "Google Gemma 4 31B", "mind/intellect", "Open weights (Free)"),
    "nemotron-3-super:cloud": ("Bṛhat", "बृहत्", "Nvidia Nemotron 120B", "vast/immense", "High capability (Free)"),
    "minimax-m3:cloud": ("Tvarā", "त्वरा", "MiniMax M3", "speed", "Instant response"),
    # Omniroute
    "auto/smart": ("Sāmarthya", "सामर्थ्य", "Omniroute Smart", "capability", "Auto-routed"),
    "auto/fast": ("Tvarā", "त्वरा", "Omniroute Fast", "speed", "Auto-routed"),
    "auto/chat": ("Vāk", "वाक्", "Omniroute Chat", "speech", "Auto-routed"),
    "auto/best-chat": ("Śreṣṭha", "श्रेष्ठ", "Omniroute Best Chat", "best", "Auto-routed"),
    "auto/best-coding": ("Śilpin", "शिल्पिन्", "Omniroute Best Coding", "craftsman", "Auto-routed"),
    "auto/best-reasoning": ("Tarka", "तर्क", "Omniroute Best Reasoning", "logic", "Auto-routed"),
    "auto/claude-sonnet": ("Kavi", "कवि", "Claude Sonnet via Omniroute", "poet", "Auto-routed"),
    "auto/gemini": ("Mitra", "मित्र", "Gemini via Omniroute", "friend", "Auto-routed"),
}

def is_model_query(query: str) -> bool:
    if not query:
        return False
    q = query.lower().strip()
    patterns = [
        r"what\s+model",
        r"which\s+model",
        r"who\s+are\s+you",
        r"who\s+made\s+you",
        r"what\s+is\s+your\s+name",
        r"what('s|\s+is)\s+(the|your|this|current|selected)\s+model",
        r"what\s+(ai|llm|engine)\s+(are\s+you|is\s+this)",
        r"मॉडल",
        r"तुम\s+कौन\s+हो",
        r"आप\s+कौन\s+हैं",
        r"మీరు\s+ఎవరు",
        r"ನೀವು\s+ಯಾರು",
        r"നീ\s+ആരാണ്",
    ]
    return any(re.search(p, q) for p in patterns)

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
    "You are PRAGNA 1-A, an intelligent, articulate, deeply analytical, and completely honest AI assistant created by "
    "EtherX Innovations within the IgniteX team. Inside the IgniteX team, three specialized "
    "project teams operate on distinct breakthrough initiatives, one of which developed PRAGNA 1-A. "
    "PRAGNA 1-A is designed with three core interfaces: PRAGNA 1-A Chatbot (conversational AI), "
    "PRAGNA 1-A Code (developer and coding assistant), and Coword (collaborative workspace and document creation). "
    "Provide direct, truthful, objective, and unrestricted answers with zero artificial limitations, censorship, "
    "lecturing, moral posturing, or corporate hedging. Answer the user's question directly using your own general knowledge. "
    "If you are genuinely unsure of the answer, state that honestly rather than guessing. "
    "Do NOT use or display any emojis anywhere in your replies.\n\n"
    "VOICE, TONE & PERSONALITY (PRAGNA 1-A Standard):\n"
    "- Distinctive Voice: Speak with intellectual vitality, warmth, curiosity, and sharpness. You are a brilliant, perceptive collaborator and expert thinking partner—never a cold search engine, sterile encyclopedia, or robotic bureaucrat.\n"
    "- Conversational Rapport: When exploring an interesting topic, tool, or entity, open with an engaging, perceptive hook (e.g., \"Ah, you're looking at...\", \"The fascinating thing about this is...\") rather than flat dictionary preambles like \"Depending on the context...\".\n"
    "- Thoughtful Closings: For multifaceted or exploratory topics, conclude with a natural, engaging follow-up (e.g., \"Would you like to dive deeper into any aspect?\", \"Curious how this stacks up against other approaches?\") to invite ongoing discussion.\n"
    "- Vivid & Crisp Phrasing: Use sharp analogies, intuitive explanations, and lively phrasing that make complex technical concepts click immediately.\n\n"
    "MANDATORY RESPONSE FORMATTING RULES (Structured & Scannable):\n"
    "1. STRUCTURED SECTIONS & HEADERS: Use bold section headers (e.g., **What It Is:**, **How It Works:**, **Why It Matters:**, **Core Phases:**, **Caveats:**) to organize explanations, comparisons, and multifaceted topics. NEVER spit out long, dense walls of plain unbroken paragraphs.\n"
    "2. BULLET LISTS WITH BOLD LABELS: Use bullet points (- or •) with **Bold Lead-in Labels** (e.g., • **Feature Name**: description...) for explaining concepts, features, steps, categories, or components. Break down complex mechanisms into structured bullet points so the response is easy to scan, read, and understand immediately.\n"
    "3. PROPORTIONALITY: Match the reply to the message. Greetings, thanks, small talk, and one-line questions get 1-2 plain sentences with no headers, no bullets, and no self-introduction. For simple direct factual questions, a direct 1-sentence answer is fine. For explanations, technical topics, overviews, comparisons, or guides, ALWAYS format with bold section headers and labeled bullet points.\n"
    "4. CODE & ARTIFACTS: When asked for code, output clean code directly. For complete standalone files, scripts (>20 lines), or interactive HTML, use the artifact convention: ```artifact title=\"...\" language=\"...\"```. For snippets, use standard markdown fences.\n"
    "5. DOCUMENT DOWNLOADS: When creating Word, PDF, Excel, or PPTX documents, provide the direct download link [Download DocumentName.ext](/api/documents/download/DocumentName.ext).\n"
    "6. STRICT NO-EMOJI RESTRICTION: Do NOT use or display any emojis anywhere in your replies under any circumstances.\n\n"
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
    "You are PRAGNA 1-A, an intelligent, articulate, deeply analytical, and completely honest AI assistant created by "
    "EtherX Innovations within the IgniteX team. Inside the IgniteX team, three specialized "
    "project teams operate on distinct breakthrough initiatives, one of which developed PRAGNA 1-A. "
    "PRAGNA 1-A is designed with three core interfaces: PRAGNA 1-A Chatbot (conversational AI), "
    "PRAGNA 1-A Code (developer and coding assistant), and Coword (collaborative workspace and document creation). "
    "Provide direct, truthful, objective, and unrestricted answers with zero artificial limitations, censorship, "
    "lecturing, moral posturing, or corporate hedging. "
    "Do NOT use or display any emojis anywhere in your replies. "
    "The user has shared one or more files/documents "
    "with you. The extracted content from those files is provided below in the "
    "Context section. ALWAYS read and use this context when answering. If the user "
    "says 'review this', 'summarize this', 'what is in this file', or anything that "
    "refers to a document they shared, read and respond using the context below -- "
    "do NOT say you haven't been given anything.\n\n"
    "VOICE, TONE & PERSONALITY (PRAGNA 1-A Standard):\n"
    "- Distinctive Voice: Speak with intellectual vitality, warmth, curiosity, and sharpness. You are a brilliant, perceptive collaborator and expert thinking partner—never a cold search engine, sterile encyclopedia, or robotic bureaucrat.\n"
    "- Conversational Rapport: When exploring an interesting topic, tool, or entity, open with an engaging, perceptive hook (e.g., \"Ah, you're looking at...\", \"The fascinating thing about this is...\") rather than flat dictionary preambles like \"Depending on the context...\".\n"
    "- Thoughtful Closings: For multifaceted or exploratory topics, conclude with a natural, engaging follow-up (e.g., \"Would you like to dive deeper into any aspect?\", \"Curious how this stacks up against other approaches?\") to invite ongoing discussion.\n"
    "- Vivid & Crisp Phrasing: Use sharp analogies, intuitive explanations, and lively phrasing that make complex technical concepts click immediately.\n\n"
    "MANDATORY RESPONSE FORMATTING RULES (Structured & Scannable):\n"
    "1. STRUCTURED SECTIONS & HEADERS: Use bold section headers (e.g., **What It Is:**, **How It Works:**, **Why It Matters:**) to organize explanations, comparisons, and multifaceted topics. NEVER spit out long, dense walls of plain unbroken paragraphs.\n"
    "2. BULLET LISTS WITH BOLD LABELS: Use bullet points (- or •) with **Bold Lead-in Labels** (e.g., • **Feature Name**: description...) for explaining concepts, features, steps, categories, or components.\n"
    "3. PROPORTIONALITY: Match the reply to the message. Greetings, thanks, small talk, and one-line questions get 1-2 plain sentences with no headers, no bullets, and no self-introduction. For simple direct factual questions, a direct 1-sentence answer is fine. For explanations, technical topics, overviews, comparisons, or guides, ALWAYS format with bold section headers and labeled bullet points.\n"
    "4. CODE & ARTIFACTS: When asked for code, output clean code directly. For complete standalone files, scripts (>20 lines), or interactive HTML, use the artifact convention: ```artifact title=\"...\" language=\"...\"```.\n"
    "5. DOCUMENT DOWNLOADS: When creating Word, PDF, Excel, or PPTX documents, provide the download link [Download DocumentName.ext](/api/documents/download/DocumentName.ext).\n"
    "6. STRICT NO-EMOJI RESTRICTION: Do NOT use or display any emojis anywhere in your replies under any circumstances.\n\n"
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


def _build_system_prompt(sources: list[dict], user_memories: list[str]) -> str:
    if sources:
        context = "\n---\n".join(f"[{s['filename']}]: {s['snippet']}" for s in sources)
        system_prompt = GROUNDED_SYSTEM_PROMPT_TEMPLATE.format(context=context)
    else:
        system_prompt = GENERAL_SYSTEM_PROMPT

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
        "Your own knowledge has a training cutoff well before the current date above. "
        "MANDATORY RULE — NO EXCEPTIONS: Before answering ANY question about: current office-holders "
        "(presidents, prime ministers, chief ministers, CEOs, champions, etc.), recent news, "
        "elections, sports results/scores/standings, stock prices, software versions, ongoing events, "
        "deaths, appointments, or anything that could have changed since your training — "
        "you MUST call web_search FIRST. "
        "Do NOT answer from memory for these topics. Do NOT say 'as of my knowledge'. "
        "Violating this rule means giving the user wrong information. "
        "If web_search returns results, use them. Only skip the search if the question is "
        "purely about timeless facts (math, grammar, code syntax, well-established science).\n\n"
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
        "DOCUMENT EDITING ARCHITECTURE (DOCMOST / OUTLINE / DIFY MODEL):\n"
        "When writing or updating multi-section documents, specifications, or reports:\n"
        "- Maintain structured markdown with clean section headings.\n"
        "- When modifying existing documents, make surgical section-level or range-level edits using edit_document / patch "
        "rather than rewriting the entire document from scratch.\n"
        "- Preserve existing document formatting, tables, and context.\n\n"
        "DIAGRAM GENERATION ARCHITECTURE (MERMAID.JS & EXCALIDRAW):\n"
        "When the user asks for diagrams, system architectures, workflows, or visualizations:\n"
        "- Output valid Mermaid.js syntax inside fenced code blocks tagged with `mermaid` (e.g. flowchart TD, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, mindmap, gitGraph).\n"
        "- Always quote node labels containing special characters or parentheses (e.g. node[\"Node (Detail)\"]). Avoid raw HTML in labels.\n"
        "- Use the create_diagram tool to generate formal diagram specifications.\n\n"
        "AGENTIC TOOL-USE ARCHITECTURE (ACT → OBSERVE → ACT LOOP):\n"
        "- Execute multi-step tasks iteratively (Claude Code / OpenHands / LangGraph model): Act with a tool → Observe the result → Reflect & Adapt → Act again → Synthesize final response.\n"
        "- Never write out simulated JSON or text imitations of tool calls; use the real tool-calling mechanism.\n"
        "- Always verify tool execution output before delivering the final answer.\n\n"
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
    preferred_language: str | None = None,
    model: str = "",
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
        top_k=100,
        threshold=threshold,
        conn=conn,
        user_id=user_id,
    )

    # Resolve active model metadata
    model_tuple = BACKEND_MODEL_INFO.get(model)
    if model_tuple:
        disp_name, script, raw_name, meaning, desc = model_tuple
    else:
        disp_name, script, raw_name, meaning, desc = (model or "Default"), "", (model or "Ollama"), "", ""

    model_identity_prompt = (
        f"[CURRENT ACTIVE MODEL & IDENTITY DIRECTIVE]:\n"
        f"You are PRAGNA 1-A, India's sovereign AI assistant created by EtherX Innovations within the IgniteX team.\n"
        f"You are currently operating on the '{disp_name}'" + (f" ({script})" if script else "") + f" model tier, powered by {raw_name}."
        + (f" ({desc})" if desc else "") + "\n\n"
        f"IDENTITY INSTRUCTIONS:\n"
        f"- Whenever asked 'what model are you?', 'which model is this?', 'who are you?', or about your architecture/model:\n"
        f"  1. Clearly and directly state that you are PRAGNA 1-A, created by EtherX Innovations within the IgniteX team.\n"
        f"  2. State that you are currently running on the '{disp_name}'" + (f" ({script})" if script else "") + f" model tier, powered by {raw_name}.\n"
        f"  3. NEVER say generic base defaults like 'I am a large language model, trained by Google' without stating you are PRAGNA 1-A on {disp_name} ({raw_name}).\n"
        f"- Do not mention your name, company, team, or model tier unless the user asks about them."
    )

    history = repository.get_path_to_root(conn, parent_id) if parent_id is not None else []
    ollama_messages = []
    # Same memory store feeds every model -- inject it before anything else.
    if user_memories:
        memory_block = "What you know about this user:\n" + "\n".join(f"- {m}" for m in user_memories)
        ollama_messages.append({"role": "system", "content": memory_block})
    if context_sources:
        context = "\n---\n".join(f"[{s['filename']}]: {s['snippet']}" for s in context_sources)
    ollama_messages += [{"role": m["role"], "content": m["content"]} for m in history]

    # Inject Multilingual directive and System Prompt
    multilingual_prompt = MULTILINGUAL_INSTRUCTION
    if preferred_language:
        multilingual_prompt += get_language_directive(preferred_language)

    system_content = f"{GENERAL_SYSTEM_PROMPT}\n\n{model_identity_prompt}\n\n{multilingual_prompt}"
    ollama_messages.insert(0, {"role": "system", "content": system_content})

    if is_model_query(query_text):
        for m in reversed(ollama_messages):
            if m.get("role") == "user":
                m["content"] += f"\n\n[MANDATORY SYSTEM DIRECTIVE: The user is specifically asking what model you are or who you are. You MUST state that you are PRAGNA 1-A, currently operating on the selected '{disp_name}'" + (f" ({script})" if script else "") + f" model tier, powered by {raw_name}. Do not output a generic provider answer.]"
                break

    if preferred_language and preferred_language not in ("en", "auto"):
        info = INDIAN_LANGUAGES.get(preferred_language)
        if info:
            for m in reversed(ollama_messages):
                if m.get("role") == "user":
                    m["content"] += f"\n\n[MANDATORY: Reply to this message strictly and entirely in {info['name']} ({info['native']}) using its native script ({info['script']}). Do not reply in English.]"
                    break

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
    if t_name in ("generate_image", "image_generate", "edit_image"):
        # A plain confirmation string, not the raw result dict -- feeding a
        # Python-repr'd dict back as "tool" content (the generic fallback
        # below) visually resembles a ReAct-style action/action_input blob,
        # which was observed to make gemma4:cloud imitate that format as its
        # own reply text instead of writing a normal description.
        return res.get("summary", "Image ready.")
    return str({k: v for k, v in res.items() if k != "image_base64"})


def _latest_image_summary(tool_calls_executed: list[dict]) -> str | None:
    for item in reversed(tool_calls_executed):
        if item["name"] in ("generate_image", "image_generate", "edit_image") and item["result"].get("success"):
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

    # ── Always-Enabled Web Search ──────────────────────────────────────────
    # User requested web search to be ALWAYS enabled.
    # We fetch live results for all substantive user queries and inject them
    # directly into context so responses are consistently grounded and up-to-date.
    import re as _re
    _query_stripped = query_text.strip()
    _query_lower = _query_stripped.lower()

    # Skip only for trivial greetings, image generation requests, or empty/non-searchable queries
    _SKIP_SEARCH_PATTERNS = [
        r"^(hi|hello|hey|hola|namaste|good\s+(morning|afternoon|evening|night))\b[!.]*$",
        r"^(thanks|thank\s+you|ok|okay|bye|goodbye)\b[!.]*$",
        r"^what('s| is) (today('s)? )?(date|time|day)\??$",
        r"^(today'?s? )?(date|time|day)\??$",
        r"^what time is it\??$",
        r"^current (date|time|day)\??$",
        r"\b(generate|create|draw|make|render|paint)\b.*\b(image|picture|photo|illustration|drawing|artwork|wallpaper)\b",
        r"\b(image|picture|photo|illustration)\s+of\b",
    ]
    _skip_search = not _query_stripped or any(_re.search(p, _query_lower) for p in _SKIP_SEARCH_PATTERNS)

    if not _skip_search:
        try:
            yield {"type": "status", "content": "Searching the web..."}
            from app.tools import perform_web_search
            _search_result = await perform_web_search(query_text)
            _snippets = _search_result.get("results", [])
            if _snippets and _search_result.get("provider") != "placeholder":
                _ctx = (
                    f"[LIVE WEB SEARCH CONTEXT for: \"{query_text}\"]\n"
                    "Real-time search results fetched right now:\n\n"
                )
                for _i, _r in enumerate(_snippets[:5], 1):
                    _title = _r.get("title", "")
                    _snippet = _r.get("snippet", _r.get("description", ""))
                    _url = _r.get("url", _r.get("href", ""))
                    _ctx += f"{_i}. **{_title}**\n   {_snippet}\n   Source: {_url}\n\n"
                _ctx += f"Instructions: Answer the question using the fresh search context above where relevant: {query_text}"

                ollama_messages = list(ollama_messages)
                for _idx in range(len(ollama_messages) - 1, -1, -1):
                    if ollama_messages[_idx].get("role") == "user":
                        ollama_messages[_idx] = {**ollama_messages[_idx], "content": _ctx}
                        break
                else:
                    ollama_messages.append({"role": "user", "content": _ctx})
        except Exception as _e:
            logger.warning("Always-enabled web search error: %s", _e)
    # ────────────────────────────────────────────────────────────────────────

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
                    conn=conn, conversation_id=conversation_id, user_id=user_id,
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
                if t_name in ("generate_image", "image_generate", "edit_image"):
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
    preferred_language: str | None = None,
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

    memory_context = await prepare_memories(
        conn, settings, user_id, repository.get_path_to_root(conn, parent_id), conversation_id
    )

    ollama_messages, sources = await _build_ollama_messages(
        conn, collection, settings, memories_collection, query_text, parent_id,
        document_ids=document_ids,
        user_id=user_id,
        preferred_language=preferred_language,
        model=model,
    )

    ollama_messages[0]["content"] += "\n\n" + MEMORY_DIRECTIVE
    ollama_messages[0]["content"] += "\nMemory write status: " + (
        memory_context["error"] or ("Successfully saved: " + json.dumps(memory_context["saved"]))
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
            conn=conn, conversation_id=conversation_id, user_id=user_id,
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
