"""Greenhouse public board API: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"""
from __future__ import annotations

import logging
import requests

log = logging.getLogger(__name__)

API = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    url = API.format(slug=slug)
    try:
        r = requests.get(url, params={"content": "true"}, timeout=timeout)
    except requests.RequestException as e:
        log.warning("greenhouse %s: request failed: %s", slug, e)
        return []
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        log.warning("greenhouse %s: HTTP %s", slug, r.status_code)
        return []
    try:
        data = r.json()
    except ValueError:
        log.warning("greenhouse %s: non-JSON response", slug)
        return []

    jobs = []
    for j in data.get("jobs", []):
        location = (j.get("location") or {}).get("name") or ""
        offices = j.get("offices") or []
        if offices:
            location = ", ".join(o.get("name", "") for o in offices if o.get("name"))
        jobs.append({
            "id": f"greenhouse:{slug}:{j.get('id')}",
            "company": slug,
            "title": j.get("title", "").strip(),
            "location": location.strip(),
            "url": j.get("absolute_url", ""),
            "description_html": j.get("content", "") or "",
            "updated_at": j.get("updated_at"),
            "source": "greenhouse",
        })
    return jobs
