import { neon } from "@neondatabase/serverless";

export type SqlRow = Record<string, unknown>;

function getDb() {
  const url = Netlify.env.get("DATABASE_URL") || process.env.DATABASE_URL || "";
  return neon(url);
}

export async function queryDb(sql: string, params: unknown[] = []): Promise<SqlRow[]> {
  const db = getDb();
  const result = await db(sql, params);
  return result as SqlRow[];
}

export async function execDb(sql: string, params: unknown[] = []): Promise<void> {
  const db = getDb();
  await db(sql, params);
}
