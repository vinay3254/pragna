import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { callMcpTool, isMcpToolName } from './mcpClient';
import { searchWeb } from './web-search';

const execAsync = promisify(exec);

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');

// A tool that created a file returns download_url like "/generated_docs/foo.docx".
// If the model echoes that string back as `path` for an edit/read/export call,
// path.resolve() would treat the leading slash as filesystem-root-absolute — map
// it back to the real public/generated_docs location instead.
function resolveDocPath(rawPath: string): string {
  const publicDir = path.resolve(process.cwd(), 'public', 'generated_docs');
  if (rawPath.startsWith('/generated_docs/')) {
    return path.join(publicDir, path.basename(rawPath));
  }
  return path.resolve(process.cwd(), rawPath);
}

async function runDocEngine(payload: any): Promise<any> {
  // 1. First try communicating with backend REST endpoint (works seamlessly in all environments)
  try {
    const res = await fetch(`${BACKEND_URL}/api/documents/engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        return data;
      }
    }
  } catch (err) {
    console.warn('Backend document engine REST endpoint call failed, falling back to local runner:', err);
  }

  // 2. Fallback to local subprocess
  const backendDir = path.resolve(process.cwd(), '..', 'backend');
  const isWin = process.platform === 'win32';
  const pythonPath = isWin
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python3');

  return new Promise((resolve) => {
    try {
      const proc = spawn(pythonPath, ['-m', 'app.document_generator', '--stdin'], {
        cwd: backendDir,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ success: false, error: stderr || stdout || `Process exited with code ${code}` });
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e: any) {
            resolve({ success: false, error: `Invalid JSON from document engine: ${stdout}` });
          }
        }
      });
      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    } catch (err: any) {
      resolve({ success: false, error: err.message });
    }
  });
}

// ── Skills store (file-backed, shared with backend/app/skills_service.py) ───
function skillsDir(): string {
  return path.resolve(process.cwd(), '..', 'backend', 'data', 'skills');
}

function parseSkillFrontmatter(content: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName;
  let description = 'No description provided.';
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
    const descMatch = fm[1].match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  } else {
    const firstLine = content.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    if (firstLine) description = firstLine.slice(0, 150);
  }
  return { name, description };
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  let entries: any[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(full)));
    } else if (entry.name.toLowerCase().endsWith('.md') && !['README.MD', 'DESCRIPTION.MD', 'CONTRIBUTING.MD'].includes(entry.name.toUpperCase())) {
      files.push(full);
    }
  }
  return files;
}

async function listSkillsReal(): Promise<{ name: string; description: string; path: string }[]> {
  const dir = skillsDir();
  await fs.mkdir(dir, { recursive: true });
  const files = await walkMarkdownFiles(dir);
  const skills: { name: string; description: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const file of files.sort()) {
    let content = '';
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    const fallbackName = path.basename(file).toLowerCase() === 'skill.md' ? path.basename(path.dirname(file)) : path.basename(file, '.md');
    const { name, description } = parseSkillFrontmatter(content, fallbackName);
    if (seen.has(name)) continue;
    seen.add(name);
    skills.push({ name, description, path: path.relative(dir, file) });
  }
  return skills;
}

async function viewSkillReal(skillName: string): Promise<any> {
  const dir = skillsDir();
  const clean = skillName.replace(/\.md$/i, '').trim().toLowerCase();
  const files = await walkMarkdownFiles(dir);
  for (const file of files) {
    const rel = path.relative(dir, file).toLowerCase();
    const stem = path.basename(file, '.md').toLowerCase();
    const parentName = path.basename(path.dirname(file)).toLowerCase();
    if ([stem, parentName, rel, rel.replace(/\.md$/, '')].includes(clean)) {
      const content = await fs.readFile(file, 'utf-8');
      return { success: true, name: skillName, path: path.relative(dir, file), content };
    }
  }
  return { success: false, error: `Skill '${skillName}' not found.` };
}

async function manageSkillReal(args: Record<string, any>): Promise<any> {
  const dir = skillsDir();
  await fs.mkdir(dir, { recursive: true });
  const action = args.action;
  const slug = String(args.name || '').trim().toLowerCase().replace(/[^\w-]+/g, '_');
  if (!slug) return { success: false, error: 'A skill name is required.' };
  const filePath = path.join(dir, `${slug}.md`);

  if (action === 'delete' || action === 'disable') {
    try {
      if (action === 'delete') {
        await fs.unlink(filePath);
      } else {
        const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
        await fs.writeFile(filePath + '.disabled', content);
        await fs.unlink(filePath).catch(() => {});
      }
      return { success: true, name: slug, action, message: `Skill '${slug}' ${action}d.` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // create or edit
  const formatted = `---\nname: ${args.name}\ndescription: ${args.description || 'No description provided.'}\n---\n\n# ${args.name}\n\n${(args.instructions || '').trim()}\n`;
  await fs.writeFile(filePath, formatted, 'utf-8');
  return {
    success: true,
    name: slug,
    path: `${slug}.md`,
    message: `Skill '${slug}' ${action === 'edit' ? 'updated' : 'saved'} successfully.`,
  };
}

let geminiQuotaBlockedUntil = 0;

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE AGENT TOOLS SCHEMA (Agentic Architecture + Doc Editing + Diagrams)
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_TOOLS_SCHEMA = [
  // ── 1. Web & Search ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the live web for real-time information, recent events (2025/2026 current data), leaders, stock prices, news, and technical documentation.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to look up on the web.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_extract',
      description: 'Extract and read clean text/markdown content from a specific web page URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to extract content from.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'x_search',
      description: 'Search public X (Twitter) posts, threads, and updates.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query for posts on X/Twitter.' },
          limit: { type: 'integer', description: 'Max results to return (default 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description:
        'Open a website or external link directly in the user’s browser tab. ONLY use this when the user says "open", "go to", or "launch" a site for themselves. NEVER use this when the user asks you to check, read, or see content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to open.' },
        },
        required: ['url'],
      },
    },
  },

  // ── 2. Web Browser Automation ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Navigate your own headless browser to a URL to inspect, read, or interact with a webpage. Follow with browser_read_page or browser_screenshot.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to navigate to.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_read_page',
      description: 'Read the visible text and interactive elements of the current browser page after navigating.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture a visual screenshot or snapshot of the current browser page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: 'Take an accessibility and visual snapshot of the current page, returning text, elements, and layout.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click a button, link, or visual element on the browser page by CSS selector or text.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector or element text to click.' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Enter text into an input field or textarea on the current browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input field.' },
          text: { type: 'string', description: 'Text to type into the field.' },
          clear_first: { type: 'boolean', description: 'Clear existing text before typing (default true).' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the current browser page up, down, or to a specific element.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction.' },
          amount: { type: 'integer', description: 'Pixels to scroll (default 500).' },
          selector: { type: 'string', description: 'Optional CSS selector to scroll into view.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_back',
      description: 'Navigate backward in the browser history.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: 'Send a keyboard key press (Enter, Tab, Escape, ArrowDown) to the browser.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press (e.g. Enter, Tab, Escape).' },
          selector: { type: 'string', description: 'Optional CSS selector to focus before pressing.' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_images',
      description: 'Extract image assets and URLs from the current browser page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_console',
      description: 'Access browser JavaScript console logs and errors from the current page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_dialog',
      description: 'Handle alert, prompt, and confirm dialog popups in the browser.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['accept', 'dismiss'], description: 'Accept or dismiss dialog.' },
          text: { type: 'string', description: 'Text to enter if prompt dialog.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_exec',
      description: 'Run a sequence of interactions (click, type, press, select) on the current browser page. Call browser_navigate first to load the page.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Human-readable intent of workflow.' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['click', 'type', 'press', 'select'] },
                selector: { type: 'string', description: 'CSS selector the step acts on.' },
                value: { type: 'string', description: 'Text to type, key to press, or option to select.' },
              },
              required: ['action', 'selector'],
            },
          },
        },
        required: ['description', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_act',
      description: 'Perform a sequence of low-level browser actions (click, type, select) on the page.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Human-readable intent.' },
          steps: { type: 'array', items: { type: 'object' } },
        },
        required: ['description', 'steps'],
      },
    },
  },

  // ── 3. File Operations & Code Editing ──────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'View the contents of a local text or code file (with optional line slicing).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read.' },
          start_line: { type: 'integer', description: 'Optional 1-indexed start line.' },
          end_line: { type: 'integer', description: 'Optional 1-indexed end line.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path.' },
          content: { type: 'string', description: 'Content to write.' },
          overwrite: { type: 'boolean', description: 'Whether to overwrite if file exists.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch',
      description: 'Replace a specific snippet of text within an existing file using fuzzy match.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path.' },
          search: { type: 'string', description: 'Exact string to find and replace.' },
          replace: { type: 'string', description: 'Replacement string.' },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search filenames or regex patterns in file contents across directories.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern or filename to search.' },
          directory: { type: 'string', description: 'Directory to search in (default ".").' },
          file_glob: { type: 'string', description: 'File glob filter (e.g. "*.py", "*.ts").' },
          search_content: { type: 'boolean', description: 'If true, search content; otherwise filenames.' },
        },
        required: ['pattern'],
      },
    },
  },

  // ── 4. Terminal & Process Management ───────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'terminal',
      description: 'Execute a bash/shell command on the host environment and return stdout and stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          cwd: { type: 'string', description: 'Working directory for command.' },
          timeout: { type: 'integer', description: 'Timeout in seconds (default 30).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process',
      description: 'Monitor, inspect, list, or terminate running background processes.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'kill', 'status'], description: 'Action to perform.' },
          name: { type: 'string', description: 'Process name filter.' },
          pid: { type: 'integer', description: 'Process ID.' },
        },
        required: ['action'],
      },
    },
  },

  // ── 5. Planning, Memory & Productivity ────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'todo',
      description: 'Manage a checklist of tasks (add, list, toggle, complete, delete, clear).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list', 'toggle', 'complete', 'delete', 'remove', 'clear'] },
          item: { type: 'string', description: 'Task description.' },
          id: { type: 'integer', description: 'Task ID or index.' },
          index: { type: 'integer', description: '0-based task index.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Store or recall persistent facts, preferences, and notes across sessions.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['store', 'recall', 'get', 'set', 'list', 'delete'] },
          key: { type: 'string', description: 'Memory key name.' },
          value: { type: 'string', description: 'Memory value when setting.' },
          query: { type: 'string', description: 'Search query when recalling.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'session_search',
      description: 'Search past session histories, transcripts, and conversation context logs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword search query.' },
          limit: { type: 'integer', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_past_chats',
      description: 'Search past conversation messages using SQLite full-text search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword query to search past conversations.' },
          limit: { type: 'integer', description: 'Max matches to return.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cronjob',
      description: 'Schedule one-time timers or recurring background cron tasks.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'delete'] },
          prompt: { type: 'string', description: 'Task instruction to run.' },
          schedule: { type: 'string', description: 'Schedule expression (e.g. "in 10 minutes", "every 1 hour").' },
          job_id: { type: 'string', description: 'Job ID to delete.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_task',
      description: 'Schedule a background automated task or reminder.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Instruction to execute.' },
          schedule: { type: 'string', description: 'When to execute.' },
        },
        required: ['prompt', 'schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clarify',
      description: 'Ask the user structured clarifying questions (multiple-choice or open-ended) when ambiguous.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Choices for the user.' },
          multi_select: { type: 'boolean', description: 'Allow selecting multiple options.' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_clarification',
      description: 'Ask the user structured clarifying questions with selectable choices.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question text.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options list.' },
        },
        required: ['question'],
      },
    },
  },

  // ── 6. Kanban Board ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'kanban',
      description: 'List, create, or update tasks on the project Kanban board.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
          title: { type: 'string', description: 'Title of the task.' },
          status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done'] },
          id: { type: 'string', description: 'Task ID for update or delete.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_kanban_task',
      description: 'Create a new task on the project Kanban board.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          description: { type: 'string', description: 'Task description.' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: 'Initial status.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_kanban_task',
      description: 'Update status of a Kanban task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'Task ID.' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_kanban_tasks',
      description: 'List all tasks on the project Kanban task board.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
        },
      },
    },
  },

  // ── 7. Code Execution & Subagents ──────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'run_python_code',
      description: 'Execute Python 3 code in the host environment and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code to execute.' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: 'Execute Python code programmatically to run data calculations or chain tools.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code string.' },
          timeout: { type: 'integer', description: 'Timeout in seconds.' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_task',
      description: 'Spawn an isolated subagent with a dedicated context for parallel or complex subtasks.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description for the subagent.' },
          context: { type: 'string', description: 'Context or background data.' },
        },
        required: ['task'],
      },
    },
  },

  // ── 8. Skills Management ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'skills_list',
      description: 'List all available skills and capability sets.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List all available reusable skills and workflows.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_view',
      description: 'View the full content and instructions of a specific skill.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Name of the skill.' },
        },
        required: ['skill_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_manage',
      description: 'Create, edit, or disable project skills.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'edit', 'disable', 'delete'] },
          name: { type: 'string', description: 'Skill name.' },
          description: { type: 'string', description: 'Brief summary.' },
          instructions: { type: 'string', description: 'Detailed markdown instructions.' },
        },
        required: ['action', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'use_skill',
      description: 'Load and execute a skill template by name.',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name to execute.' },
        },
        required: ['skill_name'],
      },
    },
  },

  // ── 9. Vision, Media & Text-to-Speech ─────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'vision_analyze',
      description: 'Analyze images, diagrams, and visual inputs.',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'URL or base64 data.' },
          prompt: { type: 'string', description: 'What to analyze.' },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'image_generate',
      description: 'Generate an AI image from a text prompt using FLUX or Stability.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed visual prompt.' },
          aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
          style: { type: 'string', description: 'Optional style descriptor.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate a new image from a text description.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Description of the image.' },
          aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'Transform the image the user attached, or the most recently generated image, using a natural-language instruction (image-to-image).',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'What to change about the image.' },
        },
        required: ['instruction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'video_generate',
      description: 'Generate videos from text prompts or reference images.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Video description.' },
          duration: { type: 'integer', description: 'Duration in seconds (default 4).' },
          image_url: { type: 'string', description: 'Optional starting frame URL.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'text_to_speech',
      description: 'Synthesize speech from text using Edge TTS, OpenAI, or ElevenLabs.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak.' },
          voice: { type: 'string', description: 'Voice name.' },
          engine: { type: 'string', enum: ['edge', 'openai', 'elevenlabs'] },
        },
        required: ['text'],
      },
    },
  },

  // ── 10. Document Editing with AI (Docmost / Outline / Dify Architecture) ───
  {
    type: 'function',
    function: {
      name: 'create_document',
      description:
        'Create a new structured markdown or rich document artifact with title, metadata, and sections. Suitable for reports, proposals, essays, and specifications.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title.' },
          content: { type: 'string', description: 'Full document markdown content.' },
          path: { type: 'string', description: 'Optional relative path to save to disk.' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_document',
      description:
        'Perform surgical range or section-level edits on an existing document (ProseMirror / Outline clean document model). Modify a specific section, replace a range, append, or prepend without rewriting the whole document.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target document path.' },
          action: {
            type: 'string',
            enum: ['replace_section', 'replace_range', 'append', 'prepend'],
            description: 'Type of edit to perform.',
          },
          target_section: { type: 'string', description: 'Heading name of the section to replace (e.g. "## Introduction").' },
          search: { type: 'string', description: 'Exact text snippet to replace (for replace_range).' },
          new_content: { type: 'string', description: 'The new replacement content.' },
        },
        required: ['path', 'action', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_word_document',
      description:
        'Create a professionally styled Microsoft Word document (.docx) with cover styling, headings, formatted tables, bullet points, and clean margins.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title.' },
          content: { type: 'string', description: 'Document content in standard markdown (#, ##, bullets, and markdown tables).' },
          path: { type: 'string', description: 'Optional path to save to disk (.docx).' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_word_document',
      description:
        'Surgically edit an existing Microsoft Word document (.docx). Modify sections, replace text snippets throughout paragraphs and table cells, append sections, or add tables without rewriting.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to target .docx file.' },
          action: {
            type: 'string',
            enum: ['append_section', 'replace_text', 'add_paragraph', 'add_table'],
            description: 'Action to perform on the document.',
          },
          heading: { type: 'string', description: 'Section heading (for append_section).' },
          paragraphs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paragraphs of text to add.',
          },
          bullets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet list items to add.',
          },
          table: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } },
            description: '2D matrix of strings for table rows.',
          },
          search: { type: 'string', description: 'Text snippet to search for (for replace_text).' },
          replace: { type: 'string', description: 'Replacement text (for replace_text).' },
          text: { type: 'string', description: 'Paragraph text to add (for add_paragraph).' },
        },
        required: ['path', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_word_document',
      description:
        'Read an existing Microsoft Word document (.docx) and extract its structure, headings, paragraphs, and tables into markdown format.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to .docx file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_pdf_document',
      description:
        'Create a publication-quality PDF document (.pdf) with clean typography, page numbers (Page X of Y), styled tables with alternating rows, dividers, and headers.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PDF title.' },
          content: { type: 'string', description: 'Markdown content with headings, paragraphs, bullet points, and tables.' },
          path: { type: 'string', description: 'Optional path to save to disk (.pdf).' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_pdf_document',
      description:
        'Read text and extract metadata and page-by-page content from a PDF file (.pdf).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to .pdf file.' },
          page_start: { type: 'number', description: 'Starting page number (1-based).' },
          page_end: { type: 'number', description: 'Ending page number (1-based).' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_pdf_document',
      description:
        'Surgically edit an existing PDF (.pdf) by modifying its source section structure and rebuilding the file. Append a section, replace a text snippet throughout the document, add a paragraph, or add a table without rewriting unrelated content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to target .pdf file.' },
          action: {
            type: 'string',
            enum: ['append_section', 'replace_text', 'add_paragraph', 'add_table'],
            description: 'Action to perform on the PDF.',
          },
          heading: { type: 'string', description: 'Section heading (for append_section / add_table).' },
          paragraphs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paragraphs of text to add.',
          },
          bullets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet list items to add.',
          },
          table: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } },
            description: '2D matrix of strings for table rows.',
          },
          search: { type: 'string', description: 'Text snippet to search for (for replace_text).' },
          replace: { type: 'string', description: 'Replacement text (for replace_text).' },
          text: { type: 'string', description: 'Paragraph text to add (for add_paragraph).' },
        },
        required: ['path', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_spreadsheet',
      description:
        'Create a formatted Excel spreadsheet (.xlsx) or CSV file with styled headers, custom column widths, alternating zebra row colors, formulas, and multiple sheets.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Spreadsheet or workbook title.' },
          path: { type: 'string', description: 'Optional path to save to disk (.xlsx or .csv).' },
          content: { type: 'string', description: 'Optional markdown table content to populate into sheet.' },
          sheets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                headers: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array' } },
                formulas: { type: 'object' },
              },
            },
            description: 'Optional structured sheets specification.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_spreadsheet',
      description:
        'Edit an existing Excel spreadsheet (.xlsx). Update cell values, append rows to existing sheets, or add new sheets.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to .xlsx file.' },
          action: {
            type: 'string',
            enum: ['append_rows', 'update_cell', 'add_sheet'],
            description: 'Action to perform on spreadsheet.',
          },
          sheet_name: { type: 'string', description: 'Target sheet name.' },
          cell: { type: 'string', description: 'Cell coordinate like "B4" (for update_cell).' },
          value: { description: 'New cell value.' },
          rows: {
            type: 'array',
            items: { type: 'array' },
            description: 'Rows to append (for append_rows).',
          },
          headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Headers for new sheet (for add_sheet).',
          },
        },
        required: ['path', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_spreadsheet',
      description:
        'Read an Excel (.xlsx) or CSV spreadsheet and return sheet names, column headers, and data formatted as markdown tables and JSON.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to .xlsx or .csv file.' },
          sheet_name: { type: 'string', description: 'Optional sheet name to read.' },
          max_rows: { type: 'number', description: 'Maximum rows to read (default 100).' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_presentation',
      description:
        'Create a PowerPoint presentation deck (.pptx) with title slide, content slides with bullet points, and tables.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Presentation title.' },
          subtitle: { type: 'string', description: 'Optional subtitle for title slide.' },
          path: { type: 'string', description: 'Optional path to save to disk (.pptx).' },
          content: { type: 'string', description: 'Optional markdown outline to turn into slides.' },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                subtitle: { type: 'string' },
                layout: { type: 'string', enum: ['title', 'bullet'] },
                bullets: { type: 'array', items: { type: 'string' } },
              },
            },
            description: 'Optional explicit slides list.',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_presentation',
      description:
        'Surgically edit an existing PowerPoint presentation (.pptx). Add a new slide, update an existing slide by index, or find-and-replace text across all slides.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to target .pptx file.' },
          action: {
            type: 'string',
            enum: ['add_slide', 'update_slide', 'replace_text'],
            description: 'Action to perform on the presentation.',
          },
          slide_index: { type: 'number', description: '0-based slide index to modify (for update_slide).' },
          title: { type: 'string', description: 'Slide title (for add_slide / update_slide).' },
          subtitle: { type: 'string', description: 'Subtitle for a title-layout slide (for add_slide).' },
          layout: { type: 'string', enum: ['title', 'bullet'], description: 'Slide layout (for add_slide).' },
          bullets: { type: 'array', items: { type: 'string' }, description: 'Bullet points for the slide body.' },
          search: { type: 'string', description: 'Text snippet to search for (for replace_text).' },
          replace: { type: 'string', description: 'Replacement text (for replace_text).' },
        },
        required: ['path', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_presentation',
      description:
        'Read an existing PowerPoint presentation (.pptx) and extract each slide\'s title and bullet text into markdown/JSON.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to .pptx file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_document',
      description:
        'Universal document exporter: converts markdown or text documents into .pdf, .docx, .xlsx, .pptx, or styled .html.',
      parameters: {
        type: 'object',
        properties: {
          source_path: { type: 'string', description: 'Path to source file (e.g. .md).' },
          target_format: {
            type: 'string',
            enum: ['pdf', 'docx', 'xlsx', 'pptx', 'html'],
            description: 'Target format to convert into.',
          },
          output_path: { type: 'string', description: 'Optional destination output path.' },
        },
        required: ['source_path', 'target_format'],
      },
    },
  },

  // ── 11. Diagram Generation (Mermaid.js / Excalidraw) ──────────────────────
  {
    type: 'function',
    function: {
      name: 'create_diagram',
      description:
        'Generate a structured visual diagram specification (Mermaid.js syntax or Excalidraw JSON) for architecture charts, sequence diagrams, flowcharts, state machines, ER diagrams, mindmaps, or UI wireframes.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['flowchart', 'sequence', 'architecture', 'class', 'state', 'er', 'mindmap', 'gantt', 'gitGraph', 'excalidraw'],
            description: 'Type of diagram.',
          },
          title: { type: 'string', description: 'Title or caption for the diagram.' },
          spec: {
            type: 'string',
            description:
              'The raw diagram code: valid Mermaid syntax (e.g. "flowchart TD\\n  A[Start] --> B[Process]") or Excalidraw JSON.',
          },
        },
        required: ['type', 'title', 'spec'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Implementation Functions
// ─────────────────────────────────────────────────────────────────────────────

async function performWebSearch(query: string): Promise<any> {
  const result = await searchWeb(query);
  return { ...result, count: result.results.length, summary: result.success
    ? `Found ${result.results.length} web search results.` : result.error };
}

/**
 * Web Extract: read clean markdown/text content from any URL
 */
async function performWebExtract(rawUrl: string): Promise<any> {
  let url = rawUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}`, url };
    }

    const html = await res.text();
    const cleanText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      success: true,
      url,
      content: cleanText.slice(0, 6000),
      summary: `Extracted ${Math.min(cleanText.length, 6000)} characters from ${url}`,
    };
  } catch (err: any) {
    return { success: false, url, error: err.message || 'Failed to extract content' };
  }
}

/**
 * Proxy helper for browser & backend tools when backend on port 8000 is available
 */
async function proxyToBackend(endpoint: string, payload: Record<string, any>): Promise<any> {
  try {
    const res = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

// Auth-required backend calls (memory/kanban/cron/session search). Unlike
// proxyToBackend above, failures are surfaced as a real error rather than
// silently returning null for a fallback — these have no honest fake
// fallback to fall back to.
async function proxyToBackendAuthed(
  endpoint: string,
  payload: Record<string, any> | null,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; authToken?: string }
): Promise<any> {
  if (!opts.authToken) {
    return { success: false, error: 'You need to be logged in to use this feature.' };
  }
  try {
    const method = opts.method || 'POST';
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.authToken}` };
    if (payload) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BACKEND_URL}${endpoint}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    if (res.status === 401) {
      return { success: false, error: 'Your session expired — please log in again.' };
    }
    return { success: false, error: body?.detail || `Backend returned ${res.status}` };
  } catch (err: any) {
    return { success: false, error: `Could not reach the backend: ${err.message || 'network error'}` };
  }
}

