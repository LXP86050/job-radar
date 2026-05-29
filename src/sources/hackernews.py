"""HackerNews "Ask HN: Who is hiring?" parser.

Monthly thread, hundreds of comments. Each top-level comment is one company.
Lower applicant volume than LinkedIn/Indeed → these are "hidden gem" jobs.

Strategy:
  1. Use Algolia HN API to find the most recent "Ask HN: Who is hiring?" story.
  2. Fetch the story + first ~500 top-level comments via Firebase HN API.
  3. Parse each comment: company name (first line), location, role keywords,
     apply link (extract first URL).
  4. Emit job dicts matching the radar's expected shape.

Comments don't have salary info usually — we don't pre-filter on it, just
let scoring decide.
"""
from __future__ import annotations

import html
import logging
import re
import urllib.request
import urllib.parse
import json
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

ALGOLIA_SEARCH = "https://hn.algolia.com/api/v1/search"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{id}.json"

# Lines often start with "** Company | Role | Location"
_HEADER_SPLIT = re.compile(r"\s*[|•·–-]\s*")
_URL_RE = re.compile(r"https?://[^\s<>\"]+")
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return _TAG_RE.sub(" ", html.unescape(s or "")).strip()


def _http_get_json(url: str, timeout: float = 15) -> dict | list | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "job-radar/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except Exception as e:
        log.warning("HN fetch %s failed: %s", url, e)
        return None


def _find_latest_hiring_story() -> int | None:
    """Find the most recent 'Ask HN: Who is hiring?' story ID via Algolia."""
    params = urllib.parse.urlencode({
        "query": "Ask HN: Who is hiring?",
        "tags": "story,author_whoishiring",
        "hitsPerPage": "5",
    })
    data = _http_get_json(f"{ALGOLIA_SEARCH}?{params}")
    if not data or not data.get("hits"):
        return None
    # Most recent first
    hits = sorted(data["hits"], key=lambda h: h.get("created_at_i", 0), reverse=True)
    return int(hits[0]["objectID"])


def _fetch_comment(comment_id: int) -> dict | None:
    return _http_get_json(HN_ITEM.format(id=comment_id))


def _parse_comment(c: dict) -> dict | None:
    """Parse one HN comment into a job dict, or None if not a real listing."""
    text = _strip_html(c.get("text", ""))
    if not text or len(text) < 60:
        return None
    # Skip comments that look like meta-discussion
    if any(x in text.lower()[:200] for x in (
        "thanks for", "what is this", "guidelines", "see also",
        "i'm looking", "im looking", "i am looking",
    )):
        return None

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return None

    # First line is usually "Company | Role | Location" or "Company - Role - Location"
    header = lines[0]
    parts = _HEADER_SPLIT.split(header)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        return None

    company = parts[0][:100]
    role = parts[1][:120] if len(parts) > 1 else ""
    location_parts = parts[2:] if len(parts) > 2 else []
    location = " / ".join(location_parts)[:150]

    # Quick remote/visa heuristics
    full_lower = text.lower()
    remote_us = any(s in full_lower for s in ("remote (us)", "us remote", "remote, us", "remote in the us"))
    visa_no = any(s in full_lower for s in ("no visa", "us only no sponsorship", "no h1b", "no sponsorship"))

    # Skip the obvious non-US-sponsor listings
    if visa_no:
        return None

    # Apply URL: first https in body
    url_match = _URL_RE.search(text)
    apply_url = url_match.group(0) if url_match else f"https://news.ycombinator.com/item?id={c.get('id')}"

    job_id = f"hackernews:hn:{c.get('id')}"

    return {
        "id": job_id,
        "source": "hackernews",
        "company": company,
        "title": role or "(see comment)",
        "location": location or ("Remote — US" if remote_us else ""),
        "url": apply_url,
        "description_html": _wrap_html(text),
        "updated_at": _iso_from_ts(c.get("time")),
    }


def _wrap_html(text: str) -> str:
    body = html.escape(text)
    return f"<div>{body}</div>"


def _iso_from_ts(ts) -> str:
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except Exception:
        return ""


def fetch(_unused_slug: str = "hn") -> list[dict]:
    """Fetch HN 'Who is hiring' jobs. Slug arg ignored — there's one thread."""
    story_id = _find_latest_hiring_story()
    if not story_id:
        log.warning("HN: could not find latest 'Who is hiring' thread")
        return []
    story = _fetch_comment(story_id)
    if not story or not story.get("kids"):
        return []
    comment_ids = story["kids"]  # top-level comment IDs
    log.info("HN thread %d: %d top-level comments", story_id, len(comment_ids))

    jobs: list[dict] = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        for c in pool.map(_fetch_comment, comment_ids):
            if not c:
                continue
            j = _parse_comment(c)
            if j:
                jobs.append(j)
    log.info("HN parsed %d job-like comments", len(jobs))
    return jobs
