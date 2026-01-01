import type { IncomingMessage, ServerResponse } from "node:http";
import { json, methodNotAllowed } from "../src/http";
import { getLatestPriceSnapshots } from "../src/services/pricing";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const snaps = await getLatestPriceSnapshots();
  return json(res, 200, {
    ok: true,
    data: snaps.map((s) => ({
      symbol: s.symbol,
      fx_usdkrw_int100: s.fx_usdkrw.toString(),
      overseas_usd_int100: s.overseas_usd.toString(),
      domestic_krw: s.domestic_krw.toString(),
      kimchi_premium_bps: s.kimchi_premium_bps,
      buy_price_krw: s.buy_price_krw.toString(),
      fetched_at: s.fetched_at
    }))
  });
}

