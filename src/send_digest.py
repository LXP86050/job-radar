"""Send the daily digest email with tailored PDF attachments.

Runs AFTER apply/tailor-matches.js so the tailored PDFs exist.
Reads state/matches/{date}-{profile}.json + state/tailored/{date}/index.json.
Sends one email per profile (Job Radar / IT Radar / High-Pay IT Radar)
with TOP 10 PDFs attached (highest score) — skip send if 0 matches.

Env vars:
  SENDGRID_API_KEY  required
  SENDER_EMAIL      required (must be verified in SendGrid)
  RECIPIENT_EMAIL   required
  DIGEST_PROFILE    default 'job-radar'
  DIGEST_MAX_ATTACHED  default 10  (top-N PDFs attached)
"""
from __future__ import annotations

import base64
import html
import json
import os
import sys
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import sendgrid
from sendgrid.helpers.mail import Mail, Attachment, FileContent, FileName, FileType, Disposition

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("digest")

PROFILE = os.environ.get("DIGEST_PROFILE", "job-radar")
PROFILE_LABEL = {
    "job-radar": "Job Radar (AI/SWE)",
    "it-radar": "IT Radar",
    "high-pay-it-radar": "High-Pay IT Radar",
}.get(PROFILE, PROFILE)
MAX_ATTACHED = int(os.environ.get("DIGEST_MAX_ATTACHED", "10"))

ROOT = Path(".")
TODAY = datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%d")
MATCHES_PATH = ROOT / "state" / "matches" / f"{TODAY}-{PROFILE}.json"
TAILORED_DIR = ROOT / "state" / "tailored" / TODAY
INDEX_PATH = TAILORED_DIR / "index.json"


def _row(match: dict, pdf_path: str | None) -> str:
    title = html.escape(match.get("title", ""))
    company = html.escape(match.get("company", ""))
    location = html.escape(match.get("location", "") or "—")
    url = html.escape(match.get("url", ""))
    score = match.get("score", "—")
    coverage = match.get("coverage")
    cov_str = f"<span style='color:#4ade80;font-size:10px;'>{coverage}% match</span>" if coverage else ""
    pdf_str = f"<a href='{html.escape(pdf_path or '')}' style='color:#888;font-size:11px;text-decoration:none;'>📄 attached</a>" if pdf_path else "<span style='color:#999;font-size:11px;'>see artifact</span>"

    return f"""
    <tr style="border-bottom:1px solid #eaecef;">
      <td style="padding:10px 8px;vertical-align:top;">
        <div style="font-size:14px;font-weight:600;color:#0366d6;">
          <a href="{url}" style="color:#0366d6;text-decoration:none;">{title}</a>
        </div>
        <div style="font-size:12px;color:#586069;margin-top:2px;">
          {company} &middot; {location} &middot; {pdf_str}
        </div>
      </td>
      <td align="center" style="padding:10px 8px;vertical-align:middle;width:60px;">
        <div style="font-size:16px;font-weight:700;color:#22863a;">{score}</div>
        {cov_str}
      </td>
    </tr>
    """


def build_html(matches: list[dict], index_by_id: dict, attached_paths: list[str]) -> str:
    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%a %b %d, %Y · %I:%M %p ET")
    rows_html = []
    for m in matches:
        # Look up tailored PDF info (coverage %, etc.)
        idx = index_by_id.get(m.get("id"))
        if idx:
            m_full = {**m, "coverage": idx.get("coverage")}
            # Path used as a label (filename) — recipient will see the attachment in their mail client.
            pdf_name = os.path.basename(idx.get("pdf") or "")
            rows_html.append(_row(m_full, pdf_name))
        else:
            rows_html.append(_row(m, None))

    summary = f"{len(matches)} new match{'es' if len(matches) != 1 else ''} · {len(attached_paths)} resume PDF(s) attached (top-{MAX_ATTACHED} by score)"

    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:760px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 4px 0;font-size:20px;color:#111;">{html.escape(PROFILE_LABEL)} — {et_now}</h2>
    <div style="color:#666;font-size:13px;margin-bottom:16px;">{html.escape(summary)}</div>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
      <thead>
        <tr style="background:#f1f3f5;">
          <th align="left" style="padding:10px 8px;font-size:11px;text-transform:uppercase;color:#555;">Role · Company · Resume</th>
          <th align="center" style="padding:10px 8px;font-size:11px;text-transform:uppercase;color:#555;width:80px;">Score</th>
        </tr>
      </thead>
      <tbody>{''.join(rows_html)}</tbody>
    </table>
    <p style="margin-top:16px;color:#888;font-size:11px;line-height:1.6;">
      Top {MAX_ATTACHED} PDFs (by score) are attached. Lower-scored matches are tailored too —
      grab them from <a href="https://github.com/LXP86050/job-radar/actions" style="color:#0366d6;">workflow artifacts</a> (run name: <code>tailored-resumes-{{run_id}}</code>).
    </p>
  </div>
</body></html>"""


def _make_attachment(path: Path) -> Attachment:
    data = path.read_bytes()
    a = Attachment()
    a.file_content = FileContent(base64.b64encode(data).decode())
    a.file_name = FileName(path.name)
    a.file_type = FileType("application/pdf")
    a.disposition = Disposition("attachment")
    return a


def main() -> int:
    api_key = os.environ.get("SENDGRID_API_KEY")
    sender = os.environ.get("SENDER_EMAIL")
    recipient = os.environ.get("RECIPIENT_EMAIL")
    if not (api_key and sender and recipient):
        log.error("Missing SENDGRID_API_KEY / SENDER_EMAIL / RECIPIENT_EMAIL")
        return 1

    if not MATCHES_PATH.exists():
        log.info("No matches file %s — skipping digest", MATCHES_PATH)
        return 0
    matches = json.loads(MATCHES_PATH.read_text())
    if not matches:
        log.info("0 matches — skipping email entirely (no spam)")
        return 0

    # Sort by score descending (already sorted by main.py but be safe)
    matches.sort(key=lambda m: m.get("score", 0), reverse=True)

    # Load tailored index for coverage % + PDF paths
    index = []
    if INDEX_PATH.exists():
        try:
            index = json.loads(INDEX_PATH.read_text())
        except Exception:
            pass
    index_by_id = {e.get("job_id"): e for e in index}

    # Pick top N matches that have a tailored PDF for attachment
    attached_paths: list[Path] = []
    for m in matches:
        if len(attached_paths) >= MAX_ATTACHED:
            break
        idx = index_by_id.get(m.get("id"))
        if not idx or not idx.get("pdf"):
            continue
        p = ROOT / idx["pdf"]
        if p.exists():
            attached_paths.append(p)

    html_body = build_html(matches, index_by_id, attached_paths)
    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%a %b %d %I:%M%p ET")
    msg = Mail(
        from_email=sender,
        to_emails=recipient,
        subject=f"{PROFILE_LABEL} — {len(matches)} matches · {et_now}",
        html_content=html_body,
    )
    for p in attached_paths:
        msg.add_attachment(_make_attachment(p))

    sg = sendgrid.SendGridAPIClient(api_key=api_key)
    resp = sg.send(msg)
    log.info("SendGrid %s; %d matches, %d PDFs attached", resp.status_code, len(matches), len(attached_paths))
    return 0


if __name__ == "__main__":
    sys.exit(main())
