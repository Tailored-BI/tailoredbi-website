import type { Context, Config } from "@netlify/functions";

const GITHUB_RAW = "https://raw.githubusercontent.com/Tailored-BI/tailoredbi-clients/main";

const CLIENTS: Record<string, { name: string }> = {
  heartland: { name: "Heartland Ag Parts" },
  ridgeline: { name: "Ridgeline Fluid Power" },
  mars:      { name: "Mars Aerospace Components" }
};

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client") || "heartland";

  if (!CLIENTS[clientId]) {
    return new Response(JSON.stringify({ error: "Unknown client" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const base = `${GITHUB_RAW}/clients/${clientId}/status`;

  try {
    const [pipelineRes, inventoryRes] = await Promise.all([
      fetch(`${base}/pipeline-status.json`),
      fetch(`${base}/workspace-inventory.json`)
    ]);

    const pipeline = pipelineRes.ok ? await pipelineRes.json() : null;
    const inventory = inventoryRes.ok ? await inventoryRes.json() : null;

    return new Response(JSON.stringify({
      client: CLIENTS[clientId],
      pipeline,
      inventory,
      fetchedAt: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch status" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = {
  path: "/api/client-status"
};
