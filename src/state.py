"""Persistent de-dup state. Stored as JSON files committed back by the workflow."""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE_DIR = Path(os.environ.get("JOB_RADAR_STATE", "state"))


def _load(name: str, default):
    p = STATE_DIR / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def _save(name: str, data) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / name).write_text(json.dumps(data, indent=2, sort_keys=True))


def already_sent_today() -> bool:
    last = _load("last_run_date.txt", "")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if isinstance(last, str) and last.strip() == today:
        return True
    return False


def mark_sent_today() -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "last_run_date.txt").write_text(today)


def load_seen() -> dict[str, str]:
    """Mapping of job_id -> ISO date first seen."""
    raw = _load("seen.json", {})
    return raw if isinstance(raw, dict) else {}


def save_seen(seen: dict[str, str]) -> None:
    # Prune entries older than 60 days to keep file size bounded.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d")
    pruned = {k: v for k, v in seen.items() if v >= cutoff}
    _save("seen.json", pruned)
