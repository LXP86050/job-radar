"""Ashby public job board API: https://api.ashbyhq.com/posting-api/job-board/{slug}"""
from __future__ import annotations

import logging
import requests

log = logging.getLogger(__name__)

API = "https://api.ashbyhq.com/posting-api/job-board/{slug}"


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    url = API.format(slug=slug)
    try:
        r = requests.get(url, params={"includeCompensation": "true"}, timeout=timeout)
    except requests.RequestException as e:
        log.warning("ashby %s: request failed: %s", slug, e)
        return []
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        log.warning("ashby %s: HTTP %s", slug, r.status_code)
        return []
    try:
        data = r.json()
    except ValueError:
        log.warning("ashby %s: non-JSON response", slug)
        return []

    jobs = []
    for j in data.get("jobs", []):
        comp = j.get("compensation") or {}
        comp_summary = comp.get("compensationTierSummary") or ""
        descr = j.get("descriptionPlain") or j.get("descriptionHtml") or ""
        location = j.get("locationName") or ""
        secondary = j.get("secondaryLocations") or []
        if secondary:
            extra = ", ".join(s.get("locationName", "") for s in secondary if s.get("locationName"))
            if extra:
                location = f"{location}; {extra}"
        jobs.append({
            "id": f"ashby:{slug}:{j.get('id')}",
            "company": slug,
            "title": (j.get("title") or "").strip(),
            "location": location,
            "url": j.get("jobUrl") or j.get("applyUrl") or "",
            "description_html": descr + ("\n" + comp_summary if comp_summary else ""),
            "compensation_summary": comp_summary,
            "updated_at": j.get("publishedAt"),
            "source": "ashby",
        })
    return jobs
