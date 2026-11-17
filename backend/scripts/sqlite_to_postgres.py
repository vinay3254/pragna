"""
Database Migration Script: SQLite to Supabase PostgreSQL

Copies all existing data from the local SQLite database into PostgreSQL
in foreign-key dependency order and resets identity sequences.

Usage:
    python scripts/sqlite_to_postgres.py
"""

import os
import sys
import sqlite3
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.config import get_settings
from app.db import init_db

try:
    import psycopg
except ImportError:
    print("Error: psycopg is required. Run `pip install psycopg[binary]`")
    sys.exit(1)

TABLES_IN_ORDER = [
    "users",
    "documents",
    "conversations",
    "messages",
    "artifacts",
    "memories",
    "tool_calls",
    "trajectories",
    "kanban_tasks",
    "scheduled_jobs",
    "shared_conversations",
    "email_otps",
    "password_resets",
]


def migrate():
    settings = get_settings()

    if not settings.database_url:
        print("Error: DATABASE_URL is not set in environment or .env file.")
        sys.exit(1)

    sqlite_path = Path(settings.db_path)
    if not sqlite_path.exists():
        print(f"Warning: SQLite database file not found at {sqlite_path}. Nothing to migrate.")
        return

    print("1. Initializing Postgres database schema and RLS...")
    init_db(settings.db_path, settings.database_url)

    print(f"2. Connecting to SQLite ({sqlite_path}) and PostgreSQL...")
    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row

    with psycopg.connect(settings.database_url, autocommit=True, sslmode="require") as pg_conn:
        with pg_conn.cursor() as pg_cur:
            total_migrated = 0

            for table in TABLES_IN_ORDER:
                # Check if table exists in SQLite
                table_check = sqlite_conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()
                if not table_check:
                    continue

                rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
                if not rows:
                    print(f"   - {table}: 0 rows (skipped)")
                    continue

                cols = [col[1] for col in sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall()]
                cols_str = ", ".join(cols)
                placeholders = ", ".join(["%s"] * len(cols))
                conflict_col = "token" if table == "shared_conversations" else "id"

                insert_sql = (
                    f"INSERT INTO {table} ({cols_str}) VALUES ({placeholders}) "
                    f"ON CONFLICT ({conflict_col}) DO NOTHING"
                )

                row_values = [tuple(row[col] for col in cols) for row in rows]
                pg_cur.executemany(insert_sql, row_values)
                count = len(row_values)
                total_migrated += count
                print(f"   - {table}: {count} row(s) migrated")

                # Reset sequence for tables with identity id
                if table != "shared_conversations":
                    try:
                        seq_sql = (
                            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                            f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false);"
                        )
                        pg_cur.execute(seq_sql)
                    except Exception as e:
                        pass

    sqlite_conn.close()
    print(f"\nMigration completed successfully! Total rows processed: {total_migrated}")


if __name__ == "__main__":
    migrate()
