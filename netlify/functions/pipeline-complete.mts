import type { Context, Config } from "@netlify/functions";

const GITHUB_API = "https://api.github.com";
const ONPREM_STATUS_URL = "https://tailored.bi/api/client-status";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const githubToken = Netlify.env.get("GITHUB_TOKEN");
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");

  if (!githubToken) {
    return new Response(JSON.stringify({ error: "Not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: { client?: string; runId?: string; status?: string } = {};
  try { body = await req.json(); } catch { body = {}; }

  const clientId = body.client || "heartland";
  const overallStatus = body.status || "SUCCESS";

  const results: Record<string, unknown> = {
    client: clientId,
    timestamp: new Date().toISOString(),
    steps: []
  };

  try {
    // Step 1 — Export status JSON via the existing export proc
    // We call the OnPrem sqlcmd via a background process
    // For now we trigger the PowerShell script via GitHub Actions webhook
    // or just call generate-briefing directly if status is SUCCESS

    // Step 2 — Generate briefing if successful
    if (overallStatus === "SUCCESS") {
      const briefingRes = await fetch("https://tailored.bi/api/generate-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const briefingData = briefingRes.ok ? await briefingRes.json() : { error: "failed" };
      (results.steps as unknown[]).push({ step: "briefing", result: briefingData });
    }

    (results.steps as unknown[]).push({ step: "complete", status: overallStatus });

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), ...results }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/pipeline-complete"
};
