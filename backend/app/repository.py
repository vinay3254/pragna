import hashlib
import hmac
import json
from datetime import datetime, timezone


def hash_secret(value: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_user(conn, email: str, password_hash: str, name: str | None = None) -> int:
    if not email or not isinstance(email, str) or not email.strip():
        raise ValueError("A valid email address is required to create a user.")
    if not password_hash or not isinstance(password_hash, str) or not password_hash.strip():
        raise ValueError("A valid password hash is required to create a user.")
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at, name) VALUES (?, ?, ?, ?)",
        (email.strip().lower(), password_hash, _now(), name),
    )
    conn.commit()
    return cur.lastrowid


def get_user_by_email_or_username(conn, identifier: str) -> dict | None:
    row = conn.execute(
        "SELECT id, email, password_hash, created_at, oauth_provider, oauth_id, name, avatar_url, COALESCE(plan, 'free') as plan "
        "FROM users WHERE lower(email) = lower(?) OR name = ?",
        (identifier, identifier),
    ).fetchone()
    return dict(row) if row else None


def update_user_password(conn, user_id: int, password_hash: str) -> bool:
    cur = conn.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (password_hash, user_id),
    )
    conn.commit()
    return cur.rowcount > 0


def delete_user(conn, user_id: int) -> bool:
    # Delete user conversations and data
    convs = conn.execute("SELECT id FROM conversations WHERE user_id = ?", (user_id,)).fetchall()
    for (cid,) in convs:
        delete_conversation(conn, cid)
    cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    return cur.rowcount > 0


def get_user(conn, user_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, email, password_hash, created_at, oauth_provider, oauth_id, name, avatar_url, COALESCE(plan, 'free') as plan "
        "FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def get_user_by_email(conn, email: str) -> dict | None:
    row = conn.execute(
        "SELECT id, email, password_hash, created_at, oauth_provider, oauth_id, name, avatar_url, COALESCE(plan, 'free') as plan "
        "FROM users WHERE email = ?",
        (email,),
    ).fetchone()
    return dict(row) if row else None


def link_oauth_to_user(
    conn, user_id: int, oauth_provider: str, oauth_id: str, name: str | None, avatar_url: str | None
) -> None:
    conn.execute(
        "UPDATE users SET oauth_provider = ?, oauth_id = ?, "
        "name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?",
        (oauth_provider, oauth_id, name, avatar_url, user_id),
    )
    conn.commit()


def get_or_create_oauth_user(
    conn, email: str, oauth_provider: str, oauth_id: str, name: str | None, avatar_url: str | None
) -> tuple[int, bool]:
    existing = get_user_by_email(conn, email)
    if existing:
        link_oauth_to_user(conn, existing["id"], oauth_provider, oauth_id, name, avatar_url)
        return existing["id"], False

    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at, oauth_provider, oauth_id, name, avatar_url) "
        "VALUES (?, NULL, ?, ?, ?, ?, ?)",
        (email, _now(), oauth_provider, oauth_id, name, avatar_url),
    )
    conn.commit()
    return cur.lastrowid, True


def count_users(conn) -> int:
    row = conn.execute("SELECT COUNT(*) as n FROM users").fetchone()
    return row["n"]


def assign_ownerless_conversations(conn, user_id: int) -> int:
    cur = conn.execute("UPDATE conversations SET user_id = ? WHERE user_id IS NULL", (user_id,))
    conn.commit()
    return cur.rowcount


def create_conversation(conn, title: str, user_id: int) -> int:
    cur = conn.execute(
        "INSERT INTO conversations (title, created_at, user_id) VALUES (?, ?, ?)",
        (title, _now(), user_id),
    )
    conn.commit()
    return cur.lastrowid


def get_conversation(conn, conversation_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, title, created_at, active_leaf_id, user_id FROM conversations WHERE id = ?",
        (conversation_id,),
    ).fetchone()
    return dict(row) if row else None


