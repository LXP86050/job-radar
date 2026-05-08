"""ATS-style match score (0-100) for a job vs the resume profile.

Components:
  Skills overlap  — 50pts (8+ matched skills = full)
  Title/seniority — 20pts
  YoE match       —  15pts
  Location        —  10pts
  AI/ML bonus     —   5pts
"""
from __future__ import annotations

import re

_YOE_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:to\s*\d{1,2}\s*)?(?:years?|yrs?)", re.IGNORECASE)


def _flat_skills(profile: dict) -> list[str]:
    out: list[str] = []
    for v in profile["skills"].values():
        out.extend(v)
    # longest first so multi-word terms match before single tokens
    return sorted(set(out), key=lambda s: (-len(s), s))


def skill_overlap(jd_text: str, skills: list[str]) -> tuple[int, list[str]]:
    text = jd_text.lower()
    found: list[str] = []
    for s in skills:
        if re.search(rf"(?<![a-z0-9]){re.escape(s)}(?![a-z0-9])", text):
            found.append(s)
    return len(found), found


def title_score(title: str, profile: dict) -> int:
    t = title.lower()
    score = 0
    if any(p in t for p in profile["preferred_titles"]):
        score += 14
    # seniority signals — Lokesh is mid-to-senior
    seniority_hits = [
        ("senior", 6),
        ("sr.", 6),
        ("sr ", 6),
        ("staff", 6),
        (" ii", 6),
        (" 2", 5),
        ("ai engineer", 6),
        ("ml engineer", 6),
        ("machine learning engineer", 6),
        ("forward deployed", 6),
        ("foundation", 5),
        ("applied", 5),
    ]
    bonus = 0
    for needle, pts in seniority_hits:
        if needle in t:
            bonus = max(bonus, pts)
    return min(20, score + bonus)


def yoe_score(jd_text: str, candidate_yoe: int) -> int:
    """15pts if required-min ≤ candidate ≤ required-max+2; partial otherwise.
    If no YoE stated, give 12 (benefit of doubt)."""
    matches = _YOE_RE.findall(jd_text)
    if not matches:
        return 12
    nums = [int(m) for m in matches if m.isdigit()]
    if not nums:
        return 12
    req_min = min(nums)
    req_max = max(nums) if max(nums) > req_min else req_min + 4
    if req_min <= candidate_yoe <= req_max + 2:
        return 15
    if candidate_yoe >= req_min - 1:
        return 10
    if candidate_yoe < req_min - 2:
        return 0
    return 5


def location_score(location: str) -> int:
    loc = (location or "").lower()
    if not loc:
        return 7
    if "remote" in loc and ("us" in loc or "united states" in loc or "americas" in loc):
        return 10
    if "remote" in loc:
        return 8
    if any(c in loc for c in ("seattle", "redmond", "bellevue", "kirkland")):
        return 10
    if any(c in loc for c in ("san francisco", "sf", "bay area", "palo alto", "mountain view", "sunnyvale", "new york", "nyc", "los angeles", "austin", "boston", "chicago", "denver")):
        return 9
    return 7


def ai_bonus(jd_text: str) -> int:
    t = jd_text.lower()
    hits = [
        "llm", "rag", "retrieval augmented", "vector database", "embeddings",
        "openai", "anthropic", "agents", "agentic", "fine-tuning", "azure openai",
        "langchain", "llamaindex", "ai engineer", "applied ai", "applied ml",
    ]
    n = sum(1 for h in hits if h in t)
    return min(5, n)


def score_job(job: dict, profile: dict) -> dict:
    jd_text = job.get("_jd_text") or ""
    title = job.get("title", "")
    skills = _flat_skills(profile)
    n_skills, matched = skill_overlap(jd_text + " " + title, skills)
    skills_pts = min(50, round((n_skills / 8) * 50))
    t_pts = title_score(title, profile)
    y_pts = yoe_score(jd_text, profile["years_experience"])
    l_pts = location_score(job.get("location", ""))
    ai_pts = ai_bonus(jd_text)
    total = skills_pts + t_pts + y_pts + l_pts + ai_pts
    return {
        "score": total,
        "matched_skills": matched,
        "breakdown": {
            "skills": skills_pts,
            "title": t_pts,
            "yoe": y_pts,
            "location": l_pts,
            "ai_bonus": ai_pts,
        },
    }
