import type { Config } from "@netlify/functions";

const THREAD_URL = "https://thread.bi";

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
  // TODO Phase 2: send staleCount, perTableStats[] (name, rowCount, duration, stale, nct),
  // runHistory[] (date, status, tablesLoaded, duration), warehouseRowCounts[] (table, rows, capturedAt)
  // These fields are needed by the Pipeline dashboard tab for full per-table detail.
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

  // ── Step 4: Send Morning Thread email immediately ──────────────────────────
  try {
    const origin = new URL(req.url).origin;
    const emailRes = await fetch(`${origin}/api/send-briefing-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client }),
    });
    const emailData = await emailRes.json();
    steps.push(`send-email: ${emailRes.status} (${emailData.success ? 'sent' : emailData.error || 'failed'})`);
    console.log("Email sent:", emailRes.status, emailData.success ? "SUCCESS" : emailData.error);

    // Mark email as sent in Thread DB so backup cron doesn't double-send
    if (emailData.success) {
      try {
        await fetch(`${THREAD_URL}/api/save-briefing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client, markEmailSent: true }),
        });
        steps.push("mark-email-sent: done");
      } catch (markErr) {
        steps.push(`mark-email-sent: failed - ${markErr}`);
      }
    }
  } catch (err) {
    steps.push(`send-email: failed - ${err}`);
    console.error("Email send failed (backup cron will retry):", err);
  }

  return new Response(JSON.stringify({ success: true, steps }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = { path: "/api/pipeline-complete" };