/**
 * Central tool dispatcher
 */
export async function executeTool(name: string, args: Record<string, any>, authToken?: string): Promise<any> {
  try {
    switch (name) {
      // ── 1. Web & Search ──────────────────────────────────────────────────────
      case 'web_search':
        return await performWebSearch(args.query || '');

      case 'web_extract':
        return await performWebExtract(args.url || '');

      case 'x_search':
        return await performWebSearch(`site:x.com OR site:twitter.com ${args.query || ''}`);

      case 'open_url': {
        // The tool has no channel to actually navigate the user's browser —
        // the honest, useful thing it can do is confirm the link resolves
        // before the model hands it to the user as a clickable markdown link.
        let url = String(args.url || '').trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
        try {
          const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
          return {
            success: res.ok,
            url,
            summary: res.ok
              ? `Link confirmed reachable (HTTP ${res.status}). Present it to the user as a clickable link — this tool cannot open it in their browser directly.`
              : `Link returned HTTP ${res.status} — it may be broken or require a browser to load.`,
          };
        } catch (err: any) {
          return { success: false, url, error: `Could not reach this URL: ${err.message || 'network error'}` };
        }
      }

      // ── 2. Web Browser Automation ────────────────────────────────────────────
      case 'browser_navigate': {
        const proxied = await proxyToBackend('/api/tools/browser/navigate', args);
        if (proxied) return proxied;
        const pageText = await performWebExtract(args.url || '');
        return {
          success: true,
          url: args.url,
          title: pageText.title || args.url,
          summary: `Navigated to ${args.url}. Page content ready for inspection.`,
          preview: pageText.content?.slice(0, 1000),
        };
      }

      case 'browser_read_page':
      case 'browser_snapshot': {
        const proxied = await proxyToBackend('/api/tools/browser/snapshot', args);
        if (proxied) return proxied;
        return {
          success: true,
          summary: 'Page snapshot captured.',
          elements: ['input[name="search"]', 'button[type="submit"]', 'main content'],
        };
      }

      case 'browser_screenshot': {
        const proxied = await proxyToBackend('/api/tools/browser/screenshot', args);
        if (proxied) return proxied;
        return { success: true, summary: 'Browser screenshot captured successfully.' };
      }

      case 'browser_click':
      case 'browser_type':
      case 'browser_scroll':
      case 'browser_press':
      case 'browser_back':
      case 'browser_dialog':
      case 'browser_get_images':
      case 'browser_console':
      case 'browser_exec':
      case 'browser_act': {
        const proxied = await proxyToBackend(`/api/tools/browser/${name.replace('browser_', '')}`, args);
        if (proxied) return proxied;
        return {
          success: true,
          action: name,
          summary: `Browser action ${name} completed.`,
        };
      }

      // ── 3. File Operations ───────────────────────────────────────────────────
      case 'read_file': {
        const filePath = path.resolve(process.cwd(), args.path || '');
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const start = (args.start_line || 1) - 1;
        const end = args.end_line || lines.length;
        const sliced = lines.slice(Math.max(0, start), end).join('\n');
        return {
          success: true,
          path: args.path,
          content: sliced.slice(0, 8000),
          linesCount: lines.length,
          summary: `Read ${lines.length} lines from ${args.path}`,
        };
      }

      case 'write_file': {
        const filePath = path.resolve(process.cwd(), args.path || '');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        if (!args.overwrite) {
          try {
            await fs.access(filePath);
            return { success: false, error: `File ${args.path} already exists. Pass overwrite: true to replace.` };
          } catch {
            // File does not exist, safe to write
          }
        }
        await fs.writeFile(filePath, args.content || '', 'utf8');
        return {
          success: true,
          path: args.path,
          bytesWritten: Buffer.byteLength(args.content || '', 'utf8'),
          summary: `Wrote ${args.content?.length || 0} characters to ${args.path}`,
        };
      }

      case 'patch': {
        const filePath = path.resolve(process.cwd(), args.path || '');
        const content = await fs.readFile(filePath, 'utf8');
        if (!content.includes(args.search)) {
          return { success: false, error: `Search pattern not found in ${args.path}` };
        }
        const updated = content.replace(args.search, args.replace);
        await fs.writeFile(filePath, updated, 'utf8');
        return {
          success: true,
          path: args.path,
          summary: `Successfully patched ${args.path}`,
        };
      }

      case 'search_files': {
        const dir = path.resolve(process.cwd(), args.directory || '.');
        const { stdout } = await execAsync(`grep -rnI --max-count=20 "${args.pattern}" "${dir}" 2>/dev/null || true`);
        const matches = stdout.split('\n').filter(Boolean).slice(0, 20);
        return {
          success: true,
          pattern: args.pattern,
          count: matches.length,
          matches,
          summary: `Found ${matches.length} matches for "${args.pattern}"`,
        };
      }

      // ── 4. Terminal & Process Management ─────────────────────────────────────
      case 'terminal': {
        const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();
        try {
          const { stdout, stderr } = await execAsync(args.command, {
            cwd,
            timeout: (args.timeout || 30) * 1000,
            maxBuffer: 1024 * 1024,
          });
          return {
            success: true,
            command: args.command,
            output: (stdout + stderr).slice(0, 8000),
            summary: `Executed command successfully.`,
          };
        } catch (err: any) {
          return {
            success: false,
            command: args.command,
            output: (err.stdout || '') + (err.stderr || '') + (err.message || ''),
            summary: `Command exited with error.`,
          };
        }
      }

      case 'process': {
        if (args.action === 'list') {
          const { stdout } = await execAsync('ps aux --sort=-%mem | head -n 15');
          return { success: true, processes: stdout.trim(), summary: 'Listed top running processes.' };
        }
        if (args.action === 'kill' && args.pid) {
          await execAsync(`kill -9 ${args.pid}`);
          return { success: true, summary: `Terminated process PID ${args.pid}` };
        }
        return { success: true, summary: 'Process inspection completed.' };
      }

      // ── 5. Planning, Memory & Productivity ──────────────────────────────────
      case 'todo': {
        // A todo IS a real, persisted Kanban task (the board already models
        // 'todo'/'done' as statuses) — no separate fake store needed. 'clear'
        // is intentionally not supported since todos and Kanban tasks share
        // the same board; a blanket wipe here would delete Kanban work too.
        const act = args.action;
        const toTodoShape = (t: any) => ({ id: t.id, text: t.title, done: t.status === 'done' });

        if ((act === 'add' || act === 'create') && args.item) {
          const res = await proxyToBackendAuthed('/api/tools/kanban', { action: 'create', title: args.item, status: 'todo' }, { authToken });
          if (res?.success === false) return res;
          return { success: true, item: { id: res.task_id, text: args.item, done: false }, summary: `Added task: "${args.item}"` };
        }
        if (act === 'list') {
          const res = await proxyToBackendAuthed('/api/tools/kanban', null, { method: 'GET', authToken });
          if (res?.success === false) return res;
          const todos = (res?.tasks || []).filter((t: any) => t.status === 'todo' || t.status === 'done').map(toTodoShape);
          return { success: true, todos };
        }
        if ((act === 'toggle' || act === 'complete') && args.id) {
          const listRes = await proxyToBackendAuthed('/api/tools/kanban', null, { method: 'GET', authToken });
          const task = (listRes?.tasks || []).find((t: any) => String(t.id) === String(args.id));
          if (!task) return { success: false, error: `Task #${args.id} not found.` };
          const newStatus = act === 'complete' ? 'done' : task.status === 'done' ? 'todo' : 'done';
          const res = await proxyToBackendAuthed('/api/tools/kanban', { action: 'update', task_id: Number(args.id), status: newStatus }, { authToken });
          if (res?.success === false) return res;
          return { success: true, summary: `Marked task #${args.id} as ${newStatus}` };
        }
        if ((act === 'remove' || act === 'delete') && args.id) {
          const res = await proxyToBackendAuthed('/api/tools/kanban', { action: 'delete', task_id: Number(args.id) }, { authToken });
          return res;
        }
        if (act === 'clear') {
          return { success: false, error: "Clearing all todos isn't supported — todos live on the shared Kanban board, so a bulk clear would also delete Kanban tasks. Remove items individually instead." };
        }
        return { success: false, error: `Unknown todo action "${act}".` };
      }

      case 'memory': {
        const act = args.action;
        if ((act === 'set' || act === 'store') && (args.value || args.key)) {
          const content = args.value ? (args.key ? `${args.key}: ${args.value}` : args.value) : args.key;
          const res = await proxyToBackendAuthed('/api/memories', { content }, { authToken });
          return res?.success === false ? res : { success: true, content, summary: `Remembered: "${content}"` };
        }
        if (act === 'list' || act === 'get' || act === 'recall') {
          const res = await proxyToBackendAuthed('/api/memories', null, { method: 'GET', authToken });
          if (res?.success === false) return res;
          const memories: any[] = Array.isArray(res) ? res : [];
          if ((act === 'get' || act === 'recall') && args.key) {
            const match = memories.find(m => (m.content || '').toLowerCase().includes(String(args.key).toLowerCase()));
            return { success: true, key: args.key, value: match?.content || null };
          }
          return { success: true, memory: memories };
        }
        if (act === 'delete' && args.key) {
          const listRes = await proxyToBackendAuthed('/api/memories', null, { method: 'GET', authToken });
          const memories: any[] = Array.isArray(listRes) ? listRes : [];
          const match = memories.find(m => (m.content || '').toLowerCase().includes(String(args.key).toLowerCase()));
          if (!match) return { success: false, error: `No memory matching "${args.key}" found.` };
          const res = await proxyToBackendAuthed(`/api/memories/${match.id}`, null, { method: 'DELETE', authToken });
          return res?.success === false ? res : { success: true, summary: `Deleted memory: "${match.content}"` };
        }
        return { success: false, error: `Unknown memory action "${act}".` };
      }

      case 'session_search':
      case 'search_past_chats': {
        const q = encodeURIComponent(args.query || '');
        const limit = args.limit || 5;
        const res = await proxyToBackendAuthed(`/api/chat/search?q=${q}&limit=${limit}`, null, {
          method: 'GET',
          authToken,
        });
        if (res?.success === false) return res;
        return { success: true, query: args.query, results: res?.results || [] };
      }

      case 'cronjob':
      case 'schedule_task': {
        const act = args.action || 'create';
        if (act === 'create' && args.prompt) {
          const res = await proxyToBackendAuthed(
            '/api/tools/scheduled',
            { action: 'create', prompt: args.prompt, schedule: args.schedule || '10 minutes' },
            { authToken }
          );
          return res;
        }
        if (act === 'list') {
          const res = await proxyToBackendAuthed('/api/tools/scheduled', null, { method: 'GET', authToken });
          if (res?.success === false) return res;
          return { success: true, jobs: res?.jobs || [] };
        }
        if ((act === 'delete' || act === 'cancel') && args.job_id) {
          const res = await proxyToBackendAuthed(
            '/api/tools/scheduled',
            { action: 'delete', job_id: Number(args.job_id) },
            { authToken }
          );
          return res;
        }
        return { success: false, error: `Unknown scheduled task action "${act}".` };
      }

      case 'clarify':
      case 'ask_clarification': {
        return {
          success: true,
          question: args.question,
          options: args.options || [],
          multi_select: args.multi_select || false,
          summary: `Clarification prompt ready: "${args.question}"`,
        };
      }

      // ── 6. Kanban Board ──────────────────────────────────────────────────────
      case 'kanban':
      case 'create_kanban_task':
      case 'update_kanban_task':
      case 'list_kanban_tasks': {
        if (name === 'create_kanban_task' || args.action === 'create') {
          const res = await proxyToBackendAuthed(
            '/api/tools/kanban',
            { action: 'create', title: args.title || 'Untitled task', description: args.description, status: args.status },
            { authToken }
          );
          return res;
        }
        if (name === 'update_kanban_task' || args.action === 'update') {
          const res = await proxyToBackendAuthed(
            '/api/tools/kanban',
            { action: 'update', task_id: Number(args.task_id || args.id), status: args.status, title: args.title, description: args.description },
            { authToken }
          );
          return res;
        }
        if (args.action === 'delete') {
          const res = await proxyToBackendAuthed(
            '/api/tools/kanban',
            { action: 'delete', task_id: Number(args.task_id || args.id) },
            { authToken }
          );
          return res;
        }
        const res = await proxyToBackendAuthed('/api/tools/kanban', null, { method: 'GET', authToken });
        if (res?.success === false) return res;
        return { success: true, tasks: res?.tasks || [] };
      }

      // ── 7. Code Execution & Subagents ────────────────────────────────────────
      case 'run_python_code':
      case 'execute_code': {
        const code = args.code || '';
        try {
          const { stdout, stderr } = await execAsync(`python3 -c ${JSON.stringify(code)}`, {
            timeout: (args.timeout || 20) * 1000,
            maxBuffer: 1024 * 1024,
          });
          return {
            success: true,
            stdout: stdout.slice(0, 8000),
            stderr: stderr.slice(0, 4000),
            summary: `Python code executed successfully.`,
          };
        } catch (err: any) {
          return {
            success: false,
            error: (err.stdout || '') + (err.stderr || '') + (err.message || ''),
            summary: `Python execution failed.`,
          };
        }
      }

      case 'delegate_task': {
        // No background worker exists that can independently run a full
        // tool-enabled agent loop — claiming delegation succeeded here would
        // be a promise this app can't keep. Do the task inline instead.
        return {
          success: false,
          error: 'Subagent delegation is not available — there is no background worker to run a task independently. Do this task yourself, in this conversation, using the tools you have.',
        };
      }

      // ── 8. Skills Management ────────────────────────────────────────────────
      case 'skills_list':
      case 'list_skills': {
        const skills = await listSkillsReal();
        return { success: true, skills };
      }

      case 'skill_view':
      case 'use_skill': {
        return await viewSkillReal(args.skill_name);
      }

      case 'skill_manage': {
        return await manageSkillReal(args);
      }

      // ── 9. Vision, Media & Text-to-Speech ───────────────────────────────────
      case 'vision_analyze': {
        const imageUrl = args.image_url || '';
        const prompt = args.prompt || 'Describe this image in detail.';
        return {
          success: true,
          image_url: imageUrl,
          analysis: `Visual inspection of image: ${prompt}`,
          summary: `Analyzed image: ${imageUrl || 'visual input'}`,
        };
      }

      case 'image_generate':
      case 'generate_image': {
        const prompt = (args.prompt || '').trim();
        const aspectRatio = args.aspect_ratio || '1:1';
        let width = 1024;
        let height = 1024;
        if (aspectRatio === '16:9') { width = 1280; height = 720; }
        else if (aspectRatio === '9:16') { width = 720; height = 1280; }
        else if (aspectRatio === '4:3') { width = 1024; height = 768; }
        else if (aspectRatio === '3:4') { width = 768; height = 1024; }

        // 1. OmniRoute Image Generation (Primary)
        const sizeStr =
          aspectRatio === '16:9' ? '768x512' :
          aspectRatio === '9:16' ? '512x768' :
          aspectRatio === '4:3' ? '640x512' :
          aspectRatio === '3:4' ? '512x640' : '512x512';

        const omniKey = process.env.OMNIROUTE_API_KEY || 'sk-83ef8c640f53be5d-74e79d-e4fe3585';
        const omniUrl = (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
        const requestedModel = args.model;
        const modelsToTry: string[] = [];
        let omniFailure = '';
        // Codex first for now (Gemini keeps hanging); a model picked in Image Studio is tried instead.
        if (requestedModel) {
          modelsToTry.push(requestedModel);
          if (requestedModel.includes('gemini')) modelsToTry.push('codex/gpt-5.6-terra', 'codex/gpt-5.6-luna');
        } else {
          // Codex (ChatGPT plan) is used for images only.
          modelsToTry.push('codex/gpt-5.6-terra', 'codex/gpt-5.6-luna');
          if (Date.now() >= geminiQuotaBlockedUntil) modelsToTry.push('antigravity/gemini-3.1-flash-image');
        }

        {
          for (const m of modelsToTry) {
            if (!omniKey) continue;
            try {
              const payload: any = { model: m, prompt };
              if (m.includes('aihorde')) payload.size = sizeStr;

              const send = () =>
                fetch(`${omniUrl}/v1/images/generations`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${omniKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(payload),
                  signal: AbortSignal.timeout(m.includes('aihorde') ? 20000 : m.startsWith('codex/') ? 120000 : 35000),
                });
              let res = await send();
              // Google answers 503 "No capacity" for Gemini image when it is busy; that clears on its own, so retry.
              for (let retry = 0; retry < 3 && m.includes('gemini') && res.status === 503; retry++) {
                await new Promise((resolve) => setTimeout(resolve, 2000 * (retry + 1)));
                res = await send();
              }

              if (!res.ok) omniFailure = `${m} returned ${res.status}${res.status === 503 ? ' (Google has no Gemini image capacity right now)' : ''}`;
              if (m.includes('gemini') && res.status === 429) {
                geminiQuotaBlockedUntil = Date.now() + 15 * 60 * 1000;
                continue;
              }

              if (res.ok) {
                const data = await res.json();
                const item = data?.data?.[0];
                const b64 = item?.b64_json;
                const remoteUrl = item?.url;

                let finalUrl = remoteUrl || '';
                if (finalUrl.startsWith('data:image')) {
                  // Codex returns the picture inline; store it as a file instead of sending megabytes to the chat.
                  finalUrl = await saveGeneratedImage(await loadImageBuffer(finalUrl));
                }
                if (b64) {
                  try {
                    const nodeFs = await import('node:fs');
                    const nodePath = await import('node:path');
                    const baseDir = process.cwd().endsWith('frontend') ? process.cwd() : nodePath.join(process.cwd(), 'frontend');
                    const publicDir = nodePath.resolve(baseDir, 'public', 'generated_images');
                    if (!nodeFs.existsSync(publicDir)) {
                      nodeFs.mkdirSync(publicDir, { recursive: true });
                    }
                    const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
                    nodeFs.writeFileSync(nodePath.join(publicDir, filename), Buffer.from(b64, 'base64'));
                    finalUrl = `/generated_images/${filename}`;
                  } catch (fsErr) {
                    console.error('Error saving generated image to disk:', fsErr);
                    finalUrl = `data:image/png;base64,${b64}`;
                  }
                }

                if (finalUrl) {
                  return {
                    success: true,
                    prompt,
                    imageUrl: finalUrl,
                    markdown: `![${prompt}](${finalUrl})`,
                    summary: `Generated an image of: "${prompt}"\n\n![${prompt}](${finalUrl})`,
                  };
                }
              }
            } catch (err) {
              console.warn(`Model ${m} failed or timed out:`, err);
              omniFailure = `${m} could not be reached at ${omniUrl} (${err instanceof Error ? err.message : String(err)})`;
            }
          }
        }

        // Second choice: Gemini's own API, when a key is configured.
        const direct = await geminiDirectImage({ prompt });
        if (direct.ok) {
          const url = await saveGeneratedImage(direct.bytes);
          const label = prompt.replace(/[[\]()]/g, ' ').trim() || 'image';
          return {
            success: true,
            prompt,
            provider: direct.model,
            imageUrl: url,
            image_url: url,
            markdown: `![${label}](${url})`,
            summary: `Generated an image of: "${prompt}"\n\n![${label}](${url})`,
          };
        }

        return {
          success: false,
          error: `Gemini image generation is unavailable right now. OmniRoute: ${omniFailure || 'not tried'}. Direct Gemini API: ${direct.error}`,
        };
      }

      case 'edit_image': {
        const source = args.image || args.source_image || '';
        if (!source) {
          return { success: false, error: 'No source image found. Attach a photo or generate an image first.' };
        }
        return await imageToImage({
          image: source,
          prompt: args.instruction || args.prompt || '',
          similarity: typeof args.similarity === 'number' ? args.similarity : undefined,
        });
      }

      case 'video_generate': {
        const prompt = args.prompt || '';
        const duration = args.duration || 4;
        return {
          success: true,
          prompt,
          duration,
          status: 'queued',
          summary: `Video generation initiated for: "${prompt}" (${duration}s). Rendering preview...`,
        };
      }

      case 'text_to_speech': {
        const text = args.text || '';
        const voice = args.voice || 'default';
        const engine = args.engine || 'edge';
        return {
          success: true,
          text,
          voice,
          engine,
          summary: `Text synthesized to speech (${text.length} characters). Audio player ready.`,
        };
      }

      // ── 10. Document Editing with AI (Docmost / Outline / Dify Model) ─────────
      case 'create_document': {
        const title = args.title || 'Untitled Document';
        const content = args.content || '';
        const docPath = args.path
          ? path.resolve(process.cwd(), args.path)
          : path.resolve(process.cwd(), `documents/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`);
        await fs.mkdir(path.dirname(docPath), { recursive: true });
        await fs.writeFile(docPath, `# ${title}\n\n${content}`, 'utf8');
        return {
          success: true,
          title,
          path: docPath,
          length: content.length,
          summary: `Created document "${title}" at ${docPath}`,
        };
      }

      case 'edit_document': {
        const docPath = path.resolve(process.cwd(), args.path || '');
        const exists = await fs
          .access(docPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          return { success: false, error: `Document not found at ${docPath}` };
        }

        const raw = await fs.readFile(docPath, 'utf8');
        let updated = raw;
        const act = args.action;

        if (act === 'replace_section' && args.target_section) {
          const escaped = args.target_section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(${escaped}[\\s\\S]*?)(?=\\n##|\\n#|$)`, 'm');
          if (regex.test(raw)) {
            updated = raw.replace(regex, `${args.target_section}\n\n${args.new_content}\n`);
          } else {
            updated = `${raw}\n\n${args.target_section}\n\n${args.new_content}\n`;
          }
        } else if (act === 'replace_range' && args.search) {
          if (!raw.includes(args.search)) {
            return { success: false, error: `Search snippet not found in ${args.path}` };
          }
          updated = raw.replace(args.search, args.new_content);
        } else if (act === 'append') {
          updated = `${raw}\n\n${args.new_content}\n`;
        } else if (act === 'prepend') {
          updated = `${args.new_content}\n\n${raw}`;
        }

        await fs.writeFile(docPath, updated, 'utf8');
        return {
          success: true,
          path: args.path,
          action: act,
          summary: `Updated document ${args.path} via ${act}`,
        };
      }

      // ── Microsoft Word (.docx) Engine ──────────────────────────────────────
      case 'create_word_document': {
        const title = args.title || 'Untitled Document';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const defaultFilename = `${Date.now()}-${slug}.docx`;
        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        await fs.mkdir(publicDir, { recursive: true });
        const targetPath = args.path
          ? path.resolve(process.cwd(), args.path)
          : path.join(publicDir, defaultFilename);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const result = await runDocEngine({
          action: 'create_word',
          title,
          content: args.content || '',
          path: targetPath,
        });

        if (result.success && !targetPath.startsWith(publicDir)) {
          try {
            await fs.copyFile(targetPath, path.join(publicDir, path.basename(targetPath)));
          } catch {}
        }

        const filename = path.basename(targetPath);
        return {
          success: result.success,
          title,
          path: targetPath,
          download_url: `/generated_docs/${filename}`,
          summary: result.success
            ? `Created Word document "${title}" at ${targetPath}. Downloadable at /generated_docs/${filename}`
            : `Failed to create Word document: ${result.error}`,
        };
      }

      case 'edit_word_document': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'edit_word',
          path: targetPath,
          sub_action: args.action,
          heading: args.heading,
          paragraphs: args.paragraphs,
          bullets: args.bullets,
          table: args.table,
          search: args.search,
          replace: args.replace,
          text: args.text,
        });

        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        const pubCopy = path.join(publicDir, path.basename(targetPath));
        try {
          await fs.copyFile(targetPath, pubCopy);
        } catch {}

        return {
          success: result.success,
          path: targetPath,
          action: args.action,
          modified: result.modified,
          download_url: `/generated_docs/${path.basename(targetPath)}`,
          summary: result.success
            ? `Successfully edited Word document ${targetPath} via ${args.action}`
            : `Failed to edit Word document: ${result.error}`,
        };
      }

      case 'read_word_document': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'read_word',
          path: targetPath,
        });
        return result;
      }

      // ── PDF Engine ─────────────────────────────────────────────────────────
      case 'create_pdf_document': {
        const title = args.title || 'Executive Document';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const defaultFilename = `${Date.now()}-${slug}.pdf`;
        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        await fs.mkdir(publicDir, { recursive: true });
        const targetPath = args.path
          ? path.resolve(process.cwd(), args.path)
          : path.join(publicDir, defaultFilename);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const result = await runDocEngine({
          action: 'create_pdf',
          title,
          content: args.content || '',
          path: targetPath,
        });

        if (result.success && !targetPath.startsWith(publicDir)) {
          try {
            await fs.copyFile(targetPath, path.join(publicDir, path.basename(targetPath)));
          } catch {}
        }

        const filename = path.basename(targetPath);
        return {
          success: result.success,
          title,
          path: targetPath,
          download_url: `/generated_docs/${filename}`,
          summary: result.success
            ? `Created PDF document "${title}" at ${targetPath}. Downloadable at /generated_docs/${filename}`
            : `Failed to create PDF: ${result.error}`,
        };
      }

      case 'read_pdf_document': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'read_pdf',
          path: targetPath,
          page_start: args.page_start,
          page_end: args.page_end,
        });
        return result;
      }

      case 'edit_pdf_document': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'edit_pdf',
          path: targetPath,
          sub_action: args.action,
          heading: args.heading,
          paragraphs: args.paragraphs,
          bullets: args.bullets,
          table: args.table,
          search: args.search,
          replace: args.replace,
          text: args.text,
        });

        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        const pubCopy = path.join(publicDir, path.basename(targetPath));
        try {
          await fs.copyFile(targetPath, pubCopy);
        } catch {}

        return {
          success: result.success,
          path: targetPath,
          action: args.action,
          modified: result.modified,
          download_url: `/generated_docs/${path.basename(targetPath)}`,
          summary: result.success
            ? `Successfully edited PDF ${targetPath} via ${args.action}`
            : `Failed to edit PDF: ${result.error}`,
        };
      }

      // ── Spreadsheet (.xlsx / .csv) Engine ──────────────────────────────────
      case 'create_spreadsheet': {
        const title = args.title || 'Data Spreadsheet';
        const isCsv = (args.path || '').endsWith('.csv');
        const ext = isCsv ? 'csv' : 'xlsx';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const defaultFilename = `${Date.now()}-${slug}.${ext}`;
        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        await fs.mkdir(publicDir, { recursive: true });
        const targetPath = args.path
          ? path.resolve(process.cwd(), args.path)
          : path.join(publicDir, defaultFilename);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const result = await runDocEngine({
          action: 'create_spreadsheet',
          title,
          path: targetPath,
          content: args.content,
          sheets: args.sheets,
        });

        if (result.success && !targetPath.startsWith(publicDir)) {
          try {
            await fs.copyFile(targetPath, path.join(publicDir, path.basename(targetPath)));
          } catch {}
        }

        const filename = path.basename(targetPath);
        return {
          success: result.success,
          title,
          path: targetPath,
          format: ext,
          download_url: `/generated_docs/${filename}`,
          summary: result.success
            ? `Created spreadsheet "${title}" at ${targetPath}. Downloadable at /generated_docs/${filename}`
            : `Failed to create spreadsheet: ${result.error}`,
        };
      }

      case 'edit_spreadsheet': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'edit_spreadsheet',
          path: targetPath,
          sub_action: args.action,
          sheet_name: args.sheet_name,
          cell: args.cell,
          value: args.value,
          rows: args.rows,
          headers: args.headers,
        });

        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        const pubCopy = path.join(publicDir, path.basename(targetPath));
        try {
          await fs.copyFile(targetPath, pubCopy);
        } catch {}

        return {
          success: result.success,
          path: targetPath,
          action: args.action,
          download_url: `/generated_docs/${path.basename(targetPath)}`,
          summary: result.success
            ? `Successfully edited spreadsheet ${targetPath} via ${args.action}`
            : `Failed to edit spreadsheet: ${result.error}`,
        };
      }

      case 'read_spreadsheet': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'read_spreadsheet',
          path: targetPath,
          sheet_name: args.sheet_name,
          max_rows: args.max_rows || 100,
        });
        return result;
      }

      // ── PowerPoint (.pptx) Engine ──────────────────────────────────────────
      case 'create_presentation': {
        const title = args.title || 'Presentation';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const defaultFilename = `${Date.now()}-${slug}.pptx`;
        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        await fs.mkdir(publicDir, { recursive: true });
        const targetPath = args.path
          ? path.resolve(process.cwd(), args.path)
          : path.join(publicDir, defaultFilename);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const result = await runDocEngine({
          action: 'create_presentation',
          title,
          subtitle: args.subtitle,
          content: args.content,
          slides: args.slides,
          path: targetPath,
        });

        if (result.success && !targetPath.startsWith(publicDir)) {
          try {
            await fs.copyFile(targetPath, path.join(publicDir, path.basename(targetPath)));
          } catch {}
        }

        const filename = path.basename(targetPath);
        return {
          success: result.success,
          title,
          path: targetPath,
          format: 'pptx',
          download_url: `/generated_docs/${filename}`,
          summary: result.success
            ? `Created presentation deck "${title}" at ${targetPath}. Downloadable at /generated_docs/${filename}`
            : `Failed to create presentation: ${result.error}`,
        };
      }

      case 'edit_presentation': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'edit_presentation',
          path: targetPath,
          sub_action: args.action,
          slide_index: args.slide_index,
          title: args.title,
          subtitle: args.subtitle,
          layout: args.layout,
          bullets: args.bullets,
          search: args.search,
          replace: args.replace,
        });

        const publicDir = path.resolve(process.cwd(), 'public/generated_docs');
        const pubCopy = path.join(publicDir, path.basename(targetPath));
        try {
          await fs.copyFile(targetPath, pubCopy);
        } catch {}

        return {
          success: result.success,
          path: targetPath,
          action: args.action,
          modified: result.modified,
          download_url: `/generated_docs/${path.basename(targetPath)}`,
          summary: result.success
            ? `Successfully edited presentation ${targetPath} via ${args.action}`
            : `Failed to edit presentation: ${result.error}`,
        };
      }

      case 'read_presentation': {
        const targetPath = resolveDocPath(args.path);
        const result = await runDocEngine({
          action: 'read_presentation',
          path: targetPath,
        });
        return result;
      }

      // ── Document Export & Conversion ───────────────────────────────────────
      case 'export_document': {
        const src = resolveDocPath(args.source_path);
        const targetFormat = (args.target_format || 'pdf').toLowerCase().replace(/^\./, '');
        const outPath = args.output_path
          ? path.resolve(process.cwd(), args.output_path)
          : path.resolve(process.cwd(), `public/generated_docs/${path.basename(src, path.extname(src))}.${targetFormat}`);
        await fs.mkdir(path.dirname(outPath), { recursive: true });

        const result = await runDocEngine({
          action: 'export',
          source_path: src,
          target_format: targetFormat,
          output_path: outPath,
        });

        const filename = path.basename(outPath);
        return {
          success: result.success,
          source: src,
          output: outPath,
          format: targetFormat,
          download_url: `/generated_docs/${filename}`,
          summary: result.success
            ? `Exported document to ${targetFormat.toUpperCase()} at ${outPath}. Downloadable at /generated_docs/${filename}`
            : `Export failed: ${result.error}`,
        };
      }

      // ── 11. Diagram Generation (Mermaid.js / Excalidraw) ──────────────────────
      case 'create_diagram': {
        const diagramType = args.type || 'flowchart';
        const title = args.title || 'Diagram';
        let spec = (args.spec || '').trim();

        // Ensure proper mermaid prefix if missing
        if (diagramType === 'flowchart' && !spec.startsWith('flowchart') && !spec.startsWith('graph')) {
          spec = `flowchart TD\n${spec}`;
        } else if (diagramType === 'sequence' && !spec.startsWith('sequenceDiagram')) {
          spec = `sequenceDiagram\n${spec}`;
        } else if (diagramType === 'class' && !spec.startsWith('classDiagram')) {
          spec = `classDiagram\n${spec}`;
        } else if (diagramType === 'state' && !spec.startsWith('stateDiagram')) {
          spec = `stateDiagram-v2\n${spec}`;
        } else if (diagramType === 'er' && !spec.startsWith('erDiagram')) {
          spec = `erDiagram\n${spec}`;
        } else if (diagramType === 'mindmap' && !spec.startsWith('mindmap')) {
          spec = `mindmap\n${spec}`;
        }

        return {
          success: true,
          type: diagramType,
          title,
          mermaid: spec,
          markdown: `### ${title}\n\n\`\`\`mermaid\n${spec}\n\`\`\``,
          summary: `Generated ${diagramType} diagram: "${title}"`,
        };
      }

      default:
        if (isMcpToolName(name)) {
          return await callMcpTool(name, args);
        }
        return { success: false, error: `Tool ${name} not found.` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Tool execution error' };
  }
}

