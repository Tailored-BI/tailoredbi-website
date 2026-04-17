# Codebase Audit — tailoredbi-website

**Audit date:** 2026-04-13  
**Repo:** tailoredbi-website (Netlify site: tailored.bi)  
**Branch:** main (commit 658926d)

> **Important context:** There is a separate repo `TailoredBI-Thread` that hosts the
> production Thread Portal app (thread.bi / threadbi.netlify.app) with 6 tabs, 17
> Netlify Functions, and Neon Postgres. This audit covers only `tailoredbi-website`,
> which is the marketing/showcase site with an older Heartland portal and the
> briefing/email pipeline functions.

---

## 1. Frontend Audit

### 1.1 Pages / Views Inventory

| Path | Purpose | Lines |
|------|---------|-------|
| `/index.html` | Main marketing/landing page — hero, Thread.bi positioning, architecture diagrams, examples gallery, pricing, showcase cards | ~2,000 |
| `/heartland/index.html` | Heartland Ag Parts showcase — brand-themed page with Oswald/Source Serif fonts, wheat/rust colors, company overview, product lines, Power BI report cards | ~1,500 |
| `/heartland/portal/index.html` | **Older Heartland Thread Portal** — password gate, 4 tabs (Morning Thread, Ask Thread, Thread Insights, Settings) | ~1,240 |
| `/heartland/status/index.html` | Public pipeline status page — client data freshness, table load success rates, workspace inventory | ~800 |
| `/dashboard/index.html` | Internal pipeline monitor — grid view of all 3 clients (Heartland, Ridgeline, Mars) with status badges, 7-day streak, run durations | ~600 |
| `/ridgeline/index.html` | Ridgeline showcase page (Hybrid MTS/MTO client) | ~1,500 |
| `/mars/index.html` | Mars showcase page — cyberpunk-themed with Orbitron/Exo 2 fonts, animated HUD, glitch effects | ~1,000 |

### 1.2 JavaScript Frameworks / Libraries

- **Framework:** None — all vanilla JavaScript
- **CSS:** All inline `<style>` blocks, no external CSS files, no Tailwind/Bootstrap/Material
- **Fonts:** Google Fonts (Outfit, Cormorant Garamond, Oswald, Source Serif 4, Orbitron, Exo 2, JetBrains Mono, Roboto Mono, Share Tech Mono)
- **Charts:** None in this repo (Thread app uses Chart.js)
- **No build step** — static HTML served directly by Netlify

### 1.3 PWA Status

| Item | Status |
|------|--------|
| `manifest.json` | **Does not exist** |
| Service worker | **Not registered anywhere** |
| `sw.js` / `service-worker.js` | **No files found** |
| iOS/Android installable | **No** |

**Verdict:** Not a PWA. No offline capability, no installability.

### 1.4 Authentication

- **No MSAL** — no `@azure/msal-browser` in frontend, no OAuth flow
- **No real auth** — Heartland portal uses a localStorage password gate (`hrtl_auth` key)
- **No Bearer tokens** sent from frontend to API functions
- **No API authentication** — all Netlify functions accept unauthenticated requests
- Password is checked client-side only — not a security boundary

### 1.5 Navigation Structure

