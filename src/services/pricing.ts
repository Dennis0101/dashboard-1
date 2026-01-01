import { getEnv } from "../env";
import type { CoinSymbol } from "../coins";
import { SUPPORTED_COINS } from "../coins";
import { withClient } from "../db";

type Snapshot = {
  symbol: CoinSymbol;
  fx_usdkrw: bigint; // *100
  overseas_usd: bigint; // *100
  domestic_krw: bigint; // integer
  kimchi_premium_bps: number; // effective bps used in buy_price
  buy_price_krw: bigint; // integer per 1 coin
  sources: any;
};

function parseDecimalToInt100(s: string): bigint {
  // convert "123.45" -> 12345n (2 decimals)
  const m = s.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error("invalid_decimal");
  const whole = m[1]!;
  const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(frac || "0");
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "user-agent": "vercel-remittance-bot/1.0" } });
    if (!res.ok) throw new Error(`fetch_failed:${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchUsdKrwRateInt100(): Promise<{ rateInt100: bigint; source: any }> {
  // primary
  try {
    const j = await fetchJson("https://open.er-api.com/v6/latest/USD");
    const rate = j?.rates?.KRW;
    if (typeof rate === "number" && Number.isFinite(rate)) {
      const rateInt100 = BigInt(Math.round(rate * 100));
      return { rateInt100, source: { fx: "open.er-api.com" } };
    }
  } catch {
    // ignore
  }
  // backup
  const j2 = await fetchJson("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json");
  const rate2 = j2?.usd?.krw;
  if (typeof rate2 === "number" && Number.isFinite(rate2)) {
    const rateInt100 = BigInt(Math.round(rate2 * 100));
    return { rateInt100, source: { fx: "currency-api@latest" } };
  }
  throw new Error("fx_fetch_failed");
}

async function fetchOverseasUsdInt100(symbol: CoinSymbol): Promise<{ priceInt100: bigint; source: any }> {
  // Coinbase for BTC/ETH/LTC is very stable
  if (symbol === "BTC" || symbol === "ETH" || symbol === "LTC") {
    const j = await fetchJson(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
    const amt = j?.data?.amount;
    if (typeof amt === "string") return { priceInt100: parseDecimalToInt100(amt), source: { overseas: "coinbase" } };
    throw new Error("coinbase_parse_failed");
  }
  // Binance as backup for XRP/TRX (USDT assumed ~ USD)
  const binanceSymbol = symbol === "XRP" ? "XRPUSDT" : "TRXUSDT";
  const j2 = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
  const price = j2?.price;
  if (typeof price === "string") return { priceInt100: parseDecimalToInt100(price), source: { overseas: "binance" } };
  throw new Error("binance_parse_failed");
}

async function fetchDomesticKrw(symbols: CoinSymbol[]): Promise<{ prices: Record<string, bigint>; source: any }> {
  const markets = symbols.map((s) => `KRW-${s}`).join(",");
  const j = await fetchJson(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets)}`);
  if (!Array.isArray(j)) throw new Error("upbit_parse_failed");
  const out: Record<string, bigint> = {};
  for (const row of j) {
    const market = row?.market;
    const trade = row?.trade_price;
    if (typeof market === "string" && typeof trade === "number" && Number.isFinite(trade)) {
      const sym = market.replace("KRW-", "");
      out[sym] = BigInt(Math.round(trade));
    }
  }
  return { prices: out, source: { domestic: "upbit" } };
}

function computeMarketKimchiBps(domesticKrw: bigint, overseasUsdInt100: bigint, fxInt100: bigint): number {
  // overseas_krw = overseasUsd*fx / 10000 (both have 2 decimals)
  const overseasKrw = (overseasUsdInt100 * fxInt100) / 10000n;
  if (overseasKrw <= 0n) return 0;
  const diff = domesticKrw - overseasKrw;
  // bps = diff/overseas * 10000
  const bps = Number((diff * 10000n) / overseasKrw);
  // clamp a bit to avoid wild values in outages
  if (!Number.isFinite(bps)) return 0;
  return Math.max(-5000, Math.min(5000, bps)); // -50%..+50%
}

function computeBuyPriceKrw(overseasUsdInt100: bigint, fxInt100: bigint, effectiveBps: number, operatorFeeKrw: bigint): bigint {
  const overseasKrw = (overseasUsdInt100 * fxInt100) / 10000n;
  const bps = BigInt(effectiveBps);
  const price = (overseasKrw * (10000n + bps)) / 10000n + operatorFeeKrw;
  return price > 0n ? price : 0n;
}

