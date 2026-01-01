import type { CoinSymbol } from "../coins";
import { COIN_SCALE, pow10 } from "../coins";
import { withClient } from "../db";
import { getLatestPriceSnapshots } from "./pricing";
import { notifyAdmin } from "../discord/adminNotify";

export async function buyCoinWithKrw(params: {
  discordUserId: string;
  symbol: CoinSymbol;
  spendKrw: bigint;
}): Promise<
  | { ok: true; symbol: CoinSymbol; spendKrw: bigint; buyPriceKrw: bigint; atomicAmount: bigint }
  | { ok: false; error: string; reason?: string }
> {
  if (params.spendKrw <= 0n) return { ok: false, error: "invalid_spend" };

  const snaps = await getLatestPriceSnapshots();
  const snap = snaps.find((s) => s.symbol === params.symbol);
  if (!snap || snap.buy_price_krw <= 0n) return { ok: false, error: "price_unavailable" };

  const buyPriceKrw = snap.buy_price_krw;
  const scale = COIN_SCALE[params.symbol];
  const denom = pow10(scale);
  const atomicAmount = (params.spendKrw * denom) / buyPriceKrw;
  if (atomicAmount <= 0n) return { ok: false, error: "spend_too_small" };

  return await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      // user
      const u = await client.query<{ id: string }>("SELECT id FROM users WHERE discord_user_id=$1", [params.discordUserId]);
      let userId: string;
      if (u.rowCount === 1) {
        userId = u.rows[0]!.id;
      } else {
        const created = await client.query<{ id: string }>(
          "INSERT INTO users(discord_user_id) VALUES($1) RETURNING id",
          [params.discordUserId]
        );
        userId = created.rows[0]!.id;
        await client.query("INSERT INTO user_balances(user_id, balance_krw) VALUES($1, 0) ON CONFLICT DO NOTHING", [
          userId
        ]);
      }

      // lock balance
      const b = await client.query<{ balance_krw: string }>(
        "SELECT balance_krw FROM user_balances WHERE user_id=$1 FOR UPDATE",
        [userId]
      );
      const cur = b.rowCount ? BigInt(b.rows[0]!.balance_krw) : 0n;
      if (cur < params.spendKrw) {
        await client.query("COMMIT");
        return { ok: false as const, error: "insufficient_krw_balance" };
      }

      // lock inventory
      const inv = await client.query<{ atomic_balance: string; atomic_scale: number; is_enabled: boolean }>(
        "SELECT atomic_balance::text AS atomic_balance, atomic_scale, is_enabled FROM inventory WHERE symbol=$1 FOR UPDATE",
        [params.symbol]
      );
      if (inv.rowCount !== 1) {
        await client.query("COMMIT");
        return { ok: false as const, error: "inventory_missing" };
      }
      const invRow = inv.rows[0]!;
      if (!invRow.is_enabled) {
        await client.query("COMMIT");
        return { ok: false as const, error: "inventory_disabled" };
      }
      const invBal = BigInt(invRow.atomic_balance);
      if (invBal < atomicAmount) {
        await client.query("COMMIT");
        await notifyAdmin(`[재고부족] ${params.symbol} atomic=${invBal.toString()} 요청=${atomicAmount.toString()}`);
        return { ok: false as const, error: "inventory_insufficient" };
      }

      // apply updates
      await client.query("UPDATE user_balances SET balance_krw = balance_krw - $2, updated_at=now() WHERE user_id=$1", [
        userId,
        params.spendKrw.toString()
      ]);

      await client.query(
        "UPDATE inventory SET atomic_balance = atomic_balance - $2, updated_at=now() WHERE symbol=$1",
        [params.symbol, atomicAmount.toString()]
      );

      const remaining = invBal - atomicAmount;
      if (remaining <= 0n) {
        await client.query("UPDATE inventory SET is_enabled=false, updated_at=now() WHERE symbol=$1", [params.symbol]);
      }

      await client.query(
        "INSERT INTO user_crypto_balances(user_id, symbol, atomic_balance, atomic_scale) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,symbol) DO UPDATE SET atomic_balance = user_crypto_balances.atomic_balance + EXCLUDED.atomic_balance, updated_at=now()",
        [userId, params.symbol, atomicAmount.toString(), scale]
      );

      const po = await client.query<{ id: string }>(
        "INSERT INTO purchase_orders(user_id, symbol, spend_krw, buy_price_krw, atomic_amount, status) VALUES($1,$2,$3,$4,$5,'filled') RETURNING id",
        [userId, params.symbol, params.spendKrw.toString(), buyPriceKrw.toString(), atomicAmount.toString()]
      );

      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1,'purchase',$2,'purchase_order',$3,$4)",
        [
          userId,
          (-params.spendKrw).toString(),
          po.rows[0]!.id,
          JSON.stringify({
            symbol: params.symbol,
            atomic_amount: atomicAmount.toString(),
            buy_price_krw: buyPriceKrw.toString()
          })
        ]
      );

      await client.query("COMMIT");
      if (invBal - atomicAmount <= 0n) {
        await notifyAdmin(`[판매중단] ${params.symbol} 재고가 0 이하로 떨어져 판매를 중단했습니다.`);
      }
      return { ok: true as const, symbol: params.symbol, spendKrw: params.spendKrw, buyPriceKrw, atomicAmount };
    } catch (e: any) {
      await client.query("ROLLBACK");
      return { ok: false as const, error: "purchase_failed", reason: String(e?.message ?? e) };
    }
  });
}

export async function getUserCryptoBalances(discordUserId: string): Promise<Record<string, { atomic_balance: string; atomic_scale: number }>> {
  return await withClient(async (client) => {
    const u = await client.query<{ id: string }>("SELECT id FROM users WHERE discord_user_id=$1", [discordUserId]);
    if (u.rowCount !== 1) return {};
    const userId = u.rows[0]!.id;
    const r = await client.query<{ symbol: string; atomic_balance: string; atomic_scale: number }>(
      "SELECT symbol, atomic_balance::text AS atomic_balance, atomic_scale FROM user_crypto_balances WHERE user_id=$1 ORDER BY symbol ASC",
      [userId]
    );
    const out: Record<string, { atomic_balance: string; atomic_scale: number }> = {};
    for (const row of r.rows) out[row.symbol] = { atomic_balance: row.atomic_balance, atomic_scale: row.atomic_scale };
    return out;
  });
}

