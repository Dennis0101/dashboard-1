import type { IncomingMessage, ServerResponse } from "node:http";
import { getEnv } from "../../../src/env";
import { json, methodNotAllowed } from "../../../src/http";
import { computeAndStoreInventoryValuation, ensureInventorySeed } from "../../../src/services/inventory";

function isAuthorizedCron(req: IncomingMessage & { headers: any; url?: string }): boolean {
  if (req.headers["x-vercel-cron"]) return true;
  const env = getEnv();
  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams.get("secret") === env.ADMIN_CRON_SECRET;
}

export default async function handler(req: IncomingMessage & { headers: any; url?: string }, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
  if (!isAuthorizedCron(req)) return json(res, 401, { ok: false, error: "unauthorized" });

  await ensureInventorySeed();
  const result = await computeAndStoreInventoryValuation();
  return json(res, 200, { ok: true, total_krw: result.totalKrw.toString(), per_symbol: result.perSymbol });
}