| Page | Nav Type | Dynamic? |
|------|----------|----------|
| Landing (`/`) | Fixed top nav with anchor links (#thread, #pricing, etc.) + two CTAs | No — hardcoded |
| Heartland Portal | Horizontal tab bar (Morning Thread, Ask Thread, Thread Insights, Settings) via `showTab()` | No — hardcoded |
| Dashboard | No nav — monolithic page with client grid | No |
| Showcase pages | Simple `<a>` links back to home/portal | No |

All navigation is **hardcoded HTML**. No dynamic menu system.

### 1.6 API Endpoints Called from Frontend

| Endpoint | Method | Called From | Purpose |
|----------|--------|-------------|---------|
| `/api/client-status?client=heartland` | GET | Portal, Dashboard, Status | Fetch pipeline status, inventory, briefing, insights |
| `/api/ai-query` | POST | Portal (Ask Thread tab) | Natural language → SQL → Fabric query |
| `/api/save-preferences` | POST | Portal (Settings tab) | Save Thread Preferences to GitHub |
| `/api/save-insight` | POST | Portal (Thread Insights tab) | Save/delete insight analyses |
| `/api/log-ask-question` | POST | Portal (Ask Thread tab) | Log question history |

### 1.7 Ask Thread / Morning Brief Status

**Both are FUNCTIONAL — not just UI shells.**

**Morning Thread:**
- Fetches pre-generated `daily-briefing.json` from GitHub via `/api/client-status`
- Renders insights with severity-coded icons (alert/warning/good/info)
- Shows category labels, action items, "Dig deeper" links
- Refresh button to reload

**Ask Thread:**
- Fully functional AI query interface
- Sends natural language to `/api/ai-query`
- Backend: ThreadAI converts to SQL → validates SELECT-only → executes on Fabric → returns results
- Frontend renders as table with columns/rows
- Suggestion pills with pre-written questions
- SQL reveal toggle
- Question history logged

**Thread Insights:**
- Displays saved insights from `insights.json` on GitHub
- Save from Ask Thread results, max 50 per client
- Delete capability

**Settings (Thread Preferences):**
- 6 configurable focus areas (AR aging, revenue, inventory, AP, production costs, vendor lead times)
- Insight count (3-8), memory depth (7/14/30 days)
- Custom instructions textarea
- Delivery day selection (Mon-Sun)
- Dynamic recipient email list management
- Persisted to GitHub via `/api/save-preferences`

### 1.8 Power BI Embed Approach

- **Not embedded** — no `powerbi-client` SDK, no iframe embeds, no embed tokens in frontend
- Showcase pages have Power BI report **cards** (marketing/visual) but no interactive embeds
- Reports exist in separate Power BI workspaces accessed via Power BI service directly
- The Thread Portal app (separate repo) may have a Reports tab — not in this repo

### 1.9 Color Scheme / Design System

**Brand palette (landing page):**
- Gold accent: `#D4A843`
- Dark background: `#0B1120`
- Light text: `#E2E8F0`
- Muted text: `#64748B`

**Heartland theme:**
- Wheat: `#E8C547`, Rust: `#C44B20`, Soil: `#3D2B1F`, Cream: `#FAF6EF`, Field: `#2D5016`

**Mars theme:**
- Void: `#020A04`, Cyan: `#00FF88`, Orange: `#FF5E1A`, Amber: `#FFB800`

**Status colors (shared):**
- Success: `#6dbe6d`, Failed: `#e07050`, Warning: `#c4963a`, Info: blue

**No design system library.** All styles are inline `<style>` blocks per page.

---

## 2. Backend / Functions Audit

### 2.1 Netlify Functions Inventory

| Function | File | Method | Schedule | Purpose |
|----------|------|--------|----------|---------|
| ai-query | `ai-query.mts` | POST | — | NLP → SQL → Fabric query execution |
| client-status | `client-status.mts` | GET | — | Aggregate client data from GitHub |
| generate-briefing | `generate-briefing.mts` | POST | — | Generate daily AI briefing (8 KPI queries → ThreadAI → insights) |
| log-ask-question | `log-ask-question.mts` | POST | — | Log user questions to GitHub |
| pipeline-complete | `pipeline-complete.mts` | POST | — | Webhook: ETL complete → trigger briefing + email |
| save-insight | `save-insight.mts` | POST | — | Save/delete user insights on GitHub |
| save-preferences | `save-preferences.mts` | POST | — | Save Thread Preferences to GitHub |
| send-briefing-email | `send-briefing-email.mts` | POST | — | Format + send HTML briefing email via MS Graph |
| send-morning-thread-background | `send-morning-thread-background.mts` | — | `0 12 * * *` (6 AM MT) | Backup email sender if pipeline-complete missed |
| send-now | `send-now.mts` | POST | — | Admin manual email trigger (hardcoded admin key) |

**Total: 10 functions** (all TypeScript `.mts`)

### 2.2 Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `THREAD_AI_API_KEY` | ai-query, generate-briefing | ThreadAI engine (AI provider key) |
| `FABRIC_CLIENT_ID` | ai-query, generate-briefing, send-briefing-email | Azure AD app registration client ID |
| `FABRIC_CLIENT_SECRET` | ai-query, generate-briefing, send-briefing-email | Azure AD app registration secret |
| `FABRIC_TENANT_ID` | ai-query, generate-briefing, send-briefing-email | Azure AD tenant ID |
| `GITHUB_TOKEN` | generate-briefing, client-status, save-insight, log-ask-question, save-preferences, send-briefing-email | GitHub API auth for tailoredbi-clients repo |

All accessed via `Netlify.env.get()`. No `.env` file in repo (secrets in Netlify dashboard only).

### 2.3 External APIs Called

| API | Endpoint | Used By | Auth Method |
|-----|----------|---------|-------------|
| **ThreadAI** | AI provider API | ai-query, generate-briefing | `x-api-key` header |
| **Azure AD OAuth2** | `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | ai-query, generate-briefing, send-briefing-email | Client credentials grant |
| **Microsoft Fabric** | TDS port 1433 (via tedious) | ai-query, generate-briefing | Azure AD access token |
| **Microsoft Graph** | `graph.microsoft.com/v1.0/users/{from}/sendMail` | generate-briefing (alerts), send-briefing-email | Bearer token |
| **GitHub REST API** | `api.github.com` | generate-briefing, save-insight, log-ask-question, save-preferences | Token header |
| **GitHub Raw Content** | `raw.githubusercontent.com/Tailored-BI/tailoredbi-clients/main/...` | client-status, send-briefing-email | Optional token |
| **Thread.bi self-API** | `thread.bi/api/save-briefing`, `/api/thread-status` | pipeline-complete, send-morning-thread-background, generate-briefing | None |

### 2.4 Database Connections

**Microsoft Fabric Data Warehouse:**
- Host: `ps46d6p7gwou5nlxnjxw3r4i2a-vicdsupe53wetowpzk2jtzqoy4.datawarehouse.fabric.microsoft.com`
- Port: 1433 (TDS)
- Database: `Thread_Warehouse`
- Auth: Azure AD Service Principal (access token or client credentials)
- Library: `tedious` (npm)
- Access: Read-only (SELECT validation enforced in ai-query)

**Schema (Thread_Warehouse):**
- Dimensions: `dim.Customer`, `dim.Part`, `dim.Vendor`, `dim.Employee`, `dim.Department`, `dim.Account`, `dim.Date`
- Facts: `fact.ARInvoice`, `fact.APInvoice`, `fact.GL`, `fact.SalesOrder`, `fact.PurchaseOrder`, `fact.Inventory`, `fact.LaborTime`, `fact.Production`, `fact.Shipment`

**No connection to Thread_Framework (20.9.85.153,1433)** — this is not yet wired.

**No Neon Postgres** in this repo (that's in the Thread app repo).

### 2.5 Dependencies

```json
{
  "dependencies": {
    "tedious": "^19.0.0"
  }
}
```

tedious transitively includes `@azure/msal-node`, `@azure/identity`, `@azure/msal-browser`, `jsonwebtoken` — but none are used directly.

### 2.6 Configuration Files

| File | Purpose |
|------|---------|
| `_headers` | Cache-Control: no-store for portal, status, dashboard, and API routes |
| `_redirects` | Clean URL routing for portal, status, dashboard |
| `.gitignore` | Only ignores `node_modules/` |
| `robots.txt` | Allow all, sitemap at tailored.bi/sitemap.xml |
| `sitemap.xml` | Root + 3 showcase pages, monthly changefreq |

No `netlify.toml` exists.

### 2.7 Security Observations

**Strengths:**
- All secrets in Netlify env vars, not in code
- SQL injection mitigated: ThreadAI generates SQL + SELECT-only validation
- Azure AD for all Fabric/Graph access
- HTTPS enforced for all external calls
- Cache headers prevent stale data

**Concerns:**
- Hardcoded admin key in send-now.mts: `"TailoredBI-Admin-2026"`
- Hardcoded `FROM_ADDRESS = "david@tailored.bi"` in email functions
- No rate limiting on `/api/ai-query` (ThreadAI API costs)
- No authentication on any API endpoint — anyone can call them
- Fabric warehouse host hardcoded — no multi-tenant flexibility
- No CORS restrictions on most endpoints

---

## 3. Gap Analysis

### ALREADY BUILT (functional in this repo)

- [x] Marketing/landing page with Thread.bi positioning, pricing, architecture diagrams
- [x] Heartland showcase page with brand theming
- [x] Mars showcase page with cyberpunk theming
- [x] Ridgeline showcase page
- [x] Heartland portal with 4 tabs (Morning Thread, Ask Thread, Thread Insights, Settings)
- [x] Ask Thread: fully functional NLP → SQL → Fabric query pipeline
- [x] Morning Thread: renders pre-generated daily briefing with severity-coded insights
- [x] Thread Insights: save/delete/view insight analyses (max 50)
- [x] Thread Preferences: configurable focus areas, insight count, memory depth, delivery schedule, recipients, custom instructions
- [x] Daily briefing generation pipeline (8 KPI queries → ThreadAI → 5 insights → GitHub)
- [x] HTML email delivery via Microsoft Graph with responsive design
- [x] Pipeline-complete webhook → auto-generate briefing → auto-send email
- [x] Backup email sender (6 AM MT cron)
- [x] Pipeline status/dashboard pages for all 3 demo clients
- [x] Data freshness tracking with 7-day streaks
- [x] Question history logging
- [x] Client data stored on GitHub (tailoredbi-clients repo)
- [x] Azure AD service principal auth for Fabric + Graph
- [x] Netlify cache headers for dynamic routes
- [x] Clean URL redirects

### PARTIALLY BUILT (exists but needs hardening)

- [ ] **Authentication** — only localStorage password gate, no real auth (MSAL needed)
- [ ] **API security** — no auth on any endpoint, no rate limiting, no CORS policy
- [ ] **Multi-client support** — hardcoded to "heartland" in most places, dashboard shows 3 clients but data only exists for heartland
- [ ] **Power BI reports** — referenced in marketing but not embedded; report cards are visual only
- [ ] **Admin controls** — send-now uses hardcoded admin key, no proper admin auth
- [ ] **Error handling** — functions have basic try/catch but no structured error responses or retry logic
- [ ] **Audit logging** — question history logged but no comprehensive activity/audit log

### NOT YET BUILT (from Thread Platform Build Specification)

- [ ] **MSAL authentication** — `@azure/msal-browser` sign-in flow, token validation, session management
- [ ] **Power BI embedded reports** — `powerbi-client` SDK, embed tokens, RLS effectiveIdentity
- [ ] **embed schema in Thread_Framework** — ClientConfig, AuthorizedUsers, ReportCatalog, RolePermissions, AIFeatures, AIPromptTemplates, Alerts, Announcements, ScheduledReports, ActivityLog, AuditLog, UserPreferences
- [ ] **Thread_Framework database connection** (20.9.85.153,1433) — not wired at all
- [ ] **Embed token service** — service principal token generation with multi-resource support, RLS, DB-driven authorization
- [ ] **Dynamic navigation** — database-driven nav from ReportCatalog + RolePermissions (currently all hardcoded)
- [ ] **user-config endpoint** — consolidated user/client/reports/announcements endpoint with caching
- [ ] **ActivityLog writes** — structured logging of ai_query, ai_brief, report_view, etc.
- [ ] **AuditLog writes** — security audit trail for token generation, auth events
- [ ] **AI prompt templates from DB** — system prompts pulled from embed.AIPromptTemplates per client
- [ ] **AI feature flags from DB** — enable/disable AI features per client via embed.AIFeatures
- [ ] **Alerts and announcements system** — from embed.Alerts and embed.Announcements tables
- [ ] **Scheduled reports** — embed.ScheduledReports functionality
- [ ] **User preferences in DB** — embed.UserPreferences (currently stored in GitHub JSON)
- [ ] **PWA** — manifest.json, service worker, offline app shell caching, installability
- [ ] **Data freshness badge on report views** — per-report freshness indicator from etl.PipelineRuns
- [ ] **Pipeline view filtered by ClientID** — from etl.PipelineRuns with status, duration, next run
- [ ] **Server-side token validation** — effectiveIdentity from validated server-side claims, not client
- [ ] **5-minute user lookup cache** — in embed-token and user-config functions
- [ ] **DB failure graceful handling** — 503 responses with structured error payloads
- [ ] **Signed-in user name and dealer ID in nav header**
- [ ] **.env.template** — documented environment variable template
- [ ] **docs/EMBED_SETUP.md** — complete embed setup documentation

---

## 4. Architecture Notes

### Two-Repo Architecture

This repo (`tailoredbi-website`) serves as:
1. Marketing site (landing page, showcase pages)
2. Older Heartland portal (4-tab version)
3. **Home for briefing/email pipeline functions** (generate-briefing, send-briefing-email, pipeline-complete, send-morning-thread-background)

The production Thread Portal lives in a separate `TailoredBI-Thread` repo with:
- 6 tabs (Morning Thread, Ask Thread, Thread Insights, Reports, Pipeline, Settings)
- 17 Netlify Functions
- Neon Postgres database
- Chart.js visualizations

### Data Flow

```
Epicor Kinetic → Azure Data Factory → Microsoft Fabric (Thread_Warehouse)
                                            ↓
                        ┌───────────────────┼───────────────────┐
                        ↓                   ↓                   ↓
                  AI Query (ThreadAI)  Briefing Gen (ThreadAI)  Power BI
                        ↓                   ↓                   ↓
                   Ask Thread tab     Morning Thread tab    (not embedded)
                        ↓                   ↓
                  Thread Insights     Email (MS Graph)
```

### Key Decision Point

The embed schema and Power BI embedding work specified in the Thread Platform Build Specification targets **Thread_Framework** at `20.9.85.153,1433` — a separate SQL Server instance from the Fabric warehouse. Connectivity to this server must be validated before proceeding (Step 0B).
