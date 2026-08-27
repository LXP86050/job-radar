"""Google careers site: server-rendered, no public API. Results are embedded
as an AF_initDataCallback({key: 'ds:1', ..., data: [...]}) block — Google's
internal (undocumented) format for hydrating JS frontends. The job array is
POSITIONAL, not keyed, so this is inherently more fragile than a real API:
if Google reshuffles field order this will start returning garbage rather
than erroring loudly. Every field access below is defensive (try/except,
bounds-checked) so a shape change degrades to "fewer jobs found" rather
than a crash — but if this source silently returns 0 for multiple days in
a row, the index map below is the first thing to re-derive from a fresh
page fetch.

Field indices observed on a live 2026-08 fetch (job = data[0][i]):
  0 id | 1 title | 2 apply/signin url | 3 [_, responsibilities_html]
  4 [_, min_quals_html] | 7 company | 9 [[loc_str, ...], ...] locations
  10 [_, about_html] | 12 [unix_seconds, nanos] posted timestamp
"""
from __future__ import annotations

import json
import logging
import re
import requests

log = logging.getLogger(__name__)

SEARCH_URL = "https://www.google.com/about/careers/applications/jobs/results"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36"}
DS1_RE = re.compile(r"AF_initDataCallback\(\{key:\s*'ds:1'.*?data:(\[.*?\])\s*,\s*sideChannel", re.DOTALL)
PAGE_SIZE = 20
MAX_PAGES = 15


def _extract_jobs(html: str) -> list[list]:
    m = DS1_RE.search(html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except (ValueError, json.JSONDecodeError):
        return []
    if not data or not isinstance(data[0], list):
        return []
    return data[0]


def _safe_get(entry: list, idx: int, default=None):
    try:
        return entry[idx]
    except (IndexError, TypeError):
        return default


def fetch(query: str = "software engineer", timeout: int = 20) -> list[dict]:
    all_entries: list[list] = []
    for page in range(1, MAX_PAGES + 1):
        try:
            r = requests.get(
                SEARCH_URL,
                params={"q": query, "target_level": ["EARLY", "MID"], "page": page},
                headers=HEADERS,
                timeout=timeout,
            )
            r.raise_for_status()
        except requests.RequestException as e:
            log.warning("google: request failed at page=%d: %s", page, e)
            break
        entries = _extract_jobs(r.text)
        if not entries:
            break
        all_entries.extend(entries)
        if len(entries) < PAGE_SIZE:
            break

    jobs = []
    for e in all_entries:
        jid = _safe_get(e, 0)
        title = _safe_get(e, 1)
        if not (jid and title):
            continue
        url = _safe_get(e, 2) or ""
        loc_list = _safe_get(e, 9) or []
        location = ", ".join(
            (loc[0] if isinstance(loc, list) and loc else "")
            for loc in loc_list if loc
        ).strip(", ")
        parts = []
        for idx in (3, 4, 10):
            field = _safe_get(e, idx)
            if isinstance(field, list) and len(field) > 1 and isinstance(field[1], str):
                parts.append(re.sub(r"<[^>]+>", " ", field[1]))
        ts_field = _safe_get(e, 12)
        posted = ts_field[0] if isinstance(ts_field, list) and ts_field else None
        jobs.append({
            "id": f"google:{jid}",
            "company": "google",
            "title": str(title).strip(),
            "location": location,
            "url": url,
            "description_html": " ".join(parts),
            "updated_at": posted,
            "source": "google",
        })
    return jobs
