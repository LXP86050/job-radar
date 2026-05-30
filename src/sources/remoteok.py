"""RemoteOK — public JSON feed of remote tech jobs.

Endpoint: https://remoteok.com/api
Returns a JSON array. First element is metadata (legal text), rest are jobs.
Each job has: id, slug, position, company, location, tags, description, url,
date (ISO), apply_url, salary_min, salary_max, etc.

Strategy:
  - Filter to roles with "engineer"/"developer" in position
  - Prefer US-OK or worldwide-OK (skip EU-only)
  - Skip explicit "no sponsorship" mentions
"""
from __future__ import annotations

import html
import logging
import urllib.request
import json

log = logging.getLogger(__name__)

API_URL = "https://remoteok.com/api"

# Anti-listings — exclude obvious mismatches
_EXCLUDE_TITLE = [
    "intern", "internship", "co-op", "junior", "entry level", "entry-level",
    "manager", "director", "head of", "vp ", "principal",
]


def _http_get_json(url: str, timeout: float = 20):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (job-radar)",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except Exception as e:
        log.warning("RemoteOK fetch failed: %s", e)
        return None


def _normalize(raw: dict) -> dict | None:
    job_id = raw.get("id") or raw.get("slug")
    if not job_id:
        return None

    title = (raw.get("position") or "").strip()
    if not title:
        return None
    tl = title.lower()
    if any(x in tl for x in _EXCLUDE_TITLE):
        return None
    if not any(k in tl for k in ("engineer", "developer", "swe", "sde")):
        return None

    company = (raw.get("company") or "").strip() or "(unknown)"
    location = raw.get("location") or "Remote"
    tags = raw.get("tags") or []

    # If the location includes specific non-US country names without "world"/"global", skip
    loc_l = (location or "").lower()
    blocked = ["europe only", "eu only", "uk only", "asia only", "india only"]
    if any(b in loc_l for b in blocked):
        return None

    desc = raw.get("description") or ""
    # Check for explicit no-sponsor language (rare on RemoteOK)
    if "no sponsorship" in desc.lower() or "no visa" in desc.lower():
        return None

    url = raw.get("url") or raw.get("apply_url") or f"https://remoteok.com/remote-jobs/{raw.get('slug', job_id)}"
    salary_min = raw.get("salary_min") or 0
    salary_max = raw.get("salary_max") or 0
    comp_summary = (
        f"${salary_min:,} – ${salary_max:,}" if (salary_min or salary_max) else ""
    )

    return {
        "id": f"remoteok:{job_id}",
        "source": "remoteok",
        "company": company,
        "title": title,
        "location": location,
        "url": url,
        "description_html": f"<div>{html.escape(desc)}<br><br>Tags: {', '.join(tags)}</div>",
        "updated_at": raw.get("date") or "",
        "compensation_summary": comp_summary,
    }


def fetch(_unused_slug: str = "remoteok") -> list[dict]:
    data = _http_get_json(API_URL)
    if not isinstance(data, list):
        return []
    # Skip first element (legal metadata)
    items = data[1:] if data and isinstance(data[0], dict) and data[0].get("legal") else data

    jobs: list[dict] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        j = _normalize(raw)
        if j:
            jobs.append(j)
    log.info("RemoteOK: %d job(s) after filtering (%d raw)", len(jobs), len(items))
    return jobs