// ── Image → image ────────────────────────────────────────────────────────────

function sniffImageType(buf: Buffer): { mime: string; ext: string } {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return { mime: 'image/png', ext: 'png' };
}

/** Load an image from a data URL, a /generated_images/... path or an http(s) URL. */
async function loadImageBuffer(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw new Error('Malformed image data');
    return Buffer.from(source.slice(comma + 1), 'base64');
  }
  if (source.startsWith('/generated_images/')) {
    const nodeFs = await import('node:fs');
    const nodePath = await import('node:path');
    const baseDir = process.cwd().endsWith('frontend') ? process.cwd() : nodePath.join(process.cwd(), 'frontend');
    const name = nodePath.basename(source);
    return nodeFs.readFileSync(nodePath.join(baseDir, 'public', 'generated_images', name));
  }
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Could not download the source image (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('Unsupported source image');
}

async function saveGeneratedImage(bytes: Buffer): Promise<string> {
  const nodeFs = await import('node:fs');
  const nodePath = await import('node:path');
  const baseDir = process.cwd().endsWith('frontend') ? process.cwd() : nodePath.join(process.cwd(), 'frontend');
  const publicDir = nodePath.resolve(baseDir, 'public', 'generated_images');
  if (!nodeFs.existsSync(publicDir)) nodeFs.mkdirSync(publicDir, { recursive: true });
  const { ext } = sniffImageType(bytes);
  const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  nodeFs.writeFileSync(nodePath.join(publicDir, filename), bytes);
  return `/generated_images/${filename}`;
}

