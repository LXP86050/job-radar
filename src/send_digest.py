"""Chunked digest emails — every tailored PDF reaches your inbox as one ZIP.

For N matches with tailored PDFs:
  - Sort by score desc
  - Chunk into batches of DIGEST_CHUNK_SIZE (default 50)
  - Send one email per chunk; each email has ONE zip attached containing
    one folder per match — folder name = the tailored PDF's filename
    (e.g. "{company}-{role}-{score}/"), and inside it the resume itself
    renamed to Lokesh_Pulivarthi.pdf
  - Subject indicates chunk N of M

Matches WITHOUT a tailored PDF (over TAILOR_MAX cap) are listed in the
LAST chunk email as URL-only rows so nothing is lost.

Skip everything if 0 matches.

Env:
  SMTP_PASS, SENDER_EMAIL, RECIPIENT_EMAIL  required (Gmail SMTP)
  DIGEST_PROFILE       default 'job-radar'
  DIGEST_CHUNK_SIZE    default 50  (PDFs per zip; Gmail cap ~25MB per email)
"""
from __future__ import annotations

import html
import json
import os
import sys
import logging
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from src.mailer import send_email

RESUME_FILENAME = "Lokesh_Pulivarthi.pdf"

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


def _row(match: dict, folder_name: str | None, coverage: int | None) -> str:
    title = html.escape(match.get("title", ""))
    company = html.escape(match.get("company", ""))
    location = html.escape(match.get("location", "") or "—")
    url = html.escape(match.get("url", ""))
    score = match.get("score", "—")
    cov_str = f"<span style='color:#22863a;font-size:10px;'>· {coverage}% match</span>" if coverage else ""
    pdf_str = (
        f"<span style='color:#0366d6;font-size:11px;'>📁 {html.escape(folder_name)}/</span>"
        if folder_name else "<span style='color:#999;font-size:11px;'>no resume (volume cap)</span>"
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
        f"{attached_count} resumes in the attached zip · "
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
      Unzip the attachment: one folder per match, named <code>{{company}}-{{role}}-{{score}}</code>,
      each containing <code>{RESUME_FILENAME}</code>. Match the row's "📁 {{folder}}/" to find the right one.
      Anything not included here exceeded the per-run tailor cap; you can run
      <code>node apply/tailor-url.js URL</code> locally for those.
    </p>
  </div>
</body></html>"""


def _build_zip(entries: list[tuple[dict, Path, int]], zip_path: Path) -> None:
    """One folder per match (named after the tailored PDF's filename), each
    containing the resume renamed to Lokesh_Pulivarthi.pdf."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for _m, pdf, _cov in entries:
            folder = pdf.stem.replace("/", "-").replace("\\", "-")
            zf.write(pdf, arcname=f"{folder}/{RESUME_FILENAME}")


def _send_one(subject: str, html_body: str, attachments: list[Path]) -> bool:
    try:
        send_email(subject, html_body, attachments)
        return True
    except Exception as e:
        log.error("send failed for '%s': %s", subject, e)
        return False


def main() -> int:
    # mailer resolves/validates SMTP creds itself; fail fast with a clear message.
    if not (os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASSWORD")):
        log.error("Missing SMTP_PASS (Gmail App Password) / SENDER_EMAIL / RECIPIENT_EMAIL")
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

    sent_ok = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, chunk in enumerate(chunks):
            rows_html = []
            pdf_entries: list[tuple[dict, Path, int]] = []
            for entry in chunk:
                if len(entry) == 3 and entry[1] is not None:
                    m, pdf, cov = entry  # type: ignore
                    rows_html.append(_row(m, pdf.stem, cov))
                    pdf_entries.append((m, pdf, cov))
                else:
                    m = entry[0] if isinstance(entry, tuple) else entry
                    rows_html.append(_row(m, None, None))

            attached_count = len(pdf_entries)
            attachments: list[Path] = []
            if pdf_entries:
                zip_path = Path(tmp) / f"job-radar-{PROFILE}-{TODAY}-part{i + 1}.zip"
                _build_zip(pdf_entries, zip_path)
                attachments.append(zip_path)

            body = _build_html(rows_html, i, total_chunks, len(matches), attached_count)
            subject = (
                f"{PROFILE_LABEL} — Part {i + 1}/{total_chunks} · "
                f"{attached_count} resumes · {et_now}"
            )
            ok = _send_one(subject, body, attachments)
            if ok:
                sent_ok += 1
            else:
                log.warning("chunk %d/%d failed; continuing", i + 1, total_chunks)

    log.info(
        "%d/%d email(s) delivered; %d matches with PDFs, %d URL-only",
        sent_ok, total_chunks, len(with_pdf), len(without_pdf),
    )
    # Fail the run if any chunk failed to send, so a bad/expired SendGrid key
    # surfaces as a red workflow instead of a silent green with an empty inbox.
    if sent_ok < total_chunks:
        log.error("%d of %d email(s) FAILED to send", total_chunks - sent_ok, total_chunks)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
