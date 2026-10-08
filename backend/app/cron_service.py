import asyncio
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

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


_TZ_RE = re.compile(r"\btz=([A-Za-z_]+(?:/[A-Za-z_+\-0-9]+)*)")
_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def split_timezone(schedule_expression: str) -> tuple[str, timezone | ZoneInfo]:
    """Strip a trailing "tz=<IANA name>" marker; unknown or missing zones mean UTC."""
    text = str(schedule_expression)
    match = _TZ_RE.search(text)
    if not match:
        return text.strip(), timezone.utc
    try:
        zone: timezone | ZoneInfo = ZoneInfo(match.group(1))
    except Exception:
        zone = timezone.utc
    return _TZ_RE.sub("", text).strip(), zone


def _next_time_of_day_occurrence(
    after: datetime, hour: int, minute: int, allowed_weekdays: set[int] | None, zone: timezone | ZoneInfo = timezone.utc
) -> datetime:
    local_after = after.astimezone(zone)
    candidate = local_after.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local_after:
        candidate += timedelta(days=1)
    while allowed_weekdays is not None and candidate.weekday() not in allowed_weekdays:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def compute_next_run(schedule_expression: str, after: datetime) -> tuple[datetime, bool]:
    """Resolve a schedule expression into (next_run_utc, is_recurring), computed
    strictly after `after` (the job's last fire time, or its creation time).

    Supported phrasing, each optionally ending in "tz=<IANA zone>" (default UTC):
    - "on 2026-10-01 at 3:30 PM": one-time run at that calendar date and time.
    - "Weekdays at 8:00 AM", "Every Monday at 9:00 AM", "Daily at 9:00 AM":
      recurs at that time of day, restricted to matching weekdays when named.
    - Anything else is a plain duration: "every ..." recurs, otherwise fires once.
    """
    text, zone = split_timezone(schedule_expression)
    text = text.lower()
    time_of_day = _parse_time_of_day(text)

    date_match = _DATE_RE.search(text)
    if date_match and time_of_day is not None:
        year, month, day = (int(g) for g in date_match.groups())
        hour, minute = time_of_day
        run_at = datetime(year, month, day, hour, minute, tzinfo=zone)
        return run_at.astimezone(timezone.utc), False

    if time_of_day is not None:
        hour, minute = time_of_day
        if "weekday" in text:
            weekdays: set[int] | None = {0, 1, 2, 3, 4}
        else:
            named_days = {v for k, v in _WEEKDAY_NAMES.items() if k in text}
            weekdays = named_days or None
        next_run = _next_time_of_day_occurrence(after, hour, minute, weekdays, zone)
        return next_run, True

    duration = timedelta(seconds=_parse_duration_seconds(text))
    recurring = text.startswith("every")
    return after + duration, recurring


_TIME_RE = re.compile(
    r"(?:\bat\s+|\b)(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|(\d{1,2}):(\d{2}))\b", re.I
)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
_DAY_ABBR = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4, "sat": 5, "sun": 6}
_DAY_LOOKUP = {**_WEEKDAY_NAMES, **_DAY_ABBR}
_DAY_PATTERN = "|".join(sorted(_DAY_LOOKUP, key=len, reverse=True))
_PART_OF_DAY = {"morning": (9, 0), "afternoon": (14, 0), "evening": (18, 0), "night": (21, 0)}


def _find_clock(text: str) -> tuple[int, int] | None:
    """Find a clock time such as 9am, 6:57 pm, 18:30, noon in free text."""
    for match in _TIME_RE.finditer(text):
        word = match.group(1).lower()
        if word == "noon":
            return 12, 0
        if word == "midnight":
            return 0, 0
        if match.group(4):
            hour, minute, ampm = int(match.group(2)), int(match.group(3) or 0), match.group(4)[0].lower()
            if not 1 <= hour <= 12 or minute > 59:
                continue
            hour = hour % 12 + (12 if ampm == "p" else 0)
            return hour, minute
        hour, minute = int(match.group(5)), int(match.group(6))
        if hour <= 23 and minute <= 59:
            return hour, minute
    return None