export async function refreshPriceSnapshots(): Promise<{ ok: true; updated: number; usedFallback: boolean; errors: any[] }> {
  const env = getEnv();
  const errors: any[] = [];
  let usedFallback = false;

  let fxInt100: bigint;
  let fxSource: any;
  try {
    const fx = await fetchUsdKrwRateInt100();
    fxInt100 = fx.rateInt100;
    fxSource = fx.source;
  } catch (e: any) {
    // fallback to last snapshot's fx if exists
    usedFallback = true;
    const last = await getLatestPriceSnapshots();
    const anySnap = last[0];
    if (!anySnap) throw e;
    fxInt100 = anySnap.fx_usdkrw;
    fxSource = { fx: "db_fallback" };
    errors.push({ fx: String(e?.message ?? e) });
  }

  let domestic: Record<string, bigint> = {};
  let domesticSource: any = {};
  try {
    const d = await fetchDomesticKrw(SUPPORTED_COINS);
    domestic = d.prices;
    domesticSource = d.source;
  } catch (e: any) {
    usedFallback = true;
    errors.push({ domestic: String(e?.message ?? e) });
  }

  const operatorFeeKrw = BigInt(env.OPERATOR_FEE_KRW);
  const operatorPremiumBps = env.KIMCHI_PREMIUM_BPS;

  const snapshots: Snapshot[] = [];
  for (const symbol of SUPPORTED_COINS) {
    try {
      const o = await fetchOverseasUsdInt100(symbol);
      const domesticKrw = domestic[symbol];
      if (!domesticKrw) throw new Error("missing_domestic_price");
      const marketBps = computeMarketKimchiBps(domesticKrw, o.priceInt100, fxInt100);
      const effectiveBps = marketBps + operatorPremiumBps;
      const buy = computeBuyPriceKrw(o.priceInt100, fxInt100, effectiveBps, operatorFeeKrw);
      snapshots.push({
        symbol,
        fx_usdkrw: fxInt100,
        overseas_usd: o.priceInt100,
        domestic_krw: domesticKrw,
        kimchi_premium_bps: effectiveBps,
        buy_price_krw: buy,
        sources: { ...fxSource, ...domesticSource, ...o.source, market_kimchi_bps: marketBps, operator_bps: operatorPremiumBps }
      });
    } catch (e: any) {
      usedFallback = true;
      errors.push({ symbol, error: String(e?.message ?? e) });
    }
  }

  const updated = await withClient(async (client) => {
    if (snapshots.length === 0) return 0;
    const values: any[] = [];
    const rowsSql: string[] = [];
    let i = 1;
    for (const s of snapshots) {
      rowsSql.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb, now())`
      );
      values.push(
        s.symbol,
        s.fx_usdkrw.toString(),
        s.overseas_usd.toString(),
        s.domestic_krw.toString(),
        s.kimchi_premium_bps,
        s.buy_price_krw.toString(),
        JSON.stringify(s.sources)
      );
    }
    const q = `INSERT INTO price_snapshots(symbol, fx_usdkrw, overseas_usd, domestic_krw, kimchi_premium_bps, buy_price_krw, sources, fetched_at)
      VALUES ${rowsSql.join(",")}`;
    const r = await client.query(q, values);
    return r.rowCount ?? 0;
  });

  return { ok: true, updated, usedFallback, errors };
}

export async function getLatestPriceSnapshots(): Promise<
  Array<{
    symbol: CoinSymbol;
    fx_usdkrw: bigint;
    overseas_usd: bigint;
    domestic_krw: bigint;
    kimchi_premium_bps: number;
    buy_price_krw: bigint;
    fetched_at: string;
  }>
> {
  return await withClient(async (client) => {
    const r = await client.query<{
      symbol: CoinSymbol;
      fx_usdkrw: string;
      overseas_usd: string;
      domestic_krw: string;
      kimchi_premium_bps: number;
      buy_price_krw: string;
      fetched_at: string;
    }>(
      `
      SELECT DISTINCT ON (symbol)
        symbol, fx_usdkrw, overseas_usd, domestic_krw, kimchi_premium_bps, buy_price_krw, fetched_at
      FROM price_snapshots
      ORDER BY symbol, fetched_at DESC
      `
    );
    return r.rows.map((x) => ({
      symbol: x.symbol,
      fx_usdkrw: BigInt(x.fx_usdkrw),
      overseas_usd: BigInt(x.overseas_usd),
      domestic_krw: BigInt(x.domestic_krw),
      kimchi_premium_bps: x.kimchi_premium_bps,
      buy_price_krw: BigInt(x.buy_price_krw),
      fetched_at: x.fetched_at
    }));
  });
}

