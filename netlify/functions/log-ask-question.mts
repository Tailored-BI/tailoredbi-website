import type { Context, Config } from "@netlify/functions";

const GITHUB_API = "https://api.github.com";
const MAX_HISTORY = 50;

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

  let body: { client?: string; question?: string; addToFocus?: boolean } = {};
  try { body = await req.json(); } catch { body = {}; }

  const clientId = body.client || "heartland";
  const question = body.question?.trim();
  if (!question) {
    return new Response(JSON.stringify({ skipped: "No question" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const path = `clients/${clientId}/status/ask-history.json`;
  const headers = {
    "Authorization": `token ${githubToken}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  let history: Record<string, unknown>[] = [];
  let sha = "";

  const getRes = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, { headers });
  if (getRes.ok) {
    const file = await getRes.json();
    sha = file.sha;
    history = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  }

  const entry: Record<string, unknown> = {
    question,
    askedAt: new Date().toISOString(),
    addedToFocus: body.addToFocus || false
  };

  history.unshift(entry);
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);

  const updated = JSON.stringify(history, null, 2);
  await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `ask: log question for ${clientId}`,
      content: Buffer.from(updated).toString("base64"),
      ...(sha ? { sha } : {})
    })
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = {
  path: "/api/log-ask-question"
};
