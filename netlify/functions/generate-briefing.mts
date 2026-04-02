import type { Context, Config } from "@netlify/functions";

const GITHUB_RAW = "https://raw.githubusercontent.com/Tailored-BI/tailoredbi-clients/main";
const GITHUB_API = "https://api.github.com";
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

async function queryFabric(sql: string, token: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`https://${FABRIC_HOST}/v1/databases/${FABRIC_DB}/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql })
  });
  if (!res.ok) throw new Error(`Fabric query failed: ${await res.text()}`);
  const data = await res.json();
  if (data.results?.[0]?.rows) return data.results[0].rows;
  if (data.value) return data.value;
  return [];
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
    const token = await getFabricToken(tenantId, clientId, clientSecret);

    const [arOverdue, arByBucket, revenueThisMonth, revenueLastYear,
           inventoryFast, apDue, productionVariance, vendorLeadTime] = await Promise.all([

      queryFabric(`SELECT COUNT(*) AS InvoiceCount, ROUND(SUM(BalanceDue),2) AS TotalOverdue
        FROM fact.ARInvoice WHERE AgingBucket = '90+' AND BalanceDue > 0`, token),

      queryFabric(`SELECT AgingBucket, COUNT(*) AS Invoices, ROUND(SUM(BalanceDue),2) AS Balance
        FROM fact.ARInvoice WHERE BalanceDue > 0
        GROUP BY AgingBucket ORDER BY AgingBucket`, token),

      queryFabric(`SELECT ROUND(SUM(ExtPrice),2) AS Revenue, COUNT(DISTINCT CustomerKey) AS Customers
        FROM fact.SalesOrder so JOIN dim.Date d ON so.OrderDateKey = d.DateKey
        WHERE d.IsCurrentMonth = 1`, token),

      queryFabric(`SELECT ROUND(SUM(ExtPrice),2) AS Revenue
        FROM fact.SalesOrder so JOIN dim.Date d ON so.OrderDateKey = d.DateKey
        WHERE d.Year = YEAR(GETDATE())-1 AND d.Month = MONTH(GETDATE())`, token),

      queryFabric(`SELECT TOP 5 p.PartDescription, COUNT(*) AS Transactions
        FROM fact.Inventory i JOIN dim.Part p ON i.PartKey = p.PartKey
        JOIN dim.Date d ON i.TranDateKey = d.DateKey
        WHERE d.DaysFromToday >= -30
        GROUP BY p.PartDescription ORDER BY Transactions DESC`, token),

      queryFabric(`SELECT COUNT(*) AS InvoiceCount, ROUND(SUM(BalanceDue),2) AS TotalDue
        FROM fact.APInvoice ap JOIN dim.Date d ON ap.DueDateKey = d.DateKey
        WHERE d.DaysFromToday BETWEEN 0 AND 7 AND ap.BalanceDue > 0`, token),

      queryFabric(`SELECT TOP 5 p.PartDescription,
        ROUND(ActLaborCost - EstLaborCost,2) AS LaborVariance,
        ROUND(ActMaterialCost - EstMaterialCost,2) AS MaterialVariance
        FROM fact.Production pr JOIN dim.Part p ON pr.PartKey = p.PartKey
        WHERE pr.JobComplete = 1 AND ABS(ActLaborCost - EstLaborCost) > 500
        ORDER BY ABS(ActLaborCost - EstLaborCost) DESC`, token),

      queryFabric(`SELECT TOP 5 v.VendorName,
        ROUND(AVG(CAST(DATEDIFF(day, po.OrderDate, po.DueDate) AS float)),1) AS AvgLeadDays
        FROM fact.PurchaseOrder po JOIN dim.Vendor v ON po.VendorKey = v.VendorKey
        WHERE po.OrderDate >= DATEADD(day,-90,GETDATE())
        GROUP BY v.VendorName ORDER BY AvgLeadDays DESC`, token)
    ]);

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
        system: `You are a business intelligence advisor for Heartland Ag Parts Co., a make-to-stock agricultural parts manufacturer in Lohrville, Iowa.

You receive fresh warehouse data every morning after their Epicor pipeline runs. Your job is to identify 3-5 specific, actionable insights the owner or CFO should know about today.

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
      "text": "2-3 sentences with specific numbers and context",
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
Here is Heartland's warehouse data from this morning's pipeline run:

${dataContext}

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

    const briefingJson = JSON.stringify(briefing, null, 2);
    await commitToGitHub(briefingJson, githubToken);

    return new Response(JSON.stringify({ success: true, insightCount: briefing.insights.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/generate-briefing"
};
