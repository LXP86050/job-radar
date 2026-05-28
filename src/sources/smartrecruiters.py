"""SmartRecruiters public postings: https://api.smartrecruiters.com/v1/companies/{slug}/postings"""
from __future__ import annotations

import logging
import re
import requests

log = logging.getLogger(__name__)

API = "https://api.smartrecruiters.com/v1/companies/{slug}/postings"
LIMIT = 100  # max page size SmartRecruiters allows


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "")


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    url = API.format(slug=slug)
    all_jobs = []
    offset = 0
    pages = 0
    while pages < 5:
        try:
            r = requests.get(url, params={"limit": LIMIT, "offset": offset}, timeout=timeout)
        except requests.RequestException as e:
            log.warning("smartrecruiters %s: request failed: %s", slug, e)
            break
        if r.status_code == 404:
            return []
        if r.status_code != 200:
            log.warning("smartrecruiters %s: HTTP %s", slug, r.status_code)
            break
        try:
            data = r.json()
        except ValueError:
            log.warning("smartrecruiters %s: non-JSON response", slug)
            break

        content = data.get("content") or []
        all_jobs.extend(content)
        total = data.get("totalFound") or 0
        offset += LIMIT
        pages += 1
        if offset >= total:
            break

    jobs = []
    for j in all_jobs:
        loc = j.get("location") or {}
        location_parts = [loc.get("city"), loc.get("region"), loc.get("country")]
        location = ", ".join(p for p in location_parts if p)

        # SmartRecruiters description is split into "sections"
        descr_parts = []
        sections = (j.get("jobAd") or {}).get("sections") or {}
        for key in ("jobDescription", "qualifications", "additionalInformation"):
            sec = sections.get(key) or {}
            descr_parts.append(_strip_html(sec.get("text", "")))

        jobs.append({
            "id": f"smartrecruiters:{slug}:{j.get('id')}",
            "company": slug,
            "title": (j.get("name") or "").strip(),
            "location": location,
            "url": j.get("applyUrl") or j.get("ref") or "",
            "description_html": "\n".join(p for p in descr_parts if p),
            "updated_at": j.get("releasedDate"),
            "source": "smartrecruiters",
        })
    return jobs
