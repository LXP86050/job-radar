"""Curated list of companies that historically sponsor H1B at $140k+ TC.

Each entry: (slug, ats). The fetcher hits the ATS's public board API for that slug.
Slugs are best-effort — the script logs and skips 404s, so over-inclusion is fine.

To add: append a tuple. To remove: delete the line.
"""

COMPANIES: list[tuple[str, str]] = [
    # ---- Greenhouse ----
    ("airbnb", "greenhouse"),
    ("doordash", "greenhouse"),
    ("instacart", "greenhouse"),
    ("lyft", "greenhouse"),
    ("dropbox", "greenhouse"),
    ("pinterest", "greenhouse"),
    ("reddit", "greenhouse"),
    ("redditinc", "greenhouse"),
    ("gitlab", "greenhouse"),
    ("twitch", "greenhouse"),
    ("coinbase", "greenhouse"),
    ("plaid", "greenhouse"),
    ("robinhood", "greenhouse"),
    ("chime", "greenhouse"),
    ("brex", "greenhouse"),
    ("ramp", "greenhouse"),
    ("mercury", "greenhouse"),
    ("affirm", "greenhouse"),
    ("sofi", "greenhouse"),
    ("stripe", "greenhouse"),
    ("cloudflare", "greenhouse"),
    ("datadog", "greenhouse"),
    ("mongodb", "greenhouse"),
    ("snowflake", "greenhouse"),
    ("databricks", "greenhouse"),
    ("confluent", "greenhouse"),
    ("elastic", "greenhouse"),
    ("notion", "greenhouse"),
    ("figma", "greenhouse"),
    ("discord", "greenhouse"),
    ("scaleai", "greenhouse"),
    ("gong", "greenhouse"),
    ("glean", "greenhouse"),
    ("samsara", "greenhouse"),
    ("benchling", "greenhouse"),
    ("hashicorp", "greenhouse"),
    ("asana", "greenhouse"),
    ("lattice", "greenhouse"),
    ("gusto", "greenhouse"),
    ("postman", "greenhouse"),
    ("retool", "greenhouse"),
    ("webflow", "greenhouse"),
    ("vercel", "greenhouse"),
    ("contentful", "greenhouse"),
    ("carta", "greenhouse"),
    ("sigmacomputing", "greenhouse"),
    ("snyk", "greenhouse"),
    ("wiz", "greenhouse"),
    ("tailscale", "greenhouse"),
    ("fivetran", "greenhouse"),
    ("dbtlabs", "greenhouse"),
    ("montecarlodata", "greenhouse"),
    ("grafanalabs", "greenhouse"),
    ("zendesk", "greenhouse"),
    ("twilio", "greenhouse"),
    ("intercom", "greenhouse"),
    ("hubspot", "greenhouse"),
    ("squarespace", "greenhouse"),
    ("squareup", "greenhouse"),
    ("blockinc", "greenhouse"),
    ("toast", "greenhouse"),
    ("klaviyo", "greenhouse"),
    ("attentive", "greenhouse"),
    ("clickup", "greenhouse"),
    ("airtable", "greenhouse"),
    ("miro", "greenhouse"),
    ("zoom", "greenhouse"),
    ("zscaler", "greenhouse"),
    ("crowdstrike", "greenhouse"),
    ("cribl", "greenhouse"),
    ("sumologic", "greenhouse"),
    ("dropboxinc", "greenhouse"),
    ("boxinc", "greenhouse"),
    ("oktainc", "greenhouse"),
    ("rippling", "greenhouse"),
    ("deelinc", "greenhouse"),
    ("auth0", "greenhouse"),
    ("hingehealth", "greenhouse"),
    ("anduril", "greenhouse"),
    ("clipboard", "greenhouse"),

    # ---- Lever ----
    ("netflix", "lever"),
    ("openai", "lever"),
    ("mixpanel", "lever"),
    ("kraken", "lever"),
    ("eventbrite", "lever"),
    ("attentive", "lever"),
    ("cohere", "lever"),
    ("character", "lever"),

    # ---- Ashby ----
    ("linear", "ashby"),
    ("posthog", "ashby"),
    ("replicate", "ashby"),
    ("anthropic", "ashby"),
    ("perplexity", "ashby"),
    ("ramp", "ashby"),
    ("vercel", "ashby"),
    ("modal", "ashby"),
    ("mistral", "ashby"),
    ("runwayml", "ashby"),
    ("cursor", "ashby"),
    ("warp", "ashby"),
    ("zed", "ashby"),
    ("supabase", "ashby"),
    ("railway", "ashby"),
    ("baseten", "ashby"),
    ("together", "ashby"),
    ("fireworksai", "ashby"),
    ("groq", "ashby"),
    ("crusoe", "ashby"),
    ("scale", "ashby"),
    ("gleananswers", "ashby"),
    ("writer", "ashby"),
    ("rampnetwork", "ashby"),

    # ---- Mid-tier H1B sponsors (less-applied-to gems, added 2026-05-29) ----
    # Companies that sponsor H1B, pay $150K+, but get far less applicant volume
    # than FAANG. ATS slug is best-effort — 404s are logged and skipped so
    # over-inclusion is fine.

    # Fintech / payments
    ("wealthfront", "greenhouse"), ("earnest", "greenhouse"),
    ("publiccom", "greenhouse"),   ("step", "greenhouse"),
    ("alpaca", "greenhouse"),      ("janestreet", "greenhouse"),

    # B2B SaaS
    ("pendoio", "greenhouse"),     ("outreach", "greenhouse"),
    ("driftcom", "greenhouse"),    ("customerio", "greenhouse"),
    ("front", "greenhouse"),       ("frontapp", "greenhouse"),
    ("zapier", "greenhouse"),      ("loom", "greenhouse"),
    ("dropboxsign", "greenhouse"),

    # AI / ML startups
    ("characterai", "ashby"),      ("character-ai", "lever"),
    ("inflectionai", "ashby"),     ("xai", "ashby"),
    ("suno", "ashby"),             ("elevenlabs", "ashby"),
    ("pika", "ashby"),             ("decagon", "ashby"),
    ("sierra-ai", "ashby"),        ("imbue", "ashby"),
    ("h2oai", "greenhouse"),       ("clarifai", "greenhouse"),
    ("hebbia", "ashby"),           ("crewai", "ashby"),

    # Dev tools / infra
    ("sourcegraph", "greenhouse"), ("circleci", "greenhouse"),
    ("sentry", "greenhouse"),      ("launchdarkly", "greenhouse"),
    ("flyio", "ashby"),            ("rendercom", "ashby"),
    ("clerkdev", "ashby"),         ("planetscale", "greenhouse"),
    ("turbopuffer", "ashby"),      ("convexdev", "ashby"),
    ("anyscalehq", "lever"),

    # Data / analytics
    ("motherduck", "ashby"),       ("hextechnologies", "ashby"),
    ("modeanalytics", "greenhouse"),("tinybird", "ashby"),
    ("dagster", "ashby"),          ("airbyte", "ashby"),
    ("presetio", "greenhouse"),

    # Security
    ("agilebits", "greenhouse"),   ("vantasoftware", "greenhouse"),
    ("dopplerhq", "ashby"),

    # Consumer / marketplace
    ("whatnotinc", "greenhouse"),  ("fairewholesale", "greenhouse"),
    ("verkada", "greenhouse"),

    # Healthcare tech
    ("oscar", "greenhouse"),       ("almahealth", "greenhouse"),

    # Crypto / web3
    ("krakencrypto", "lever"),     ("circlecom", "greenhouse"),
    ("fireblocks", "greenhouse"),  ("chainalysis", "greenhouse"),

    # Big GH/Lever H1B sponsors not yet covered
    ("spotify", "greenhouse"),     ("flexport", "greenhouse"),
    ("warbyparker", "greenhouse"),

    # Forward-deployed / customer engineer (less competitive flows)
    ("retool", "lever"),           ("appliedintuition", "ashby"),
    ("applied-intuition", "ashby"),

    # ---- Wave 2: More H1B sponsors (added 2026-05-30) ----
    # Focus: confirmed H1B sponsors paying $150K+, mid-applicant-volume.

    # Trading / quant (heavy H1B, $200K+ usually)
    ("twosigma", "greenhouse"),    ("citadel", "greenhouse"),
    ("citadelsecurities", "greenhouse"),
    ("drweng", "greenhouse"),      ("drw", "greenhouse"),
    ("hrt", "greenhouse"),         ("hudsonrivertrading", "greenhouse"),
    ("imc", "greenhouse"),         ("imctrading", "greenhouse"),
    ("optiver", "greenhouse"),     ("akunamatata", "greenhouse"),
    ("flowtraders", "greenhouse"),

    # FAANG-adjacent / large tech (Greenhouse / Lever)
    ("roblox", "greenhouse"),      ("robloxgames", "greenhouse"),
    ("etsy", "greenhouse"),        ("wayfair", "greenhouse"),
    ("atlassian", "greenhouse"),   ("yelp", "greenhouse"),
    ("wish", "greenhouse"),        ("stubhub", "greenhouse"),
    ("zillow", "greenhouse"),      ("opendoor", "greenhouse"),
    ("uberinc", "greenhouse"),     ("rentthernway", "greenhouse"),
    ("doordashinc", "greenhouse"),

    # Social / consumer
    ("snap", "greenhouse"),        ("snapinc", "greenhouse"),
    ("bumble", "greenhouse"),      ("hingedating", "greenhouse"),
    ("matchgroup", "greenhouse"),  ("nextdoor", "greenhouse"),
    ("twitter", "greenhouse"),     ("xcorp", "greenhouse"),

    # Streaming / media
    ("disneystreaming", "greenhouse"),
    ("hulu", "greenhouse"),        ("paramount", "greenhouse"),
    ("spotifyads", "greenhouse"),  ("soundcloud", "greenhouse"),

    # Cloud / infra (more)
    ("akamai", "greenhouse"),      ("cloudera", "greenhouse"),
    ("hashi", "greenhouse"),       ("rapid7", "greenhouse"),
    ("zoominfo", "greenhouse"),    ("braze", "greenhouse"),
    ("amplitude", "greenhouse"),   ("airtableinc", "greenhouse"),
    ("zenefits", "greenhouse"),

    # AI / ML extras
    ("perplexityai", "ashby"),     ("scaleai", "ashby"),
    ("midjourney", "ashby"),       ("runwayhq", "ashby"),
    ("synthesia", "lever"),        ("descript", "ashby"),
    ("glean", "ashby"),            ("gleanwork", "ashby"),
    ("voltagepark", "ashby"),

    # Fintech extras
    ("blockchain", "greenhouse"),  ("paxos", "greenhouse"),
    ("nuvei", "greenhouse"),       ("addepar", "greenhouse"),
    ("plaidinc", "greenhouse"),    ("tripactions", "greenhouse"),
    ("navan", "greenhouse"),

    # Adtech / martech
    ("thetradedesk", "greenhouse"),
    ("contentstack", "greenhouse"), ("sailthru", "greenhouse"),
    ("klaviyoadtech", "greenhouse"),

    # Healthcare / biotech
    ("doximity", "greenhouse"),    ("hims", "greenhouse"),
    ("invitae", "greenhouse"),     ("benchlinginc", "greenhouse"),
    ("temporal", "ashby"),         ("temporalio", "ashby"),

    # Robotics / auto
    ("waymo", "greenhouse"),       ("cruise", "greenhouse"),
    ("zoox", "greenhouse"),        ("nuro", "greenhouse"),
    ("rivianauto", "greenhouse"),  ("lucidmotors", "greenhouse"),

    # Lever wave 2
    ("squarespacecareers", "lever"),
    ("wealthfrontteam", "lever"),  ("workrise", "lever"),
    ("hims-careers", "lever"),     ("noom", "lever"),
    ("squareincapps", "lever"),

    # Ashby wave 2
    ("braintrust", "ashby"),       ("braintrustdata", "ashby"),
    ("baseten", "ashby"),          ("modal-labs", "ashby"),
    ("fireworks-ai", "ashby"),     ("warp-dev", "ashby"),
    ("cursor-ai", "ashby"),        ("anyscaleinc", "ashby"),
    ("anysphere", "ashby"),

    # Forward-deployed/customer engineer at AI cos
    ("scale-ai", "lever"),         ("databricksinc", "greenhouse"),
    ("anaconda", "greenhouse"),

    # ---- Workday (slug = "tenant/site"; adapter probes wd1/wd2/wd3/wd5)
    # NOTE: Microsoft uses a custom backend (jobs.careers.microsoft.com), NOT Workday.
    ("salesforce/External_Career_Site", "workday"),
    ("nvidia/NVIDIAExternalCareerSite", "workday"),
    ("adobe/external_experienced", "workday"),
    ("intuit/External", "workday"),
    ("capitalone/Capital_One", "workday"),
    ("tmobile/External", "workday"),
    ("autodesk/Ext", "workday"),
    ("servicenow/ServiceNow", "workday"),
    ("workday/Workday", "workday"),
    ("cisco/External_Career_Site", "workday"),
    ("walmart/WalmartExternal", "workday"),
    ("paypal/jobs", "workday"),
    ("hp/ExternalCareerSite", "workday"),
    ("hpe/Jobsathpe", "workday"),
    ("vmware/VMware", "workday"),
    ("oracle/Oracle", "workday"),
    ("uber/UberCareers", "workday"),
    ("ge/GE_External_Career_Site", "workday"),
    ("att/External", "workday"),
    ("verizon/External", "workday"),
    ("comcast/Comcast_Careers", "workday"),
    ("citi/2", "workday"),
    ("jpmc/External_search", "workday"),
    ("bmo/External", "workday"),
    ("ibm/External_Career", "workday"),
    ("dell/External_Career_Site", "workday"),
    ("amd/External_Career_Site", "workday"),
    ("micron/External", "workday"),
    ("appliedmaterials/External", "workday"),

    # ---- SmartRecruiters ----
    ("Visa", "smartrecruiters"),
    ("Bosch", "smartrecruiters"),
    ("Square", "smartrecruiters"),
    ("PublicisGroupe", "smartrecruiters"),
    ("McAfee", "smartrecruiters"),

    # ---- Workable (smaller startups; over-inclusion is fine — slug 404s skip) ----
    ("pleo", "workable"),
    ("checkly", "workable"),
    ("nccgroupplc", "workable"),
]


def by_ats() -> dict[str, list[str]]:
    """Group company slugs by ATS."""
    grouped: dict[str, list[str]] = {}
    for slug, ats in COMPANIES:
        grouped.setdefault(ats, []).append(slug)
    # de-dup within each ATS
    return {k: sorted(set(v)) for k, v in grouped.items()}
