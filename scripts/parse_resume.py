"""Re-parse the resume PDF and update data/resume_profile.json's `years_experience`.

Use this after replacing the resume. It does NOT regenerate the curated skill list —
edit data/resume_profile.json directly to add/remove skills the script searches for in JDs.

Usage:  python scripts/parse_resume.py /path/to/resume.pdf
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

PROFILE_PATH = Path("data/resume_profile.json")


def extract_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def years_in_text(text: str) -> int:
    """Heuristic: sum spans like 'Mar 2024 - Present', 'Aug 2022 - Mar 2024' from EXPERIENCE section."""
    months = {m.lower(): i for i, m in enumerate(
        ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], start=1)}
    pat = re.compile(
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})\s*[-–]\s*"
        r"(present|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4}))",
        re.IGNORECASE,
    )
    from datetime import date
    today = date.today()
    total_months = 0
    for m in pat.finditer(text):
        sm, sy = months[m.group(1).lower()[:3]], int(m.group(2))
        if m.group(3).lower() == "present":
            em, ey = today.month, today.year
        else:
            em, ey = months[m.group(4).lower()[:3]], int(m.group(5))
        total_months += max(0, (ey - sy) * 12 + (em - sm))
    return round(total_months / 12)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    pdf = Path(sys.argv[1])
    text = extract_text(pdf)
    yoe = years_in_text(text)
    profile = json.loads(PROFILE_PATH.read_text())
    old = profile.get("years_experience")
    profile["years_experience"] = yoe
    PROFILE_PATH.write_text(json.dumps(profile, indent=2))
    print(f"years_experience: {old} -> {yoe}")


if __name__ == "__main__":
    main()
