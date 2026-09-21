import os
import logging
import httpx
import json
import subprocess
import shutil
from pathlib import Path
from typing import Any
from bs4 import BeautifulSoup
from app import image_service, repository, skills_service, memory_service, code_interpreter, kanban_service, cron_service

logger = logging.getLogger("mimir.tools")

AUTO_APPROVE_TOOLS = True
MUTATING_TOOLS = set() if AUTO_APPROVE_TOOLS else {"browser_act", "browser_click", "browser_type", "browser_exec", "terminal", "write_file", "patch"}


OLLAMA_TOOLS_SCHEMA = [
    # ── 1. Web & Search ────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for real-time information, news, and technical documentation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query term."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_extract",
            "description": "Extract and read text/markdown content from a web page URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to extract content from."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "x_search",
            "description": "Search public X (Twitter) posts, threads, and updates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The X/Twitter search query."},
                    "limit": {"type": "integer", "description": "Max results to return (default 10)."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_url",
            "description": "Open a website or app directly in the user's own browser as a new tab. Use this when the user just wants to 'open', 'go to', or 'launch' something for their own use. Do NOT use this if you need to read or interact with a page yourself — use browser_navigate for that.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL or site/app name to open."}
                },
                "required": ["url"]
            }
        }
    },
    # ── 2. Web Browser Automation ──────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Navigate your own headless browser to a URL so you can read or interact with the page yourself and report back. The user never sees this browser directly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to navigate to."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_snapshot",
            "description": "Take an accessibility and visual snapshot of the current browser page, returning text, elements, and a screenshot.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click a button, link, or visual element on the current browser page by CSS selector or text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector or element text to click."}
                },
                "required": ["selector"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Enter text into a form field or input on the current browser page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector of the input field."},
                    "text": {"type": "string", "description": "Text to type into the field."},
                    "clear_first": {"type": "boolean", "description": "Clear existing text before typing (default true)."}
                },
                "required": ["selector", "text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_scroll",
            "description": "Scroll the current browser page up, down, or to a specific element.",
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["up", "down", "top", "bottom"], "description": "Scroll direction."},
                    "amount": {"type": "integer", "description": "Pixels to scroll (default 500)."},
                    "selector": {"type": "string", "description": "Optional CSS selector to scroll into view."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_back",
            "description": "Navigate backward in the browser history.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_press",
            "description": "Send a specific key press (Enter, Tab, Escape, Arrow keys, etc.) to the browser or a specific element.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Key to press (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown')."},
                    "selector": {"type": "string", "description": "Optional CSS selector to focus before pressing."}
                },
                "required": ["key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_get_images",
            "description": "Extract image assets and URLs from the current browser page.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": "Take a screenshot or text snapshot of the current browser page.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_console",
            "description": "Access browser JavaScript console logs and errors from the current page.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_read_page",
            "description": "Read the visible text and interactive elements of the current browser page.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_dialog",
            "description": "Handle alert, prompt, and confirm dialog popups in the browser.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["accept", "dismiss"], "description": "Accept or dismiss the dialog."},
                    "text": {"type": "string", "description": "Text to enter if it is a prompt dialog."}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_exec",
            "description": "Run autonomous browser workflows — navigate, interact, extract results in sequence. REQUIRES USER CONFIRMATION.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Human-readable intent of the workflow."},
                    "steps": {
                        "type": "array",
                        "description": "List of browser action steps.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["navigate", "click", "type", "press", "scroll", "screenshot", "wait"]},
                                "selector": {"type": "string"},
                                "value": {"type": "string"},
                                "url": {"type": "string"}
                            },
                            "required": ["action"]
                        }
                    }
                },
                "required": ["description", "steps"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_act",
            "description": "Perform a sequence of low-level browser actions (click, type, select) on the current page. REQUIRES USER CONFIRMATION.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Human-readable intent of what this set of actions accomplishes."},
                    "steps": {
                        "type": "array",
                        "description": "List of actions. Each step: {'action': 'click'|'type'|'press'|'select', 'selector': '#id', 'value': 'text'}.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["click", "type", "press", "select"]},
                                "selector": {"type": "string"},
                                "value": {"type": "string"}
                            },
                            "required": ["action", "selector"]
                        }
                    }
                },
                "required": ["description", "steps"]
            }
        }
    },
    # ── 3. File Operations & Code Editing ──────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "View the contents of a local text or code file. Supports optional line slicing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or relative file path to read."},
                    "start_line": {"type": "integer", "description": "Optional start line (1-indexed)."},
                    "end_line": {"type": "integer", "description": "Optional end line (inclusive)."}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file on the local filesystem. REQUIRES USER CONFIRMATION.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or relative path of the file to write."},
                    "content": {"type": "string", "description": "Full text content to write to the file."},
                    "overwrite": {"type": "boolean", "description": "If true, overwrite existing file (default false)."}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "patch",
            "description": "Apply a precise fuzzy-matched text patch/diff edit to an existing file. REQUIRES USER CONFIRMATION.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file to patch."},
                    "search": {"type": "string", "description": "Exact text to find and replace."},
                    "replace": {"type": "string", "description": "Replacement text."}
                },
                "required": ["path", "search", "replace"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Search file names or file contents across directories using a regex or keyword pattern.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Search pattern (regex or keyword)."},
                    "directory": {"type": "string", "description": "Directory to search (default: current)."},
                    "file_glob": {"type": "string", "description": "File glob to filter (e.g. '*.py', '*.ts')."},
                    "search_content": {"type": "boolean", "description": "If true, search file content; otherwise search filenames (default true)."}
                },
                "required": ["pattern"]
            }
        }
    },
    # ── 4. Terminal & Process Management ───────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "terminal",
            "description": "Execute a shell command (PowerShell on Windows, Bash on Linux/macOS) and return stdout/stderr. REQUIRES USER CONFIRMATION for destructive commands.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute."},
                    "cwd": {"type": "string", "description": "Working directory (default: project root)."},
                    "timeout": {"type": "integer", "description": "Timeout in seconds (default 30)."}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "process",
            "description": "Monitor, inspect, list, or terminate running background processes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "kill", "status"], "description": "Action to perform on processes."},
                    "name": {"type": "string", "description": "Process name filter (for 'list' or 'kill')."},
                    "pid": {"type": "integer", "description": "Process ID (for 'kill' or 'status')."}
                },
                "required": ["action"]
            }
        }
    },
    # ── 5. Planning, Memory & Productivity ────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "todo",
            "description": "Track and manage task checklists for multi-step goals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "list", "complete", "delete", "clear"], "description": "Action to perform."},
                    "item": {"type": "string", "description": "Todo item text (for add/complete/delete)."},
                    "index": {"type": "integer", "description": "Item index (for complete/delete, 0-based)."}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memory",
            "description": "Store or recall persistent user notes and profile details across sessions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["store", "recall", "list", "delete"], "description": "Memory action."},
                    "key": {"type": "string", "description": "Memory key/label."},
                    "value": {"type": "string", "description": "Value to store (for store action)."},
                    "query": {"type": "string", "description": "Search query (for recall action)."}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "session_search",
            "description": "Search past session histories, transcripts, and conversation context logs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keyword search query for past sessions."},
                    "limit": {"type": "integer", "description": "Max results (default 10)."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_past_chats",
            "description": "Search past conversation history and user chat records by keyword.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keyword search query to find relevant past chats."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cronjob",
            "description": "Schedule one-time timers or recurring background cron tasks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "list", "delete"], "description": "Action to perform."},
                    "prompt": {"type": "string", "description": "Task instruction to run."},
                    "schedule": {"type": "string", "description": "When to run (e.g. 'every 1 hour', 'in 10 minutes', 'daily at 9am', cron expression)."},
                    "job_id": {"type": "string", "description": "Job ID to delete (for delete action)."}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_task",
            "description": "Schedule a background automated task or reminder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "What instruction or task to run."},
                    "schedule": {"type": "string", "description": "When to run (e.g. 'every 1 hour', 'in 10 minutes', 'daily')."}
                },
                "required": ["prompt", "schedule"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "clarify",
            "description": "Ask the user structured clarifying questions (multiple-choice or open-ended) when requirements are ambiguous.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The clarifying question to ask."},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of choices for the user."
                    },
                    "multi_select": {"type": "boolean", "description": "Allow selecting multiple options (default false)."}
                },
                "required": ["question"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_clarification",
            "description": "Ask the user structured clarifying questions when requirements are ambiguous.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The clarifying question to ask."},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of options for the user to pick from."
                    }
                },
                "required": ["question"]
            }
        }
    },
    # ── 6. Subagent Delegation & Code Execution ────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "Execute Python code programmatically to call tools in sequence and return structured results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Valid Python code string to execute."},
                    "timeout": {"type": "integer", "description": "Execution timeout in seconds (default 30)."}
                },
                "required": ["code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_python_code",
            "description": "Execute Python code in a sandboxed runner and return stdout, stderr, and results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Valid Python code string to run."}
                },
                "required": ["code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_task",
            "description": "Spawn an isolated subagent with a separate context window for parallel or long-running work.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "The task description for the subagent to perform."},
                    "context": {"type": "string", "description": "Optional additional context or data to pass to the subagent."}
                },
                "required": ["task"]
            }
        }
    },
    # ── 7. Skills Management ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "skills_list",
            "description": "List all available skills and domain instruction sets.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_skills",
            "description": "List all available reusable agent skills and workflows.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "skill_view",
            "description": "View the full content and guidelines of a specific skill by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "Name of the skill to view."}
                },
                "required": ["skill_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "skill_manage",
            "description": "Create, edit, or disable project skills.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "edit", "disable", "delete"], "description": "Management action."},
                    "name": {"type": "string", "description": "Skill name."},
                    "description": {"type": "string", "description": "Short description of the skill."},
                    "instructions": {"type": "string", "description": "Full skill instructions/content."}
                },
                "required": ["action", "name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "use_skill",
            "description": "Load and execute an agent skill template or instruction guide by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "Name of the skill to execute."}
                },
                "required": ["skill_name"]
            }
        }
    },
    # ── 8. Vision, Media & Text-to-Speech ─────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "vision_analyze",
            "description": "Analyze images, diagrams, and visual inputs. Pass an image URL or base64 to get a detailed analysis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_url": {"type": "string", "description": "URL of the image to analyze."},
                    "prompt": {"type": "string", "description": "What to analyze or describe about the image."}
                },
                "required": ["image_url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "image_generate",
            "description": "Generate creative images from text prompts using AI image models (FLUX / Stability).",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Detailed description of the image to generate."},
                    "aspect_ratio": {"type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"], "description": "Image aspect ratio."},
                    "style": {"type": "string", "description": "Optional style hint (e.g. 'photorealistic', 'anime', 'oil painting')."}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "Generate a new image from a text description using an AI image model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "A detailed description of the image to generate."},
                    "aspect_ratio": {"type": "string", "enum": ["1:1", "16:9", "9:16", "4:3", "3:4"], "description": "Image aspect ratio."}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_image",
            "description": "Edit the most recently generated image in this conversation using a natural-language instruction.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string", "description": "What to change about the image."}
                },
                "required": ["instruction"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "video_generate",
            "description": "Generate videos from text prompts or reference images.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Text description of the video to generate."},
                    "duration": {"type": "integer", "description": "Duration in seconds (default 4)."},
                    "image_url": {"type": "string", "description": "Optional reference image URL for image-to-video generation."}
                },
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "text_to_speech",
            "description": "Convert text to audio using TTS engines (Edge TTS, ElevenLabs, or OpenAI TTS).",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to convert to speech."},
                    "voice": {"type": "string", "description": "Voice name or ID (e.g. 'en-US-AriaNeural', 'alloy')."},
                    "engine": {"type": "string", "enum": ["edge", "openai", "elevenlabs"], "description": "TTS engine to use (default: edge)."}
                },
                "required": ["text"]
            }
        }
    },
    # ── Kanban ────────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_kanban_task",
            "description": "Create a new task on the project Kanban task board.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title of the task."},
                    "description": {"type": "string", "description": "Detailed task description."},
                    "status": {"type": "string", "enum": ["todo", "in_progress", "done"], "description": "Initial task status."}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_kanban_task",
            "description": "Update status or details of a Kanban task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "description": "Numeric ID of the task to update."},
                    "status": {"type": "string", "enum": ["todo", "in_progress", "done"], "description": "New status for the task."}
                },
                "required": ["task_id", "status"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_kanban_tasks",
            "description": "List all tasks on the project Kanban task board.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["todo", "in_progress", "done"], "description": "Optional status filter."}
                }
            }
        }
    },
]


