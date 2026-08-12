# Job Radar

Daily-emailed list of new job postings that match my resume, scored 0–100. Fetches public ATS feeds (Greenhouse / Lever / Ashby) for ~100 H1B-sponsoring companies, filters by role / location / sponsorship / salary, scores each posting against my resume profile, and emails matches scoring 85+ at 7:00 AM ET.

> **For deep-dive on the architecture, where to add companies / roles / sources, scoring, and how the daily cron handles DST: [`docs/INTERNALS.md`](docs/INTERNALS.md).**

```
GH Actions cron (11/12 UTC) ──► fetch sources ──► pre-filter ──► ATS score ──► dedup ──► Gmail SMTP email
```

## Layout

| path | role |
| --- | --- |
| `src/main.py` | orchestrator |
| `src/companies.py` | curated company → ATS map |
| `src/sources/` | Greenhouse / Lever / Ashby fetchers |
| `src/filters.py` | title / location / sponsorship / salary pre-filters |
| `src/scoring.py` | 0–100 ATS-style score |
| `src/email_sender.py` | Gmail SMTP HTML report |
| `src/mailer.py` | shared Gmail SMTP send helper |
| `src/state.py` | dedup + once-per-day guard |
| `data/resume_profile.json` | skill list, preferred titles, exclude terms |
| `state/` | persisted seen-ids and last-run-date (committed back by the workflow) |
| `.github/workflows/daily.yml` | 7am-ET cron + DST handling |

## One-time setup

### 1. Gmail App Password (free, no daily API limits beyond Gmail's 500/day)
1. Use a Gmail account for sending (e.g. `lokeshchow06@gmail.com`).
2. **Enable 2-Step Verification:** Google Account → Security → 2-Step Verification (required before app passwords are available).
3. **Create an App Password:** Google Account → Security → App passwords → generate one (name it `job-radar`). Copy the 16-character password; you won't see it again.

### 2. GitHub repo secrets
Once the repo is pushed, add three secrets at *Settings → Secrets and variables → Actions*:

| name | value |
| --- | --- |
| `SMTP_PASS` | the 16-char Gmail App Password from step 1 |
| `SENDER_EMAIL` | the Gmail address that owns the App Password (also the From address) |
| `RECIPIENT_EMAIL` | where the daily report should land (e.g. `lokeshchow06@gmail.com`) |

Or via CLI:
```bash
gh secret set SMTP_PASS
gh secret set SENDER_EMAIL --body "lokeshchow06@gmail.com"
gh secret set RECIPIENT_EMAIL --body "lokeshchow06@gmail.com"
```

### 3. Trigger a manual run to verify
GitHub → Actions → **Daily Job Radar** → Run workflow → set `force` to `true`. You should see an email within ~2 minutes.

## Tuning

- **Add a company:** append `("slug", "greenhouse" | "lever" | "ashby")` to `src/companies.py`. The slug is the path segment of the company's public job board URL (e.g. `boards.greenhouse.io/airbnb` → `airbnb`). Wrong slugs return empty silently.
- **Change the score threshold:** edit `ATS_THRESHOLD` in `.github/workflows/daily.yml` (default `85`).
- **Edit role keywords / excludes / skills:** `data/resume_profile.json`.
- **Update years of experience after a job change:** `python scripts/parse_resume.py /path/to/new_resume.pdf`.

## Local testing

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export SMTP_PASS="your-16-char-gmail-app-password"
export SENDER_EMAIL=you@gmail.com
export RECIPIENT_EMAIL=you@gmail.com
export FORCE_RUN=1            # bypass the 7am-ET gate and the once-per-day guard
python -m src.main
```

## Notes

- Auto-applying is intentionally out of scope: top boards' ToS prohibit it, applications need tailoring, and bulk submissions hurt your reputation with recruiters.
- LinkedIn and Indeed are *not* sources. Their ToS prohibits automated scraping and they aggressively block it.
- Salary filter only excludes a posting if a stated max is below `min_total_comp`. Postings without a stated range are kept (the curated company list is already biased toward $140k+ payers).
