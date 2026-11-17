import logging
import sqlite3
import pytest
from app.db import (
    PgRow,
    translate_sql_for_pg,
    PgCursor,
    init_db,
    get_connection,
)


def test_translate_sql_placeholder_rewrite():
    sql = "SELECT * FROM users WHERE email = ? AND oauth_provider = ?"
    translated, returns_id = translate_sql_for_pg(sql)
    assert translated == "SELECT * FROM users WHERE email = %s AND oauth_provider = %s"
    assert returns_id is False


def test_translate_sql_datetime_now():
    sql = "INSERT INTO kanban_tasks (title, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))"
    translated, returns_id = translate_sql_for_pg(sql)
    assert "CURRENT_TIMESTAMP" in translated
    assert "datetime('now')" not in translated
    assert translated.endswith("RETURNING id")
    assert returns_id is True


def test_translate_sql_json_placeholder():
    sql = "INSERT INTO trajectories (conversation_id, arguments_json) VALUES (?, json(?))"
    translated, returns_id = translate_sql_for_pg(sql)
    assert "json(?)" not in translated
    assert "%s, %s" in translated
    assert translated.endswith("RETURNING id")
    assert returns_id is True


def test_translate_sql_insert_returning_id_injection():
    sql = "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)"
    translated, returns_id = translate_sql_for_pg(sql)
    assert translated == "INSERT INTO users (email, password_hash, created_at) VALUES (%s, %s, %s) RETURNING id"
    assert returns_id is True

    # Already has RETURNING
    sql_with_returning = "INSERT INTO users (email) VALUES (?) RETURNING id"
    translated2, returns_id2 = translate_sql_for_pg(sql_with_returning)
    assert translated2 == "INSERT INTO users (email) VALUES (%s) RETURNING id"
    assert returns_id2 is False


def test_translate_sql_insert_shared_conversations_skips_returning_id():
    sql = "INSERT INTO shared_conversations (token, title, content, created_at) VALUES (?, ?, ?, ?)"
    translated, returns_id = translate_sql_for_pg(sql)
    assert "RETURNING id" not in translated
    assert returns_id is False


def test_translate_sql_pragma_skipped():
    for pragma in [
        "PRAGMA journal_mode = WAL",
        "PRAGMA busy_timeout = 30000",
        "PRAGMA synchronous = NORMAL",
        "PRAGMA table_info(conversations)",
    ]:
        translated, returns_id = translate_sql_for_pg(pragma)
        assert translated == ""
        assert returns_id is False


def test_pg_row_interface_parity_with_sqlite3_row():
    cols = ["id", "email", "name", "created_at"]
    vals = (1, "user@example.com", "Test User", "2026-01-01T00:00:00Z")
    row = PgRow(cols, vals)

    # 1. Index access
    assert row[0] == 1
    assert row[1] == "user@example.com"
    assert row[2] == "Test User"
    assert row[3] == "2026-01-01T00:00:00Z"

    # 2. Tuple unpacking
    u_id, u_email, u_name, u_created = row
    assert u_id == 1
    assert u_email == "user@example.com"
    assert u_name == "Test User"

    # 3. Column name access
    assert row["id"] == 1
    assert row["email"] == "user@example.com"
    assert row["name"] == "Test User"

    # 4. dict(row) conversion
    row_dict = dict(row)
    assert row_dict == {
        "id": 1,
        "email": "user@example.com",
        "name": "Test User",
        "created_at": "2026-01-01T00:00:00Z",
    }

    # 5. Dict methods
    assert row.get("email") == "user@example.com"
    assert row.get("nonexistent", "default") == "default"
    assert list(row.keys()) == cols
    assert tuple(row.values()) == vals
    assert ("email", "user@example.com") in row.items()

    # 6. Membership and length
    assert "email" in row
    assert "missing" not in row
    assert len(row) == 4


def test_pg_cursor_integrity_error_wrapping():
    class MockPool:
        def connection(self):
            class MockConnCtx:
                def __enter__(self):
                    class MockConn:
                        def cursor(self):
                            class MockCur:
                                def __enter__(self):
                                    return self

                                def __exit__(self, *args):
                                    pass

                                def execute(self, sql, params=None):
                                    import psycopg.errors
                                    raise psycopg.errors.UniqueViolation("duplicate key value violates unique constraint")
                            return MockCur()
                    return MockConn()

                def __exit__(self, *args):
                    pass
            return MockConnCtx()

    cursor = PgCursor(MockPool())
    with pytest.raises(sqlite3.IntegrityError) as exc_info:
        cursor.execute("INSERT INTO users (email) VALUES (?)", ("dup@example.com",))
    assert "unique constraint" in str(exc_info.value)


def test_safe_logging_does_not_leak_credentials(caplog):
    caplog.set_level(logging.INFO)
    db_url = "postgresql://myuser:supersecretpass123@db.supabase.co:5432/postgres"

    # Mock psycopg.connect so we don't need real network
    import psycopg

    class DummyConn:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def cursor(self):
            class DummyCur:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    pass

                def execute(self, stmt):
                    pass
            return DummyCur()

    import unittest.mock as mock
    with mock.patch("psycopg.connect", return_value=DummyConn()):
        init_db("data/test.db", database_url=db_url)

    log_text = caplog.text
    assert "Database backend active: postgres" in log_text
    # Secret credentials must NEVER be in the log output
    assert "supersecretpass123" not in log_text
    assert "myuser" not in log_text
    assert db_url not in log_text