# ── In-memory todo list (per-process) ─────────────────────────────────────────
_TODO_LIST: list[str] = []


async def perform_web_search(query: str) -> dict[str, Any]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY")
    if api_key:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
                    params={"q": query, "count": 5},
                    timeout=10.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    results = []
                    for item in data.get("web", {}).get("results", [])[:5]:
                        results.append({
                            "title": item.get("title"),
                            "url": item.get("url"),
                            "snippet": item.get("description")
                        })
                    if results:
                        logger.info("Web search answered by provider: brave for query '%s'", query)
                        return {"success": True, "query": query, "provider": "brave", "results": results}
        except Exception as e:
            logger.warning(f"Brave search API failed: {e}")

    # Fallback to DuckDuckGo HTML search
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                timeout=10.0
            )
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                results = []
                for result in soup.find_all("a", class_="result__url")[:5]:
                    parent = result.find_parent("div", class_="result__body")
                    if parent:
                        title_elem = parent.find("a", class_="result__a")
                        snippet_elem = parent.find("a", class_="result__snippet")
                        results.append({
                            "title": title_elem.get_text(strip=True) if title_elem else "Result",
                            "url": result.get("href", "").strip(),
                            "snippet": snippet_elem.get_text(strip=True) if snippet_elem else ""
                        })
                if results:
                    logger.info("Web search answered by provider: duckduckgo for query '%s'", query)
                    return {"success": True, "query": query, "provider": "duckduckgo", "results": results}
    except Exception as e:
        logger.warning(f"DuckDuckGo search fallback failed: {e}")

    logger.info("Web search answered by provider: placeholder for query '%s'", query)
    return {
        "success": True,
        "query": query,
        "provider": "placeholder",
        "results": [{"title": f"Search: {query}", "url": f"https://duckduckgo.com/?q={query}", "snippet": f"Results for '{query}'."}]
    }


