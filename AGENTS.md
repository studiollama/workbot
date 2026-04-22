# AGENTS.md

> **Auto-managed by workbot.** Do not edit sections marked 🔒 — they are overwritten on sync.
> Cloud agents: append your findings to [Agent Reports](#agent-reports) only.

## 🔒 Project

- **Stack:** Node.js, Playwright, Airtable API, QuickBooks API
- **Repo:** `/app/development/` (local git, not pushed to remote)
- **ETL scripts:** `/app/development/etl/` — ClassPass and MindBody scrapers
- **Data exports:** `/app/development/data/` — organized by source (mindbody-payouts/, mindbody-sales/)
- **Config:** `/app/development/.env` — credentials (gitignored)
- **Dashboard:** workbot workflows in `/app/.workbot/workflows.json`

## 🔒 Active Context

**Current focus:** Sales channel ETL automation for Embody Through Yoga Studio

- ClassPass ETL: **complete** — workflow `classpass-etl`, cron 8th & 25th of month
- MindBody ETL: **complete** — workflow `mindbody-etl`, manual trigger
- QuickBooks OAuth: **integrated** — Airtable is single source of truth for refresh token
- Next: schedule MindBody ETL, build ETL for Stripe/Eventbrite/Wellhub/FitOn
- April 24 check-in: Google Ads full-month review

## 🔒 Key Decisions

1. **Airtable as hub** — All sales data flows through Airtable Accounting base (`appHHMEcznh7jG3aC`). Airtable automations handle QBO sync.
2. **Playwright for scraping** — Both ClassPass and MindBody use Playwright headless Chromium. No APIs available for payout/sales data.
3. **Dynamic date ranges** — Payouts: from last deposit date + 1 day. Sales: from last sale date in Sales - Mindbody table + 1 day. Never hardcoded.
4. **Dedup strategy** — Deposits by Deposit ID. Sales by Sale ID (>0) or composite key (date+client+product+amount+detailID) for refunds/chargebacks with Sale ID=0.
5. **Sigma 90-day export** — MindBody Analytics 2.0 uses Sigma Computing embed. Default filter is "This month to yesterday" which misses cross-month transactions. Always set Quick Dates → 90 Days before exporting.

## 🔒 Patterns & Corrections

- **FindSite is flaky** — MindBody's `/App/Admin/FindSite` search fails intermittently. Always retry up to 3 times.
- **Payments Portal requires dropdown** — Cannot navigate directly to payments.mindbody.io. Must open via ET dropdown in the main portal.
- **Sigma kebab on hover** — The table kebab menu (⋮) only appears when the table is clicked first. Export submenu is hover-triggered, not click.
- **Airtable typecast** — Always pass `typecast: true` when creating records to auto-create singleSelect options.
- **Airtable batch dedup** — Cannot update the same record twice in one batch. Deduplicate update arrays by record ID before sending.
- **MindBody date format** — Classic reports use M/D/YYYY (no leading zeros). Payments portal uses MM/DD/YYYY.

---

## Agent Reports

<!-- Cloud agents: append your findings below this line. Use the format: -->
<!-- ### [Date] Agent Name — Brief Title -->
<!-- - What you found / did / recommend -->
<!-- - Links to relevant files or commits -->

_No agent reports yet._
