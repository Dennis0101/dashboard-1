import { withClient } from "../db";
import type { CoinSymbol } from "../coins";
import { COIN_SCALE, SUPPORTED_COINS, pow10 } from "../coins";
import { getLatestPriceSnapshots } from "./pricing";

export async function getInventory(): Promise<
  Array<{ symbol: CoinSymbol; atomic_balance: bigint; atomic_scale: number; is_enabled: boolean; updated_at: string }>
> {
  return await withClient(async (client) => {
    const r = await client.query<{
      symbol: CoinSymbol;
      atomic_balance: string;
      atomic_scale: number;
      is_enabled: boolean;
      updated_at: string;
    }>("SELECT symbol, atomic_balance::text AS atomic_balance, atomic_scale, is_enabled, updated_at FROM inventory ORDER BY symbol ASC");
    return r.rows.map((x) => ({
      symbol: x.symbol,
      atomic_balance: BigInt(x.atomic_balance),
      atomic_scale: x.atomic_scale,
      is_enabled: x.is_enabled,
      updated_at: x.updated_at
    }));
  });
}

export async function computeAndStoreInventoryValuation(): Promise<{
  totalKrw: bigint;
  perSymbol: Record<string, { atomic_balance: string; value_krw: string; buy_price_krw: string }>;
}> {
  const snaps = await getLatestPriceSnapshots();
  const snapBy: Record<string, { buy_price_krw: bigint }> = {};
  for (const s of snaps) snapBy[s.symbol] = { buy_price_krw: s.buy_price_krw };

  const inv = await getInventory();
  const perSymbol: Record<string, { atomic_balance: string; value_krw: string; buy_price_krw: string }> = {};
  let total = 0n;
  for (const row of inv) {
    const buy = snapBy[row.symbol]?.buy_price_krw ?? 0n;
    const scale = row.atomic_scale ?? COIN_SCALE[row.symbol];
    const denom = pow10(scale);
    const value = denom > 0n ? (row.atomic_balance * buy) / denom : 0n;
    perSymbol[row.symbol] = {
      atomic_balance: row.atomic_balance.toString(),
      value_krw: value.toString(),
      buy_price_krw: buy.toString()
    };
    total += value;
  }

  await withClient(async (client) => {
    await client.query("INSERT INTO inventory_valuation(total_krw, per_symbol) VALUES($1, $2::jsonb)", [
      total.toString(),
      JSON.stringify(perSymbol)
    ]);
  });

  return { totalKrw: total, perSymbol };
}

export async function ensureInventorySeed(): Promise<void> {
  await withClient(async (client) => {
    for (const sym of SUPPORTED_COINS) {
      await client.query(
        "INSERT INTO inventory(symbol, atomic_balance, atomic_scale, is_enabled) VALUES($1, 0, $2, true) ON CONFLICT (symbol) DO NOTHING",
        [sym, COIN_SCALE[sym]]
      );
    }
  });
}

