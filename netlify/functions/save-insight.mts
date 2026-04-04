import type { Context, Config } from "@netlify/functions";

const GITHUB_API = "https://api.github.com";
const MAX_INSIGHTS = 50;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const githubToken = Netlify.env.get("GITHUB_TOKEN");
  if (!githubToken) {
    return new Response(JSON.stringify({ error: "Not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body: {
    client?: string;
    title?: string;
    question?: string;
    sql?: string;
    explanation?: string;
    chartType?: string;
    columns?: string[];
    rows?: Record<string, unknown>[];
  } = {};
  try { body = await req.json(); } catch { body = {}; }

  const clientId = body.client || "heartland";
  if (!body.question) {
    return new Response(JSON.stringify({ error: "No question provided" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const path = `clients/${clientId}/status/insights.json`;
  const headers = {
    "Authorization": `token ${githubToken}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  let insights: Record<string, unknown>[] = [];
  let sha = "";

  const getRes = await fetch(
    `${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`,
    { headers }
  );
  if (getRes.ok) {
    const file = await getRes.json();
    sha = file.sha;
    insights = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  }

  const insight: Record<string, unknown> = {
    id: `insight_${Date.now()}`,
    title: body.title || body.explanation || body.question,
    question: body.question,
    sql: body.sql,
    explanation: body.explanation,
    chartType: body.chartType,
    columns: body.columns,
    rows: body.rows,
    savedAt: new Date().toISOString(),
    dataDate: new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  };

  insights.unshift(insight);
  if (insights.length > MAX_INSIGHTS) insights = insights.slice(0, MAX_INSIGHTS);

  const updated = JSON.stringify(insights, null, 2);
  await fetch(
    `${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `insights: save Thread Insight for ${clientId}`,
        content: Buffer.from(updated).toString("base64"),
        ...(sha ? { sha } : {})
      })
    }
  );

  return new Response(JSON.stringify({ success: true, id: insight.id }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = {
  path: "/api/save-insight"
};
