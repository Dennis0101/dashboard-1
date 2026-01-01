import { createHash } from "node:crypto";
import { withClient } from "../db";
import { randomCode } from "../crypto";

export function computeIdempotencyKey(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(s).digest("hex");
}

export async function createDepositIntent(discordUserId: string): Promise<{ depositCode: string; expiresAt: string }> {
  return await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const u = await client.query<{ id: string }>("SELECT id FROM users WHERE discord_user_id=$1", [discordUserId]);
      let userId: string;
      if (u.rowCount === 1) {
        userId = u.rows[0]!.id;
      } else {
        const created = await client.query<{ id: string }>(
          "INSERT INTO users(discord_user_id) VALUES($1) RETURNING id",
          [discordUserId]
        );
        userId = created.rows[0]!.id;
        await client.query("INSERT INTO user_balances(user_id, balance_krw) VALUES($1, 0) ON CONFLICT DO NOTHING", [
          userId
        ]);
      }

      // best-effort: expire old open intents
      await client.query("UPDATE deposit_intents SET status='expired' WHERE user_id=$1 AND status='open' AND expires_at < now()", [
        userId
      ]);

      let depositCode = "";
      let expiresAt = "";
      for (let i = 0; i < 5; i++) {
        depositCode = `D-${randomCode(10)}`;
        const r = await client.query<{ deposit_code: string; expires_at: string }>(
          "INSERT INTO deposit_intents(user_id, deposit_code) VALUES($1, $2) ON CONFLICT (deposit_code) DO NOTHING RETURNING deposit_code, expires_at",
          [userId, depositCode]
        );
        if (r.rowCount === 1) {
          expiresAt = r.rows[0]!.expires_at;
          break;
        }
      }
      if (!expiresAt) throw new Error("failed_to_generate_deposit_code");

      await client.query("COMMIT");
      return { depositCode, expiresAt };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

export async function applyIosDeposit(params: {
  idempotencyKey: string;
  deviceId: string;
  bankName?: string;
  depositorName?: string;
  depositCode?: string;
  amountKrw: bigint;
  occurredAtIso: string;
  raw: unknown;
}): Promise<{ credited: boolean; reason?: string; discordUserId?: string; amountKrw: bigint }> {
  return await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      // Insert event for dedupe inside txn
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO ios_deposit_events(idempotency_key, device_id, bank_name, depositor_name, deposit_code, amount_krw, occurred_at, raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
        [
          params.idempotencyKey,
          params.deviceId,
          params.bankName ?? null,
          params.depositorName ?? null,
          params.depositCode ?? null,
          params.amountKrw.toString(),
          params.occurredAtIso,
          JSON.stringify(params.raw ?? {})
        ]
      );
      if (inserted.rowCount !== 1) {
        await client.query("COMMIT");
        return { credited: false, reason: "duplicate", amountKrw: params.amountKrw };
      }

      if (!params.depositCode) {
        await client.query("COMMIT");
        return { credited: false, reason: "missing_deposit_code", amountKrw: params.amountKrw };
      }

      // lock intent
      const intent = await client.query<{ id: string; user_id: string; status: string; expires_at: string }>(
        "SELECT id, user_id, status, expires_at FROM deposit_intents WHERE deposit_code=$1 FOR UPDATE",
        [params.depositCode]
      );
      if (intent.rowCount !== 1) {
        await client.query("COMMIT");
        return { credited: false, reason: "unknown_deposit_code", amountKrw: params.amountKrw };
      }
      const row = intent.rows[0]!;
      if (row.status !== "open") {
        await client.query("COMMIT");
        return { credited: false, reason: "deposit_code_not_open", amountKrw: params.amountKrw };
      }

      // expire check
      const exp = new Date(row.expires_at).getTime();
      if (Number.isFinite(exp) && exp < Date.now()) {
        await client.query("UPDATE deposit_intents SET status='expired' WHERE id=$1", [row.id]);
        await client.query("COMMIT");
        return { credited: false, reason: "deposit_code_expired", amountKrw: params.amountKrw };
      }

      const u = await client.query<{ discord_user_id: string }>("SELECT discord_user_id FROM users WHERE id=$1", [row.user_id]);
      const discordUserId = u.rowCount === 1 ? u.rows[0]!.discord_user_id : undefined;

      // credit balance
      await client.query(
        "INSERT INTO user_balances(user_id, balance_krw) VALUES($1, 0) ON CONFLICT (user_id) DO NOTHING",
        [row.user_id]
      );
      await client.query("UPDATE user_balances SET balance_krw = balance_krw + $2, updated_at=now() WHERE user_id=$1", [
        row.user_id,
        params.amountKrw.toString()
      ]);
      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1,'deposit',$2,'ios_deposit_event',$3,$4)",
        [
          row.user_id,
          params.amountKrw.toString(),
          params.idempotencyKey,
          JSON.stringify({
            device_id: params.deviceId,
            deposit_code: params.depositCode,
            depositor_name: params.depositorName ?? null,
            bank_name: params.bankName ?? null
          })
        ]
      );
      await client.query("UPDATE deposit_intents SET status='used' WHERE id=$1", [row.id]);

      await client.query("COMMIT");
      return { credited: true, discordUserId, amountKrw: params.amountKrw };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

