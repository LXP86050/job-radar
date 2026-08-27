"""Apple jobs site: server-rendered, no separate API. Job data is embedded
in the page as window.__staticRouterHydrationData = JSON.parse("...") —
a double-encoded JSON blob (JS string literal wrapping real JSON). Full
job summary is inline; no per-job enrichment needed.
"""
from __future__ import annotations

import json
import logging
import re
import requests

log = logging.getLogger(__name__)

SEARCH_URL = "https://jobs.apple.com/en-us/search"
DETAIL_URL = "https://jobs.apple.com/en-us/details/{id}/{slug}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36"}
MARKER = "__staticRouterHydrationData = JSON.parse("
MAX_PAGES = 15


def _extract_search_results(html: str) -> tuple[list[dict], int]:
    idx = html.find(MARKER)
    if idx == -1:
        return [], 0
    start = idx + len(MARKER)
    end = html.find(");", start)
    if end == -1:
        return [], 0
    try:
        inner = json.loads(html[start:end])  # unescape JS string -> raw JSON text
        data = json.loads(inner)
    except (ValueError, json.JSONDecodeError):
        return [], 0
    search = (data.get("loaderData") or {}).get("search") or {}
    return search.get("searchResults") or [], search.get("totalRecords") or 0


def fetch(search: str = "software engineer", timeout: int = 20) -> list[dict]:
    all_results: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        try:
            r = requests.get(
                SEARCH_URL,
                params={"search": search, "location": "united-states-USA", "page": page},
                headers=HEADERS,
                timeout=timeout,
            )
            r.raise_for_status()
        except requests.RequestException as e:
            log.warning("apple: request failed at page=%d: %s", page, e)
            break
        results, total = _extract_search_results(r.text)
        if not results:
            break
        all_results.extend(results)
        if len(all_results) >= total:
            break

    jobs = []
    for r in all_results:
        rid = r.get("id")
        pos_id = r.get("positionId")
        slug = r.get("transformedPostingTitle") or ""
        if not (rid and pos_id):
            continue
        locations = ", ".join(
            loc.get("name") or loc.get("countryName") or ""
            for loc in (r.get("locations") or [])
        )
        summary = r.get("jobSummary") or ""
        jobs.append({
            "id": f"apple:{rid}",
            "company": "apple",
            "title": (r.get("postingTitle") or "").strip(),
            "location": locations.strip(),
            "url": DETAIL_URL.format(id=rid, slug=slug),
            "description_html": summary,
            "updated_at": r.get("postDateInGMT") or r.get("postingDate"),
            "source": "apple",
        })
    return jobs
