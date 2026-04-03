import type { Context, Config } from "@netlify/functions";

const GITHUB_RAW = "https://raw.githubusercontent.com/Tailored-BI/tailoredbi-clients/main";
const GRAPH_ENDPOINT = "https://graph.microsoft.com/v1.0";
const FROM_ADDRESS = "david@tailored.bi";

async function getGraphToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default"
    }).toString()
  });
  if (!res.ok) throw new Error(`Graph token failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function sendGraphEmail(token: string, to: string[], subject: string, html: string): Promise<void> {
  const res = await fetch(`${GRAPH_ENDPOINT}/users/${FROM_ADDRESS}/sendMail`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        from: {
          emailAddress: {
            name: "Thread by Tailored.BI",
            address: FROM_ADDRESS
          }
        },
        toRecipients: to.map(addr => ({
          emailAddress: { address: addr }
        }))
      },
      saveToSentItems: true
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph sendMail failed (${res.status}): ${err.substring(0, 300)}`);
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const clientId = Netlify.env.get("FABRIC_CLIENT_ID");
  const clientSecret = Netlify.env.get("FABRIC_CLIENT_SECRET");
  const tenantId = Netlify.env.get("FABRIC_TENANT_ID");
  const githubToken = Netlify.env.get("GITHUB_TOKEN");

  if (!clientId || !clientSecret || !tenantId || !githubToken) {
    return new Response(JSON.stringify({ error: "Not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body: { client?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const clientId2 = body.client || "heartland";

  const day = new Date().getDay();
  const isWeekday = day >= 1 && day <= 5;

  const headers = {
    "Authorization": `token ${githubToken}`,
    "Accept": "application/vnd.github.v3.raw"
  };
  const base = `${GITHUB_RAW}/clients/${clientId2}/status`;

  const [briefingRes, inventoryRes] = await Promise.all([
    fetch(`${base}/daily-briefing.json`, { headers }),
    fetch(`${base}/workspace-inventory.json`, { headers })
  ]);

  if (!briefingRes.ok) {
    return new Response(JSON.stringify({ error: "No briefing available" }), {
      status: 404, headers: { "Content-Type": "application/json" }
    });
  }

  const briefing = await briefingRes.json();
  const inventory = inventoryRes.ok ? await inventoryRes.json() : null;

  const config = inventory?.notifications?.briefingEmail;
  if (!config?.enabled) {
    return new Response(JSON.stringify({ skipped: "Email notifications disabled" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  if (config.weekdayOnly && !isWeekday) {
    return new Response(JSON.stringify({ skipped: "Weekend — briefing email skipped" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const recipients: string[] = config.recipients || [];
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ skipped: "No recipients configured" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const severityStyle: Record<string, { bg: string; border: string; color: string; label: string }> = {
    alert:   { bg: "#fff0f0", border: "#c0201a", color: "#8a1010", label: "Action needed" },
    warning: { bg: "#fff8f0", border: "#c4511a", color: "#8a3010", label: "Watch closely" },
    good:    { bg: "#eaf6ea", border: "#2a7a2a", color: "#1a5c1a", label: "Good news" },
    info:    { bg: "#e8f0ff", border: "#185fa5", color: "#0c447c", label: "FYI" }
  };

  const pipelineAlert = briefing.pipelineMissed ? `
    <div style="margin-bottom:16px;padding:12px 14px;background:#fff8f0;border-left:4px solid #c4511a;border-radius:0 6px 6px 0;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c4511a;margin-bottom:3px;">Pipeline alert — data not refreshed today</div>
      <div style="font-size:12px;color:#6a4a2a;line-height:1.5;">Thread's data was last updated <strong>${briefing.lastRunMT || 'unknown'}</strong>. This Morning Thread reflects that data — today's activity is not yet included. Tailored.BI has been notified and is investigating.</div>
    </div>` : '';

  const insightsHtml = (briefing.insights || []).map((ins: {
    severity: string; title: string; text: string; action?: string
  }) => {
    const s = severityStyle[ins.severity] || severityStyle.info;
    return `
    <div style="margin-bottom:14px;padding:12px 14px;background:${s.bg};border-left:4px solid ${s.border};border-radius:0 6px 6px 0;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${s.color};margin-bottom:4px;">${s.label} — ${ins.title}</div>
      <div style="font-size:13px;color:#3d2b0e;line-height:1.6;margin-bottom:${ins.action ? '6px' : '0'}">${ins.text}</div>
      ${ins.action ? `<div style="font-size:11px;color:#6a5a4a;font-style:italic;">${ins.action}</div>` : ''}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">

  <div style="background:#3d2b0e;padding:14px 20px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="color:#f5f0e8;font-size:15px;font-weight:700;">${inventory?.client || "Heartland Ag Parts Co."}</div>
      <div style="color:#8a7040;font-size:11px;margin-top:2px;">Thread by Tailored.BI · ${briefing.dataDate || new Date().toLocaleDateString()}</div>
    </div>
    <div style="color:#c4963a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Morning Thread</div>
  </div>

  <div style="background:#fff;padding:20px;border:1px solid #e2dbd2;border-top:none;">
    <div style="font-size:13px;color:#6a5a4a;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f0ebe4;">
      Good morning. Thread reviewed your Heartland data overnight. Here is what needs your attention today.
    </div>
    ${pipelineAlert}
    ${insightsHtml}
  </div>

  <div style="background:#f9f6f2;padding:12px 20px;border:1px solid #e2dbd2;border-top:none;border-radius:0 0 8px 8px;text-align:center;">
    <a href="https://tailored.bi/heartland/portal" style="display:inline-block;padding:8px 20px;background:#c4511a;color:#fff;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin-bottom:10px;">View full portal →</a>
    <div style="font-size:10px;color:#aaa;">Thread by Tailored.BI · Managed BI for Epicor Kinetic · tailored.bi</div>
  </div>

</div>
</body>
</html>`;

  try {
    const token = await getGraphToken(tenantId, clientId, clientSecret);
    await sendGraphEmail(token, recipients, `${config.subject || "Morning Thread"} · ${briefing.dataDate || new Date().toLocaleDateString()}`, html);

    return new Response(JSON.stringify({
      success: true,
      recipients: recipients.length,
      from: FROM_ADDRESS
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: "Email send failed",
      detail: String(err).substring(0, 300)
    }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/send-briefing-email"
};
