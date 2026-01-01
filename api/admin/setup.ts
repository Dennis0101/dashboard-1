import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { json, methodNotAllowed } from "../../src/http";
import { getEnv } from "../../src/env";
import { withClient } from "../../src/db";

export default async function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const env = getEnv();
  const url = new URL(req.url ?? "", "http://localhost");
  const secret = url.searchParams.get("secret");
  if (!secret || secret !== env.ADMIN_CRON_SECRET) {
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const sql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  await withClient(async (client) => {
    await client.query(sql);
  });

  return json(res, 200, { ok: true });
}

