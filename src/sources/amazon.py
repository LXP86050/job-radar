"""Amazon jobs API: https://www.amazon.jobs/en/search.json

Public, unauthenticated, and returns full description + qualifications
inline — no per-job enrichment needed. Also surfaces Amazon-owned brands
(Twitch, Whole Foods corporate, etc.) under company_name.
"""
from __future__ import annotations

import logging
import requests

log = logging.getLogger(__name__)

SEARCH_URL = "https://www.amazon.jobs/en/search.json"
PUBLIC_BASE = "https://www.amazon.jobs"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36"}
PAGE_SIZE = 100
MAX_PAGES = 15  # up to 1500 listings


def fetch(query: str = "software engineer", timeout: int = 20) -> list[dict]:
    all_jobs: list[dict] = []
    offset = 0
    for _ in range(MAX_PAGES):
        try:
            r = requests.get(
                SEARCH_URL,
                params={
                    "base_query": query,
                    "country": "USA",
                    "result_limit": PAGE_SIZE,
                    "offset": offset,
                },
                headers=HEADERS,
                timeout=timeout,
            )
            r.raise_for_status()
            data = r.json()
        except (requests.RequestException, ValueError) as e:
            log.warning("amazon: request failed at offset=%d: %s", offset, e)
            break
        batch = data.get("jobs") or []
        if not batch:
            break
        all_jobs.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    jobs = []
    for j in all_jobs:
        jid = j.get("id_icims") or j.get("id")
        if not jid:
            continue
        desc = " ".join(filter(None, [
            j.get("description"),
            j.get("basic_qualifications"),
            j.get("preferred_qualifications"),
        ]))
        jobs.append({
            "id": f"amazon:{jid}",
            "company": (j.get("company_name") or "amazon").strip(),
            "title": (j.get("title") or "").strip(),
            "location": (j.get("normalized_location") or j.get("location") or "").strip(),
            "url": PUBLIC_BASE + (j.get("job_path") or ""),
            "description_html": desc,
            "updated_at": j.get("posted_date"),
            "source": "amazon",
        })
    return jobs
