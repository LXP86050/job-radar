# Internals

How the job-radar pipeline works, where to change things, and how the daily trigger is wired up. Use this as the reference when you want to add a company, tweak a role list, swap a profile, or debug a missed run.

## At a glance

```
                   ┌─ data/resume_profile.json     (AI / SWE)
                   ├─ data/it_profile.json         (IT, strict, 150k+)
                   └─ data/it_high_pay_profile.json (IT, loose, 140k+, salary-sorted)
                                  │
GH Actions cron ──► main.py loads one profile per workflow step
                                  │
                                  ▼
   src/companies.py  ─── ~100 (slug, ats) tuples ───► src/sources/{greenhouse,lever,ashby}.py
                                                          (parallel HTTP fetch, fail-soft on 404)
                                  │
                                  ▼
   src/filters.py        title → location → 10-day age → "no sponsorship" → salary
                                  │
                                  ▼
   src/scoring.py        skills 50 + title 20 + yoe 15 + location 10 + AI bonus 5  =  0–100
                                  │
                                  ▼
   src/state.py          drop anything in state/<radar>/seen.json (dedup against prior runs)
                                  │
                                  ▼
   src/email_sender.py   sort by score (or salary), cap to max_email_rows, send via SendGrid
                                  │
                                  ▼
   .github/workflows/daily.yml    commits state/<radar>/seen.json + last_run_date.txt back
```

The same `src/main.py` runs three times in one workflow, switching profile via env vars (`PROFILE_PATH`, `PROFILE_NAME`, `STATE_DIR`, `ATS_THRESHOLD`). Each radar has its own state directory so dedup is independent per radar.

## The three radars

| Radar | Profile | Threshold | Min comp | Sort | Cap | Subject prefix |
| --- | --- | ---: | ---: | --- | --- | --- |
| Job Radar (AI / SWE) | [`data/resume_profile.json`](../data/resume_profile.json) | 85 | $140k | score | none | `Job Radar` |
| IT Radar | [`data/it_profile.json`](../data/it_profile.json) | 85 | $150k | score | none | `IT Radar` |
| High-Pay IT Radar | [`data/it_high_pay_profile.json`](../data/it_high_pay_profile.json) | 50 | $140k | salary | top 100 | `High-Pay IT Radar` |

Both filters and scoring are profile-driven, so adding a fourth radar is a copy-and-tweak of one of the JSON files plus a new step in the workflow.

## Repo layout

| path | purpose |
| --- | --- |
| `.github/workflows/daily.yml` | the cron, DST handling, per-radar env, state commit-back |
| `src/main.py` | orchestrator — load profile, fetch, filter, score, dedup, send |
| `src/companies.py` | `(slug, ats)` tuples grouped by ATS |
| `src/sources/greenhouse.py` | `fetch(slug)` → list of normalized job dicts |
| `src/sources/lever.py` | same, for Lever |
| `src/sources/ashby.py` | same, for Ashby |
| `src/filters.py` | pre-filters (title / location / age / sponsorship / salary) |
| `src/scoring.py` | the 100-point ATS-style score |
| `src/state.py` | persistent dedup + once-per-day guard |
| `src/email_sender.py` | SendGrid client + HTML report template |
| `data/*.json` | one file per radar; the only thing you should edit to tune behavior |
| `state/<radar>/seen.json` | job IDs already emailed; pruned to last 60 days |
| `state/<radar>/last_run_date.txt` | UTC date of last successful send |
| `scripts/parse_resume.py` | one-off: re-derive `years_experience` from a new resume PDF |

## Add a new career portal (a new company)

The unit of "career portal" is one row in [`src/companies.py`](../src/companies.py): `(slug, ats)`. The slug is the path segment of the company's public job board URL.

### 1. Identify the ATS

Open the company's careers page in a browser. The URL after clicking through to the job listing usually tells you which ATS they use:

