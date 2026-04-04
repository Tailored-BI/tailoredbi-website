import type { Context, Config } from "@netlify/functions";

const GITHUB_API = "https://api.github.com";

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

  let body: { client?: string; preferences?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { body = {}; }

  const clientId = body.client || "heartland";
  const preferences = body.preferences;
  if (!preferences) {
    return new Response(JSON.stringify({ error: "No preferences provided" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const path = `clients/${clientId}/status/workspace-inventory.json`;
  const headers = {
    "Authorization": `token ${githubToken}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  const getRes = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, { headers });
  if (!getRes.ok) {
    return new Response(JSON.stringify({ error: "Could not fetch inventory" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const file = await getRes.json();
  const current = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  current.threadPreferences = {
    ...preferences,
    updatedAt: new Date().toISOString().split("T")[0],
  };

  const updated = JSON.stringify(current, null, 2);
  const putRes = await fetch(`${GITHUB_API}/repos/Tailored-BI/tailoredbi-clients/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `prefs: update Thread preferences for ${clientId}`,
      content: Buffer.from(updated).toString("base64"),
      sha: file.sha
    })
  });

  if (!putRes.ok) {
    return new Response(JSON.stringify({ error: "Could not save preferences" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = {
  path: "/api/save-preferences"
};
