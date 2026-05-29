"""Chunked digest emails — every tailored PDF reaches your inbox.

For N matches with tailored PDFs:
  - Sort by score desc
  - Chunk into batches of DIGEST_CHUNK_SIZE (default 50)
  - Send one email per chunk; each email has all chunk's PDFs attached
  - Subject indicates chunk N of M

Matches WITHOUT a tailored PDF (over TAILOR_MAX cap) are listed in the
LAST chunk email as URL-only rows so nothing is lost.

Skip everything if 0 matches.

Env:
  SENDGRID_API_KEY, SENDER_EMAIL, RECIPIENT_EMAIL  required
  DIGEST_PROFILE       default 'job-radar'
  DIGEST_CHUNK_SIZE    default 50  (PDFs per email; Gmail cap ~25MB)
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
CHUNK_SIZE = int(os.environ.get("DIGEST_CHUNK_SIZE", "50"))

ROOT = Path(".")
TODAY = datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%d")
MATCHES_PATH = ROOT / "state" / "matches" / f"{TODAY}-{PROFILE}.json"
INDEX_PATH = ROOT / "state" / "tailored" / TODAY / "index.json"


def _row(match: dict, pdf_filename: str | None, coverage: int | None) -> str:
    title = html.escape(match.get("title", ""))
    company = html.escape(match.get("company", ""))
    location = html.escape(match.get("location", "") or "—")
    url = html.escape(match.get("url", ""))
    score = match.get("score", "—")
    cov_str = f"<span style='color:#22863a;font-size:10px;'>· {coverage}% match</span>" if coverage else ""
    pdf_str = (
        f"<span style='color:#0366d6;font-size:11px;'>📎 {html.escape(pdf_filename)}</span>"
        if pdf_filename else "<span style='color:#999;font-size:11px;'>no PDF (volume cap)</span>"
    )
    return f"""
    <tr style="border-bottom:1px solid #eaecef;">
      <td style="padding:10px 8px;vertical-align:top;">
        <div style="font-size:14px;font-weight:600;">
          <a href="{url}" style="color:#0366d6;text-decoration:none;">{title}</a>
        </div>
        <div style="font-size:12px;color:#586069;margin-top:2px;">
          {company} &middot; {location} &middot; {pdf_str} {cov_str}
        </div>
      </td>
      <td align="center" style="padding:10px 8px;vertical-align:middle;width:60px;">
        <div style="font-size:16px;font-weight:700;color:#22863a;">{score}</div>
      </td>
    </tr>
    """


def _build_html(rows_html: list[str], chunk_idx: int, total_chunks: int, total_matches: int, attached_count: int) -> str:
    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%a %b %d %I:%M %p ET")
    summary = (
        f"Part {chunk_idx + 1} of {total_chunks} · "
        f"{attached_count} PDFs attached this email · "
        f"{total_matches} total new matches across all parts"
    )
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
      Attachments named <code>{{company}}-{{role}}-{{score}}.pdf</code>. Match the row's "📎 {{filename}}"
      to the attachment in your mail client. Anything not attached here exceeded the per-run tailor cap;
      you can run <code>node apply/tailor-url.js URL</code> locally for those.
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


def _send_one(api_key: str, sender: str, recipient: str, subject: str, html_body: str, attachments: list[Path]) -> bool:
    msg = Mail(from_email=sender, to_emails=recipient, subject=subject, html_content=html_body)
    for p in attachments:
        msg.add_attachment(_make_attachment(p))
    sg = sendgrid.SendGridAPIClient(api_key=api_key)
    try:
        resp = sg.send(msg)
        log.info("SendGrid %s for '%s' (%d attachments)", resp.status_code, subject, len(attachments))
        return 200 <= int(resp.status_code) < 300
    except Exception as e:
        log.error("send failed for '%s': %s", subject, e)
        return False


def main() -> int:
    api_key = os.environ.get("SENDGRID_API_KEY")
    sender = os.environ.get("SENDER_EMAIL")
    recipient = os.environ.get("RECIPIENT_EMAIL")
    if not (api_key and sender and recipient):
        log.error("Missing SENDGRID_API_KEY / SENDER_EMAIL / RECIPIENT_EMAIL")
        return 1

    if not MATCHES_PATH.exists():
        log.info("No matches file %s — nothing to send.", MATCHES_PATH)
        return 0
    matches = json.loads(MATCHES_PATH.read_text())
    if not matches:
        log.info("0 matches — skipping email entirely.")
        return 0

    matches.sort(key=lambda m: m.get("score", 0), reverse=True)

    index = []
    if INDEX_PATH.exists():
        try:
            index = json.loads(INDEX_PATH.read_text())
        except Exception:
            pass
    index_by_id = {e.get("job_id"): e for e in index}

    # Partition matches into (with-PDF) and (without-PDF)
    with_pdf: list[tuple[dict, Path, int]] = []
    without_pdf: list[dict] = []
    for m in matches:
        idx = index_by_id.get(m.get("id"))
        if idx and idx.get("pdf"):
            p = ROOT / idx["pdf"]
            if p.exists():
                with_pdf.append((m, p, idx.get("coverage", 0)))
                continue
        without_pdf.append(m)

    # Chunk PDF matches into batches of CHUNK_SIZE
    chunks = [with_pdf[i:i + CHUNK_SIZE] for i in range(0, len(with_pdf), CHUNK_SIZE)] or [[]]
    # Append URL-only matches into the LAST chunk as overflow rows
    last_overflow = [(m, None, None) for m in without_pdf]
    if last_overflow:
        chunks[-1] = chunks[-1] + last_overflow  # type: ignore

    total_chunks = len(chunks)
    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%I:%M%p ET")

    for i, chunk in enumerate(chunks):
        rows_html = []
        attachments: list[Path] = []
        for entry in chunk:
            if len(entry) == 3 and entry[1] is not None:
                m, pdf, cov = entry  # type: ignore
                rows_html.append(_row(m, pdf.name, cov))
                attachments.append(pdf)
            else:
                m = entry[0] if isinstance(entry, tuple) else entry
                rows_html.append(_row(m, None, None))

        attached_count = len(attachments)
        body = _build_html(rows_html, i, total_chunks, len(matches), attached_count)
        subject = (
            f"{PROFILE_LABEL} — Part {i + 1}/{total_chunks} · "
            f"{attached_count} resumes · {et_now}"
        )
        ok = _send_one(api_key, sender, recipient, subject, body, attachments)
        if not ok:
            log.warning("chunk %d/%d failed; continuing", i + 1, total_chunks)

    log.info(
        "sent %d email(s); %d matches with PDFs, %d URL-only",
        total_chunks, len(with_pdf), len(without_pdf),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
