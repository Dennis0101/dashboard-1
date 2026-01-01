import type { IncomingMessage, ServerResponse } from "node:http";
import { getEnv } from "../../../src/env";
import { json, methodNotAllowed } from "../../../src/http";
import { refreshPriceSnapshots } from "../../../src/services/pricing";

function isAuthorizedCron(req: IncomingMessage & { headers: any; url?: string }): boolean {
  if (req.headers["x-vercel-cron"]) return true;
  const env = getEnv();
  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams.get("secret") === env.ADMIN_CRON_SECRET;
}

export default async function handler(req: IncomingMessage & { headers: any; url?: string }, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
  if (!isAuthorizedCron(req)) return json(res, 401, { ok: false, error: "unauthorized" });

  const result = await refreshPriceSnapshots();
  return json(res, 200, result);
}