def list_conversations(conn, user_id: int, query: str | None = None) -> list[dict]:
    if query:
        rows = conn.execute(
            """
            SELECT DISTINCT c.id, c.title, c.created_at FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.user_id = ? AND (c.title LIKE ? OR m.content LIKE ?)
            ORDER BY c.created_at DESC
            """,
            (user_id, f"%{query}%", f"%{query}%"),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, title, created_at FROM conversations WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def rename_conversation(conn, conversation_id: int, title: str) -> bool:
    cur = conn.execute(
        "UPDATE conversations SET title = ? WHERE id = ?", (title, conversation_id)
    )
    conn.commit()
    return cur.rowcount > 0


def delete_conversation(conn, conversation_id: int) -> bool:
    """Deletes a conversation and all its cascading records cleanly."""
    conn.execute(
        "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)",
        (conversation_id,),
    )
    conn.execute(
        "DELETE FROM artifacts WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)",
        (conversation_id,),
    )
    conn.execute(
        "DELETE FROM trajectories WHERE conversation_id = ?",
        (str(conversation_id),),
    )
    conn.execute(
        "DELETE FROM memories WHERE source_conversation_id = ?",
        (conversation_id,),
    )
    conn.execute(
        "DELETE FROM conversation_fts WHERE conversation_id = ?",
        (conversation_id,),
    )
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?",
        (conversation_id,),
    )
    cur = conn.execute(
        "DELETE FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    conn.commit()
    return cur.rowcount > 0


def add_message(
    conn,
    conversation_id: int,
    role: str,
    content: str,
    parent_id: int | None = None,
    sources: list[dict] | None = None,
    model: str | None = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO messages (conversation_id, role, content, created_at, feedback, sources, parent_id, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            conversation_id,
            role,
            content,
            _now(),
            None,
            json.dumps(sources) if sources else None,
            parent_id,
            model,
        ),
    )
    conn.commit()
    message_id = cur.lastrowid
    set_active_leaf(conn, conversation_id, message_id)
    return message_id


def update_message_content(conn, message_id: int, content: str) -> None:
    conn.execute(
        "UPDATE messages SET content = ? WHERE id = ?", (content, message_id)
    )
    conn.commit()


def list_messages(conn, conversation_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, conversation_id, role, content, created_at, feedback, sources, parent_id, model
        FROM messages WHERE conversation_id = ? ORDER BY id ASC
        """,
        (conversation_id,),
    ).fetchall()
    result = []
    for row in rows:
        item = _enrich_message(conn, dict(row))
        result.append(item)
    return result


def get_message(conn, message_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT id, conversation_id, role, content, created_at, feedback, sources, parent_id, model
        FROM messages WHERE id = ?
        """,
        (message_id,),
    ).fetchone()
    if not row:
        return None
    return _enrich_message(conn, dict(row))


def _enrich_message(conn, item: dict) -> dict:
    item["sources"] = json.loads(item["sources"]) if item["sources"] else None
    msg_id = item["id"]

    # Attach artifacts summary [{id, title, language}]
    art_rows = conn.execute(
        "SELECT id, title, language FROM artifacts WHERE message_id = ? ORDER BY id ASC",
        (msg_id,),
    ).fetchall()
    item["artifacts"] = [dict(r) for r in art_rows]

    # Attach tool calls [{id, tool_name, arguments, result, status, created_at}]
    tc_rows = conn.execute(
        "SELECT id, tool_name, arguments, result, status, created_at FROM tool_calls WHERE message_id = ? ORDER BY id ASC",
        (msg_id,),
    ).fetchall()
    tool_calls = []
    for r in tc_rows:
        d = dict(r)
        try:
            d["arguments"] = json.loads(d["arguments"])
        except Exception:
            pass
        if d["result"]:
            try:
                d["result"] = json.loads(d["result"])
            except Exception:
                pass
        tool_calls.append(d)
    item["tool_calls"] = tool_calls

    return item


def get_path_to_root(conn, message_id: int) -> list[dict]:
    path = []
    current_id = message_id
    while current_id is not None:
        message = get_message(conn, current_id)
        if not message:
            break
        path.append(message)
        current_id = message["parent_id"]
    path.reverse()
    return path


def set_active_leaf(conn, conversation_id: int, message_id: int) -> bool:
    row = conn.execute(
        "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
        (message_id, conversation_id),
    ).fetchone()
    if not row:
        return False
    conn.execute(
        "UPDATE conversations SET active_leaf_id = ? WHERE id = ?",
        (message_id, conversation_id),
    )
    conn.commit()
    return True


def set_feedback(conn, message_id: int, rating: str) -> bool:
    cur = conn.execute(
        "UPDATE messages SET feedback = ? WHERE id = ?", (rating, message_id)
    )
    conn.commit()
    return cur.rowcount > 0


# --- Artifacts Repository ---

def create_artifact(conn, message_id: int, title: str, language: str | None, content: str) -> int:
    cur = conn.execute(
        """
        INSERT INTO artifacts (message_id, title, language, content, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (message_id, title, language, content, _now()),
    )
    conn.commit()
    return cur.lastrowid


def get_artifact(conn, artifact_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, message_id, title, language, content, created_at FROM artifacts WHERE id = ?",
        (artifact_id,),
    ).fetchone()
    return dict(row) if row else None


def list_artifacts_for_message(conn, message_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, message_id, title, language, content, created_at FROM artifacts WHERE message_id = ? ORDER BY id ASC",
        (message_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# --- Memories Repository ---

def create_memory(
    conn, content: str, source_conversation_id: int | None = None, user_id: int | None = None
) -> int:
    cur = conn.execute(
        """
        INSERT INTO memories (content, created_at, source_conversation_id, user_id)
        VALUES (?, ?, ?, ?)
        """,
        (content, _now(), source_conversation_id, user_id),
    )
    conn.commit()
    return cur.lastrowid


def get_memory(conn, memory_id: int, user_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, content, created_at, source_conversation_id FROM memories WHERE id = ? AND user_id = ?",
        (memory_id, user_id),
    ).fetchone()
    return dict(row) if row else None


def list_memories(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, content, created_at, source_conversation_id FROM memories "
        "WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def delete_memory(conn, memory_id: int, user_id: int) -> bool:
    cur = conn.execute("DELETE FROM memories WHERE id = ? AND user_id = ?", (memory_id, user_id))
    conn.commit()
    return cur.rowcount > 0


# --- Tool Calls Repository ---

def create_tool_call(conn, message_id: int, tool_name: str, arguments: dict | str, status: str = "pending") -> int:
    args_str = json.dumps(arguments) if isinstance(arguments, dict) else arguments
    cur = conn.execute(
        """
        INSERT INTO tool_calls (message_id, tool_name, arguments, result, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (message_id, tool_name, args_str, None, status, _now()),
    )
    conn.commit()
    return cur.lastrowid


def update_tool_call(conn, tool_call_id: int, result: dict | str | None, status: str) -> bool:
    res_str = json.dumps(result) if isinstance(result, (dict, list)) else (result if result is not None else None)
    cur = conn.execute(
        "UPDATE tool_calls SET result = ?, status = ? WHERE id = ?",
        (res_str, status, tool_call_id),
    )
    conn.commit()
    return cur.rowcount > 0


def get_tool_call(conn, tool_call_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, message_id, tool_name, arguments, result, status, created_at FROM tool_calls WHERE id = ?",
        (tool_call_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["arguments"] = json.loads(d["arguments"])
    except Exception:
        pass
    if d["result"]:
        try:
            d["result"] = json.loads(d["result"])
        except Exception:
            pass
    return d


def list_tool_calls_for_message(conn, message_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, message_id, tool_name, arguments, result, status, created_at FROM tool_calls WHERE message_id = ? ORDER BY id ASC",
        (message_id,),
    ).fetchall()
    res = []
    for r in rows:
        d = dict(r)
        try:
            d["arguments"] = json.loads(d["arguments"])
        except Exception:
            pass
        if d["result"]:
            try:
                d["result"] = json.loads(d["result"])
            except Exception:
                pass
        res.append(d)
    return res


def get_latest_generated_image(conn, conversation_id: int) -> str | None:
    """Most recent generate_image/edit_image result's image_base64 for this
    conversation, so edit_image can find something to edit without the user
    re-attaching it."""
    row = conn.execute(
        """
        SELECT tc.result FROM tool_calls tc
        JOIN messages m ON m.id = tc.message_id
        WHERE m.conversation_id = ?
              AND tc.tool_name IN ('generate_image', 'edit_image')
              AND tc.result IS NOT NULL
        ORDER BY tc.id DESC LIMIT 1
        """,
        (conversation_id,),
    ).fetchone()
    if not row or not row["result"]:
        return None
    try:
        return json.loads(row["result"]).get("image_base64")
    except Exception:
        return None


# --- Documents Repository ---

def create_document_record(conn, filename: str, source: str, chunk_count: int) -> int:
    cur = conn.execute(
        """
        INSERT INTO documents (filename, source, ingested_at, chunk_count)
        VALUES (?, ?, ?, ?)
        """,
        (filename, source, _now(), chunk_count),
    )
    conn.commit()
    return cur.lastrowid


def update_document_chunk_count(conn, document_id: int, chunk_count: int) -> None:
    conn.execute(
        "UPDATE documents SET chunk_count = ? WHERE id = ?", (chunk_count, document_id)
    )
    conn.commit()


def list_documents(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, filename, source, ingested_at, chunk_count
        FROM documents ORDER BY ingested_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


def document_exists(conn, filename: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM documents WHERE filename = ?",
        (filename,)
    ).fetchone()
    return row is not None


def get_document_by_filename(conn, filename: str) -> dict | None:
    row = conn.execute(
        "SELECT id, filename, source, ingested_at, chunk_count FROM documents WHERE filename = ?",
        (filename,),
    ).fetchone()
    return dict(row) if row else None


def get_document_by_id(conn, document_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, filename, source, ingested_at, chunk_count FROM documents WHERE id = ?",
        (document_id,),
    ).fetchone()
    return dict(row) if row else None


def update_document_ingested_at(conn, document_id: int) -> None:
    conn.execute(
        "UPDATE documents SET ingested_at = ? WHERE id = ?", (_now(), document_id)
    )
    conn.commit()


def delete_document_record(conn, document_id: int) -> None:
    conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    conn.commit()


def create_shared_conversation(conn, token: str, title: str, content: str, owner_user_id: int | None) -> None:
    conn.execute(
        "INSERT INTO shared_conversations (token, title, content, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        (token, title, content, owner_user_id, _now()),
    )
    conn.commit()


def get_shared_conversation(conn, token: str) -> dict | None:
    row = conn.execute(
        "SELECT token, title, content, created_at FROM shared_conversations WHERE token = ?",
        (token,),
    ).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Email OTP & Password Reset Helpers
# ---------------------------------------------------------------------------

def create_email_otp(conn, email: str, code_hash: str, expires_at: str) -> int:
    clean_email = email.strip().lower()
    # Invalidate previous unconsumed OTPs for this email
    conn.execute(
        "UPDATE email_otps SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL",
        (_now(), clean_email),
    )
    cur = conn.execute(
        "INSERT INTO email_otps (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)",
        (clean_email, code_hash, expires_at, _now()),
    )
    conn.commit()
    return cur.lastrowid


def get_recent_email_otps_count(conn, email: str, since: str) -> int:
    clean_email = email.strip().lower()
    row = conn.execute(
        "SELECT COUNT(*) as count FROM email_otps WHERE email = ? AND created_at >= ?",
        (clean_email, since),
    ).fetchone()
    return row["count"] if row else 0


def get_latest_email_otp(conn, email: str) -> dict | None:
    clean_email = email.strip().lower()
    row = conn.execute(
        "SELECT id, email, code_hash, expires_at, attempts, created_at, consumed_at "
        "FROM email_otps WHERE email = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
        (clean_email,),
    ).fetchone()
    return dict(row) if row else None


def increment_otp_attempts(conn, otp_id: int) -> int:
    conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?", (otp_id,))
    conn.commit()
    row = conn.execute("SELECT attempts FROM email_otps WHERE id = ?", (otp_id,)).fetchone()
    return row["attempts"] if row else 0


def consume_email_otp(conn, otp_id: int) -> None:
    conn.execute("UPDATE email_otps SET consumed_at = ? WHERE id = ?", (_now(), otp_id))
    conn.commit()


def delete_email_otp(conn, otp_id: int) -> None:
    conn.execute("DELETE FROM email_otps WHERE id = ?", (otp_id,))
    conn.commit()


def cleanup_expired_otps(conn) -> None:
    conn.execute("DELETE FROM email_otps WHERE expires_at < ?", (_now(),))
    conn.commit()


def create_password_reset(conn, user_id: int, token_hash: str, expires_at: str) -> int:
    # Invalidate previous unused reset tokens for this user
    conn.execute(
        "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
        (_now(), user_id),
    )
    cur = conn.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (user_id, token_hash, expires_at, _now()),
    )
    conn.commit()
    return cur.lastrowid


def get_password_reset_by_hash(conn, token_hash: str) -> dict | None:
    row = conn.execute(
        "SELECT id, user_id, token_hash, expires_at, used_at, created_at "
        "FROM password_resets WHERE token_hash = ?",
        (token_hash,),
    ).fetchone()
    return dict(row) if row else None


def consume_password_reset(conn, reset_id: int, user_id: int) -> None:
    conn.execute(
        "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
        (_now(), user_id),
    )
    conn.commit()


def cleanup_expired_password_resets(conn) -> None:
    conn.execute("DELETE FROM password_resets WHERE expires_at < ?", (_now(),))
    conn.commit()


# ===========================================================================
# Subscriptions & Billing
# ===========================================================================

def create_subscription_order(
    conn, user_id: int, plan: str, amount_paise: int, provider: str = "demo"
) -> int:
    cur = conn.execute(
        "INSERT INTO subscriptions (user_id, plan, amount_paise, status, provider, created_at) "
        "VALUES (?, ?, ?, 'created', ?, ?)",
        (user_id, plan, amount_paise, provider, _now()),
    )
    conn.commit()
    return cur.lastrowid


def get_subscription(conn, subscription_id: int, user_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, user_id, plan, amount_paise, status, provider, current_period_end, created_at "
        "FROM subscriptions WHERE id = ? AND user_id = ?",
        (subscription_id, user_id),
    ).fetchone()
    return dict(row) if row else None


def mark_subscription_paid(
    conn, subscription_id: int, user_id: int, plan: str, current_period_end: str
) -> bool:
    cur = conn.execute(
        "UPDATE subscriptions SET status = 'paid', current_period_end = ? WHERE id = ? AND user_id = ?",
        (current_period_end, subscription_id, user_id),
    )
    if cur.rowcount > 0:
        conn.execute("UPDATE users SET plan = ? WHERE id = ?", (plan, user_id))
        conn.commit()
        return True
    return False


def update_user_plan(conn, user_id: int, plan: str) -> None:
    conn.execute("UPDATE users SET plan = ? WHERE id = ?", (plan, user_id))
    conn.commit()


def get_user_subscription_status(conn, user_id: int) -> dict:
    user = get_user(conn, user_id)
    if not user:
        return {"plan": "free", "current_period_end": None}

    user_plan = user.get("plan") or "free"

    # Find the latest paid subscription
    row = conn.execute(
        "SELECT id, plan, current_period_end FROM subscriptions "
        "WHERE user_id = ? AND status = 'paid' "
        "ORDER BY id DESC LIMIT 1",
        (user_id,),
    ).fetchone()

    if not row:
        if user_plan != "free":
            update_user_plan(conn, user_id, "free")
        return {"plan": "free", "current_period_end": None}

    period_end = row["current_period_end"]
    if period_end:
        try:
            end_dt = datetime.fromisoformat(period_end.replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            if end_dt < now_dt:
                # Subscription has expired! Downgrade back to free
                update_user_plan(conn, user_id, "free")
                return {"plan": "free", "current_period_end": None}
        except Exception:
            if period_end < _now():
                update_user_plan(conn, user_id, "free")
                return {"plan": "free", "current_period_end": None}

    return {"plan": row["plan"] or user_plan, "current_period_end": period_end}



