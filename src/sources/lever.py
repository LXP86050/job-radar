"""Lever public postings API: https://api.lever.co/v0/postings/{slug}?mode=json"""
from __future__ import annotations

import logging
import requests

log = logging.getLogger(__name__)

API = "https://api.lever.co/v0/postings/{slug}"


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    url = API.format(slug=slug)
    try:
        r = requests.get(url, params={"mode": "json"}, timeout=timeout)
    except requests.RequestException as e:
        log.warning("lever %s: request failed: %s", slug, e)
        return []
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        log.warning("lever %s: HTTP %s", slug, r.status_code)
        return []
    try:
        data = r.json()
    except ValueError:
        log.warning("lever %s: non-JSON response", slug)
        return []

    jobs = []
    for j in data:
        cats = j.get("categories", {}) or {}
        location = cats.get("location") or ""
        all_locs = cats.get("allLocations") or []
        if all_locs:
            location = ", ".join(all_locs)
        descr = j.get("descriptionPlain") or j.get("description") or ""
        for li in j.get("lists", []) or []:
            descr += "\n" + (li.get("text") or "")
        jobs.append({
            "id": f"lever:{slug}:{j.get('id')}",
            "company": slug,
            "title": (j.get("text") or "").strip(),
            "location": location,
            "url": j.get("hostedUrl") or j.get("applyUrl") or "",
            "description_html": descr,
            "updated_at": j.get("createdAt"),
            "source": "lever",
        })
    return jobs
