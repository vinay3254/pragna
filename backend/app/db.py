import logging
import re
import sqlite3
from pathlib import Path
from typing import Any

try:
    import psycopg
    from psycopg.errors import IntegrityError as PgIntegrityError
    from psycopg_pool import ConnectionPool
    HAS_PSYCOPG = True
except ImportError:
    HAS_PSYCOPG = False
    PgIntegrityError = Exception
    ConnectionPool = None

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    oauth_provider TEXT,
    oauth_id TEXT,
    name TEXT,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free'
);
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active_leaf_id INTEGER REFERENCES messages(id),
    user_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    feedback TEXT,
    sources TEXT,
    parent_id INTEGER REFERENCES messages(id),
    model TEXT
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    chunk_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    title TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    memory_key TEXT,
    created_at TEXT NOT NULL,
    source_conversation_id INTEGER REFERENCES conversations(id),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    tool_name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    result TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trajectories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id INTEGER,
    tool_name TEXT NOT NULL,
    arguments_json TEXT,
    result_summary TEXT,
    status TEXT NOT NULL,
    error TEXT,
    duration_ms REAL,
    created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
    conversation_id,
    message_id,
    role,
    content
);
CREATE TABLE IF NOT EXISTS kanban_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    conversation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    schedule_expression TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    conversation_id TEXT,
    created_at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shared_conversations (
    token TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    owner_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'demo',
    current_period_end TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT 'mobile',
    theme TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_screens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    current_version_id INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_screen_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screen_id INTEGER NOT NULL REFERENCES design_screens(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    prompt TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_messages_project ON design_messages(project_id, id);

"""

SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    oauth_provider TEXT,
    oauth_id TEXT,
    name TEXT,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free'
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
CREATE TABLE IF NOT EXISTS conversations (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active_leaf_id BIGINT,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    feedback TEXT,
    sources TEXT,
    parent_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    model TEXT
);
CREATE TABLE IF NOT EXISTS documents (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    ingested_at TEXT NOT NULL,
    chunk_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source_conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_key TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE TABLE IF NOT EXISTS tool_calls (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    result TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trajectories (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id BIGINT,
    tool_name TEXT NOT NULL,
    arguments_json TEXT,
    result_summary TEXT,
    status TEXT NOT NULL,
    error TEXT,
    duration_ms REAL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kanban_tasks (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    conversation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    prompt TEXT NOT NULL,
    schedule_expression TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    conversation_id TEXT,
    created_at TEXT NOT NULL
);
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS last_run TEXT;
ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user_id ON scheduled_jobs(user_id);
CREATE TABLE IF NOT EXISTS shared_conversations (
    token TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_otps (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'demo',
    current_period_end TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_content_tsv ON messages USING gin(to_tsvector('english', content));
CREATE TABLE IF NOT EXISTS design_projects (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT 'mobile',
    theme TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_screens (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    current_version_id BIGINT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_screen_versions (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    screen_id BIGINT NOT NULL REFERENCES design_screens(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    prompt TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_messages (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_messages_project ON design_messages(project_id, id);

"""

PG_ENABLE_RLS = """
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE trajectories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_screen_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_messages ENABLE ROW LEVEL SECURITY;
"""


class PgRow:
    """
    Row adapter that mirrors sqlite3.Row functionality:
    - Index access: row[0], row[1]
    - Tuple unpacking: (a, b) = row
    - Column name access: row["id"], row["email"]
    - Dictionary conversion: dict(row)
    - Key membership: "id" in row
    - dict-like methods: keys(), values(), items(), get()
    """
    def __init__(self, cols: list[str], values: tuple | list):
        self._cols = list(cols)
        self._values = tuple(values)
        self._dict = dict(zip(self._cols, self._values))

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, (int, slice)):
            return self._values[key]
        return self._dict[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self._dict.get(key, default)

    def keys(self) -> list[str]:
        return self._cols

    def values(self) -> tuple:
        return self._values

    def items(self):
        return self._dict.items()

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __contains__(self, key: Any) -> bool:
        return key in self._dict

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, PgRow):
            return self._dict == other._dict
        if isinstance(other, dict):
            return self._dict == other
        if isinstance(other, (tuple, list)):
            return self._values == tuple(other)
        return False

    def __repr__(self) -> str:
        return f"<PgRow {self._dict}>"


def translate_sql_for_pg(sql: str) -> tuple[str, bool]:
    """
    Translates raw SQLite queries into Postgres-compatible SQL:
    - Skips PRAGMA statements (returns empty string)
    - Rewrites datetime('now') to CURRENT_TIMESTAMP
    - Rewrites json(?) to %s
    - Rewrites ? placeholders to %s
    - Appends RETURNING id on INSERTs (except shared_conversations) for lastrowid support
    """
    trimmed = sql.strip()
    if trimmed.upper().startswith("PRAGMA"):
        return "", False

    # datetime('now') translation
    translated = re.sub(r"datetime\s*\(\s*['\"]now['\"]\s*\)", "CURRENT_TIMESTAMP", sql, flags=re.IGNORECASE)
    
    # json(?) translation
    translated = re.sub(r"json\s*\(\s*\?\s*\)", "%s", translated, flags=re.IGNORECASE)

    # Placeholder ? -> %s
    translated = translated.replace("?", "%s")

    returns_id = False
    if re.search(r"^\s*INSERT\s+INTO\s+", translated, re.IGNORECASE):
        if not re.search(r"\bRETURNING\b", translated, re.IGNORECASE):
            if not re.search(r"\bINSERT\s+INTO\s+shared_conversations\b", translated, re.IGNORECASE):
                translated = translated.rstrip().rstrip(";") + " RETURNING id"
                returns_id = True

    return translated, returns_id


_pool_cache: dict[str, Any] = {}


def get_pg_pool(database_url: str) -> Any:
    if not HAS_PSYCOPG:
        raise RuntimeError("psycopg and psycopg_pool are required for Postgres support. Please install them.")
    global _pool_cache
    if database_url not in _pool_cache or _pool_cache[database_url].closed:
        _pool_cache[database_url] = ConnectionPool(
            conninfo=database_url,
            min_size=1,
            max_size=5,
            # Supabase's pooler drops idle connections. Validate a connection before handing it out,
            # recycle idle ones before the server does, and fail fast instead of blocking the
            # event loop for the default 30s pool timeout.
            check=ConnectionPool.check_connection,
            max_idle=60,
            timeout=10,
            kwargs={
                "autocommit": True,
                "sslmode": "require",
                "connect_timeout": 10,
                "keepalives": 1,
                "keepalives_idle": 30,
                "keepalives_interval": 10,
                "keepalives_count": 3,
            },
            open=True,
        )
    return _pool_cache[database_url]


class PgCursor:
    def __init__(self, pool: Any):
        self._pool = pool
        self._rows: list[PgRow] = []
        self._idx: int = 0
        self.lastrowid: int | None = None
        self.rowcount: int = -1
        self.description: list | None = None

    def execute(self, sql: str, parameters: Any = None) -> "PgCursor":
        translated_sql, returns_id = translate_sql_for_pg(sql)
        if not translated_sql:
            self._rows = []
            self.rowcount = 0
            self.description = None
            self.lastrowid = None
            return self

        try:
            with self._pool.connection() as conn:
                with conn.cursor() as cur:
                    if parameters is not None:
                        cur.execute(translated_sql, parameters)
                    else:
                        cur.execute(translated_sql)

                    self.rowcount = cur.rowcount
                    self.description = cur.description

                    if returns_id:
                        try:
                            ret_row = cur.fetchone()
                            if ret_row:
                                self.lastrowid = ret_row[0]
                        except Exception:
                            pass
                        self._rows = []
                        self._idx = 0
                    elif cur.description:
                        cols = [d.name for d in cur.description]
                        raw_rows = cur.fetchall()
                        self._rows = [PgRow(cols, r) for r in raw_rows]
                        self._idx = 0
                    else:
                        self._rows = []
                        self._idx = 0
        except PgIntegrityError as exc:
            raise sqlite3.IntegrityError(str(exc)) from exc
        except Exception as exc:
            raise exc

        return self

    def executemany(self, sql: str, seq_of_parameters: Any) -> "PgCursor":
        translated_sql, _ = translate_sql_for_pg(sql)
        if not translated_sql:
            self._rows = []
            self.rowcount = 0
            return self

        try:
            with self._pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.executemany(translated_sql, seq_of_parameters)
                    self.rowcount = cur.rowcount
                    self.description = cur.description
                    self._rows = []
                    self._idx = 0
        except PgIntegrityError as exc:
            raise sqlite3.IntegrityError(str(exc)) from exc
        except Exception as exc:
            raise exc

        return self

    def fetchone(self) -> PgRow | None:
        if self._idx < len(self._rows):
            row = self._rows[self._idx]
            self._idx += 1
            return row
        return None

    def fetchall(self) -> list[PgRow]:
        if self._idx < len(self._rows):
            res = self._rows[self._idx:]
            self._idx = len(self._rows)
            return res
        return []

    def fetchmany(self, size: int = 1) -> list[PgRow]:
        end = min(self._idx + size, len(self._rows))
        res = self._rows[self._idx:end]
        self._idx = end
        return res

    def close(self) -> None:
        self._rows = []
        self._idx = 0

    def __enter__(self) -> "PgCursor":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


class PgConnection:
    """
    Connection adapter implementing standard sqlite3.Connection methods on top of Postgres.
    """
    def __init__(self, database_url: str):
        self.database_url = database_url
        self._pool = get_pg_pool(database_url)
        self.row_factory = None

    def cursor(self) -> PgCursor:
        return PgCursor(self._pool)

    def execute(self, sql: str, parameters: Any = None) -> PgCursor:
        cur = self.cursor()
        return cur.execute(sql, parameters)

    def executemany(self, sql: str, seq_of_parameters: Any) -> PgCursor:
        cur = self.cursor()
        return cur.executemany(sql, seq_of_parameters)

    def executescript(self, script: str) -> None:
        for stmt in script.strip().split(";"):
            clean_stmt = stmt.strip()
            if clean_stmt:
                self.execute(clean_stmt)

    def commit(self) -> None:
        pass  # Autocommit enabled

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass

    def __enter__(self) -> "PgConnection":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


def _migrate_conversations_user_id(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()]
    if "user_id" not in columns:
        conn.execute("ALTER TABLE conversations ADD COLUMN user_id INTEGER REFERENCES users(id)")


def _migrate_users_oauth_columns(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "oauth_provider" in columns:
        return

    conn.execute(
        """
        CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            created_at TEXT NOT NULL,
            oauth_provider TEXT,
            oauth_id TEXT,
            name TEXT,
            avatar_url TEXT
        )
        """
    )
    conn.execute(
        "INSERT INTO users_new (id, email, password_hash, created_at) "
        "SELECT id, email, password_hash, created_at FROM users"
    )
    conn.execute("DROP TABLE users")
    conn.execute("ALTER TABLE users_new RENAME TO users")


def _migrate_memories_user_id(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(memories)").fetchall()]
    if "memory_key" not in columns:
        conn.execute("ALTER TABLE memories ADD COLUMN memory_key TEXT")
    if "user_id" not in columns:
        try:
            conn.execute("ALTER TABLE memories ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
        except Exception:
            pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)")


def _migrate_scheduled_jobs_columns(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(scheduled_jobs)").fetchall()]
    if "title" not in columns:
        try:
            conn.execute("ALTER TABLE scheduled_jobs ADD COLUMN title TEXT")
        except Exception:
            pass
    if "last_run" not in columns:
        try:
            conn.execute("ALTER TABLE scheduled_jobs ADD COLUMN last_run TEXT")
        except Exception:
            pass
    if "user_id" not in columns:
        try:
            conn.execute("ALTER TABLE scheduled_jobs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
        except Exception:
            pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user_id ON scheduled_jobs(user_id)")


def _migrate_users_plan_column(conn: sqlite3.Connection) -> None:
    columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "plan" not in columns:
        try:
            conn.execute("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'")
        except Exception:
            pass


def init_db(db_path: str, database_url: str | None = None) -> None:
    if database_url and database_url.strip():
        logger.info("Database backend active: postgres")
        if not HAS_PSYCOPG:
            raise RuntimeError("psycopg and psycopg_pool are required when DATABASE_URL is set.")
        with psycopg.connect(database_url, autocommit=True, sslmode="require") as conn:
            with conn.cursor() as cur:
                for stmt in SCHEMA_PG.strip().split(";"):
                    s = stmt.strip()
                    if s:
                        cur.execute(s)
                for stmt in PG_ENABLE_RLS.strip().split(";"):
                    s = stmt.strip()
                    if s:
                        try:
                            cur.execute(s)
                        except Exception as exc:
                            logger.debug("RLS statement note: %s", exc)
        return

    logger.info("Database backend active: sqlite")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.executescript(SCHEMA)
    _migrate_conversations_user_id(conn)
    _migrate_users_oauth_columns(conn)
    _migrate_users_plan_column(conn)
    _migrate_memories_user_id(conn)
    _migrate_scheduled_jobs_columns(conn)
    conn.commit()
    conn.close()


def get_connection(db_path: str, database_url: str | None = None) -> Any:
    if database_url and database_url.strip():
        return PgConnection(database_url)

    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn
