"""Y Combinator Work at a Startup jobs.

workatastartup.com is YC's portfolio job board — hundreds of YC-funded
startups, many sponsor H1B, much smaller applicant volume than LinkedIn.

They expose an unauthenticated JSON feed at
  https://www.workatastartup.com/api/companies/{batch}/jobs
or via the search API at /api/jobs/search

We just hit /jobs/search with paging.
"""
from __future__ import annotations

import logging
import urllib.request
import urllib.parse
import json
from datetime import datetime, timezone

log = logging.getLogger(__name__)

SEARCH_URL = "https://www.workatastartup.com/api/jobs/search"


def _http_get_json(url: str, timeout: float = 20):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "job-radar/1.0",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except Exception as e:
        log.warning("YC fetch %s failed: %s", url, e)
        return None


def _normalize(raw: dict) -> dict | None:
    """YC search result → radar job shape."""
    job_id = raw.get("id") or raw.get("jobId")
    if not job_id:
        return None
    company = (raw.get("company") or {}).get("name", "") if isinstance(raw.get("company"), dict) else (raw.get("companyName", ""))
    title = raw.get("title") or raw.get("name", "")
    location = raw.get("location") or raw.get("locations") or ""
    if isinstance(location, list):
        location = " / ".join(str(x) for x in location[:3])

    url = raw.get("url") or raw.get("apply_url") or f"https://www.workatastartup.com/jobs/{job_id}"
    desc = raw.get("description") or raw.get("descriptionHtml") or raw.get("about") or ""
    updated = raw.get("updated_at") or raw.get("posted_at") or raw.get("created_at") or ""

    return {
        "id": f"yc:{job_id}",
        "source": "ycombinator",
        "company": company,
        "title": title,
        "location": location,
        "url": url,
        "description_html": desc,
        "updated_at": updated,
        "compensation_summary": raw.get("salary") or raw.get("salaryRange") or "",
    }


def fetch(_unused_slug: str = "yc") -> list[dict]:
    """Fetch YC Work at a Startup jobs (engineering roles, US locations).

    The API is paged; we walk until empty.
    """
    jobs: list[dict] = []
    page = 1
    while page <= 10:  # Cap at 10 pages (~500 jobs) to keep run-time bounded
        params = urllib.parse.urlencode({
            "role": "eng",         # engineering filter
            "country": "us",        # US-located positions
            "remote": "true",       # include remote
            "page": page,
        })
        data = _http_get_json(f"{SEARCH_URL}?{params}")
        if not data:
            break
        items = data.get("jobs") or data.get("results") or data.get("data") or []
        if not items:
            break
        for raw in items:
            j = _normalize(raw)
            if j:
                jobs.append(j)
        if len(items) < 20:  # last page
            break
        page += 1
    log.info("YC fetched %d job(s) across %d page(s)", len(jobs), page)
    return jobs