| URL pattern | ATS | Slug example |
| --- | --- | --- |
| `boards.greenhouse.io/airbnb` | greenhouse | `airbnb` |
| `boards.greenhouse.io/embed/job_app?for=stripe` | greenhouse | `stripe` |
| `jobs.lever.co/openai/...` | lever | `openai` |
| `jobs.ashbyhq.com/linear/...` | ashby | `linear` |

If it's Workday, Taleo, iCIMS, BambooHR, SmartRecruiters, or a custom-built page — none of those have free public APIs that return clean JSON, so you'd need to add a new source module (see "Add a new ATS source" below). Skip those for now.

### 2. Verify the slug returns jobs

```bash
# Greenhouse
curl -s 'https://boards-api.greenhouse.io/v1/boards/<slug>/jobs' | head -c 200

# Lever
curl -s 'https://api.lever.co/v0/postings/<slug>?mode=json' | head -c 200

# Ashby
curl -s 'https://api.ashbyhq.com/posting-api/job-board/<slug>' | head -c 200
```

A 404 or empty `{"jobs":[]}` means the slug is wrong or the company isn't public-listed. The pipeline silently skips 404s, so you can be aggressive and add a guess.

### 3. Add the row

Append to the right block in [`src/companies.py`](../src/companies.py):

```python
COMPANIES: list[tuple[str, str]] = [
    # ---- Greenhouse ----
    ("airbnb", "greenhouse"),
    # ...
    ("yourcompany", "greenhouse"),    # ← new
    # ---- Lever ----
    ("openai", "lever"),
    # ---- Ashby ----
    ("linear", "ashby"),
]
```

Order doesn't matter — `companies.by_ats()` re-groups by ATS at runtime.

### 4. Optional: dry-run locally before committing

```bash
cd ~/Code/job-radar && source .venv/bin/activate
python -c "from src.sources import greenhouse; print(len(greenhouse.fetch('yourcompany')))"
```

Then push. The next workflow run will pick it up automatically.

## Add or remove a role / title

The title list lives entirely in the profile JSON. There is no code change needed.

### `preferred_titles` (whitelist — at least one must match)

Substring match, case-insensitive, applied to the posting's title. Add the bare phrase, lowercased:

```jsonc
"preferred_titles": [
  "software engineer",
  "ai engineer",
  "staff engineer",
  "platform engineer",
  "your-new-role-name"      // ← e.g. "developer advocate"
]
```

Tip: add multiple variations if the title is commonly written different ways. For SRE: `"site reliability engineer", " sre", "sre,", "sre "` (the leading space prevents matching "Senior" → "sre" inside another word; the trailing comma matches "SRE, Networking").

### `exclude_title_terms` (blacklist — any match disqualifies)

Used to keep junk out without having to enumerate every variant of a good title:

```jsonc
"exclude_title_terms": [
  "intern",
  "junior",
  "manager",         // careful — this also kills "Technical Program Manager"
  "sales engineer"
]
```

If a banned term appears as a substring of a title, the posting is rejected before scoring. Keep this list focused — broad terms like `"manager"` or `"lead"` will misfire.

### How the matching is implemented

[`src/filters.py:title_matches`](../src/filters.py): excludes are checked first, then includes. Both are plain substring checks via `in`. No regex, no word boundaries — that's intentional, because ATS titles are inconsistent ("SWE II" vs "Software Engineer 2" vs "Senior Software Engineer (II)") and substring matching is the most robust pass for typical noise.

## Add a new ATS source (Workable, SmartRecruiters, etc.)

The pipeline is source-pluggable. To add Workable:

### 1. Create the fetcher

`src/sources/workable.py`:

