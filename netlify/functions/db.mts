import { neon } from "@netlify/neon";

export type SqlRow = Record<string, unknown>;

export function getDb() {
  return neon(Netlify.env.get("DATABASE_URL")!);
}

export async function queryDb(sql: string, params: unknown[] = []): Promise<SqlRow[]> {
  const db = getDb();
  const result = await db.query(sql, params);
  return result as SqlRow[];
}

export async function execDb(sql: string, params: unknown[] = []): Promise<void> {
  const db = getDb();
  await db.query(sql, params);
}
