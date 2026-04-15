import type { Context, Config } from "@netlify/functions";
import { queryDb, execDb } from "./db.mts";

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
            name: "Thread.bi",
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

  const fabricClientId = Netlify.env.get("FABRIC_CLIENT_ID");
  const fabricClientSecret = Netlify.env.get("FABRIC_CLIENT_SECRET");
  const tenantId = Netlify.env.get("FABRIC_TENANT_ID");

  if (!fabricClientId || !fabricClientSecret || !tenantId) {
    return new Response(JSON.stringify({ error: "Not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body: { client?: string; recipients?: string[] } = {};
  try { body = await req.json(); } catch { body = {}; }
  const clientId = body.client || "heartland";
  const bodyRecipients = Array.isArray(body.recipients) ? body.recipients.filter(e => e && e.includes("@")) : [];

  // ── Query 1: Briefing content from Neon ────────────────────────────────────
  let briefing: Record<string, unknown> | null = null;
  try {
    const rows = await queryDb(
      `SELECT b.*, c.name AS client_name
       FROM briefings b
       JOIN clients c ON b.client_id = c.client_id
       WHERE b.client_id = $1
       ORDER BY b.generated_at DESC LIMIT 1`,
      [clientId]
    );
    briefing = rows[0] || null;
  } catch (err) {
    console.error("send-briefing-email: briefing query failed:", String(err).substring(0, 200));
  }

  if (!briefing) {
    console.log(`send-briefing-email: no briefing found for ${clientId} — skipping send`);
    return new Response(JSON.stringify({ skipped: `No briefing found for ${clientId}` }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // ── Query 2: Pipeline status from Neon ─────────────────────────────────────
  let pip: Record<string, unknown> = {};
  try {
    const rows = await queryDb(
      `SELECT * FROM pipeline_status WHERE client_id = $1`,
      [clientId]
    );
    pip = rows[0] || {};
  } catch (err) {
    console.error("send-briefing-email: pipeline_status query failed:", String(err).substring(0, 200));
  }

  // ── Query 3: Preferences from Neon ─────────────────────────────────────────
  let prefs: Record<string, unknown> = {};
  try {
    const rows = await queryDb(
      `SELECT * FROM thread_preferences WHERE client_id = $1`,
      [clientId]
    );
    prefs = rows[0] || {};
  } catch (err) {
    console.error("send-briefing-email: preferences query failed:", String(err).substring(0, 200));
  }

  // ── Delivery day check ─────────────────────────────────────────────────────
  const deliveryDaysStr = String(prefs.delivery_days || "1,2,3,4,5");
  const deliveryDays: number[] = deliveryDaysStr.split(",").map(Number).filter(n => n > 0);
  const todayDay = new Date().getDay() === 0 ? 7 : new Date().getDay();
  if (!deliveryDays.includes(todayDay)) {
    return new Response(JSON.stringify({ skipped: `Not a delivery day (day ${todayDay})` }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // ── Recipients: POST body → users table → thread_preferences fallback ─────
  let recipients: string[] = bodyRecipients;
  if (!recipients.length) {
    try {
      const userRows = await queryDb(
        `SELECT email FROM users
         WHERE client_id = $1 AND is_active = true AND role IN ('employee', 'admin')`,
        [clientId]
      );
      recipients = userRows.map(r => String(r.email)).filter(e => e.includes("@"));
    } catch (err) {
      console.log("send-briefing-email: users query failed, trying preferences:", String(err).substring(0, 100));
    }
  }
  if (!recipients.length) {
    const prefRecipients = String(prefs.recipients || "");
    if (prefRecipients) recipients = prefRecipients.split(",").map(e => e.trim()).filter(e => e.includes("@"));
  }
  if (!recipients.length) {
    return new Response(JSON.stringify({ skipped: "No recipients configured" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // ── Parse briefing fields ──────────────────────────────────────────────────
  const insights = briefing.insights ? JSON.parse(String(briefing.insights)) : [];
  const dataHealth = briefing.data_health ? JSON.parse(String(briefing.data_health)) : null;
  const clientName = String(briefing.client_name || "Heartland Ag Parts Co.");
  const dataDate = String(briefing.data_date || new Date().toLocaleDateString());
  const pipelineMissed = briefing.pipeline_missed === true;
  const briefingLastRunMT = String(briefing.last_run_mt || "");

  // ── Build dataHealth from pipeline_status if briefing.data_health is empty ─
  const dh = dataHealth && dataHealth.lastRefresh && dataHealth.lastRefresh !== "Unknown"
    ? dataHealth
    : {
        lastRefresh: String(pip.last_run_mt || "Unknown"),
        tablesSuccess: Number(pip.tables_loaded || 0),
        tablesTotal: Number(pip.total_tables || 16),
        tablesFailed: Number(pip.tables_failed || 0),
        duration: String(pip.duration || "—"),
        recordsProcessed: Number(pip.total_rows || 0),
        streakOk: Number(pip.streak_ok || 0),
        streakTotal: Number(pip.streak_total || 0),
        overallStatus: String(pip.overall_status || "UNKNOWN"),
      };

  // ── Build HTML ─────────────────────────────────────────────────────────────
  const severityStyle: Record<string, { bg: string; border: string; color: string; label: string }> = {
    alert:   { bg: "#fff0f0", border: "#c0201a", color: "#8a1010", label: "Action needed" },
    warning: { bg: "#fff8f0", border: "#c4511a", color: "#8a3010", label: "Watch closely" },
    good:    { bg: "#eaf6ea", border: "#2a7a2a", color: "#1a5c1a", label: "Good news" },
    info:    { bg: "#e8f0ff", border: "#185fa5", color: "#0c447c", label: "FYI" }
  };

  const pipelineAlert = pipelineMissed ? `
    <tr><td style="padding:0 0 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="4" style="background:#c4511a;"></td>
        <td style="padding:14px 16px;background:#fff8f0;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c4511a;">Pipeline alert — data not refreshed today</p>
          <p style="margin:0;font-size:15px;color:#6a4a2a;line-height:1.65;">Thread's data was last updated <strong>${briefingLastRunMT || 'unknown'}</strong>. This Morning Thread reflects that data — today's activity is not yet included. Tailored.BI has been notified and is investigating.</p>
        </td>
      </tr></table>
    </td></tr>` : '';

  const catBadge: Record<string, { bg: string; color: string }> = {
    revenue:     { bg: '#e8f0e0', color: '#3B6D11' },
    sales:       { bg: '#e8f0e0', color: '#3B6D11' },
    collections: { bg: '#fde8e8', color: '#A32D2D' },
    ar:          { bg: '#fde8e8', color: '#A32D2D' },
    production:  { bg: '#e6f1fb', color: '#185FA5' },
    operations:  { bg: '#e6f1fb', color: '#185FA5' },
    purchasing:  { bg: '#eeedfe', color: '#534AB7' },
    inventory:   { bg: '#fdf3e3', color: '#854F0B' },
  };
  function getCatFromTitle(title: string): string {
    const t = title.toLowerCase();
    if (/revenue|margin|sales/i.test(t)) return 'revenue';
    if (/collect|overdue|aging|ar\b|receivable/i.test(t)) return 'collections';
    if (/job|production|operat/i.test(t)) return 'production';
    if (/vendor|purchas|lead.time|ap\b/i.test(t)) return 'purchasing';
    if (/inventor|stock|part/i.test(t)) return 'inventory';
    return '';
  }

  const insightsHtml = (insights || []).map((ins: {
    severity: string; title: string; text: string; action?: string; suggestedQuery?: string; category?: string; focusArea?: string
  }) => {
    const s = severityStyle[ins.severity] || severityStyle.info;
    const cat = (ins.category || ins.focusArea || getCatFromTitle(ins.title)).toLowerCase();
    const cb = catBadge[cat] || { bg: '#fdf3e3', color: '#854F0B' };
    const catLabel = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
    const catHtml = catLabel ? `<span style="display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:${cb.bg};color:${cb.color};padding:2px 7px;border-radius:8px;">${catLabel}</span>` : '';
    return `
    <tr><td style="padding:0 0 14px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="4" style="background:${s.border};"></td>
        <td style="padding:14px 16px;background:${s.bg};">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${s.color};">${s.label}</p>
          <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#1a1a1a;line-height:1.35;">${ins.title}</p>
          ${catHtml ? `<p style="margin:0 0 10px;">${catHtml}</p>` : ''}
          <p style="margin:0${ins.action ? ' 0 8px' : ''};font-size:15px;color:#3d2b0e;line-height:1.65;">${ins.text}</p>
          ${ins.action ? `<p style="margin:0 0 8px;font-size:13px;color:#6a5a4a;font-style:italic;">${ins.action}</p>` : ''}
          ${ins.suggestedQuery ? `<p style="margin:0;"><a href="https://thread.bi/?tab=ask&query=${encodeURIComponent(ins.suggestedQuery)}&t=${Date.now()}" style="font-size:12px;color:#BA7517;text-decoration:none;font-weight:600;">Dig deeper in Thread →</a></p>` : ''}
        </td>
      </tr></table>
    </td></tr>`;
  }).join('');

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
      <tr><td style="background-color:#0f1e35;padding:16px 24px;border-radius:8px 8px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td>
            <p style="margin:0;font-size:17px;font-weight:700;color:#f0ead8;">Thread<span style="font-style:italic;color:#c9a84c;">.bi</span></p>
            <p style="margin:3px 0 0;font-size:13px;color:#6a7a90;">${clientName} · ${dataDate}</p>
          </td>
          <td align="right" valign="top">
            <p style="margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c9a84c;">Morning Thread</p>
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
            <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://thread.bi/?t=${Date.now()}" style="height:40px;v-text-anchor:middle;width:220px;" arcsize="15%" fillcolor="#c9a84c"><center style="color:#fff;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;">Open Thread.bi →</center></v:roundrect><![endif]-->
            <!--[if !mso]><!-->
            <a href="https://thread.bi/?t=${Date.now()}" style="display:inline-block;padding:10px 28px;background-color:#c9a84c;color:#ffffff;border-radius:6px;font-size:14px;font-weight:700;text-decoration:none;mso-hide:all;">Open Thread.bi →</a>
            <!--<![endif]-->
          </td></tr>
          <tr><td align="center">
            <p style="margin:0;font-size:11px;color:#aaa;"><a href="https://thread.bi" style="color:#c9a84c;text-decoration:none;">thread.bi</a> · A product of <a href="https://tailored.bi" style="color:#c9a84c;text-decoration:none;">Tailored.BI</a></p>
          </td></tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  // ── Send email ─────────────────────────────────────────────────────────────
  try {
    const token = await getGraphToken(tenantId, fabricClientId, fabricClientSecret);
    await sendGraphEmail(token, recipients, `Morning Thread — ${clientName} · ${dataDate}`, html);

    // ── Mark email_sent_at in Neon ─────────────────────────────────────────
    try {
      await execDb(
        `UPDATE briefings SET email_sent_at = NOW()
         WHERE client_id = $1 AND generated_at = $2`,
        [clientId, briefing.generated_at]
      );
    } catch (markErr) {
      console.error("send-briefing-email: failed to mark email_sent_at:", String(markErr).substring(0, 200));
    }

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
