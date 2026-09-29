import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

_WEEKDAY_NAMES = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def _parse_duration_seconds(expr: str) -> int:
    """Parse a schedule expression like "10 minutes", "2h", "30s", "in 1 day"
    into a whole number of seconds. Falls back to treating a bare number as
    minutes (the common phrasing when a unit is omitted), and to 60s if the
    expression is unparseable.
    """
    text = str(expr).strip().lower()
    match = re.search(r"(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?", text)
    if not match:
        return 60
    amount = float(match.group(1))
    unit = match.group(2) or "minutes"
    if unit.startswith("s"):
        multiplier = 1
    elif unit.startswith("m"):
        multiplier = 60
    elif unit.startswith("h"):
        multiplier = 3600
    elif unit.startswith("d"):
        multiplier = 86400
    else:
        multiplier = 60
    return max(1, int(amount * multiplier))


def _parse_time_of_day(text: str) -> tuple[int, int] | None:
    """Extract an "at HH[:MM] [am/pm]" clock time from schedule text (UTC)."""
    match = re.search(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    ampm = match.group(3)
    if ampm == "pm" and hour != 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def _next_time_of_day_occurrence(
    after: datetime, hour: int, minute: int, allowed_weekdays: set[int] | None
) -> datetime:
    candidate = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= after:
        candidate += timedelta(days=1)
    while allowed_weekdays is not None and candidate.weekday() not in allowed_weekdays:
        candidate += timedelta(days=1)
    return candidate


def compute_next_run(schedule_expression: str, after: datetime) -> tuple[datetime, bool]:
    """Resolve a schedule expression into (next_run_utc, is_recurring), computed
    strictly after `after` (the job's last fire time, or its creation time).

    Clock-time phrasing ("Weekdays at 8:00 AM", "Every Monday at 9:00 AM",
    "Daily at 9:00 AM") recurs at that time of day, restricted to matching
    weekdays when named. Anything else falls back to a plain duration: an
    "every ..." expression recurs at that interval, otherwise it fires once.
    """
    text = str(schedule_expression).strip().lower()
    time_of_day = _parse_time_of_day(text)

    if time_of_day is not None:
        hour, minute = time_of_day
        if "weekday" in text:
            weekdays: set[int] | None = {0, 1, 2, 3, 4}
        else:
            named_days = {v for k, v in _WEEKDAY_NAMES.items() if k in text}
            weekdays = named_days or None
        next_run = _next_time_of_day_occurrence(after, hour, minute, weekdays)
        return next_run, True

    duration = timedelta(seconds=_parse_duration_seconds(text))
    recurring = text.startswith("every")
    return after + duration, recurring


def schedule_task(
    conn: sqlite3.Connection,
    prompt: str,
    schedule_expression: str,
    conversation_id: str | None = None,
    title: str | None = None,
    user_id: int | None = None,
) -> dict[str, Any]:
    """Schedule a recurring or delayed background task for the AI agent."""
    if not prompt.strip():
        return {"success": False, "error": "Task prompt cannot be empty."}

    task_title = (title or "").strip() or prompt.strip().split("\n")[0][:40]
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO scheduled_jobs (prompt, schedule_expression, status, conversation_id, title, created_at, user_id)
        VALUES (?, ?, 'active', ?, ?, datetime('now'), ?)
        """,
        (prompt.strip(), schedule_expression.strip(), conversation_id, task_title, user_id),
    )
    conn.commit()
    job_id = cursor.lastrowid
    return {
        "success": True,
        "job_id": job_id,
        "title": task_title,
        "prompt": prompt,
        "schedule": schedule_expression,
        "summary": f"Scheduled task #{job_id}: '{task_title}' ({schedule_expression})",
    }


def list_scheduled_tasks(conn: sqlite3.Connection, user_id: int | None = None) -> list[dict[str, Any]]:
    """List scheduled background jobs owned by `user_id` (all jobs if omitted)."""
    cursor = conn.cursor()
    if user_id is None:
        cursor.execute(
            "SELECT id, prompt, schedule_expression, status, created_at, title, last_run FROM scheduled_jobs ORDER BY id DESC"
        )
    else:
        cursor.execute(
            "SELECT id, prompt, schedule_expression, status, created_at, title, last_run FROM scheduled_jobs "
            "WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        )
    rows = cursor.fetchall()
    return [
        {
            "id": r[0],
            "prompt": r[1],
            "schedule": r[2],
            "status": r[3],
            "created_at": r[4],
            "title": r[5] or (r[1][:40] if r[1] else "Untitled task"),
            "last_run": r[6],
        }
        for r in rows
    ]


def _owns_job(conn: sqlite3.Connection, job_id: int, user_id: int | None) -> bool:
    if user_id is None:
        return True
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM scheduled_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    return bool(row) and row[0] == user_id


def toggle_scheduled_task(conn: sqlite3.Connection, job_id: int, user_id: int | None = None) -> dict[str, Any]:
    """Toggle between active and paused status."""
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM scheduled_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    if not row:
        return {"success": False, "error": f"Job #{job_id} not found."}
    if not _owns_job(conn, job_id, user_id):
        return {"success": False, "error": f"Job #{job_id} not found."}
    current_status = row[0]
    new_status = "paused" if current_status == "active" else "active"
    cursor.execute("UPDATE scheduled_jobs SET status = ? WHERE id = ?", (new_status, job_id))
    conn.commit()
    return {"success": True, "job_id": job_id, "status": new_status, "summary": f"Task #{job_id} is now {new_status}."}


def cancel_scheduled_task(conn: sqlite3.Connection, job_id: int, user_id: int | None = None) -> dict[str, Any]:
    """Cancel a scheduled background task."""
    if not _owns_job(conn, job_id, user_id):
        return {"success": False, "error": f"Job #{job_id} not found."}
    cursor = conn.cursor()
    cursor.execute("UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ?", (job_id,))
    conn.commit()
    if cursor.rowcount == 0:
        return {"success": False, "error": f"Job #{job_id} not found."}
    return {"success": True, "job_id": job_id, "summary": f"Cancelled scheduled task #{job_id}"}


async def run_scheduled_task_now(conn: sqlite3.Connection, job_id: int, user_id: int | None = None) -> dict[str, Any]:
    """Trigger execution of a scheduled task immediately."""
    from datetime import datetime, timezone
    from app import repository
    if not _owns_job(conn, job_id, user_id):
        return {"success": False, "error": f"Job #{job_id} not found."}
    cursor = conn.cursor()
    cursor.execute("SELECT id, prompt, schedule_expression, conversation_id, title FROM scheduled_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    if not row:
        return {"success": False, "error": f"Job #{job_id} not found."}

    jid, prompt, expr, conv_id, title = row
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute("UPDATE scheduled_jobs SET last_run = datetime('now') WHERE id = ?", (job_id,))
    conn.commit()

    # Deliver to conversation if associated
    if conv_id:
        try:
            cid = int(conv_id)
            active_leaf = repository.get_active_leaf(conn, cid)
            repository.append_message(
                conn,
                conversation_id=cid,
                role="assistant",
                content=f"⏰ **[Scheduled Task: {title or 'Triggered'}]**\n\n{prompt}",
                parent_id=active_leaf,
                model="scheduled-task",
            )
        except Exception:
            pass

    return {
        "success": True,
        "job_id": job_id,
        "last_run": now_iso,
        "summary": f"Task '{title or prompt[:30]}' triggered successfully."
    }


async def run_scheduled_jobs_worker(conn: sqlite3.Connection):
    """Background loop that polls scheduled_jobs every 2s and fires due jobs into
    conversation threads, rescheduling recurring jobs for their next occurrence."""
    import asyncio
    from app import repository

    while True:
        try:
            await asyncio.sleep(2)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, prompt, schedule_expression, conversation_id, created_at, last_run FROM scheduled_jobs WHERE status = 'active'"
            )
            jobs = cursor.fetchall()
            now_dt = datetime.now(timezone.utc)

            for job in jobs:
                job_id, prompt, expr, conv_id, created_at_str, last_run_str = job

                checkpoint_str = last_run_str or created_at_str
                try:
                    clean_str = str(checkpoint_str).replace("Z", "").split(".")[0]
                    checkpoint_dt = datetime.fromisoformat(clean_str).replace(tzinfo=timezone.utc)
                except Exception:
                    checkpoint_dt = now_dt

                next_run, recurring = compute_next_run(expr, checkpoint_dt)
                if now_dt >= next_run:
                    new_status = "active" if recurring else "completed"
                    cursor.execute(
                        "UPDATE scheduled_jobs SET status = ?, last_run = datetime('now') WHERE id = ?",
                        (new_status, job_id),
                    )
                    conn.commit()

                    # Push notification message into conversation
                    if conv_id:
                        try:
                            cid = int(conv_id)
                            active_leaf = repository.get_active_leaf(conn, cid)
                            repository.append_message(
                                conn,
                                conversation_id=cid,
                                role="assistant",
                                content=f"⏰ **Scheduled Notification:** {prompt}",
                                parent_id=active_leaf,
                                model="scheduled-timer",
                            )
                        except Exception:
                            pass
        except Exception:
            pass
