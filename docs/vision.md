# Tailored.BI — Product Vision
*April 2026*

---

## How we got here

It started simply enough. Epicor manufacturers were drowning in operational data and starving for business intelligence. They'd spent half a million dollars on an ERP system and were still pulling Excel reports every Monday morning. The answer seemed obvious — build a proper data warehouse, connect Power BI, deliver better reports.

But something more interesting emerged in the building.

---

## What Tailored.BI actually is

A managed intelligence subscription for Epicor manufacturers. Not a software license. Not a consulting engagement. A subscription to a living system that knows your business, watches it every night, and tells you what you need to know every morning — across every department that touches the ERP.

The pitch in one sentence: *"You subscribed to Epicor. Now subscribe to the intelligence."*

---

## The infrastructure layer — Microsoft Fabric

Every Tailored.BI client gets a dedicated Microsoft Fabric data warehouse provisioned on the Tailored.BI managed tenant. Your data doesn't live on your servers, and it doesn't live in some shared multi-tenant database. It lives in a private, isolated warehouse on Tailored.BI's Microsoft infrastructure, accessible only through Thread, managed entirely by us.

Think of it the way you think about Salesforce. Salesforce doesn't run on your servers — that's the whole point. You subscribe to a managed service that handles the infrastructure, the uptime, the security, and the upgrades. Tailored.BI works exactly the same way for your business intelligence.

Every night, after your Epicor production system goes quiet, our pipeline reaches into your ERP through a read-only connection and pulls the day's transactions — every sales order, every invoice, every purchase, every part movement, every labor entry. It shapes that data into clean analytical tables in your private warehouse. By morning, everything is ready.

For Partner tier clients or companies with specific compliance requirements, Thread deploys on the client's own Microsoft tenant — their Fabric workspace, their data sovereignty, fully managed by Tailored.BI. That's the Partner tier conversation.

---

## Thread — your business advisor

Thread is the intelligence layer that lives on top of the warehouse. It's named for Microsoft Fabric — the platform that weaves your Epicor data together — and for what it does every morning: follows the threads through your business data to find what matters.

Thread is not a chatbot. It's not a dashboard. It's not a report generator. It's a business advisor that knows your company specifically — your customers, your vendors, your seasonal patterns, your margins — and reasons about your data the way a trusted analyst would.

**What Thread does every night:**

While your team has gone home and your production system is idle, Thread works. It analyzes your warehouse across the areas that matter most to your business — AR aging, revenue trends, inventory levels, purchasing exposure, production performance, vendor reliability, and more — and prepares your Morning Thread. The specific areas Thread focuses on are configured in Thread Preferences. This isn't a canned report. Thread reasons about what it finds, compares it against your history, and decides what you actually need to know today.

**The Morning Thread:**

Every morning, Thread delivers your Morning Thread — a focused briefing of specific, actionable insights based on last night's data. The number of insights is configurable — some clients want three focused priorities, others want a comprehensive eight. Thread tells you not just what the numbers are, but what they mean and what to do about them.

A typical Morning Thread might read:

- *Alert: Midwest Equipment Co. — $84,200 at 97 days. This balance has grown for the third consecutive day. Recommend a direct call today before it crosses 100 days.*
- *Watch: Planter season demand arriving three weeks early. Part RU-4420 covers approximately 11 days at current order rate. Lead time from Central States Forgings is 21 days.*
- *Good news: Q1 closed at $2.84M — up 12% vs Q1 last year. March was the strongest single month since October 2024.*

That's not a report. That's an advisor who read your numbers before you arrived.

**Thread serves every department:**

Thread doesn't just serve the CFO. The same warehouse that powers the finance Morning Thread also powers the operations manager's Morning Thread about production variance and inventory risk, the sales manager's Morning Thread about customer trends and backlog, and the purchasing team's Morning Thread about vendor lead times and PO exposure. Same warehouse. Same pipeline. Every stakeholder gets the view that matters to their role.

**Thread's memory — configurable depth:**

Thread maintains a rolling memory of every briefing it has generated. It knows what it flagged yesterday, whether the situation improved or worsened, and which issues are escalating versus resolving. Memory depth is configurable — seven days gives Thread a working week of context, thirty days gives Thread a full month of business history to reason across.

