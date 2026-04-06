import type { Config } from "@netlify/functions";

const THREAD_URL = "https://tailoredbi-thread.netlify.app";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  const client = String(body.client || "heartland");
  const status = String(body.status || "SUCCESS");
  const steps: string[] = [];

  console.log(`pipeline-complete: client=${client} status=${status}`);

  // ── Step 1: Update Thread pipeline status ──────────────────────────────────
  try {
    const r = await fetch(`${THREAD_URL}/api/update-pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client,
        overallStatus: status,
        lastRunMT: new Date().toLocaleString("en-US", {
          timeZone: "America/Denver",
          weekday: "short", month: "numeric", day: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true
        }) + " MT",
        tablesLoaded: 16,
        totalTables: 16,
        tablesFailed: 0,
        updatedAt: new Date().toISOString(),
      }),
    });
    steps.push(`update-pipeline: ${r.status}`);
    console.log("Thread pipeline updated:", r.status);
  } catch (err) {
    steps.push(`update-pipeline: failed - ${err}`);
    console.error("Thread pipeline update failed:", err);
  }

  // ── Step 2: Check if briefing already generated today ──────────────────────
  let briefingAlreadyDone = false;
  try {
    const checkRes = await fetch(
      `${THREAD_URL}/api/thread-status?client=${client}&_=${Date.now()}`
    );
    const checkData = await checkRes.json();
    const lastBriefing = checkData?.briefing?.generatedAt;
    if (lastBriefing) {
      const briefingDate = new Date(lastBriefing).toDateString();
      const today = new Date().toDateString();
      briefingAlreadyDone = briefingDate === today;
      console.log(`Briefing check: lastBriefing=${briefingDate} today=${today} skip=${briefingAlreadyDone}`);
    }
  } catch (err) {
    console.error("Briefing check failed:", err);
  }

  if (briefingAlreadyDone) {
    steps.push("generate-briefing: skipped (already generated today)");
    console.log("Briefing already generated today — skipping");
    return new Response(JSON.stringify({ success: true, steps, skipped: true }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // ── Step 3: Generate briefing (saves to GitHub + Thread Postgres) ──────────
  try {
    const origin = new URL(req.url).origin;
    const r = await fetch(`${origin}/api/generate-briefing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client }),
    });
    steps.push(`generate-briefing: ${r.status}`);
    console.log("Briefing generated:", r.status);
  } catch (err) {
    steps.push(`generate-briefing: failed - ${err}`);
    console.error("Briefing generation failed:", err);
  }

  // ── Step 4: NO EMAIL HERE — email sent by scheduled function at 7am MT ─────
  steps.push("email: deferred to scheduled send-morning-thread function");

  return new Response(JSON.stringify({ success: true, steps }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = { path: "/api/pipeline-complete" };
