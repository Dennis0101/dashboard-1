import { randomBytes } from "node:crypto";
import type { CoinSymbol } from "../coins";
import { withClient } from "../db";
import { getEnv } from "../env";

const DEFAULT_TRANSFER_FEE_KRW = 1000n; // 예제용(운영에서는 체인별/정책별로 별도 관리 권장)

export async function createTransferRequest(params: {
  discordUserId: string;
  symbol: CoinSymbol;
  toAddress: string;
  atomicAmount: bigint;
}): Promise<
  | { ok: true; id: string; feeKrw: bigint; atomicAmount: bigint }
  | { ok: false; error: string; reason?: string }
> {
  if (params.atomicAmount <= 0n) return { ok: false, error: "invalid_amount" };
  if (!params.toAddress || params.toAddress.length < 10) return { ok: false, error: "invalid_address" };

  const env = getEnv();
  const feeKrw = DEFAULT_TRANSFER_FEE_KRW;

  return await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const u = await client.query<{ id: string }>("SELECT id FROM users WHERE discord_user_id=$1", [params.discordUserId]);
      if (u.rowCount !== 1) {
        await client.query("COMMIT");
        return { ok: false as const, error: "user_not_found" };
      }
      const userId = u.rows[0]!.id;

      // lock KRW balance (for fee)
      const b = await client.query<{ balance_krw: string }>(
        "SELECT balance_krw FROM user_balances WHERE user_id=$1 FOR UPDATE",
        [userId]
      );
      const krw = b.rowCount ? BigInt(b.rows[0]!.balance_krw) : 0n;
      if (krw < feeKrw) {
        await client.query("COMMIT");
        return { ok: false as const, error: "insufficient_krw_for_fee" };
      }

      // lock coin balance
      const cb = await client.query<{ atomic_balance: string; atomic_scale: number }>(
        "SELECT atomic_balance::text AS atomic_balance, atomic_scale FROM user_crypto_balances WHERE user_id=$1 AND symbol=$2 FOR UPDATE",
        [userId, params.symbol]
      );
      if (cb.rowCount !== 1) {
        await client.query("COMMIT");
        return { ok: false as const, error: "no_coin_balance" };
      }
      const curAtomic = BigInt(cb.rows[0]!.atomic_balance);
      if (curAtomic < params.atomicAmount) {
        await client.query("COMMIT");
        return { ok: false as const, error: "insufficient_coin_balance" };
      }

      // deduct fee + coin
      await client.query("UPDATE user_balances SET balance_krw = balance_krw - $2, updated_at=now() WHERE user_id=$1", [
        userId,
        feeKrw.toString()
      ]);
      await client.query(
        "UPDATE user_crypto_balances SET atomic_balance = atomic_balance - $3, updated_at=now() WHERE user_id=$1 AND symbol=$2",
        [userId, params.symbol, params.atomicAmount.toString()]
      );

      const tr = await client.query<{ id: string }>(
        "INSERT INTO transfer_requests(user_id, symbol, to_address, atomic_amount, fee_krw, status) VALUES($1,$2,$3,$4,$5,'queued') RETURNING id",
        [userId, params.symbol, params.toAddress, params.atomicAmount.toString(), feeKrw.toString()]
      );

      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1,'transfer_fee',$2,'transfer_request',$3,$4)",
        [userId, (-feeKrw).toString(), tr.rows[0]!.id, JSON.stringify({ symbol: params.symbol, provider: env.TRANSFER_PROVIDER })]
      );

      await client.query("COMMIT");
      return { ok: true as const, id: tr.rows[0]!.id, feeKrw, atomicAmount: params.atomicAmount };
    } catch (e: any) {
      await client.query("ROLLBACK");
      return { ok: false as const, error: "transfer_create_failed", reason: String(e?.message ?? e) };
    }
  });
}

function mockSendTx(): { txHash: string } {
  const hex = randomBytes(16).toString("hex");
  return { txHash: `0xMOCK${hex}` };
}

export async function processQueuedTransfers(limit = 5): Promise<{ processed: number; sent: number; failed: number }> {
  const env = getEnv();
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < limit; i++) {
    const picked = await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const r = await client.query<{ id: string }>(
          `
          SELECT id
          FROM transfer_requests
          WHERE status='queued'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
          `
        );
        if (r.rowCount !== 1) {
          await client.query("COMMIT");
          return null;
        }
        const id = r.rows[0]!.id;
        await client.query("UPDATE transfer_requests SET status='processing', updated_at=now() WHERE id=$1", [id]);
        await client.query("COMMIT");
        return { id };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });

    if (!picked) break;
    processed++;

    try {
      let txHash = "";
      if (env.TRANSFER_PROVIDER === "mock") {
        txHash = mockSendTx().txHash;
      } else {
        throw new Error("provider_not_implemented");
      }

      await withClient(async (client) => {
        await client.query(
          "UPDATE transfer_requests SET status='sent', tx_hash=$2, updated_at=now() WHERE id=$1",
          [picked.id, txHash]
        );
      });
      sent++;
    } catch (e: any) {
      await withClient(async (client) => {
        await client.query(
          "UPDATE transfer_requests SET status='failed', error=$2, updated_at=now() WHERE id=$1",
          [picked.id, String(e?.message ?? e)]
        );
      });
      failed++;
    }
  }

  return { processed, sent, failed };
}