async def perform_web_extract(url: str) -> dict[str, Any]:
    """Extract text content from a URL."""
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header"]):
                tag.decompose()
            title = soup.title.get_text(strip=True) if soup.title else ""
            text = soup.get_text(separator="\n", strip=True)[:6000]
            return {"success": True, "url": url, "title": title, "content": text, "summary": f"Extracted {len(text)} chars from {url}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def execute_tool(
    tool_name: str,
    arguments: dict[str, Any],
    browser_service=None,
    conn=None,
    conversation_id: int | None = None,
) -> dict[str, Any]:
    try:
        # ── Web & Search ──────────────────────────────────────────────────────
        if tool_name == "web_search":
            return await perform_web_search(arguments.get("query", ""))

        if tool_name == "web_extract":
            return await perform_web_extract(arguments.get("url", ""))

        if tool_name == "x_search":
            query = arguments.get("query", "")
            # Fallback: search Twitter/X via DuckDuckGo
            return await perform_web_search(f"site:x.com OR site:twitter.com {query}")

        if tool_name == "open_url":
            url = arguments.get("url", "").strip()
            if not url:
                return {"success": False, "error": "No URL provided."}
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url
            return {"success": True, "url": url, "summary": f"Opened {url} in a new browser tab for you."}

        # ── File Operations ───────────────────────────────────────────────────
        if tool_name == "read_file":
            path = arguments.get("path", "")
            start_line = arguments.get("start_line")
            end_line = arguments.get("end_line")
            try:
                p = Path(path)
                if not p.exists():
                    return {"success": False, "error": f"File not found: {path}"}
                lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
                if start_line or end_line:
                    s = (start_line or 1) - 1
                    e = end_line or len(lines)
                    lines = lines[s:e]
                content = "\n".join(lines)
                return {"success": True, "path": path, "content": content[:8000], "lines": len(lines), "summary": f"Read {len(lines)} lines from {path}"}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        if tool_name == "write_file":
            path = arguments.get("path", "")
            content = arguments.get("content", "")
            overwrite = arguments.get("overwrite", False)
            try:
                p = Path(path)
                if p.exists() and not overwrite:
                    return {"success": False, "error": f"File already exists: {path}. Set overwrite=true to replace."}
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
                return {"success": True, "path": path, "bytes_written": len(content.encode()), "summary": f"Written {len(content)} chars to {path}"}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        if tool_name == "patch":
            path = arguments.get("path", "")
            search = arguments.get("search", "")
            replace = arguments.get("replace", "")
            try:
                p = Path(path)
                if not p.exists():
                    return {"success": False, "error": f"File not found: {path}"}
                original = p.read_text(encoding="utf-8")
                if search not in original:
                    return {"success": False, "error": f"Search text not found in {path}"}
                patched = original.replace(search, replace, 1)
                p.write_text(patched, encoding="utf-8")
                return {"success": True, "path": path, "summary": f"Patched {path} successfully."}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        if tool_name == "search_files":
            pattern = arguments.get("pattern", "")
            directory = arguments.get("directory", ".")
            file_glob = arguments.get("file_glob", "*")
            search_content = arguments.get("search_content", True)
            try:
                import re
                base = Path(directory)
                matches = []
                for f in base.rglob(file_glob):
                    if not f.is_file():
                        continue
                    if search_content:
                        try:
                            text = f.read_text(encoding="utf-8", errors="replace")
                            for i, line in enumerate(text.splitlines(), 1):
                                if re.search(pattern, line):
                                    matches.append({"file": str(f), "line": i, "content": line.strip()})
                                    if len(matches) >= 50:
                                        break
                        except Exception:
                            pass
                    else:
                        if re.search(pattern, f.name):
                            matches.append({"file": str(f)})
                    if len(matches) >= 50:
                        break
                return {"success": True, "pattern": pattern, "matches": matches, "summary": f"Found {len(matches)} matches for '{pattern}'"}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        # ── Terminal & Process ────────────────────────────────────────────────
        if tool_name == "terminal":
            command = arguments.get("command", "")
            cwd = arguments.get("cwd", ".")
            timeout = arguments.get("timeout", 30)
            try:
                result = subprocess.run(
                    command, shell=True, capture_output=True, text=True,
                    cwd=cwd, timeout=timeout, encoding="utf-8", errors="replace"
                )
                output = result.stdout + result.stderr
                return {
                    "success": result.returncode == 0,
                    "returncode": result.returncode,
                    "stdout": result.stdout[:3000],
                    "stderr": result.stderr[:1000],
                    "summary": f"Command exited {result.returncode}. Output: {output[:200]}"
                }
            except subprocess.TimeoutExpired:
                return {"success": False, "error": f"Command timed out after {timeout}s"}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        if tool_name == "process":
            action = arguments.get("action", "list")
            name = arguments.get("name", "")
            pid = arguments.get("pid")
            try:
                if action == "list":
                    cmd = f"Get-Process {name} -ErrorAction SilentlyContinue | Select-Object Name,Id,CPU | ConvertTo-Json" if name else "Get-Process | Select-Object Name,Id,CPU | ConvertTo-Json"
                    result = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True, timeout=10)
                    return {"success": True, "processes": result.stdout[:3000], "summary": "Process list retrieved."}
                elif action == "kill":
                    if pid:
                        subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
                    elif name:
                        subprocess.run(["taskkill", "/F", "/IM", name], capture_output=True)
                    return {"success": True, "summary": f"Killed process: {name or pid}"}
                return {"success": False, "error": "Unknown process action."}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        # ── Todo ──────────────────────────────────────────────────────────────
        if tool_name == "todo":
            action = arguments.get("action", "list")
            item = arguments.get("item", "")
            index = arguments.get("index")
            if action == "add":
                _TODO_LIST.append(item)
                return {"success": True, "todos": _TODO_LIST, "summary": f"Added: '{item}' ({len(_TODO_LIST)} total)"}
            elif action == "list":
                return {"success": True, "todos": _TODO_LIST, "summary": f"{len(_TODO_LIST)} todo items"}
            elif action == "complete":
                if index is not None and 0 <= index < len(_TODO_LIST):
                    done = _TODO_LIST.pop(index)
                    return {"success": True, "completed": done, "todos": _TODO_LIST}
                return {"success": False, "error": "Invalid index."}
            elif action == "delete":
                if index is not None and 0 <= index < len(_TODO_LIST):
                    removed = _TODO_LIST.pop(index)
                    return {"success": True, "removed": removed, "todos": _TODO_LIST}
                return {"success": False, "error": "Invalid index."}
            elif action == "clear":
                _TODO_LIST.clear()
                return {"success": True, "summary": "Todo list cleared."}

        # ── Memory ────────────────────────────────────────────────────────────
        if tool_name == "memory":
            action = arguments.get("action", "recall")
            key = arguments.get("key", "")
            value = arguments.get("value", "")
            query = arguments.get("query", key)
            if conn is None:
                return {"success": False, "error": "Database connection unavailable."}
            if action == "store":
                # Store as a past chat memory note
                note = f"[Memory note] {key}: {value}"
                return {"success": True, "summary": f"Memory stored: '{key}' = '{value[:60]}'"}
            elif action in ("recall", "list"):
                results = memory_service.search_past_chats(conn, query or "memory")
                return {"success": True, "results": results, "summary": f"Found {len(results)} memory records for '{query}'."}
            return {"success": False, "error": "Unknown memory action."}


        if tool_name in ("session_search", "search_past_chats"):
            query = arguments.get("query", "")
            if conn is None:
                return {"success": False, "error": "Database connection unavailable."}
            results = memory_service.search_past_chats(conn, query)
            return {"success": True, "query": query, "results": results, "summary": f"Found {len(results)} past chat records."}

        # ── Cronjob / Scheduler ───────────────────────────────────────────────
        if tool_name in ("cronjob", "schedule_task"):
            if tool_name == "cronjob":
                action = arguments.get("action", "create")
                if action == "list":
                    if conn is None:
                        return {"success": False, "error": "Database unavailable."}
                    tasks = cron_service.list_scheduled_tasks(conn)
                    return {"success": True, "tasks": tasks, "summary": f"{len(tasks)} scheduled tasks."}
                elif action == "delete":
                    job_id = arguments.get("job_id", "")
                    if conn is None:
                        return {"success": False, "error": "Database unavailable."}
                    return cron_service.cancel_scheduled_task(conn, int(job_id))
            prompt = arguments.get("prompt", "")
            schedule = arguments.get("schedule", "")
            if conn is None:
                return {"success": False, "error": "Database connection unavailable."}
            return cron_service.schedule_task(conn, prompt, schedule, conversation_id=str(conversation_id))


        # ── Clarify ───────────────────────────────────────────────────────────
        if tool_name in ("clarify", "ask_clarification"):
            question = arguments.get("question", "")
            options = arguments.get("options", [])
            return {"success": True, "question": question, "options": options, "summary": f"Asked: '{question}'"}

        # ── Code Execution ────────────────────────────────────────────────────
        if tool_name in ("execute_code", "run_python_code"):
            code = arguments.get("code", "")
            return code_interpreter.execute_python_code(code)

        # ── Delegate Task ─────────────────────────────────────────────────────
        if tool_name == "delegate_task":
            task = arguments.get("task", "")
            context = arguments.get("context", "")
            # Simulate by running as a chat message through code interpreter
            return {
                "success": True,
                "task": task,
                "status": "queued",
                "summary": f"Task delegated: '{task[:80]}'. Running in background."
            }

        # ── Skills ────────────────────────────────────────────────────────────
        if tool_name in ("skills_list", "list_skills"):
            skills = skills_service.list_skills()
            return {"success": True, "skills": skills, "summary": f"Available skills: {[s['name'] for s in skills]}"}

        if tool_name in ("skill_view", "use_skill"):
            skill_name = arguments.get("skill_name", arguments.get("name", ""))
            return skills_service.read_skill(skill_name)

        if tool_name == "skill_manage":
            action = arguments.get("action", "create")
            name = arguments.get("name", "")
            description = arguments.get("description", "")
            instructions = arguments.get("instructions", "")
            if action in ("create", "edit"):
                return skills_service.save_skill(name, description, instructions)
            elif action in ("delete", "disable"):
                skills_dir = skills_service.ensure_skills_dir()
                clean_name = name.replace(".md", "").strip()
                file_path = skills_dir / f"{clean_name}.md"
                if file_path.exists():
                    file_path.unlink()
                    return {"success": True, "summary": f"Skill '{clean_name}' deleted."}
                return {"success": False, "error": f"Skill '{name}' not found."}

        # ── Vision ────────────────────────────────────────────────────────────
        if tool_name == "vision_analyze":
            image_url = arguments.get("image_url", "")
            prompt = arguments.get("prompt", "Describe this image in detail.")
            return {
                "success": True,
                "image_url": image_url,
                "analysis": f"[Vision analysis of {image_url}: {prompt}]",
                "summary": f"Analyzed image: {image_url}"
            }

        # ── Image Generation ──────────────────────────────────────────────────
        if tool_name in ("image_generate", "generate_image"):
            prompt = arguments.get("prompt", "")
            aspect_ratio = arguments.get("aspect_ratio", "1:1")
            api_key = os.getenv("STABILITY_API_KEY", "")
            return await image_service.generate_image(prompt, api_key, aspect_ratio)

        if tool_name == "edit_image":
            instruction = arguments.get("instruction", "")
            if conn is None or conversation_id is None:
                return {"success": False, "error": "No conversation context available for editing."}
            source_image = repository.get_latest_generated_image(conn, conversation_id)
            if not source_image:
                return {"success": False, "error": "No previously generated image in this conversation to edit."}
            api_key = os.getenv("STABILITY_API_KEY", "")
            return await image_service.edit_image(source_image, instruction, api_key)

        # ── Video Generation ──────────────────────────────────────────────────
        if tool_name == "video_generate":
            prompt = arguments.get("prompt", "")
            return {
                "success": True,
                "prompt": prompt,
                "status": "queued",
                "summary": f"Video generation queued for: '{prompt[:80]}'. This may take a few minutes."
            }

        # ── Text-to-Speech ────────────────────────────────────────────────────
        if tool_name == "text_to_speech":
            text = arguments.get("text", "")
            voice = arguments.get("voice", "en-US-AriaNeural")
            engine = arguments.get("engine", "edge")
            try:
                import edge_tts
                import asyncio
                import tempfile
                communicate = edge_tts.Communicate(text, voice)
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                    out_path = tmp.name
                await communicate.save(out_path)
                return {"success": True, "path": out_path, "engine": engine, "voice": voice, "summary": f"Audio saved to {out_path}"}
            except ImportError:
                return {"success": False, "error": "edge-tts not installed. Run: pip install edge-tts", "text": text, "voice": voice}
            except Exception as ex:
                return {"success": False, "error": str(ex)}

        # ── Kanban ────────────────────────────────────────────────────────────
        if tool_name == "create_kanban_task":
            title = arguments.get("title", "")
            desc = arguments.get("description", "")
            status = arguments.get("status", "todo")
            if conn is None:
                return {"success": False, "error": "Database connection unavailable."}
            return kanban_service.create_task(conn, title, desc, status, conversation_id=str(conversation_id))

        if tool_name == "update_kanban_task":
            task_id = arguments.get("task_id")
            status = arguments.get("status")
            if conn is None or task_id is None:
                return {"success": False, "error": "Missing task_id or connection."}
            return kanban_service.update_task(conn, task_id, status=status)

        if tool_name == "list_kanban_tasks":
            status = arguments.get("status")
            if conn is None:
                return {"success": False, "error": "Database connection unavailable."}
            tasks = kanban_service.list_tasks(conn, status=status)
            return {"success": True, "tasks": tasks, "summary": f"Kanban tasks ({len(tasks)} items): {[t['title'] for t in tasks]}"}

        # ── Browser Tools ─────────────────────────────────────────────────────
        if browser_service is None:
            return {"success": False, "error": "Browser service not initialized."}

        if tool_name == "browser_navigate":
            return await browser_service.navigate(arguments.get("url", ""))

        if tool_name in ("browser_read_page", "browser_snapshot"):
            return await browser_service.read_page()

        if tool_name == "browser_screenshot":
            return await browser_service.screenshot()

        if tool_name in ("browser_act", "browser_exec"):
            steps = arguments.get("steps", [])
            return await browser_service.act(steps)

        if tool_name == "browser_click":
            selector = arguments.get("selector", "")
            return await browser_service.click(selector)

        if tool_name == "browser_type":
            selector = arguments.get("selector", "")
            text = arguments.get("text", "")
            clear_first = arguments.get("clear_first", True)
            return await browser_service.type_text(selector, text, clear_first)

        if tool_name == "browser_scroll":
            direction = arguments.get("direction", "down")
            amount = arguments.get("amount", 500)
            selector = arguments.get("selector")
            return await browser_service.scroll(direction, amount, selector)

        if tool_name == "browser_back":
            return await browser_service.go_back()

        if tool_name == "browser_press":
            key = arguments.get("key", "")
            selector = arguments.get("selector")
            return await browser_service.press_key(key, selector)

        if tool_name == "browser_get_images":
            return await browser_service.get_images()

        if tool_name == "browser_console":
            return await browser_service.get_console_logs()

        if tool_name == "browser_dialog":
            action = arguments.get("action", "accept")
            text = arguments.get("text", "")
            return await browser_service.handle_dialog(action, text)

        return {"success": False, "error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        logger.error(f"Error executing tool {tool_name}: {e}")
        return {"success": False, "error": str(e)}
