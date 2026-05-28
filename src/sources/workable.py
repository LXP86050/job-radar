"""Workable public jobs: https://apply.workable.com/api/v3/accounts/{slug}/jobs?state=published"""
from __future__ import annotations

import logging
import re
import requests

log = logging.getLogger(__name__)

API = "https://apply.workable.com/api/v3/accounts/{slug}/jobs"
LIMIT = 100


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "")


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    url = API.format(slug=slug)
    all_jobs = []
    offset = 0
    pages = 0
    while pages < 5:
        try:
            r = requests.get(
                url,
                params={"state": "published", "limit": LIMIT, "offset": offset},
                timeout=timeout,
            )
        except requests.RequestException as e:
            log.warning("workable %s: request failed: %s", slug, e)
            break
        if r.status_code == 404:
            return []
        if r.status_code != 200:
            log.warning("workable %s: HTTP %s", slug, r.status_code)
            break
        try:
            data = r.json()
        except ValueError:
            log.warning("workable %s: non-JSON response", slug)
            break

        results = data.get("results") or []
        all_jobs.extend(results)
        total = data.get("total") or 0
        offset += LIMIT
        pages += 1
        if offset >= total:
            break

    jobs = []
    for j in all_jobs:
        loc = j.get("location") or {}
        location_parts = [loc.get("city"), loc.get("region"), loc.get("country")]
        location = ", ".join(p for p in location_parts if p)
        descr = _strip_html(j.get("description") or "")
        jobs.append({
            "id": f"workable:{slug}:{j.get('id') or j.get('shortcode')}",
            "company": slug,
            "title": (j.get("title") or "").strip(),
            "location": location,
            "url": j.get("shortlink") or j.get("application_url") or "",
            "description_html": descr,
            "updated_at": j.get("created_at"),
            "source": "workable",
        })
    return jobs
