"""SendGrid email sender. Builds a daily HTML report from scored matches."""
from __future__ import annotations

import html
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


def _row(m: dict) -> str:
    j = m["job"]
    s = m["score_data"]
    title = html.escape(j.get("title", ""))
    company = html.escape(j.get("company", ""))
    location = html.escape(j.get("location", "") or "—")
    url = html.escape(j.get("url", ""))
    salary = j.get("_max_salary")
    salary_str = f"${salary:,}+" if salary else "—"
    matched = ", ".join(m["score_data"]["matched_skills"][:8])
    matched = html.escape(matched) or "—"
    score = s["score"]
    score_color = "#0a7d28" if score >= 90 else "#1a73e8"
    return f"""
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;">
        <div style="font-weight:600;font-size:14px;">
          <a href="{url}" style="color:#1a73e8;text-decoration:none;">{title}</a>
        </div>
        <div style="color:#555;font-size:12px;margin-top:2px;">
          {company} &middot; {location} &middot; {j.get('source')}
        </div>
        <div style="color:#777;font-size:11px;margin-top:4px;">Skills: {matched}</div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;font-weight:700;color:{score_color};">{score}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-size:13px;">{salary_str}</td>
    </tr>
    """


def build_html(matches: list[dict], threshold: int, total_scanned: int, profile_name: str) -> str:
    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%a %b %d, %Y")
    if not matches:
        body_inner = (
            f'<tr><td colspan="3" style="padding:24px;text-align:center;color:#888;">'
            f"No new matches scoring {threshold}+ today. Scanned {total_scanned} postings.</td></tr>"
        )
    else:
        body_inner = "".join(_row(m) for m in matches)

    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:760px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 4px 0;font-size:20px;color:#111;">{profile_name} — {et_now}</h2>
    <div style="color:#666;font-size:13px;margin-bottom:16px;">
      {len(matches)} new match{'es' if len(matches) != 1 else ''} (score ≥ {threshold}) out of {total_scanned} postings scanned.
    </div>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
      <thead>
        <tr style="background:#f1f3f5;">
          <th align="left" style="padding:10px 8px;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:0.4px;">Role</th>
          <th align="center" style="padding:10px 8px;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:0.4px;width:60px;">Score</th>
          <th align="right" style="padding:10px 8px;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:0.4px;width:120px;">Salary</th>
        </tr>
      </thead>
      <tbody>{body_inner}</tbody>
    </table>
    <p style="margin-top:16px;color:#888;font-size:11px;line-height:1.6;">
      Matches are scored against your resume profile. Salary shown only when stated in the JD.
      To tune the role/skill list or add companies, edit <code>data/resume_profile.json</code> or <code>src/companies.py</code> in your repo.
    </p>
  </div>
</body></html>"""


def send(matches: list[dict], threshold: int, total_scanned: int, profile_name: str) -> None:
    api_key = os.environ.get("SENDGRID_API_KEY")
    sender = os.environ.get("SENDER_EMAIL")
    recipient = os.environ.get("RECIPIENT_EMAIL")
    if not (api_key and sender and recipient):
        raise RuntimeError("Missing SENDGRID_API_KEY / SENDER_EMAIL / RECIPIENT_EMAIL env vars")

    et_now = datetime.now(ZoneInfo("America/New_York")).strftime("%b %d")
    subject = f"{profile_name}: {len(matches)} new match{'es' if len(matches) != 1 else ''} ({et_now})"
    msg = Mail(
        from_email=sender,
        to_emails=recipient,
        subject=subject,
        html_content=build_html(matches, threshold, total_scanned, profile_name),
    )
    client = SendGridAPIClient(api_key)
    resp = client.send(msg)
    if resp.status_code >= 300:
        raise RuntimeError(f"SendGrid send failed: HTTP {resp.status_code} {resp.body}")
