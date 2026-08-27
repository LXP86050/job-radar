"""Microsoft careers API: https://apply.careers.microsoft.com/api/pcsx/search

Undocumented but public (no auth) — same API the jobs.careers.microsoft.com
frontend calls. List endpoint has no description body, so a second
detail-endpoint call (position_details) is needed per survivor, mirrored
after the workday.py lazy-enrichment pattern.
"""
from __future__ import annotations

import logging
import re
import time
import requests

log = logging.getLogger(__name__)

SEARCH_URL = "https://apply.careers.microsoft.com/api/pcsx/search"
DETAIL_URL = "https://apply.careers.microsoft.com/api/pcsx/position_details"
PUBLIC_URL = "https://apply.careers.microsoft.com/careers/job/{id}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36"}
PAGE_SIZE = 10  # confirmed via live probe; API ignores larger page-size hints
MAX_PAGES = 30  # up to 300 US listings


def enrich_description(job: dict, timeout: int = 15) -> dict:
    """Lazy-fetch JD body. Mutates job dict in place. Only call for jobs that
    survive title/location pre-filter — keeps API volume manageable."""
    if job.get("source") != "microsoft" or job.get("description_html"):
        return job
    position_id = job["id"].split(":", 1)[-1]
    data = {}
    for attempt in range(3):
        try:
            r = requests.get(
                DETAIL_URL,
                params={"position_id": position_id, "domain": "microsoft.com", "hl": "en"},
                headers=HEADERS,
                timeout=timeout,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            r.raise_for_status()
            data = r.json().get("data") or {}
            break
        except (requests.RequestException, ValueError):
            return job
    body = data.get("jobDescription") or ""
    if body:
        stripped = re.sub(r"<[^>]+>", " ", body)
        job["description_html"] = stripped
        job["_jd_text"] = stripped
    return job


def fetch(query: str = "software engineer", timeout: int = 20) -> list[dict]:
    all_positions: list[dict] = []
    start = 0
    for _ in range(MAX_PAGES):
        data = None
        for attempt in range(3):
            try:
                r = requests.get(
                    SEARCH_URL,
                    params={"domain": "microsoft.com", "query": query, "location": "United States", "start": start},
                    headers=HEADERS,
                    timeout=timeout,
                )
                if r.status_code == 429:
                    time.sleep(2 * (attempt + 1))
                    continue
                r.raise_for_status()
                data = r.json()
                break
            except (requests.RequestException, ValueError) as e:
                log.warning("microsoft: request failed at start=%d (attempt %d): %s", start, attempt + 1, e)
        if data is None:
            break
        positions = (data.get("data") or {}).get("positions") or []
        if not positions:
            break
        all_positions.extend(positions)
        if len(positions) < PAGE_SIZE:
            break
        start += PAGE_SIZE

    jobs = []
    for p in all_positions:
        pid = p.get("id")
        if not pid:
            continue
        jobs.append({
            "id": f"microsoft:{pid}",
            "company": "microsoft",
            "title": (p.get("name") or "").strip(),
            "location": ", ".join(p.get("standardizedLocations") or p.get("locations") or []),
            "url": PUBLIC_URL.format(id=pid),
            "description_html": "",  # requires enrich_description()
            "updated_at": p.get("postedTs"),
            "source": "microsoft",
        })
    return jobs
