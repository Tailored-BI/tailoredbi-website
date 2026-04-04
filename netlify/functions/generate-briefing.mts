import type { Context, Config } from "@netlify/functions";
import { Connection, Request as TdsRequest } from "tedious";

const GITHUB_RAW = "https://raw.githubusercontent.com/Tailored-BI/tailoredbi-clients/main";
const GITHUB_API = "https://api.github.com";
const BRIEFING_HISTORY_PATH = "clients/heartland/status/briefing-history.json";
const PIPELINE_STATUS_PATH = "clients/heartland/status/pipeline-status.json";
const ASK_HISTORY_PATH = "clients/heartland/status/ask-history.json";
const WORKSPACE_INVENTORY_PATH = "clients/heartland/status/workspace-inventory.json";
const MAX_HISTORY_DAYS = 7;
const FABRIC_HOST = "ps46d6p7gwou5nlxnjxw3r4i2a-vicdsupe53wetowpzk2jtzqoy4.datawarehouse.fabric.microsoft.com";
const FABRIC_DB = "Heartland_Warehouse";

async function getFabricToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://database.windows.net/.default"
    }).toString()
  });
  if (!res.ok) throw new Error(`Token failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

function openConnection(authConfig: Record<string, unknown>): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const connection = new Connection({
      server: FABRIC_HOST,
      authentication: authConfig,
      options: {
        database: FABRIC_DB,
        encrypt: true,
        port: 1433,
        connectTimeout: 30000,
        requestTimeout: 30000
      }
    } as any);
    connection.on("connect", (err) => {
      if (err) { reject(err); return; }
      resolve(connection);
    });
    connection.connect();
  });
}

function execQuery(conn: Connection, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    const request = new TdsRequest(sql, (err) => {
      if (err) { reject(err); return; }
      resolve(rows);
    });
    request.on("row", (rowCols) => {
      const row: Record<string, unknown> = {};
      for (const col of rowCols) row[col.metadata.colName] = col.value;
      rows.push(row);
    });
    conn.execSql(request);
  });
}

async function runAllQueries(queries: string[], authConfig: Record<string, unknown>): Promise<Record<string, unknown>[][]> {
  const conn = await openConnection(authConfig);
  try {
    const results: Record<string, unknown>[][] = [];
    for (const sql of queries) {
      results.push(await execQuery(conn, sql));
    }
    return results;
  } finally {
    conn.close();
  }
}

async function commitToGitHub(content: string, token: string): Promise<void> {
  const path = "clients/heartland/status/daily-briefing.json";
  const getRes = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, {
    headers: { "Authorization": `token ${token}`, "Accept": "application/vnd.github.v3+json" }
  });
  const existing = getRes.ok ? await getRes.json() : null;
  await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github.v3+json"
    },
    body: JSON.stringify({
      message: `briefing: daily AI briefing ${new Date().toISOString().split('T')[0]}`,
      content: Buffer.from(content).toString("base64"),
      ...(existing?.sha ? { sha: existing.sha } : {})
    })
  });
}

async function getAndUpdateHistory(newBriefing: Record<string, unknown>, githubToken: string): Promise<Record<string, unknown>[]> {
  const headers = {
    "Authorization": `token ${githubToken}`,
    "Accept": "application/vnd.github.v3+json"
  };

  let history: Record<string, unknown>[] = [];
  const getRes = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${BRIEFING_HISTORY_PATH}`, { headers });

  if (getRes.ok) {
    const file = await getRes.json();
    const content = Buffer.from(file.content, "base64").toString("utf8");
    history = JSON.parse(content);
  }

  history.unshift(newBriefing);
  if (history.length > MAX_HISTORY_DAYS) history = history.slice(0, MAX_HISTORY_DAYS);

  const updatedContent = JSON.stringify(history, null, 2);
  const getRes2 = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${BRIEFING_HISTORY_PATH}`, { headers });
  const existing = getRes2.ok ? await getRes2.json() : null;

  await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${BRIEFING_HISTORY_PATH}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `briefing: update history ${new Date().toISOString().split('T')[0]}`,
      content: Buffer.from(updatedContent).toString("base64"),
      ...(existing?.sha ? { sha: existing.sha } : {})
    })
  });

  return history;
}

export default async (req: Request, context: Context) => {
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const clientId = Netlify.env.get("FABRIC_CLIENT_ID");
  const clientSecret = Netlify.env.get("FABRIC_CLIENT_SECRET");
  const tenantId = Netlify.env.get("FABRIC_TENANT_ID");
  const githubToken = Netlify.env.get("GITHUB_TOKEN");

  if (!anthropicKey || !clientId || !clientSecret || !tenantId || !githubToken) {
    return new Response(JSON.stringify({ error: "Not configured" }), { status: 500 });
  }

  try {
    const queries = [
      `SELECT COUNT(*) AS InvoiceCount, ROUND(SUM(BalanceDue),2) AS TotalOverdue
        FROM fact.ARInvoice WHERE AgingBucket = '90+' AND BalanceDue > 0`,
      `SELECT AgingBucket, COUNT(*) AS Invoices, ROUND(SUM(BalanceDue),2) AS Balance
        FROM fact.ARInvoice WHERE BalanceDue > 0
        GROUP BY AgingBucket ORDER BY AgingBucket`,
      `SELECT ROUND(SUM(ExtPrice),2) AS Revenue, COUNT(DISTINCT CustomerKey) AS Customers
        FROM fact.SalesOrder so JOIN dim.Date d ON so.OrderDateKey = d.DateKey
        WHERE d.IsCurrentMonth = 1`,
      `SELECT ROUND(SUM(ExtPrice),2) AS Revenue
        FROM fact.SalesOrder so JOIN dim.Date d ON so.OrderDateKey = d.DateKey
        WHERE d.Year = YEAR(GETDATE())-1 AND d.Month = MONTH(GETDATE())`,
      `SELECT TOP 5 p.PartDescription, COUNT(*) AS Transactions
        FROM fact.Inventory i JOIN dim.Part p ON i.PartKey = p.PartKey
        JOIN dim.Date d ON i.TranDateKey = d.DateKey
        WHERE d.DaysFromToday >= -30
        GROUP BY p.PartDescription ORDER BY Transactions DESC`,
      `SELECT COUNT(*) AS InvoiceCount, ROUND(SUM(BalanceDue),2) AS TotalDue
        FROM fact.APInvoice ap JOIN dim.Date d ON ap.DueDateKey = d.DateKey
        WHERE d.DaysFromToday BETWEEN 0 AND 7 AND ap.BalanceDue > 0`,
      `SELECT TOP 5 p.PartDescription,
        ROUND(pr.ActLaborCost - pr.EstLaborCost,2) AS LaborVariance,
        ROUND(pr.ActMtlCost - pr.EstMtlCost,2) AS MaterialVariance,
        ROUND(pr.CostVariance,2) AS TotalVariance
        FROM fact.Production pr JOIN dim.Part p ON pr.PartKey = p.PartKey
        WHERE pr.JobComplete = 1 AND ABS(pr.CostVariance) > 500
        ORDER BY ABS(pr.CostVariance) DESC`,
      `SELECT TOP 5 v.VendorName,
        ROUND(AVG(CAST(DATEDIFF(day, po.OrderDate, po.DueDate) AS float)),1) AS AvgLeadDays
        FROM fact.PurchaseOrder po JOIN dim.Vendor v ON po.VendorKey = v.VendorKey
        WHERE po.OrderDate >= DATEADD(day,-90,GETDATE())
        GROUP BY v.VendorName ORDER BY AvgLeadDays DESC`
    ];

    // Single connection, sequential queries — avoids Fabric connection throttling
    let results: Record<string, unknown>[][];
    try {
      const token = await getFabricToken(tenantId, clientId, clientSecret);
      results = await runAllQueries(queries, {
        type: "azure-active-directory-access-token" as const,
        options: { token }
      });
    } catch (tokenErr) {
      try {
        results = await runAllQueries(queries, {
          type: "azure-active-directory-service-principal-secret" as const,
          options: { clientId, clientSecret, tenantId }
        });
      } catch (spnErr) {
        function errDetail(e: unknown): string {
          if (!e) return 'null';
          if (e instanceof AggregateError) return `AggregateError(${e.errors.length}): ` + e.errors.map((x: any) => x?.message || x?.code || String(x)).join('; ');
          if (e instanceof Error) {
            const parts = [e.constructor.name, e.message, (e as any).code].filter(Boolean);
            return parts.join(' | ') || JSON.stringify(Object.getOwnPropertyNames(e).reduce((o, k) => { (o as any)[k] = (e as any)[k]; return o; }, {})).substring(0, 300);
          }
          try { return JSON.stringify(e).substring(0, 300); } catch { return String(e); }
        }
        throw new Error(`Token: ${errDetail(tokenErr)} | SPN: ${errDetail(spnErr)}`);
      }
    }

    const [arOverdue, arByBucket, revenueThisMonth, revenueLastYear,
           inventoryFast, apDue, productionVariance, vendorLeadTime] = results;

    const dataContext = JSON.stringify({
      arOverdue90Plus: arOverdue[0] || {},
      arByBucket,
      revenueThisMonth: revenueThisMonth[0] || {},
      revenueLastYearSameMonth: revenueLastYear[0] || {},
      topMovingParts: inventoryFast,
      apDueThisWeek: apDue[0] || {},
      productionVariance,
      vendorLeadTimes: vendorLeadTime
    }, null, 2);

    let pipelineStatus: Record<string, unknown> = {};
    try {
      const psRes = await fetch(`${GITHUB_RAW}/${PIPELINE_STATUS_PATH}`, {
        headers: {
          "Authorization": `token ${githubToken}`,
          "Accept": "application/vnd.github.v3.raw"
        }
      });
      if (psRes.ok) pipelineStatus = await psRes.json();
    } catch { pipelineStatus = {}; }

    const streakDays = String(pipelineStatus.streakDays || "");
    const streakArr = streakDays ? streakDays.split(",") : [];
    const streakOk = streakArr.filter((d: string) => d.trim() === "ok").length;
    const streakTotal = streakArr.length;
    const totalRows = Array.isArray(pipelineStatus.tables)
      ? (pipelineStatus.tables as Record<string, unknown>[]).reduce(
          (sum: number, t: Record<string, unknown>) => sum + (Number(t.rowsLoaded) || 0), 0)
      : 0;

    const lastRunStr = String(pipelineStatus.lastRunMT || "");
    const now = new Date();
    const todayMDY = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const todayMD = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const pipelineRanToday = lastRunStr.includes(todayMDY) ||
      lastRunStr.includes(todayMD);
    const statusIsSuccess = String(pipelineStatus.overallStatus || '') === 'SUCCESS';
    const pipelineMissed = !pipelineRanToday && !statusIsSuccess && lastRunStr.length > 0;
    const dataAge = pipelineMissed
      ? `WARNING: The pipeline did not run today. Last successful run was ${lastRunStr}. All insights below are based on data from that run — not today's activity.`
      : `Pipeline ran successfully today at ${lastRunStr}. Data is current.`;

    if (pipelineMissed) {
      const alertClientId = Netlify.env.get("FABRIC_CLIENT_ID");
      const alertClientSecret = Netlify.env.get("FABRIC_CLIENT_SECRET");
      const alertTenantId = Netlify.env.get("FABRIC_TENANT_ID");
      if (alertClientId && alertClientSecret && alertTenantId) {
        try {
          const alertTokenRes = await fetch(
            `https://login.microsoftonline.com/${alertTenantId}/oauth2/v2.0/token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: alertClientId,
                client_secret: alertClientSecret,
                scope: "https://graph.microsoft.com/.default"
              }).toString()
            }
          );
          if (alertTokenRes.ok) {
            const alertToken = (await alertTokenRes.json()).access_token;
            await fetch("https://graph.microsoft.com/v1.0/users/david@tailored.bi/sendMail", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${alertToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                message: {
                  subject: "Thread alert — Heartland pipeline did not run today",
                  body: {
                    contentType: "HTML",
                    content: `<div style="font-family:'Segoe UI',sans-serif;max-width:500px;padding:20px;">
                      <div style="background:#3d2b0e;padding:12px 16px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;">
                        <div style="color:#f5f0e8;font-size:13px;font-weight:600;">Heartland Ag Parts Co.</div>
                        <div style="color:#c4963a;font-size:10px;font-weight:700;text-transform:uppercase;">Pipeline Alert</div>
                      </div>
                      <div style="background:#fff;padding:16px;border:1px solid #e2dbd2;border-top:none;">
                        <div style="padding:12px 14px;background:#fff8f0;border-left:3px solid #c4511a;border-radius:0 6px 6px 0;margin-bottom:12px;">
                          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#c4511a;margin-bottom:4px;">Pipeline did not run today</div>
                          <div style="font-size:12px;color:#3d2b0e;line-height:1.6;">The Heartland ETL pipeline has not run today. Thread generated this morning briefing using data last updated <strong>${lastRunStr}</strong>.</div>
                        </div>
                        <div style="font-size:11px;color:#6a5a4a;line-height:1.8;">
                          <strong>What to check:</strong><br/>
                          &bull; Azure VM TBI-Gateway (20.9.85.153) — is it running?<br/>
                          &bull; On-premises data gateway — is it registered and online in Fabric?<br/>
                          &bull; Fabric pipeline trigger — did the 8am schedule fire?<br/>
                          &bull; SQL Server on the gateway machine — is the service running?<br/>
                          &bull; Task Scheduler — did the 8:30am export script run?
                        </div>
                      </div>
                      <div style="background:#f9f6f2;padding:8px 16px;border:1px solid #e2dbd2;border-top:none;border-radius:0 0 8px 8px;font-size:10px;color:#aaa;">
                        Thread by Tailored.BI · Automated watchdog alert · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>`
                  },
                  from: { emailAddress: { name: "Thread by Tailored.BI", address: "david@tailored.bi" } },
                  toRecipients: [{ emailAddress: { address: "david@tailored.bi" } }]
                },
                saveToSentItems: true
              })
            });
          }
        } catch (alertErr) {
          console.error("Watchdog alert failed:", alertErr);
        }
      }
    }

    let threadPreferences: Record<string, unknown> = {};
    let askHistory: Record<string, unknown>[] = [];
    try {
      const invRes = await fetch(`${GITHUB_RAW}/${WORKSPACE_INVENTORY_PATH}`, {
        headers: { "Authorization": `token ${githubToken}`, "Accept": "application/vnd.github.v3.raw" }
      });
      if (invRes.ok) {
        const inv = await invRes.json();
        threadPreferences = inv.threadPreferences || {};
      }
    } catch { threadPreferences = {}; }
    const insightCount = Number(threadPreferences.insightCount) || 5;
    const memoryDays = Number(threadPreferences.memoryDays) || 7;

    try {
      const askRes = await fetch(`${GITHUB_RAW}/${ASK_HISTORY_PATH}`, {
        headers: { "Authorization": `token ${githubToken}`, "Accept": "application/vnd.github.v3.raw" }
      });
      if (askRes.ok) {
        const allAsks = await askRes.json();
        const memoryDaysAgo = new Date(Date.now() - memoryDays * 24 * 60 * 60 * 1000).toISOString();
        askHistory = allAsks.filter((a: Record<string, unknown>) =>
          String(a.askedAt || '') > memoryDaysAgo
        ).slice(0, 20);
      }
    } catch { askHistory = []; }

    let priorHistory: Record<string, unknown>[] = [];
    try {
      const histRes = await fetch(`${GITHUB_RAW}/${BRIEFING_HISTORY_PATH}`, {
        headers: {
          "Authorization": `token ${githubToken}`,
          "Accept": "application/vnd.github.v3.raw"
        }
      });
      if (histRes.ok) {
        priorHistory = await histRes.json();
        if (priorHistory.length > memoryDays) priorHistory = priorHistory.slice(0, memoryDays);
      }
    } catch { priorHistory = []; }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: `You are Thread, the Tailored.BI business advisor for Heartland Ag Parts Co. You produce the Morning Thread — a daily briefing woven from overnight Epicor data. Heartland is a make-to-stock agricultural parts manufacturer in Lohrville, Iowa.

You receive fresh warehouse data every morning after their Epicor pipeline runs. You also receive the last 7 days of prior briefings so you can reason across time — spotting trends, tracking whether flagged issues improved or worsened, and avoiding repeating the same insight every day unless it is genuinely escalating.

${threadPreferences.customInstructions ? `IMPORTANT — CLIENT INSTRUCTIONS:
The client has given you these specific instructions. Read them carefully and let them guide what you surface, what you skip, and how you frame your insights:
"${threadPreferences.customInstructions}"

` : ''}${threadPreferences.focusAreas ? `CLIENT FOCUS AREAS (weight these higher):
${Object.entries(threadPreferences.focusAreas as Record<string, boolean>).filter(([,v]) => v).map(([k]) => '- ' + k).join('\n')}

` : ''}${askHistory.length > 0 ? `QUESTIONS THE CLIENT ASKED THREAD THIS WEEK (signals about what they care about):
${askHistory.map((a: Record<string, unknown>) => '- "' + a.question + '"' + (a.addedToFocus ? ' [added to focus]' : '')).join('\n')}

Use these questions as signals about what the client is thinking about. If they have been asking about a topic repeatedly, proactively surface insights about it even if Thread would not normally flag it.

` : ''}Your job is to identify exactly ${insightCount} specific, actionable insights the owner or CFO should know about today. No more, no fewer.

Use prior briefings to:
- Note if a flagged issue is getting worse
- Note if something improved
- Avoid repeating the same low-priority insight multiple days in a row unless it is escalating
- Identify trends that are only visible across multiple days

Be specific with numbers. Be direct. Write like a trusted advisor, not a software system.
Use plain English — no SQL, no technical terms.
Flag things that need action today vs things to watch.

Return ONLY a JSON object with this structure — no markdown, no extra text:
{
  "generatedAt": "ISO timestamp",
  "insights": [
    {
      "severity": "alert" | "warning" | "good" | "info",
      "title": "Short headline (max 8 words)",
      "text": "2-3 sentences with specific numbers and context. If this relates to a prior briefing, note the change.",
      "action": "What to do about it (1 sentence)",
      "suggestedQuery": "A question the user could ask in the Ask tab to dig deeper"
    }
  ]
}

Severity guide:
- alert: needs attention today (overdue AR, stockout risk, large cost variance)
- warning: watch closely (trending worse, approaching a threshold)
- good: positive news worth noting
- info: useful context, no action needed`,
        messages: [{
          role: "user",
          content: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

DATA FRESHNESS: ${dataAge}

Here is Heartland's warehouse data from the most recent pipeline run:
${dataContext}

${priorHistory.length > 0 ? `Here are the last ${priorHistory.length} day(s) of prior briefings for context:
${JSON.stringify(priorHistory.map((h: Record<string, unknown>) => ({ date: h.dataDate, insights: (h.insights as Record<string, unknown>[])?.map((i: Record<string, unknown>) => ({ severity: i.severity, title: i.title, text: i.text })) })), null, 2)}

Use this history to track trends, note changes, and avoid repeating static low-priority items.` : 'This is the first briefing — no prior history available.'}

Generate the daily briefing.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";
    const jsonMatch = rawText.match(/\{[\s\S]*"insights"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse briefing response");

    const briefing = JSON.parse(jsonMatch[0]);
    briefing.generatedAt = new Date().toISOString();
    briefing.dataDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    briefing.pipelineMissed = pipelineMissed;
    briefing.lastRunMT = lastRunStr;
    briefing.dataHealth = {
      lastRefresh: pipelineStatus.lastRunMT || "Unknown",
      tablesSuccess: pipelineStatus.tablesSuccess ?? 0,
      tablesTotal: pipelineStatus.tablesTotal ?? 0,
      tablesFailed: pipelineStatus.tablesFailed ?? 0,
      duration: pipelineStatus.duration || "—",
      recordsProcessed: totalRows,
      streakOk,
      streakTotal,
      streakDays: streakArr,
      overallStatus: pipelineStatus.overallStatus || "UNKNOWN",
      tableStatus: Array.isArray(pipelineStatus.tables)
        ? (pipelineStatus.tables as Record<string, unknown>[]).map(
            (t: Record<string, unknown>) => ({
              name: t.name,
              status: t.status,
              rowsLoaded: t.rowsLoaded,
              lastSuccessful: t.lastSuccessful || null,
              errorMessage: t.errorMessage || null
            }))
        : []
    };

    const briefingJson = JSON.stringify(briefing, null, 2);
    await commitToGitHub(briefingJson, githubToken);
    const updatedHistory = await getAndUpdateHistory(briefing, githubToken);

    return new Response(JSON.stringify({ success: true, insightCount: briefing.insights.length, historyDays: updatedHistory.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    let msg: string;
    if (err instanceof AggregateError) {
      msg = `AggregateError(${err.errors.length}): ` + err.errors.map((x: any) => x?.message || x?.code || String(x)).join('; ');
    } else if (err instanceof Error) {
      msg = [err.constructor.name, err.message, (err as any).code].filter(Boolean).join(' | ');
      if (!msg) msg = JSON.stringify(Object.getOwnPropertyNames(err).reduce((o, k) => { (o as any)[k] = (err as any)[k]; return o; }, {})).substring(0, 500);
    } else {
      msg = String(err);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/generate-briefing"
};
