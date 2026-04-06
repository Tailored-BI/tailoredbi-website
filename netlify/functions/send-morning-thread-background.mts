import type { Config } from "@netlify/functions";

const THREAD_URL = "https://tailoredbi-thread.netlify.app";

export default async (req: Request) => {
  const clients = ["heartland"];

  for (const client of clients) {
    console.log(`send-morning-thread: processing ${client}`);

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

      const dayOfWeek = new Date().getDay();
      const deliveryDays = prefs?.deliveryDays || [1, 2, 3, 4, 5];
      if (!deliveryDays.includes(dayOfWeek)) {
        console.log(`${client}: today (${dayOfWeek}) not a delivery day — skipping`);
        continue;
      }

      const origin = new URL(req.url).origin;
      const emailRes = await fetch(`${origin}/api/send-briefing-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client }),
      });

      console.log(`${client}: email sent — status ${emailRes.status}`);

    } catch (err) {
      console.error(`${client}: error — ${err}`);
    }
  }
};

export const config: Config = {
  schedule: "0 13 * * *",
};
