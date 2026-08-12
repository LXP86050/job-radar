"""Gmail SMTP mailer — shared by main.py (daily report) and send_digest.py.

Replaces SendGrid. Uses Python's stdlib smtplib + STARTTLS, so there is no
third-party dependency and no API key. Authenticates with a Gmail account and
a 16-char App Password (Google Account -> Security -> App passwords).

Env (all read here so callers stay simple):
  SMTP_PASS            required  — Gmail App Password (also accepts GMAIL_APP_PASSWORD)
  SENDER_EMAIL         required  — the Gmail address that owns the App Password;
                                   also used as the SMTP login and the From address
  RECIPIENT_EMAIL      required  — where matches are delivered
  SMTP_USER            optional  — override the login if it differs from SENDER_EMAIL
  SMTP_HOST            optional  — default smtp.gmail.com
  SMTP_PORT            optional  — default 587 (STARTTLS)
"""
from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

log = logging.getLogger("mailer")

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))


def _creds() -> tuple[str, str, str, str]:
    """Resolve (login_user, password, from_addr, recipient) from env."""
    password = os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASSWORD")
    sender = os.environ.get("SENDER_EMAIL")
    user = os.environ.get("SMTP_USER") or sender
    recipient = os.environ.get("RECIPIENT_EMAIL")
    missing = [
        name
        for name, val in (
            ("SMTP_PASS", password),
            ("SENDER_EMAIL", sender),
            ("RECIPIENT_EMAIL", recipient),
        )
        if not val
    ]
    if missing:
        raise RuntimeError("Missing email env vars: " + ", ".join(missing))
    return user, password, sender, recipient  # type: ignore[return-value]


def send_email(subject: str, html_body: str, attachments: list[Path] | None = None) -> None:
    """Send one HTML email with optional PDF attachments. Raises on failure.

    Gmail caps a single message at ~25MB across all attachments; keep chunk
    sizes modest so a batch of PDFs stays under that.
    """
    user, password, sender, recipient = _creds()
    attachments = attachments or []

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content("This message contains an HTML body; view it in an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")

    for p in attachments:
        p = Path(p)
        msg.add_attachment(
            p.read_bytes(),
            maintype="application",
            subtype="pdf",
            filename=p.name,
        )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as server:
        server.starttls()
        server.login(user, password)
        server.send_message(msg)

    log.info("SMTP sent '%s' (%d attachments)", subject, len(attachments))
