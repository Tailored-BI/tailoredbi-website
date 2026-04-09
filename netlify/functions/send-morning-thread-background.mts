import type { Config } from "@netlify/functions";

const THREAD_URL = "https://thread.bi";

// Backup email sender — runs at 9:15 AM MT (15:15 UTC)
// Only sends if pipeline-complete didn't already send today's email
export default async (req: Request) => {
  const clients = ["heartland"];

  for (const client of clients) {
    console.log(`send-morning-thread-backup: processing ${client}`);

    try {
      const statusRes = await fetch(
        `${THREAD_URL}/api/thread-status?client=${client}&_=${Date.now()}`
      );
      const statusData = await statusRes.json();

      const briefing = statusData?.briefing;
      const prefs = statusData?.inventory?.threadPreferences;

      if (!briefing) {
        console.log(`${client}: no briefing found — skipping`);
        continue;
      }

      const briefingDate = new Date(briefing.generatedAt).toDateString();
      const today = new Date().toDateString();

      if (briefingDate !== today) {
        console.log(`${client}: briefing is from ${briefingDate}, not today — skipping`);
        continue;
      }

      // Check if email was already sent by pipeline-complete
      if (briefing.emailSentAt) {
        const sentDate = new Date(briefing.emailSentAt).toDateString();
        if (sentDate === today) {
          console.log(`${client}: email already sent at ${briefing.emailSentAt} — skipping`);
          continue;
        }
      }

      const dayOfWeek = new Date().getDay();
      const deliveryDays = prefs?.deliveryDays || [1, 2, 3, 4, 5];
      if (!deliveryDays.includes(dayOfWeek)) {
        console.log(`${client}: today (${dayOfWeek}) not a delivery day — skipping`);
        continue;
      }

      console.log(`${client}: email NOT sent by pipeline-complete — sending backup`);

      const origin = new URL(req.url).origin;
      const emailRes = await fetch(`${origin}/api/send-briefing-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client }),
      });

      console.log(`${client}: backup email sent — status ${emailRes.status}`);

      // Mark as sent
      if (emailRes.ok) {
        try {
          await fetch(`${THREAD_URL}/api/save-briefing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client, markEmailSent: true }),
          });
        } catch (e) { console.error(`${client}: mark-sent failed`, e); }
      }

    } catch (err) {
      console.error(`${client}: error — ${err}`);
    }
  }
};

export const config: Config = {
  schedule: "15 15 * * *",
};