```python
"""Workable public board API."""
from __future__ import annotations
import logging, requests
log = logging.getLogger(__name__)

API = "https://apply.workable.com/api/v3/accounts/{slug}/jobs"

def fetch(slug: str, timeout: int = 20) -> list[dict]:
    r = requests.get(API.format(slug=slug), timeout=timeout)
    if r.status_code != 200:
        return []
    out = []
    for j in r.json().get("results", []):
        out.append({
            "id": f"workable:{slug}:{j['shortcode']}",
            "company": slug,
            "title": j.get("title", ""),
            "location": (j.get("location") or {}).get("city", ""),
            "url": j.get("url", ""),
            "description_html": j.get("description", ""),
            "updated_at": j.get("created_at"),    # consumed by the freshness filter
            "source": "workable",
        })
    return out
```

### 2. Register it in `src/main.py`

```python
from src.sources import ashby, greenhouse, lever, workable

# ...
fetchers = {
    "greenhouse": greenhouse.fetch,
    "lever":      lever.fetch,
    "ashby":      ashby.fetch,
    "workable":   workable.fetch,        # ← new
}
```

### 3. Add company rows

```python
("yourco", "workable"),
```

That's the whole change. The shape of the dict returned by `fetch()` is the contract — match the keys and the rest of the pipeline works unchanged.

## How scoring works

[`src/scoring.py:score_job`](../src/scoring.py) computes a 0–100 score from five components. All weights are in code, not config — change them by editing the function.

| Component | Max | What it measures | Where |
| --- | ---: | --- | --- |
| Skills | 50 | Distinct profile skills appearing in the JD or title. 8 hits = full marks; partial credit below. | `skill_overlap` + the formula `min(50, round((n / 8) * 50))` |
| Title / seniority | 20 | Preferred-title hit (14) + senior/staff/AI/Forward-Deployed bonus (up to 6) | `title_score` |
| YoE | 15 | Posting's stated `N+ years` vs your `years_experience`; 12 if not stated | `yoe_score` |
| Location | 10 | Remote-US > Seattle/Redmond > major US metros > other | `location_score` |
| AI/ML bonus | 5 | LLM / RAG / vector / agent / Azure OpenAI / LangChain mentions | `ai_bonus` |

The default thresholds are 85 (strict) and 50 (high-pay loose lens). To raise the bar uniformly, change `ATS_THRESHOLD` in [`.github/workflows/daily.yml`](../.github/workflows/daily.yml). To change it for one radar only, set `ATS_THRESHOLD: '70'` on that step's `env:` block (the high-pay radar already does this).

### Recalibrating skills

The skill list lives in `data/<profile>.json` under the `skills` object, grouped by category. Categories are cosmetic — internally the lists are flattened. Keep entries lowercased; the regex around them adds word-boundary checks (`(?<![a-z0-9])skill(?![a-z0-9])`) so single tokens like `go` or `c#` won't accidentally match `cargo` or `c++`.

## How the daily trigger is set up

[`.github/workflows/daily.yml`](../.github/workflows/daily.yml) defines two cron entries plus a manual button:

```yaml
on:
  schedule:
    - cron: '0 11 * * *'   # 11:00 UTC = 7am EDT (summer), 6am EST (winter)
    - cron: '0 12 * * *'   # 12:00 UTC = 8am EDT (summer), 7am EST (winter)
  workflow_dispatch:
    inputs:
      force:
        description: 'Bypass the 7am-ET hour check and the once-per-day guard'
```

Both crons fire every day, but the script is the deciding gate:

| Time of year | 11:00 UTC | 12:00 UTC | Result |
| --- | --- | --- | --- |
| EDT (summer) | ET hour = 7 → run | ET hour = 8 → exits at hour check | one send at 7am EDT |
| EST (winter) | ET hour = 6 → exits at hour check | ET hour = 7 → run | one send at 7am EST |

That's how the radar lands at 7am ET year-round without needing to redeploy at DST boundaries. The redundancy also means that if GH Actions delays one cron firing (sometimes 5–15 min), the other half-DST run is harmless because the once-per-day flag (`state/<radar>/last_run_date.txt`) prevents a double-send.

### Manual trigger

