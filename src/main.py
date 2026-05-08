"""Daily job-match orchestrator.

Flow:
  1. Skip if not 7am ET (within tolerance) — so the workflow can run at multiple UTC
     times for DST robustness without double-sending.
  2. Skip if today already sent.
  3. Fetch jobs from all configured sources in parallel.
  4. Pre-filter on title / location / sponsorship terms / stated salary.
  5. Score each remaining job; keep score >= threshold.
  6. De-dup against `state/seen.json`.
  7. Send email; persist state.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from src import companies, email_sender, filters, scoring, state
from src.sources import ashby, greenhouse, lever

THRESHOLD = int(os.environ.get("ATS_THRESHOLD", "85"))
TARGET_HOUR_ET = 7
PROFILE_PATH = Path(os.environ.get("PROFILE_PATH", "data/resume_profile.json"))
PROFILE_NAME = os.environ.get("PROFILE_NAME", "Job Radar")
FORCED = os.environ.get("FORCE_RUN") == "1"

log = logging.getLogger("job_radar")


def _is_target_hour() -> bool:
    if FORCED:
        return True
    return datetime.now(ZoneInfo("America/New_York")).hour == TARGET_HOUR_ET


def _load_profile() -> dict:
    return json.loads(PROFILE_PATH.read_text())


def _fetch_all() -> list[dict]:
    grouped = companies.by_ats()
    fetchers = {"greenhouse": greenhouse.fetch, "lever": lever.fetch, "ashby": ashby.fetch}
    tasks: list[tuple[str, str]] = []
    for ats, slugs in grouped.items():
        if ats not in fetchers:
            continue
        for slug in slugs:
            tasks.append((ats, slug))

    all_jobs: list[dict] = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(fetchers[ats], slug): (ats, slug) for ats, slug in tasks}
        for fut in as_completed(futures):
            ats, slug = futures[fut]
            try:
                jobs = fut.result()
                all_jobs.extend(jobs)
                log.info("fetched %s/%s: %d jobs", ats, slug, len(jobs))
            except Exception as e:
                log.warning("fetch failed for %s/%s: %s", ats, slug, e)
    return all_jobs


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if not _is_target_hour():
        h = datetime.now(ZoneInfo("America/New_York")).hour
        log.info("skipping: ET hour is %d, target is %d", h, TARGET_HOUR_ET)
        return 0
    if not FORCED and state.already_sent_today():
        log.info("skipping: already sent today")
        return 0

    profile = _load_profile()
    log.info("[%s] threshold=%d, fetching jobs…", PROFILE_NAME, THRESHOLD)
    jobs = _fetch_all()
    log.info("total fetched: %d", len(jobs))

    pre_kept: list[dict] = []
    rejection_reasons: dict[str, int] = {}
    for j in jobs:
        ok, reason = filters.passes_pre_filters(j, profile)
        if ok:
            pre_kept.append(j)
        else:
            rejection_reasons[reason] = rejection_reasons.get(reason, 0) + 1
    log.info("post pre-filter: %d  (rejections: %s)", len(pre_kept), rejection_reasons)

    seen = state.load_seen()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    matches: list[dict] = []
    for j in pre_kept:
        sd = scoring.score_job(j, profile)
        if sd["score"] < THRESHOLD:
            continue
        if j["id"] in seen:
            continue
        matches.append({"job": j, "score_data": sd})
        seen[j["id"]] = today

    sort_by = profile.get("sort_by", "score")
    if sort_by == "salary":
        matches.sort(key=lambda m: (m["job"].get("_max_salary") or 0, m["score_data"]["score"]), reverse=True)
    else:
        matches.sort(key=lambda m: m["score_data"]["score"], reverse=True)
    log.info("matches at threshold %d: %d (sorted by %s)", THRESHOLD, len(matches), sort_by)

    cap = profile.get("max_email_rows")
    shown = matches[:cap] if cap else matches
    email_sender.send(shown, THRESHOLD, total_scanned=len(jobs), profile_name=PROFILE_NAME, total_matches=len(matches))
    state.save_seen(seen)
    state.mark_sent_today()
    log.info("[%s] done — emailed %d matches", PROFILE_NAME, len(matches))
    return 0


if __name__ == "__main__":
    sys.exit(run())
