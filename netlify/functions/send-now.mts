import type { Config } from "@netlify/functions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  if (body.adminKey !== "TailoredBI-Admin-2026") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json", ...CORS }
    });
  }

  const client = String(body.client || "heartland");
  const origin = new URL(req.url).origin;

  try {
    const r = await fetch(`${origin}/api/send-briefing-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({ client }),
    });
    const result = await r.json();
    return new Response(JSON.stringify({ success: true, status: r.status, result }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
};

export const config: Config = { path: "/api/send-now" };