GitHub → Actions → **Daily Job Radar** → **Run workflow** → set `force` to `true`. This sets `FORCE_RUN=1` for the run, which makes [`src/main.py`](../src/main.py) bypass:

- The 7am-ET hour gate (so it runs whenever you click).
- The once-per-day guard (so you can re-test repeatedly).

Dedup against `seen.json` still applies, so re-running the same day with no new postings will email "0 new matches." To regenerate a full email, delete the relevant `state/<radar>/seen.json` first.

```bash
gh -R LXP86050/job-radar workflow run "Daily Job Radar" -f force=true
```

### State commit-back

The last step in the workflow:

```yaml
- name: Commit updated state
  if: always()
  run: |
    if [[ -n "$(git status --porcelain state/)" ]]; then
      git config user.name "github-actions[bot]"
      git config user.email "github-actions[bot]@users.noreply.github.com"
      git add state/
      git commit -m "state: update seen/last-run [skip ci]"
      git push
    fi
```

`permissions: contents: write` at the top of the workflow gives the action's `GITHUB_TOKEN` push rights. The `[skip ci]` keeps the bot's commit from re-triggering the workflow.

If you `git pull` locally and see one or two new commits per morning from `github-actions[bot]`, that's why.

## Secrets and state

### Three GH Actions secrets

Set at *repo Settings → Secrets and variables → Actions*:

| name | value |
| --- | --- |
| `SENDGRID_API_KEY` | the `SG.…` key from SendGrid (Mail Send: Full Access) |
| `SENDER_EMAIL` | the verified sender (Settings → Sender Authentication in SendGrid) |
| `RECIPIENT_EMAIL` | where the daily emails go |

```bash
gh -R LXP86050/job-radar secret list
gh -R LXP86050/job-radar secret set SENDGRID_API_KEY < /dev/stdin   # paste, then Ctrl-D
```

### State directory

```
state/
├── ai_swe/
│   ├── seen.json            # {job_id: first-seen-iso-date}
│   └── last_run_date.txt    # UTC date string
├── it/
│   └── ...
└── it_high_pay/
    └── ...
```

Pruning to the last 60 days happens in [`src/state.py:save_seen`](../src/state.py) so the file doesn't grow forever.

## Common operations

| Goal | Action |
| --- | --- |
| Trigger a one-off run | `gh -R LXP86050/job-radar workflow run "Daily Job Radar" -f force=true` |
| See logs of the most recent run | `gh -R LXP86050/job-radar run view --log` |
| Reset dedup for one radar (re-flood inbox) | delete that radar's `state/<radar>/seen.json`, push, run workflow |
| Stop sending one of the radars | comment out its step in `daily.yml` (don't delete state) |
| Pause everything | disable the workflow in the Actions tab |
| Update YoE after a job change | `python scripts/parse_resume.py /path/to/new.pdf` |
| Test a slug locally | `python -c "from src.sources import greenhouse; print(len(greenhouse.fetch('slug')))"` |

## Troubleshooting

- **Got an email but matches were obviously wrong** — most likely a too-permissive entry in `preferred_titles`. Add a more specific exclusion to `exclude_title_terms`.
- **Expected jobs missing from a known-good company** — the slug in `companies.py` is wrong, or the company moved off that ATS. Test the slug with the curl commands above.
- **No email at all on a run** — check the workflow log; SendGrid auth issues usually show as `HTTP 401 ... unauthorized` from the `Run job radar` step. Re-verify the sender email in SendGrid; the API key only sends from verified senders.
- **Two emails for one radar in one day** — only happens if the `state/<radar>/last_run_date.txt` commit-back failed. Look for a permission error on the `Commit updated state` step (the workflow needs `contents: write`).
- **GH Actions cron skipped** — GitHub deprioritizes scheduled workflows in low-activity repos. The two-cron-per-day design tolerates one of the firings being skipped. If both skip, manually trigger.
