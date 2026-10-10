# PRAGNA 1-A

> Intelligent, high-performance AI workspace and conversational operating environment.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python)](https://python.org)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-Vector_Storage-orange)](https://www.trychroma.com/)

---

## Overview

**PRAGNA 1-A** is a full-stack AI platform combining conversational intelligence with real-time artifact visualization, document generation, semantic search, browser exploration, voice synthesis, and dynamic task management.

Built for velocity, reliability, and precision, PRAGNA 1-A pairs an ultra-responsive Next.js 15 frontend with a high-concurrency FastAPI engine, SQLite persistence, and ChromaDB vector search.

---

## Wireframes & User Interface

### 1. Main Workspace & Artifact Studio (Desktop)

```text
+---------------------------------------------------------------------------------------------------------+
| [=] PRAGNA 1-A Workspace      [ Model: Gemma-4 / Claude / DeepSeek v ]     (Settings) (Tasks) [User Profile] |
+------------------+----------------------------------------------------+------------------------------------+
| SIDEBAR          | CHAT CONVERSATION VIEW                             | ARTIFACT STUDIO                    |
|                  |                                                    |                                    |
| [+ New Chat]     |  User:                                             |  [ Code ] [ Preview ] [ Export ]   |
|                  |  Build an interactive architecture diagram.        |  --------------------------------  |
| FOLDERS          |                                                    |  flowchart TD                      |
| > Work           |  PRAGNA 1-A:                                       |    A[Client] --> B[Gateway]        |
| > Research       |  Here is the architecture specification. I have    |    B --> C[(Vector DB)]            |
| > Drafts         |  rendered the interactive diagram on the right.    |                                    |
|                  |                                                    |  +------------------------------+  |
| RECENT SESSIONS  |  [Status: Processing execution completed]          |  |                              |  |
| - Market Study   |                                                    |  |      [ MERMAID PREVIEW ]     |  |
| - API Design     |  ------------------------------------------------  |  |                              |  |
| - DB Schema      |                                                    |  +------------------------------+  |
|                  |                                                    |  Actions:                          |
|                  |                                                    |  [ Copy ]  [ Download SVG ]        |
|                  |  +----------------------------------------------+  |  [ Create Document ]               |
|                  |  | Message PRAGNA 1-A...              (Mic) [>] |  |                                    |
|                  |  +----------------------------------------------+  |                                    |
+------------------+----------------------------------------------------+------------------------------------+
```

### 2. Task & Workflow Board (Kanban View)

```text
+---------------------------------------------------------------------------------------------------------+
| [<- Back to Chat]                  PRAGNA 1-A Task Management Board                  [+ Create Task]  |
+-----------------------------------+-----------------------------------+---------------------------------+
| BACKLOG                           | IN PROGRESS                       | COMPLETED                       |
+-----------------------------------+-----------------------------------+---------------------------------+
| [TASK-101]                        | [TASK-098]                        | [TASK-084]                      |
| Ingest Q3 Financial Reports       | Scrape Developer Docs             | Vector index benchmark          |
| Tag: RAG | Priority: High         | Tag: Browser | Priority: Medium   | Tag: ChromaDB | Priority: Low   |
|                                   |                                   |                                 |
| [TASK-102]                        |                                   | [TASK-092]                      |
| Generate Executive Summary Slides |                                   | OAuth login integration         |
| Tag: Presentation                 |                                   | Tag: Auth | Priority: High      |
+-----------------------------------+-----------------------------------+---------------------------------+
```

### 3. Mobile Responsive Layout

```text
+-----------------------------------+
| [=] PRAGNA 1-A           (Avatar) |
+-----------------------------------+
| Assistant:                        |
| Retrieval complete. 3 sources     |
| referenced from knowledge store.  |
|                                   |
| User:                             |
| Summarize section 2.              |
|                                   |
| Assistant:                        |
| Section 2 covers vector search    |
| indexing with ChromaDB...         |
|                                   |
| +-------------------------------+ |
| | Message...          (Mic) [>] | |
| +-------------------------------+ |
+-----------------------------------+
| [Chats]  [Artifacts]  [Settings]  |
+-----------------------------------+
```

---

## System Workflows

### 1. End-to-End Chat & Streaming Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Client (Browser)
    participant Edge as Next.js 15 App Router
    participant Engine as FastAPI Core Engine
    participant Memory as Semantic Memory (ChromaDB)
    participant Model as LLM Inference
    participant DB as SQLite Storage

    User->>Edge: Submit prompt & session context
    Edge->>Engine: Forward request with session state
    Engine->>Memory: Query contextual user memories
    Memory-->>Engine: Return top-k memory matches
    Engine->>Model: Stream prompt + augmented system instructions
    Model-->>Engine: SSE chunk stream (tokens / structured actions)
    Engine-->>Edge: Real-time SSE token forwarding
    Edge-->>User: Incremental text render & dynamic artifact compilation
    Engine->>DB: Persist conversation history & metadata
```

### 2. Knowledge Ingestion & Vector Retrieval Workflow

```mermaid
flowchart TD
    subgraph Ingestion["Document Ingestion Pipeline"]
        Doc[Uploaded Document / File] --> Parse[Text & Markdown Extractor]
        Parse --> Chunk[Recursive Character Splitter]
        Chunk --> Embed[Ollama / Cloud Embedding Generator]
        Embed --> VectorStore[(ChromaDB Vector Store)]
        Parse --> Meta[(SQLite Document Index)]
    end

    subgraph Retrieval["Query Time Retrieval"]
        Query[User Message] --> QEmbed[Query Embedding]
        QEmbed --> SimSearch[Cosine Similarity Search]
        VectorStore --> SimSearch
        SimSearch --> Context[Relevant Chunk Injection]
        Context --> Synthesis[Response Generation]
    end
```

### 3. Continuous Integration Workflow (CI/CD)

```mermaid
flowchart LR
    Push([Git Push / PR]) --> CI{GitHub Actions}

    subgraph BackendJob["Backend Test Suite"]
        PythonSetup[Setup Python 3.12] --> DepInstall[Install pip dependencies]
        DepInstall --> Pytest[Run Pytest Suite]
    end

    subgraph FrontendJob["Frontend Verification"]
        NodeSetup[Setup Node.js 20] --> NpmInstall[npm ci]
        NpmInstall --> TypeCheck[TypeScript Type Check]
        TypeCheck --> Lint[Next.js Linter]
        Lint --> Build[Production Build]
    end

    CI --> BackendJob
    CI --> FrontendJob
    BackendJob --> Deployable([Ready for Deployment])
    FrontendJob --> Deployable
```

---

## How It's Built

PRAGNA 1-A is engineered as a decoupled, modern multi-service architecture prioritizing speed, developer ergonomics, and rock-solid reliability.

```mermaid
flowchart TD
    subgraph Presentation["Frontend Layer (Port 4028 / 3000)"]
        Next["Next.js 15 + React 19"]
        UIComp["Tailwind CSS + Lucide Icons"]
        Mermaid["Mermaid.js + CodeBlock Studio"]
        Store["Client State + LocalStorage Preferences"]
    end

    subgraph AppServer["Backend API Layer (Port 8000)"]
        API["FastAPI High-Concurrency Gateway"]
        AuthMiddleware["JWT Authentication & Rate Limiting"]
        Services["Document Gen | Browser Automation | Voice"]
        BackgroundWorker["Async Cron & Background Worker"]
    end

    subgraph Persistence["Storage & Data Layer"]
        SQL[(SQLite: pragna.db)]
        Vector[(ChromaDB Vector Database)]
        DiskStore["Document Archive & File Cache"]
    end

    Presentation <-->|"HTTP / SSE Streams"| AppServer
    AppServer <--> Persistence
```

### 1. Frontend Stack
- **Framework**: [Next.js 15](https://nextjs.org/) (App Router architecture)
- **UI Engine**: [React 19](https://react.dev/) with React Server Components & Client Hooks
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with custom responsive design & neural vortex animation canvas
- **Syntax & Diagrams**: Dynamic [Mermaid.js](https://mermaid.js.org/) rendering, Prism syntax highlighting, and KaTeX math formatting
- **Icons & Visuals**: [Lucide React](https://lucide.dev/)

### 2. Backend Stack
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.12) running under Uvicorn
- **Relational Persistence**: SQLite for conversations, users, tasks, and system configurations
- **Vector Search Engine**: [ChromaDB](https://www.trychroma.com/) for semantic retrieval and long-term memory embeddings
- **Web Automation**: Playwright headless browser engine for dynamic page inspection and content extraction
- **Document Processing**: Custom multi-format generator supporting PDF, DOCX, XLSX, and presentation files
- **Speech & Audio**: Voice capture, transcription, and speech synthesis services

### 3. Key Subsystems

| Subsystem | Responsibility |
| :--- | :--- |
| **Artifact Studio** | Live code sandboxing, interactive diagrams, and instant file generation directly from chat stream. |
| **Semantic Memory** | Cross-session preference recall and contextual user knowledge indexing using vector similarity. |
| **Knowledge Base (RAG)** | Automated document ingestion, recursive chunking, and similarity ranking. |
| **Browser Exploration** | Headless DOM parsing, screenshot capture, and web page content synthesis. |
| **Task Management** | Integrated Kanban board for organizing multi-step activities and background jobs. |
| **Pragna Design** | Turns a brief into linked, themed app or website screens that can be refined by chat or by clicking an element, with version history and HTML/PNG export. See [Pragna Design](#pragna-design). |
| **Rate Limiter & Guard** | In-memory token bucket rate limiting and payload validation protecting core endpoints. |

---

## Repository Structure

```text
pragna/
├── .github/
│   └── workflows/
│       └── ci.yml              # Automated testing and build validation pipeline
├── backend/
│   ├── app/
│   │   ├── routes/             # REST endpoints (chat, docs, auth, voice, tasks, etc.)
│   │   ├── artifact_service.py # Artifact management and exports
│   │   ├── browser_service.py  # Playwright browser automation
│   │   ├── chat_service.py     # Conversation orchestration and model routing
│   │   ├── db.py               # SQLite connection pool and schema migrations
│   │   ├── design_service.py   # Pragna Design: planning, screen generation, repair pass, pictures
│   │   ├── document_generator.py# PDF, Word, Excel, and Slide generators
│   │   ├── image_service.py    # Image generation and stock-photo lookup
│   │   ├── memory_service.py   # ChromaDB-backed semantic user memory
│   │   ├── rag.py              # Document ingestion and vector embeddings
│   │   ├── rate_limit.py       # Request throttling middleware
│   │   └── repository.py       # SQL data access layer
│   ├── tests/                  # Pytest verification suites
│   ├── Dockerfile              # Backend container definition
│   └── requirements.txt        # Python production dependencies
├── frontend/
│   ├── src/
│   │   ├── app/                # Next.js routes (chat, settings, tasks, share, design)
│   │   ├── components/         # Reusable UI widgets and layout modules
│   │   ├── context/            # Global React application state
│   │   └── lib/                # Utility helpers, streaming clients, API wrappers (design.ts)
│   ├── public/vendor/          # Pinned Tailwind script used by the Design preview
│   ├── Dockerfile              # Frontend container definition
│   └── package.json            # Node.js dependencies and run scripts
├── docker-compose.yml          # Multi-container orchestration
└── run.sh                      # Local startup script
```

---

## Pragna Design

`/design` turns a one-line brief into one complete interactive design for a mobile app or a website. Requested views live inside that design as local tabs, panels, or sections.

The workspace pairs a persistent design conversation with a zoomable canvas. Start with a brief, paste or drop a reference image, or use a starter idea. The project gallery fetches previews only when their cards are visible.

Open **Project tools** (the wrench) for the native workspace features:

- **Brands**: private design-system library with editable colors/fonts, brand rules, reusable HTML patterns, multiple brands and a default for new projects. Import CSS variables and conventions from source files or code ZIPs.
- **Sources**: import screenshots, PDFs, DOCX, PPTX, XLSX, SVG, text, source code and audio/video files (20 MB each; 20 references per project). Capture public website HTML or a selected element. Imports never execute uploaded scripts; screenshot references also reach the builder as an image.
- **Canvas**: layers, instant text/style edits, live previews, Alt-drag positioning, corner resizing, duplication, grouping, flipping, ordering and version-based undo/redo. Set artboard size and canvas position; duplicate an artboard or save the whole project as an exploration.
- **Directions and formats**: choose one fast direction or two/three alternatives. Presentation projects plan up to six slides; documents and marketing assets use dedicated briefs and artboard dimensions. Present completed artboards using arrow keys and Escape.
- **Comments and collaboration**: anchor comments to selected elements, resolve/reopen them, or apply them through AI. Owners grant registered accounts viewer, commenter or editor roles. Shared conversations show authors; active workspaces poll for changes every eight seconds. This is persisted collaboration, without live cursors or simultaneous text editing.
- **Share**: revocable view-only preview links work without login. Public previews omit conversations, comments and source documents. Private access stays restricted to owner and granted accounts.
- **Export**: HTML, ZIP, PNG, rendered multi-page PDF, PowerPoint with editable text over rendered artwork, and a coding handoff bundle containing source HTML, tokens, local Tailwind and HANDOFF.md. Chromium is required for PDF/PPTX; install it with `python -m playwright install chromium`. The backend Docker image bundles Chromium and the pinned Tailwind dependency.
- **Advanced prototypes**: native video/audio controls, self-contained Canvas/WebGL/shader scripts, browser voice input/playback, and host-brokered AI forms. Owners enable **AI demo** in Preview before model calls run. Microphone access depends on browser support and user permission. Exports explain which host services require reopening in Pragna.

Canva and Google Slides can import the exported PPTX. Direct partner publishing, connected-account OAuth, live coding-agent sync, enterprise administration and full native editing of every exported visual object are not implemented. Handoff bundles provide files and implementation instructions; they do not automatically change another repository.

Feature reference: [Claude Design's official guide](https://support.claude.com/en/articles/14604416-get-started-with-claude-design). Pragna implements its own native workflows rather than using Claude's private APIs.


- **Canvas**: select an element for a targeted change, use the hand tool to pan, or fit and focus screens. Shortcuts: `V` to select, `H` to pan, `0` to fit, and `+` / `-` to zoom.
- **Conversation**: follow-up messages refine the current design by default. Add a screen explicitly when needed; projects with several screens can also apply an edit to the entire design. Generation shows elapsed time and can be stopped without losing finished work. Follow-up edits include recent conversation context.
- **Inspect**: edit a single text element instantly, without a model call. Each change creates a restorable version; stale selections cannot overwrite a newer design.
- **Preview**: explore a screen at desktop, tablet, or mobile widths. Inputs and local prototype interactions work here; named links open matching project screens. New designs can include local tabs, filters, menus, and dialogs.
- **Design direction**: generation plans the audience, primary task, content sections, interaction trigger/result pairs, states, and responsive behavior. The workspace shows the plan and each generation stage; assistant replies support formatted text and tables.
- **Design checks**: review missing interaction targets, duplicate IDs, unlabeled controls, and theme contrast. When Chromium is installed, isolated browser smoke checks also detect script errors, horizontal overflow at 390/768/1280px, and sample up to six visible buttons. Findings feed the repair pass and remain available through a repair action. These are smoke checks, not full application verification; external services are blocked during checks. Browser reports use a bounded in-memory cache and are unavailable after a server restart until the design is checked again.
- **Theme and history**: apply a palette, typography, and corner radius across screens, or restore an earlier screen version. Theme writes are serialized to preserve the latest choice.
- **Export**: download one screen as HTML or PNG, or all completed screens as a ZIP containing linked HTML files and design tokens. Exported HTML uses Tailwind and Google Fonts CDNs.

The editor shares Pragna’s gold palette and light/dark appearance preference. On phones, existing projects open in a focused mobile preview, with the conversation available from the header.

**How a generation runs**

1. A planner call picks a project name, art direction, a brand theme (colours, font), generic photo search terms, and one complete design by default (or requested alternatives / presentation slides). It chooses a surface (Monitor, Operate, Compare, Configure, Decide/Learn, Explore, Inspect), a composition, and a detailed content/interaction specification. Generated text tokens are adjusted for readable contrast before building.
2. The design streams onto the canvas as HTML arrives, with model scripts removed from incomplete drafts. Drafts are not saved as versions or available for editing/export. The finished body is saved immediately, before photography. A shared local runtime handles declarative tabs (including keyboard navigation), disclosures, dialogs with focus restoration, search, category filters, validated forms, range output, and incidental demo feedback. Custom inline JavaScript handles domain logic such as cart totals or calculations. The runtime is included in standalone HTML exports.
3. Source checks and available browser smoke checks run after the first screen appears. A second AI pass runs only for findings from those checks, or when **Extra design polish** is selected. Repairs that add broken targets, remove prototype behavior, or regress browser findings are rejected. The repair call has a 60-second budget and preserves the first version on failure.
4. Photography is deferred until after the first saved screen. Photo resolution and filling share a 30-second budget; unfilled slots retain theme colours and a notice explains the timeout. Sources remain Codex, public-domain or CC0 Wikimedia Commons, then Gemini image.

**Configuration** (`backend/app/design_service.py`)

| Setting | Value |
| :--- | :--- |
| `DESIGN_MODEL` (environment override) | `antigravity/gemini-3.7-flash-medium` through OmniRoute |
| `DESIGN_PLAN_MODEL` (environment override) | `antigravity/gemini-3.7-flash-low`, 2,048-token planning budget |
| `DESIGN_FALLBACK_MODEL` (environment override) | `ollama-cloud/gemma4:31b`; set empty to disable |
| `DESIGN_MAX_TOKENS` | `24576`, the page output budget |
| `IMAGE_SOURCES` | Codex terra, Codex luna, Wikimedia Commons, Gemini image |

OmniRoute is reached with `OMNIROUTE_BASE_URL` and `OMNIROUTE_API_KEY` in `backend/.env`.

**Things to know**

- Planning has a 25-second total budget and falls back to a minimal plan if unavailable. Models that produce no content within 10 seconds (planning) or 20 seconds (building) switch to the configured fallback. An unavailable provider is skipped for 90 seconds so page construction does not repeat the planner's wait. Failover occurs only before content begins; partial output from different models is never mixed. No model provider availability is guaranteed.
- SSE heartbeats keep the proxy connection alive during planning; draft events are throttled and queue size is bounded. Stopping cancels model and finishing tasks while retaining completed versions. The frontend proxy (`proxyTimeout` in `frontend/next.config.mjs`) must stay longer than a generation.
- The in-app preview loads a pinned Tailwind copy from `frontend/public/vendor/`. Exported HTML uses the Tailwind CDN link and embeds its pictures, so it works on its own.
- Image providers rate limit. A provider that answers 429 or 502 is skipped for 60 seconds. Codex is used for pictures only, never for text.
- Tests: `cd backend && .venv/bin/python -m pytest tests/test_design.py -q`.
- Browser checks and interaction tests: install Chromium with `cd backend && .venv/bin/python -m playwright install chromium`, then run `.venv/bin/python -m pytest tests/test_design.py tests/test_design_workspace.py tests/test_design_runtime.py tests/test_design_features.py -q`. Generation remains available without Chromium; the UI identifies source-only checks.

---

## Getting Started

### Prerequisites
- **Node.js**: v20.x or later
- **Python**: v3.12 or later
- **Docker & Docker Compose** (optional, recommended for production)

### Quick Start with Docker

```bash
# 1. Clone repository
git clone https://github.com/vinay3254/pragna.git
cd pragna

# 2. Build and run services
docker compose up --build
```
Access the application at `http://localhost:4028` (or `http://localhost:3000`).

---

### Manual Setup (Local Development)

#### 1. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3.12 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Configure environment variables
cp .env.example .env

# Run development server
uvicorn app.main:create_app --factory --reload --port 8000
```

#### 2. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Open `http://localhost:4028` in your browser.

---

## Testing & Validation

Run comprehensive verification across both tiers:

```bash
# Backend test suite
cd backend
pytest

# Frontend type checking and build test
cd ../frontend
npm run type-check
npm run build
```

---

## Contributors

- **Vinay G K** ([@vinay3254](https://github.com/vinay3254)) — Lead Developer & Maintainer
- **Reshma Banu** ([@reshmabanu2823](https://github.com/reshmabanu2823)) — Contributor

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