**Thread learns from you:**

The Thread Preferences system lets you configure Thread to match how you run your business:

- Focus areas — toggle on or off the areas of the business Thread watches most closely
- Insight count — set how many insights Thread surfaces each morning (3 to 8)
- Memory depth — set how many days of briefing history Thread reasons across (7, 14, or 30)
- Custom instructions — brief Thread in plain English about what matters right now
- Delivery days — choose which days Thread emails your Morning Thread
- Recipients — add any stakeholder to the Morning Thread distribution

Every question you ask in Ask Thread is also a signal. If you've asked about inventory three times this week, Thread notices and weights it higher in tomorrow's Morning Thread. The more you engage with Thread, the more it understands what your business actually cares about.

**Ask Thread:**

Ask Thread anything about your business in plain English. Thread queries your live warehouse and returns an answer in seconds — no SQL, no Excel, no waiting for a report to run. Every answer includes a visual — bar charts, tables, aging breakdowns — rendered from your real Epicor data.

**Thread Insights:**

When Thread surfaces something important — or when you find something useful in Ask Thread — save it as a Thread Insight. A visual analysis generated on the fly from your live Epicor data, saved to your personal library. Thread Insights builds over time into a collection of visual analyses tailored specifically to how you run your company. Every Morning Thread insight includes a "Dig deeper →" link that runs the analysis and saves it to Thread Insights automatically.

---

## The Power BI layer — visual reports

Thread tells you what's happening. Power BI shows you the full picture. Every Tailored.BI subscription includes professionally designed Power BI reports built on the same warehouse Thread uses — always current, always accurate, always available on any device.

Reports are bundled by module. The Finance module includes the Executive Scorecard, Financial Performance report, and AR Aging Statement. The Operations module includes Production Variance and Inventory Analysis. The Sales module includes Revenue & Sales and Customer Performance. The Purchasing and Inventory modules include their own report sets for Partner tier clients.

These are the reports your CFO shares in board meetings and your management team reviews in weekly sessions. Not operational screens — that's what Epicor is for. These are the analytical views that answer the questions Epicor was never designed to answer.

---

## The three-layer story

**Layer 1 — Epicor: transactions**

Epicor was built for operational work — entering orders, shipping parts, receiving inventory, managing jobs. Keep using it for exactly that. Your SSRS reports — customer invoices, vendor statements, packing slips, pick tickets — keep running exactly as they do today. Tailored.BI never touches your operational documents.

**Layer 2 — Thread: intelligence**

Every night Thread pulls your Epicor transactions into a private Microsoft Fabric warehouse and reasons across them. Thread answers the questions Epicor was never designed to answer. Which customers are heading toward collections? Is this month tracking ahead or behind last year? Where are jobs running over budget? What parts are going to stock out before the season peaks?

**Layer 3 — Power BI: visual layer**

Thread tells you what is happening. Power BI shows you the full picture. The same warehouse Thread reasons across every night powers your Power BI reports — always current, never touching production.

*"Epicor tells you what's happening. Thread tells you what it means."*

---

## The module system

Tailored.BI is structured around business modules. Each module adds Thread intelligence, Power BI reports, and Ask Thread coverage for that area of the business — all from the same Epicor data already in the warehouse.

| Module | Thread focuses on | Power BI reports |
|---|---|---|
| Finance | AR aging, AP exposure, GL trends, revenue vs PY, margins | Executive Scorecard, Financial Performance, AR Aging Statement |
| Operations | Production variance, job costing, inventory risk, WIP aging | Production Variance, Inventory Analysis |
| Sales | Revenue trends, customer analysis, backlog, order-to-ship | Revenue & Sales, Customer Performance |
| Purchasing | PO exposure, vendor lead times, price variance, sole-source risk | Purchasing Analysis, Vendor Scorecard |
| Inventory | Slow movers, stockout risk, carrying cost, seasonal demand | Inventory Health, Part Velocity |

---

## Pricing