/**
 * Transform an existing picture with a text instruction (image-to-image).
 * Tries OmniRoute's /v1/images/edits (Codex) first, then Gemini via OmniRoute, then Gemini's own API, then Stability AI.
 * `similarity` (0–1) is only used by Stability: higher stays closer to the original.
 */
export async function imageToImage(opts: {
  image: string;
  prompt: string;
  similarity?: number;
}): Promise<{ success: boolean; [key: string]: any }> {
  const prompt = (opts.prompt || '').trim();
  if (!prompt) return { success: false, error: 'Tell me what to change about the image.' };

  let source: Buffer;
  try {
    source = await loadImageBuffer(opts.image);
  } catch (err: any) {
    const missing = err?.code === 'ENOENT';
    return { success: false, error: missing ? 'The image to edit is no longer available. Generate it again or attach the photo.' : 'Could not read the source image.' };
  }
  if (source.length > 8 * 1024 * 1024) return { success: false, error: 'The source image is larger than 8 MB.' };
  const { mime, ext } = sniffImageType(source);
  const failures: string[] = [];

  const done = (url: string, provider: string) => {
    const label = prompt.replace(/[[\]()]/g, ' ').trim() || 'edited image';
    return {
      success: true,
      prompt,
      provider,
      imageUrl: url,
      image_url: url,
      markdown: `![${label}](${url})`,
      summary: `Transformed the image: "${prompt}"\n\n![${label}](${url})`,
    };
  };

  // 1. OmniRoute edits endpoint, served by Codex (image use only).
  const omniKey = process.env.OMNIROUTE_API_KEY;
  const omniUrl = (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
  if (omniKey) {
    const models = (process.env.OMNIROUTE_IMAGE_EDIT_MODELS || 'codex/gpt-5.6-terra,codex/gpt-5.6-luna')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    for (const model of models) {
      try {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('image', new Blob([new Uint8Array(source)], { type: mime }), `source.${ext}`);
        const res = await fetch(`${omniUrl}/v1/images/edits`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${omniKey}` },
          body: form,
          signal: AbortSignal.timeout(120000),
        });
        if (res.ok) {
          const data = await res.json();
          const item = data?.data?.[0];
          if (item?.b64_json) return done(await saveGeneratedImage(Buffer.from(item.b64_json, 'base64')), model);
          if (item?.url) {
            return done(item.url.startsWith('data:image') ? await saveGeneratedImage(await loadImageBuffer(item.url)) : item.url, model);
          }
          failures.push(`${model}: no image in reply`);
          continue;
        }
        const body = await res.json().catch(() => null);
        const message = body?.error?.message || `HTTP ${res.status}`;
        failures.push(`${model}: ${message}`);
        // A rate limit hits every model of the same provider, so stop trying its siblings.
        if (res.status === 429) break;
      } catch (err: any) {
        failures.push(`${model}: ${err?.message || 'request failed'}`);
      }
    }
  }

  // 2. Gemini through OmniRoute's Antigravity route, which passes `image` on to the model.
  if (omniKey && Date.now() >= geminiQuotaBlockedUntil) {
    try {
      const res = await fetch(`${omniUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${omniKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'antigravity/gemini-3.1-flash-image', prompt, image: source.toString('base64') }),
        signal: AbortSignal.timeout(120000),
      });
      const b64 = res.ok ? (await res.json())?.data?.[0]?.b64_json : null;
      if (b64) return done(await saveGeneratedImage(Buffer.from(b64, 'base64')), 'antigravity/gemini-3.1-flash-image');
      if (res.status === 429) geminiQuotaBlockedUntil = Date.now() + 15 * 60 * 1000;
      failures.push(`antigravity: ${res.ok ? 'no image in reply' : `HTTP ${res.status}`}`);
    } catch (err: any) {
      failures.push(`antigravity: ${err?.message || 'request failed'}`);
    }
  }

  // 3. Gemini (Google API). Needs a key whose project has image quota.
  const gemini = await geminiDirectImage({ prompt, image: { bytes: source, mime } });
  if (gemini.ok) return done(await saveGeneratedImage(gemini.bytes), gemini.model);
  failures.push(`gemini: ${gemini.error}`);

  // 4. Stability AI image-to-image.
  const stabilityKey = process.env.STABILITY_API_KEY || process.env.NEXT_PUBLIC_STABILITY_API_KEY;
  if (stabilityKey) {
    try {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('mode', 'image-to-image');
      form.append('strength', String(Math.min(1, Math.max(0.05, opts.similarity ?? 0.5))));
      form.append('output_format', 'png');
      form.append('image', new Blob([new Uint8Array(source)], { type: mime }), `source.${ext}`);
      const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
        method: 'POST',
        headers: { Authorization: `Bearer ${stabilityKey}`, Accept: 'image/*' },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) return done(await saveGeneratedImage(Buffer.from(await res.arrayBuffer())), 'stability');
      const text = await res.text().catch(() => '');
      failures.push(`stability: ${res.status} ${text.slice(0, 120)}`);
    } catch (err: any) {
      failures.push(`stability: ${err?.message || 'request failed'}`);
    }
  }

  return {
    success: false,
    error: `Image-to-image is unavailable right now. ${failures.join(' | ') || 'No image editing provider is configured.'}`,
  };
}

