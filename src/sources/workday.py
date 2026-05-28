"""Workday CXS API: https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs

Slug format: "{tenant}/{site}" — adapter probes common wdN host prefixes
(wd1, wd2, wd3, wd5) to find the right one.

Workday list endpoint returns title + location + externalPath but NO description.
For now we surface what's there; downstream scoring works on title + location.
A future enhancement can lazy-fetch the JD body for jobs that pass title pre-filter.
"""
from __future__ import annotations

import logging
import requests

log = logging.getLogger(__name__)

HOST_PREFIXES = ["wd1", "wd5", "wd3", "wd2", "wd12"]
LIMIT = 20  # Workday API caps page size at 20
MAX_PAGES = 10  # → up to 200 jobs/company


def _api_url(tenant: str, site: str, host: str) -> str:
    return f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"


def _job_detail_url(tenant: str, site: str, host: str, external_path: str) -> str:
    # external_path already starts with "/job/...", so don't add another /job.
    return f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{external_path}"


def _public_url(tenant: str, site: str, host: str, external_path: str) -> str:
    return f"https://{tenant}.{host}.myworkdayjobs.com/en-US/{site}{external_path}"


def _post_list(url: str, offset: int, timeout: int) -> dict | None:
    try:
        r = requests.post(
            url,
            json={"appliedFacets": {}, "limit": LIMIT, "offset": offset, "searchText": ""},
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36",
            },
            timeout=timeout,
        )
    except requests.RequestException as e:
        log.warning("workday %s: request failed: %s", url, e)
        return None
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        log.warning("workday %s: HTTP %s", url, r.status_code)
        return None
    try:
        return r.json()
    except ValueError:
        log.warning("workday %s: non-JSON response", url)
        return None


def enrich_description(job: dict, timeout: int = 15) -> dict:
    """Lazy-fetch JD body for a Workday job. Mutates job dict in place and returns it.
    Called by main.py only for jobs that survive title/location pre-filter — keeps API
    volume manageable (~1 detail call per high-potential job).
    """
    if job.get("source") != "workday" or job.get("description_html"):
        return job
    # Reconstruct detail URL from job id
    # id format: "workday:{tenant}/{site}:{externalPath}"
    parts = job["id"].split(":", 2)
    if len(parts) < 3:
        return job
    ts, external_path = parts[1], parts[2]
    if "/" not in ts:
        return job
    tenant, site = ts.split("/", 1)
    for host in HOST_PREFIXES:
        url = _job_detail_url(tenant, site, host, external_path)
        try:
            r = requests.get(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36",
                },
                timeout=timeout,
            )
        except requests.RequestException:
            continue
        if r.status_code != 200:
            continue
        try:
            data = r.json()
        except ValueError:
            continue
        info = data.get("jobPostingInfo") or {}
        body = info.get("jobDescription") or ""
        if body:
            # Strip HTML tags for cleaner scoring
            import re as _re
            stripped = _re.sub(r"<[^>]+>", " ", body)
            job["description_html"] = stripped
            # Update the cached _jd_text (set by filters.passes_pre_filters)
            # so scoring sees the enriched content.
            job["_jd_text"] = stripped
        return job
    return job


def fetch(slug: str, timeout: int = 20) -> list[dict]:
    """slug: "tenant/site"  e.g. "microsoft/Microsoft" or "nvidia/NVIDIAExternalCareerSite"."""
    if "/" not in slug:
        log.warning("workday slug must be 'tenant/site', got %r", slug)
        return []
    tenant, site = slug.split("/", 1)

    # Probe host prefixes
    used_host = None
    first_page = None
    for host in HOST_PREFIXES:
        data = _post_list(_api_url(tenant, site, host), 0, timeout)
        if data is not None and data.get("jobPostings"):
            used_host = host
            first_page = data
            break
    if not first_page:
        return []

    total = first_page.get("total") or 0
    all_postings = list(first_page.get("jobPostings", []))
    # Pull additional pages if total > LIMIT (cap at 5 pages = 250 jobs/company)
    offset = LIMIT
    pages = 1
    while offset < total and pages < MAX_PAGES:
        data = _post_list(_api_url(tenant, site, used_host), offset, timeout)
        if not data:
            break
        all_postings.extend(data.get("jobPostings", []))
        offset += LIMIT
        pages += 1

    jobs = []
    for j in all_postings:
        external_path = j.get("externalPath") or ""
        jobs.append({
            "id": f"workday:{tenant}/{site}:{external_path}",
            "company": tenant,
            "title": (j.get("title") or "").strip(),
            "location": (j.get("locationsText") or "").strip(),
            "url": _public_url(tenant, site, used_host, external_path),
            "description_html": "",  # description requires separate fetch
            "updated_at": j.get("postedOn"),
            "source": "workday",
        })
    return jobs