### Foundation — $1,500/mo · $5,000 setup
Finance module. Thread wakes up every morning knowing your AR, AP, revenue, and margins. 2 Power BI users. Hosted on Tailored.BI managed Fabric.

### Growth — $2,500/mo · $8,000 setup
Three modules: Finance + Operations + Sales. Thread routed by recipient — every stakeholder gets their lens. 5 Power BI users. Hosted on Tailored.BI managed Fabric.

### Partner — $5,000/mo · $15,000 setup
All modules. Deployed on the client's own Microsoft tenant — their data sovereignty, their infrastructure. Thread configured per stakeholder. 8 dedicated hours per month for enhancements — bug fixes always covered, hours are for forward progress only. Additional hours at $250/hr. Unlimited Power BI users.

---

## The data privacy answer

With most AI tools, the data you put in has value to someone else. The questions you ask and the data you share may feed back into a model that serves millions of other users.

Thread works differently. You are the subscriber, not the product.

Your Epicor data lives in a private, isolated warehouse on Tailored.BI's dedicated Microsoft infrastructure. It never touches another client's environment. It never trains a shared model. Thread reasons about your data inside your warehouse context. Your AR aging goes in. Your Morning Thread comes out. Nothing leaves that loop.

Thread is a reasoning engine. It reads your data, thinks about what matters, and tells you what it found. Your data exists in Thread's world for exactly one purpose — to make your Morning Thread more useful tomorrow than it was today.

Before we connect to anything, we sign an NDA. Your data is your business. We treat it that way.

---

## Why it's defensible

Any manufacturer can sign up for a generic AI tool. What they cannot replicate is a system that:

- Knows the specific structure of their Epicor database intimately
- Has accumulated weeks or months of their specific business context
- Runs on dedicated managed infrastructure with a full audit trail
- Learns from their specific questions and stated priorities
- Is configured around their business — their focus areas, their memory depth, their custom instructions
- Connects to their actual operational data — not summaries or exports
- Serves every department, not just finance

This is not a product you install. It's a relationship that deepens over time. Thread on day one is useful. Thread after six months — knowing your seasonal patterns, your customer history, your recurring issues, the questions you ask every week — is genuinely irreplaceable. That's why it's a subscription, not a project. And that's why clients who start don't leave.

---

## The path to market

The product is built and working. The next challenge is the first real client conversation.

**Epicor partner channel** is the fastest path. Epicor implementation partners have existing relationships with exactly the right buyers but most don't have a compelling analytics story. A referral arrangement with two or three Epicor partners could fill the pipeline faster than cold outreach.

**Epicor user community** is the second path. Regional user groups and the annual Insights conference are full of manufacturers who've been living with the same reporting frustrations for years. A live Thread demo in that context is a very different conversation than a cold call.

**The first client** is the most important milestone — even at a steep discount. A real company with real Epicor data who will give honest feedback and a testimonial is worth more than ten fictional showcases.

---

## The roadmap

**Built and live:**
- Daily pipeline (16 tables, Azure VM, 8am MT)
- Thread Portal (Morning Thread, Ask Thread, Thread Insights, Settings)
- Thread Preferences (full configuration per client)
- Morning Thread email via Office 365
- Thread Insights with Chart.js visualizations
- "Dig deeper" bridge from Morning Thread to Thread Insights
- Website with Thread-first positioning and module-based pricing

**Building next:**
- Mini inline charts in Morning Thread cards
- Power BI report pages (Revenue, Margin, AR/AP, Trends)
- Publish report and embed in client showcase
- Version control and change management in portal

**On the horizon:**
- Multi-client scale (Ridgeline, Mars, and beyond)
- Change management system in portal
- Purchasing and Inventory module reports
- Labor module
- Budget vs actual (Partner tier)

---

## The category

You are not building BI software. You are not building an AI chatbot. You are building the managed intelligence layer for Epicor manufacturers — a category that does not meaningfully exist yet.

Thread is the product. Tailored.BI is the platform. The opportunity is every manufacturer running Epicor Kinetic who subscribed to the ERP but never subscribed to what the data inside it actually knows.

That's a large number of companies. And none of them have a Thread yet.

---

*Tailored.BI · woven into your data · tailored.bi*