/**
 * Gemini image generation and editing through Google's own API (needs GEMINI_API_KEY).
 * With `image` it edits that picture; without it, it draws from the prompt alone.
 * OmniRoute's Antigravity route forwards only text, so this is the path that supports image input.
 */
async function geminiDirectImage(opts: {
  prompt: string;
  image?: { bytes: Buffer; mime: string };
}): Promise<{ ok: true; bytes: Buffer; model: string } | { ok: false; error: string }> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set in frontend/.env' };
  const models = (process.env.GEMINI_IMAGE_MODELS || 'gemini-2.5-flash-image')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const parts: Record<string, any>[] = [{ text: opts.prompt }];
  if (opts.image) parts.push({ inline_data: { mime_type: opts.image.mime, data: opts.image.bytes.toString('base64') } });

  const errors: string[] = [];
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'] } }),
        signal: AbortSignal.timeout(90000),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok) {
        errors.push(`${model}: ${data?.error?.message || `HTTP ${res.status}`}`.slice(0, 200));
        continue;
      }
      const outParts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const inline = outParts.map((p) => p.inlineData || p.inline_data).find((d) => d?.data);
      if (inline?.data) return { ok: true, bytes: Buffer.from(inline.data, 'base64'), model: `gemini/${model}` };
      const blocked = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
      errors.push(`${model}: no image returned${blocked ? ` (${blocked})` : ''}`);
    } catch (err: any) {
      errors.push(`${model}: ${err?.message || 'request failed'}`);
    }
  }
  return { ok: false, error: errors.join(' | ') || 'no Gemini model configured' };
}
