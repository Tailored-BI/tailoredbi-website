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

  const prefs = inventory?.threadPreferences || {};
  const config = inventory?.notifications?.briefingEmail || {};

  const deliveryDays: number[] = prefs.deliveryDays?.length > 0
    ? prefs.deliveryDays
    : (config.weekdayOnly !== false ? [1,2,3,4,5] : [1,2,3,4,5]);

  const todayDay = new Date().getDay() === 0 ? 7 : new Date().getDay();
  if (!deliveryDays.includes(todayDay)) {
    return new Response(JSON.stringify({ skipped: `Not a delivery day (day ${todayDay})` }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const recipients: string[] = prefs.recipients?.length > 0
    ? prefs.recipients
    : (config.recipients || []);
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
    <tr><td style="padding:0 0 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="4" style="background:#c4511a;"></td>
        <td style="padding:14px 16px;background:#fff8f0;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c4511a;">Pipeline alert — data not refreshed today</p>
          <p style="margin:0;font-size:15px;color:#6a4a2a;line-height:1.65;">Thread's data was last updated <strong>${briefing.lastRunMT || 'unknown'}</strong>. This Morning Thread reflects that data — today's activity is not yet included. Tailored.BI has been notified and is investigating.</p>
        </td>
      </tr></table>
    </td></tr>` : '';

  const insightsHtml = (briefing.insights || []).map((ins: {
    severity: string; title: string; text: string; action?: string; suggestedQuery?: string
  }) => {
    const s = severityStyle[ins.severity] || severityStyle.info;
    return `
    <tr><td style="padding:0 0 14px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="4" style="background:${s.border};"></td>
        <td style="padding:14px 16px;background:${s.bg};">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${s.color};">${s.label} — ${ins.title}</p>
          <p style="margin:0${ins.action ? ' 0 8px' : ''};font-size:15px;color:#3d2b0e;line-height:1.65;">${ins.text}</p>
          ${ins.action ? `<p style="margin:0 0 8px;font-size:13px;color:#6a5a4a;font-style:italic;">${ins.action}</p>` : ''}
          ${ins.suggestedQuery ? `<p style="margin:0;"><a href="https://threadbi.netlify.app/?tab=ask&query=${encodeURIComponent(ins.suggestedQuery)}&t=${Date.now()}" style="font-size:12px;color:#c4511a;text-decoration:none;font-weight:600;">Dig deeper in Thread →</a></p>` : ''}
        </td>
      </tr></table>
    </td></tr>`;
  }).join('');

  const clientName = inventory?.client || "Heartland Ag Parts Co.";
  const dataDate = briefing.dataDate || new Date().toLocaleDateString();

  const dh = briefing.dataHealth;
  const dataHealthTable = dh ? `
    <tr><td style="padding:0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;border-top:1px solid #e2dbd2;">
        <tr><td style="padding:10px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr>
              <td style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a7a6a;font-family:Arial,sans-serif;">Data health &amp; pipeline status</td>
              <td align="right" style="font-size:9px;color:${dh.tablesFailed===0?'#2a7a2a':'#c0201a'};font-weight:600;font-family:Arial,sans-serif;">&#9679; ${dh.tablesFailed===0?'All systems healthy':dh.tablesFailed+' table(s) failed'}</td>
            </tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="25%" align="center" style="padding:6px 4px;border-right:1px solid #e2dbd2;">
                <div style="font-size:9px;color:#aaa09a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;font-family:Arial,sans-serif;">Last refresh</div>
                <div style="font-size:12px;font-weight:700;color:#3d2b0e;font-family:Arial,sans-serif;">${dh.lastRefresh}</div>
              </td>
              <td width="20%" align="center" style="padding:6px 4px;border-right:1px solid #e2dbd2;">
                <div style="font-size:9px;color:#aaa09a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;font-family:Arial,sans-serif;">Tables</div>
                <div style="font-size:12px;font-weight:700;color:#2a7a2a;font-family:Arial,sans-serif;">${dh.tablesSuccess}/${dh.tablesTotal} ✓</div>
              </td>
              <td width="20%" align="center" style="padding:6px 4px;border-right:1px solid #e2dbd2;">
                <div style="font-size:9px;color:#aaa09a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;font-family:Arial,sans-serif;">Records</div>
                <div style="font-size:12px;font-weight:700;color:#c4511a;font-family:Arial,sans-serif;">${dh.recordsProcessed?Number(dh.recordsProcessed).toLocaleString():'—'}</div>
              </td>
              <td width="15%" align="center" style="padding:6px 4px;border-right:1px solid #e2dbd2;">
                <div style="font-size:9px;color:#aaa09a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;font-family:Arial,sans-serif;">Duration</div>
                <div style="font-size:12px;font-weight:700;color:#3d2b0e;font-family:Arial,sans-serif;">${dh.duration||'—'}</div>
              </td>
              <td width="20%" align="center" style="padding:6px 4px;">
                <div style="font-size:9px;color:#aaa09a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;font-family:Arial,sans-serif;">30-day streak</div>
                <div style="font-size:12px;font-weight:700;color:#2a7a2a;font-family:Arial,sans-serif;">${dh.streakOk}/${dh.streakTotal} ✓</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>` : '';

  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>Morning Thread · ${dataDate}</title>
  <!--[if mso]><style>table{border-collapse:collapse;}td{font-family:Segoe UI,Arial,sans-serif;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f2ed;font-family:'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f2ed;">
  <tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr><td style="background-color:#3d2b0e;padding:16px 24px;border-radius:8px 8px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td>
            <p style="margin:0;font-size:17px;font-weight:700;color:#f5f0e8;">${clientName}</p>
            <p style="margin:3px 0 0;font-size:13px;color:#8a7040;">Thread by Tailored.BI · ${dataDate}</p>
          </td>
          <td align="right" valign="top">
            <p style="margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c4963a;">Morning Thread</p>
          </td>
        </tr></table>
      </td></tr>

      <!-- BODY -->
      <tr><td style="background-color:#ffffff;padding:24px;border-left:1px solid #e2dbd2;border-right:1px solid #e2dbd2;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <!-- Intro -->
          <tr><td style="padding:0 0 16px;border-bottom:1px solid #f0ebe4;">
            <p style="margin:0;font-size:15px;color:#6a5a4a;line-height:1.65;">Good morning. Thread reviewed your data overnight. Here is what needs your attention today.</p>
          </td></tr>
          <tr><td style="padding:16px 0 0;"></td></tr>

          <!-- Pipeline alert (if any) -->
          ${pipelineAlert}

          <!-- Insights -->
          ${insightsHtml}

        </table>
      </td></tr>

      <!-- CTA FOOTER -->
      ${dataHealthTable}

      <tr><td style="background-color:#f9f6f2;padding:20px 24px;border:1px solid #e2dbd2;border-top:none;border-radius:0 0 8px 8px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center" style="padding:0 0 12px;">
            <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://threadbi.netlify.app/?t=${Date.now()}" style="height:40px;v-text-anchor:middle;width:220px;" arcsize="15%" fillcolor="#c4511a"><center style="color:#fff;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;">Open Thread →</center></v:roundrect><![endif]-->
            <!--[if !mso]><!-->
            <a href="https://threadbi.netlify.app/?t=${Date.now()}" style="display:inline-block;padding:10px 28px;background-color:#c4511a;color:#ffffff;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none;mso-hide:all;">Open Thread →</a>
            <!--<![endif]-->
          </td></tr>
          <tr><td align="center">
            <p style="margin:0;font-size:11px;color:#aaa;">Thread by <a href="https://tailored.bi" style="color:#c4963a;text-decoration:none;">Tailored.BI</a></p>
          </td></tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    const token = await getGraphToken(tenantId, clientId, clientSecret);
    await sendGraphEmail(token, recipients, `Morning Thread — ${inventory?.client || "Heartland Ag Parts"} · ${briefing.dataDate || new Date().toLocaleDateString()}`, html);

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
