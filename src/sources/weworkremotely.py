"""We Work Remotely — RSS feeds for remote programming jobs.

Each category has its own RSS feed at /categories/{slug}.rss
We pull:
  - remote-programming-jobs (broadest)
  - remote-back-end-programming-jobs
  - remote-front-end-programming-jobs
  - remote-full-stack-programming-jobs
  - remote-devops-sysadmin-jobs

Each <item> has title, link, description (HTML), pubDate.
Title format is usually "Company: Role Title".
"""
from __future__ import annotations

import html as html_mod
import logging
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

log = logging.getLogger(__name__)

FEEDS = [
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
]

_EXCLUDE = [
    "intern", "junior", "manager", "director", "head of", "vp ",
]


def _http_get(url: str, timeout: float = 20) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (job-radar)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        log.warning("WWR fetch %s failed: %s", url, e)
        return None


def _parse_item(item: ET.Element) -> dict | None:
    def get(tag):
        el = item.find(tag)
        return el.text.strip() if el is not None and el.text else ""

    raw_title = get("title")
    link = get("link")
    desc = get("description")
    pub_date = get("pubDate")

    if not raw_title or not link:
        return None

    # Title is usually "Company: Role"
    if ":" in raw_title:
        company, _, title = raw_title.partition(":")
        company = company.strip()
        title = title.strip()
    else:
        # Fallback if format differs
        title = raw_title.strip()
        company = "(see posting)"

    tl = title.lower()
    if any(x in tl for x in _EXCLUDE):
        return None
    if not any(k in tl for k in ("engineer", "developer", "swe", "sde", "tech lead")):
        return None

    # Try to ID from link path
    m = re.search(r"/listings/([a-z0-9-]+)", link, re.IGNORECASE)
    job_id = m.group(1) if m else link.rsplit("/", 1)[-1]

    # ISO-ish timestamp
    iso = ""
    try:
        # pubDate looks like "Tue, 29 May 2026 15:00:00 +0000"
        dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %z")
        iso = dt.isoformat()
    except Exception:
        pass

    # Strip explicit no-sponsor flags from description
    if "no sponsorship" in desc.lower() or "no visa" in desc.lower():
        return None

    return {
        "id": f"weworkremotely:{job_id}",
        "source": "weworkremotely",
        "company": company,
        "title": title,
        "location": "Remote",
        "url": link,
        "description_html": desc,  # already HTML in RSS
        "updated_at": iso,
    }


def fetch(_unused_slug: str = "wwr") -> list[dict]:
    seen_ids: set[str] = set()
    jobs: list[dict] = []
    for feed_url in FEEDS:
        body = _http_get(feed_url)
        if not body:
            continue
        try:
            root = ET.fromstring(body)
        except ET.ParseError as e:
            log.warning("WWR parse %s failed: %s", feed_url, e)
            continue
        for item in root.iter("item"):
            j = _parse_item(item)
            if j and j["id"] not in seen_ids:
                seen_ids.add(j["id"])
                jobs.append(j)
    log.info("WeWorkRemotely: %d unique job(s) across %d feeds", len(jobs), len(FEEDS))
    return jobs