def _clock_label(hour: int, minute: int) -> str:
    return f"{hour % 12 or 12}:{minute:02d} {'PM' if hour >= 12 else 'AM'}"


def parse_schedule_text(text: str, tz_name: str | None = None, now: datetime | None = None) -> dict[str, Any] | None:
    """Turn natural language into a schedule. Understands things like "every weekday at 8am",
    "tomorrow at 6:30 pm", "in 2 hours", "next friday 4pm", "every 15 minutes", "daily at noon"
    and phrases inside a longer sentence. Returns None when no schedule is found.

    Result: {expression (stored form), label (for people), next_run (UTC ISO), recurring}.
    """
    raw = str(text or "")
    tz_match = _TZ_RE.search(raw)
    tz_name = tz_name or (tz_match.group(1) if tz_match else None)
    try:
        zone: timezone | ZoneInfo = ZoneInfo(tz_name) if tz_name else timezone.utc
    except Exception:
        zone, tz_name = timezone.utc, None
    suffix = f" tz={tz_name}" if tz_name else ""
    now_utc = now or datetime.now(timezone.utc)
    local_now = now_utc.astimezone(zone)
    low = _TZ_RE.sub("", raw).lower()
    clock = _find_clock(low)

    def finish(expression: str, label: str, recurring: bool) -> dict[str, Any]:
        full = expression + suffix
        run_at, _ = compute_next_run(full, now_utc)
        return {"expression": full, "label": label, "next_run": run_at.isoformat(), "recurring": recurring}

    def once_on(day: datetime, hour: int, minute: int, word: str | None = None) -> dict[str, Any]:
        stamp = f"{day.year:04d}-{day.month:02d}-{day.day:02d}"
        pretty = f"{day.strftime('%a')}, {day.day} {day.strftime('%b')}"
        when = word or pretty
        return finish(f"On {stamp} at {_clock_label(hour, minute)}", f"{when} at {_clock_label(hour, minute)}", False)

    # "in 30 minutes", "after 2 hours"
    rel = re.search(r"\b(?:in|after)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b", low)
    if rel:
        unit = rel.group(2)[0]
        seconds = max(1, int(float(rel.group(1)) * _UNIT_SECONDS[unit]))
        pretty_unit = rel.group(2).rstrip("s")
        return finish(f"In {seconds} seconds", f"In {rel.group(1)} {pretty_unit}{'' if rel.group(1) == '1' else 's'}", False)

    # "every 15 minutes", "every 2 hours", "hourly"
    interval = re.search(r"\bevery\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b", low)
    if interval and not clock:
        unit = interval.group(2)[0]
        seconds = max(1, int(interval.group(1)) * _UNIT_SECONDS[unit])
        unit_name = interval.group(2).rstrip("s")
        return finish(f"Every {seconds} seconds", f"Every {interval.group(1)} {unit_name}{'' if interval.group(1) == '1' else 's'}", True)
    if re.search(r"\bhourly\b|\bevery hour\b", low):
        return finish("Every 3600 seconds", "Every hour", True)

    part = next((k for k in _PART_OF_DAY if re.search(rf"\b{k}\b", low)), None)
    hour, minute = clock or (_PART_OF_DAY[part] if part else (9, 0))
    clock_text = _clock_label(hour, minute)
    have_time = clock is not None or part is not None

    # Recurring: weekdays / daily / every <day>
    if re.search(r"\bweekdays?\b|\bmon(?:day)?\s*(?:-|to|through)\s*fri(?:day)?\b", low):
        return finish(f"Weekdays at {clock_text}", f"Every weekday at {clock_text}", True)
    if re.search(r"\b(?:every\s*day|daily|each day|everyday)\b", low) or (
        re.search(r"\bevery\s+(?:morning|afternoon|evening|night)\b", low)
    ):
        return finish(f"Daily at {clock_text}", f"Every day at {clock_text}", True)
    day_match = re.search(rf"\bevery\s+({_DAY_PATTERN})\b", low)
    if day_match:
        name = [k for k, v in _WEEKDAY_NAMES.items() if v == _DAY_LOOKUP[day_match.group(1)]][0].title()
        return finish(f"Every {name} at {clock_text}", f"Every {name} at {clock_text}", True)

    # One-time: explicit date, tomorrow, today, next <day>, on <day>
    iso = _DATE_RE.search(low)
    if iso:
        day = datetime(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        return once_on(day, hour, minute)
    if re.search(r"\btomorrow\b", low):
        return once_on(local_now + timedelta(days=1), hour, minute, "Tomorrow")
    if re.search(r"\btoday\b|\btonight\b", low):
        if "tonight" in low and not clock:
            hour, minute = 20, 0
        return once_on(local_now, hour, minute, "Today")
    weekday = re.search(rf"\b(?:next|on|this)?\s*({_DAY_PATTERN})\b", low)
    if weekday:
        target = _DAY_LOOKUP[weekday.group(1)]
        ahead = (target - local_now.weekday()) % 7
        candidate = (local_now + timedelta(days=ahead)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        if ahead == 0 and (candidate <= local_now or "next" in weekday.group(0)):
            candidate += timedelta(days=7)
        return once_on(candidate, hour, minute)

    # Bare clock time: the next time it occurs
    if have_time:
        candidate = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local_now:
            candidate += timedelta(days=1)
        return once_on(candidate, hour, minute, "Today" if candidate.date() == local_now.date() else "Tomorrow")
    return None


def describe_schedule(expression: str, now: datetime | None = None) -> str:
    """Human wording for a stored schedule expression (used by the task list)."""
    _, zone = split_timezone(expression)
    parsed = parse_schedule_text(expression, now=now)
    return parsed["label"] if parsed else re.sub(_TZ_RE, "", str(expression)).strip()


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

    parsed = parse_schedule_text(schedule_expression)
    if parsed:
        schedule_expression = parsed["expression"]
    if _DATE_RE.search(schedule_expression):
        run_at, _ = compute_next_run(schedule_expression, datetime.now(timezone.utc))
        if run_at <= datetime.now(timezone.utc):
            return {"success": False, "error": "That date and time is already in the past."}

    if conversation_id in ("", "None", "null"):
        conversation_id = None
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
    """List scheduled background jobs owned by `user_id` (all jobs if omitted), with
    next run time, running state and a preview of the latest result."""
    from app import repository

    cursor = conn.cursor()
    columns = "id, prompt, schedule_expression, status, created_at, title, last_run, conversation_id"
    if user_id is None:
        cursor.execute(f"SELECT {columns} FROM scheduled_jobs ORDER BY id DESC")
    else:
        cursor.execute(f"SELECT {columns} FROM scheduled_jobs WHERE user_id = ? ORDER BY id DESC", (user_id,))
    now = datetime.now(timezone.utc)
    jobs = []
    for r in cursor.fetchall():
        job_id, prompt, expr, status, created_at, title, last_run, conv_id = r

        next_run_iso = None
        if status == "active":
            try:
                checkpoint = datetime.fromisoformat(str(last_run or created_at).replace("Z", "").split(".")[0]).replace(tzinfo=timezone.utc)
                next_run_iso = compute_next_run(expr, checkpoint)[0].isoformat()
            except Exception:
                next_run_iso = None

        last_result = None
        last_ok = None
        if conv_id and last_run:
            try:
                conversation = repository.get_conversation(conn, int(conv_id))
                leaf = conversation["active_leaf_id"] if conversation else None
                message = repository.get_message(conn, leaf) if leaf else None
                if message and message["role"] == "assistant":
                    body = re.sub(r"^(?:\u23f0 )?\*\*(?:\[Scheduled Task:[^\]]*\]|Scheduled task:[^*]*)\*\*\s*", "", message["content"] or "")
                    last_ok = not body.startswith("Could not run this task")
                    last_result = body[:220]
            except Exception:
                logger.exception("Could not load latest result for scheduled job #%s", job_id)

        jobs.append({
            "id": job_id,
            "prompt": prompt,
            "schedule": expr,
            "schedule_label": describe_schedule(expr, now),
            "status": status,
            "created_at": created_at,
            "title": title or (prompt[:40] if prompt else "Untitled task"),
            "last_run": last_run,
            "next_run": next_run_iso,
            "conversation_id": conv_id,
            "running": job_id in _running_jobs,
            "last_result": last_result,
            "last_ok": last_ok,
        })
    return jobs


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


_SYSTEM_PROMPT = (
    "You are Pragna, running a scheduled task for the user in the background. "
    "Carry out the task now and reply with the finished result only. "
    "Current UTC time: {now}."
)
_running_jobs: set[int] = set()


async def _collect(messages: list[dict], model: str, url: str, api_keys: list[str]) -> str:
    from app.ollama_client import chat_stream

    parts: list[str] = []
    async for token in chat_stream(messages, model, url, api_keys=api_keys):
        parts.append(token)
    return "".join(parts).strip()


async def _generate_reply(messages: list[dict]) -> tuple[str, str]:
    """Answer via Omniroute first, then local Ollama. Returns (text, provider label)."""
    from app.config import get_settings

    settings = get_settings()
    attempts: list[tuple[str, str, str, list[str]]] = []
    if settings.omniroute_api_key:
        # Same proven model the chat uses first; auto-routed combos can stream only keepalives.
        omniroute_models = list(dict.fromkeys(["antigravity/gemini-2.5-flash", settings.chat_model, "auto/best-free"]))
        for model in omniroute_models:
            attempts.append(("Omniroute", settings.omniroute_base_url, model, [settings.omniroute_api_key]))
    attempts.append(("Ollama", settings.ollama_local_url, settings.ollama_local_model, []))

    errors: list[str] = []
    for label, url, model, keys in attempts:
        try:
            text = await asyncio.wait_for(_collect(messages, model, url, keys), timeout=90)
            if text:
                return text, f"{label} ({model})"
            errors.append(f"{label} {model}: empty reply")
        except Exception as exc:
            logger.warning("Scheduled task LLM attempt via %s failed: %s", label, exc)
            errors.append(f"{label} {model}: {exc}")
    raise RuntimeError("; ".join(errors))


def _ensure_conversation(conn: sqlite3.Connection, job_id: int, conv_id: Any, title: str | None, user_id: int | None) -> int | None:
    """Return the chat that receives this job's results, creating one when the job has none."""
    from app import repository

    try:
        if conv_id not in (None, "", "None", "null"):
            cid = int(conv_id)
            if repository.get_conversation(conn, cid):
                return cid
    except (TypeError, ValueError):
        pass
    if user_id is None:
        return None
    cid = repository.create_conversation(conn, title or "Scheduled task", user_id)
    conn.execute("UPDATE scheduled_jobs SET conversation_id = ? WHERE id = ?", (str(cid), job_id))
    conn.commit()
    return cid


async def _execute_job(
    conn: sqlite3.Connection, job_id: int, prompt: str, title: str | None, conv_id: Any, user_id: int | None
) -> dict[str, Any]:
    """Run the job's prompt through the LLM and post the answer to its chat."""
    from app import repository

    cid = _ensure_conversation(conn, job_id, conv_id, title, user_id)
    if cid is None:
        logger.error("Scheduled job #%s has no owner or conversation; nothing to deliver to", job_id)
        return {"success": False, "error": "Task has no chat to deliver to."}

    conversation = repository.get_conversation(conn, cid)
    leaf = conversation["active_leaf_id"] if conversation else None
    history: list[dict] = []
    if leaf:
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in repository.get_path_to_root(conn, leaf)[-6:]
            if m["role"] in ("user", "assistant") and m.get("content")
        ]
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT.format(now=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"))},
        *history,
        {"role": "user", "content": prompt},
    ]

    heading = f"**Scheduled task: {title or 'Task'}**"
    try:
        text, provider = await _generate_reply(messages)
        content = f"{heading}\n\n{text}"
        model = provider
        ok = True
    except Exception as exc:
        logger.exception("Scheduled job #%s failed to generate a reply", job_id)
        content = f"{heading}\n\nCould not run this task: {exc}"
        model = "scheduled-task"
        ok = False
    repository.add_message(conn, conversation_id=cid, role="assistant", content=content, parent_id=leaf, model=model)
    return {"success": ok, "conversation_id": cid}


async def _execute_job_guarded(conn, job_id, prompt, title, conv_id, user_id) -> None:
    try:
        await _execute_job(conn, job_id, prompt, title, conv_id, user_id)
    except Exception:
        logger.exception("Scheduled job #%s delivery failed", job_id)
    finally:
        _running_jobs.discard(job_id)


async def run_scheduled_task_now(conn: sqlite3.Connection, job_id: int, user_id: int | None = None) -> dict[str, Any]:
    """Trigger execution of a scheduled task immediately."""
    if not _owns_job(conn, job_id, user_id):
        return {"success": False, "error": f"Job #{job_id} not found."}
    row = conn.execute(
        "SELECT prompt, conversation_id, title, user_id FROM scheduled_jobs WHERE id = ?", (job_id,)
    ).fetchone()
    if not row:
        return {"success": False, "error": f"Job #{job_id} not found."}
    prompt, conv_id, title, owner_id = row
    if job_id in _running_jobs:
        return {"success": True, "job_id": job_id, "running": True, "summary": "Task is already running."}
    conn.execute("UPDATE scheduled_jobs SET last_run = datetime('now') WHERE id = ?", (job_id,))
    conn.commit()
    # Create the result chat up front so the UI can link to it while the model is still working.
    cid = _ensure_conversation(conn, job_id, conv_id, title, owner_id)
    _running_jobs.add(job_id)
    asyncio.create_task(_execute_job_guarded(conn, job_id, prompt, title, cid, owner_id))
    return {
        "success": True,
        "job_id": job_id,
        "running": True,
        "conversation_id": cid,
        "summary": f"Task '{title or prompt[:30]}' started.",
    }


async def run_scheduled_jobs_worker(conn: sqlite3.Connection):
    """Background loop that polls scheduled_jobs every 2s, runs due jobs through the LLM
    and posts the answer to the job's chat. Recurring jobs are rescheduled."""
    while True:
        try:
            await asyncio.sleep(2)
            jobs = conn.execute(
                "SELECT id, prompt, schedule_expression, conversation_id, created_at, last_run, title, user_id "
                "FROM scheduled_jobs WHERE status = 'active'"
            ).fetchall()
            now_dt = datetime.now(timezone.utc)

            for job_id, prompt, expr, conv_id, created_at_str, last_run_str, title, user_id in jobs:
                if job_id in _running_jobs:
                    continue
                checkpoint_str = last_run_str or created_at_str
                try:
                    clean_str = str(checkpoint_str).replace("Z", "").split(".")[0]
                    checkpoint_dt = datetime.fromisoformat(clean_str).replace(tzinfo=timezone.utc)
                except Exception:
                    checkpoint_dt = now_dt

                next_run, recurring = compute_next_run(expr, checkpoint_dt)
                if now_dt < next_run:
                    continue
                conn.execute(
                    "UPDATE scheduled_jobs SET status = ?, last_run = datetime('now') WHERE id = ?",
                    ("active" if recurring else "completed", job_id),
                )
                conn.commit()
                _running_jobs.add(job_id)
                asyncio.create_task(_execute_job_guarded(conn, job_id, prompt, title, conv_id, user_id))
        except Exception:
            logger.exception("Scheduled jobs worker iteration failed")
