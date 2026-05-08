"""Role/title, sponsorship, location, salary, and freshness filters applied before scoring."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from html import unescape

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

# Capture salary ranges or single values, e.g. "$140,000 - $200,000", "$140K - $200K", "$140k–$200k"
_SAL_RANGE_RE = re.compile(
    r"\$\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*[Kk]?\s*[-–—to]+\s*\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*[Kk]?",
)
_SAL_SINGLE_RE = re.compile(r"\$\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*[Kk]?")


def strip_html(s: str) -> str:
    s = unescape(s or "")
    s = _TAG_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def title_matches(title: str, profile: dict) -> bool:
    """Return True if title matches a preferred role and not an excluded one."""
    t = title.lower()
    if any(bad in t for bad in profile["exclude_title_terms"]):
        return False
    return any(good in t for good in profile["preferred_titles"])


def is_us_or_remote(location: str) -> bool:
    """True if location is US or US-remote. Tolerant — most postings list cities or 'Remote'."""
    if not location:
        # Empty location: don't reject; some boards omit it. Let downstream JD check handle it.
        return True
    loc = location.lower()
    # Hard reject obvious non-US
    non_us = [
        "london", "berlin", "paris", "madrid", "barcelona", "amsterdam", "dublin",
        "munich", "lisbon", "warsaw", "stockholm", "copenhagen", "tel aviv", "tokyo",
        "singapore", "sydney", "melbourne", "toronto", "vancouver", "montreal",
        "bangalore", "bengaluru", "hyderabad", "mumbai", "delhi", "noida", "pune", "chennai",
        "manila", "shanghai", "beijing", "shenzhen", "hong kong", "seoul", "dubai",
        "mexico city", "são paulo", "sao paulo", "buenos aires",
        "china", "uk", "u.k.", "emea", "apac", "latam", "india", "ireland",
        "germany", "france", "spain", "netherlands", "australia", "canada", "japan",
        "brazil", "argentina", "philippines", "indonesia", "thailand", "vietnam",
    ]
    if any(x in loc for x in non_us):
        # But "remote, US" or similar should still pass even if it mentions other regions
        if "us" in loc or "united states" in loc or "americas" in loc or "remote" in loc:
            # Allow if US is one of the listed locations
            if any(x in loc for x in [", us", "(us)", "us)", "united states", "usa", "u.s.", "americas"]):
                return True
        return False
    return True


def sponsors_h1b(jd_text: str, profile: dict) -> bool:
    """Hard-exclude postings that explicitly say no sponsorship / citizenship-required."""
    t = jd_text.lower()
    return not any(term in t for term in profile["exclude_jd_terms"])


def extract_max_salary(jd_text: str) -> int | None:
    """Extract the highest stated annualized salary in USD, or None if not found.
    Treats values 30..600 (no comma, no K) as 'thousands' if context suggests so.
    Skips unrealistic single values like '$15' (likely hourly/promo).
    """
    text = jd_text
    best: int | None = None
    for m in _SAL_RANGE_RE.finditer(text):
        for grp in m.groups():
            v = _normalize_amount(grp, full_match=m.group(0))
            if v and (best is None or v > best):
                best = v
    if best is not None:
        return best
    # Fallback: single values in vicinity of "salary"/"compensation"/"base"
    for m in _SAL_SINGLE_RE.finditer(text):
        ctx_start = max(0, m.start() - 60)
        ctx = text[ctx_start:m.end() + 20].lower()
        if any(k in ctx for k in ("salary", "base pay", "base salary", "compensation", "annual", "total comp", "tc range")):
            v = _normalize_amount(m.group(1), full_match=m.group(0))
            if v and (best is None or v > best):
                best = v
    return best


def _normalize_amount(raw: str, full_match: str = "") -> int | None:
    raw_clean = raw.replace(",", "")
    try:
        n = float(raw_clean)
    except ValueError:
        return None
    has_k = "k" in full_match.lower()
    if has_k:
        n *= 1000
    elif n < 1000:
        # Bare number like "140" — interpret as thousands.
        n *= 1000
    if n < 30000 or n > 1_500_000:
        return None
    return int(n)


def _parse_ts(raw) -> datetime | None:
    """Best-effort parse of source timestamps. Returns timezone-aware UTC datetime or None."""
    if raw is None or raw == "":
        return None
    # Lever: epoch milliseconds (int or numeric str).
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(raw / 1000.0, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    s = str(raw).strip()
    if s.isdigit():
        try:
            n = int(s)
            return datetime.fromtimestamp(n / 1000.0 if n > 10**11 else n, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    # ISO 8601 — handle the 'Z' suffix that fromisoformat doesn't accept on older stdlib.
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_recent(job: dict, max_age_days: int) -> bool:
    dt = _parse_ts(job.get("updated_at"))
    if dt is None:
        return True  # benefit of the doubt; some boards omit timestamps
    age_days = (datetime.now(timezone.utc) - dt).days
    return age_days <= max_age_days


def passes_pre_filters(job: dict, profile: dict) -> tuple[bool, str]:
    """Returns (ok, reason_if_rejected)."""
    title = job.get("title", "")
    if not title_matches(title, profile):
        return False, "title"
    if not is_us_or_remote(job.get("location", "")):
        return False, "location"
    max_age = profile.get("max_age_days")
    if max_age and not is_recent(job, max_age):
        return False, f"age>{max_age}d"
    jd_text = strip_html(job.get("description_html", ""))
    job["_jd_text"] = jd_text  # cache for scoring
    if not sponsors_h1b(jd_text, profile):
        return False, "no-sponsorship"
    sal = extract_max_salary(jd_text + " " + (job.get("compensation_summary") or ""))
    job["_max_salary"] = sal
    if sal is not None and sal < profile["min_total_comp"]:
        return False, f"salary<{profile['min_total_comp']}"
    return True, ""
