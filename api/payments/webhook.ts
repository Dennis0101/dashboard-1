import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getEnv } from "../../src/env";
import { json, methodNotAllowed, readRawBody } from "../../src/http";
import { hmacHex, safeEqualHex } from "../../src/crypto";
import { withClient } from "../../src/db";

const BodySchema = z.object({
  provider: z.string().min(1),
  idempotency_key: z.string().min(8),
  discord_user_id: z.string().min(1),
  amount_krw: z.union([z.string(), z.number()]),
  signature: z.string().optional()
});

// NOTE: 실운영에서는 결제사별 서명 규격으로 교체하세요.
function canonical(provider: string, idempotencyKey: string, discordUserId: string, amountKrw: string): string {
  return ["v1", provider, idempotencyKey, discordUserId, amountKrw].join(":");
}

export default async function handler(req: IncomingMessage & { headers: any }, res: ServerResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const env = getEnv();

  const raw = await readRawBody(req, 256 * 1024);
  let body: any;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(res, 400, { ok: false, error: "invalid_json" });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json(res, 400, { ok: false, error: "invalid_body" });

  const b = parsed.data;
  const amountKrw = BigInt(String(b.amount_krw));
  if (amountKrw <= 0n) return json(res, 400, { ok: false, error: "amount_must_be_positive" });

  // Use ADMIN_CRON_SECRET as a placeholder shared secret (replace with provider secret per gateway)
  const signature = String(req.headers["x-payment-signature"] ?? b.signature ?? "");
  const expected = hmacHex(env.ADMIN_CRON_SECRET, canonical(b.provider, b.idempotency_key, b.discord_user_id, amountKrw.toString()));
  if (!signature || !safeEqualHex(expected, signature)) return json(res, 401, { ok: false, error: "invalid_signature" });

  const credited = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const ins = await client.query(
        "INSERT INTO payment_events(provider, idempotency_key, amount_krw, discord_user_id, raw) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT (idempotency_key) DO NOTHING",
        [b.provider, b.idempotency_key, amountKrw.toString(), b.discord_user_id, JSON.stringify(body)]
      );
      if (ins.rowCount !== 1) {
        await client.query("COMMIT");
        return false;
      }
      const u = await client.query<{ id: string }>("SELECT id FROM users WHERE discord_user_id=$1", [b.discord_user_id]);
      let userId: string;
      if (u.rowCount === 1) {
        userId = u.rows[0]!.id;
      } else {
        const created = await client.query<{ id: string }>(
          "INSERT INTO users(discord_user_id) VALUES($1) RETURNING id",
          [b.discord_user_id]
        );
        userId = created.rows[0]!.id;
        await client.query("INSERT INTO user_balances(user_id, balance_krw) VALUES($1, 0) ON CONFLICT DO NOTHING", [
          userId
        ]);
      }
      await client.query("UPDATE user_balances SET balance_krw = balance_krw + $2, updated_at=now() WHERE user_id=$1", [
        userId,
        amountKrw.toString()
      ]);
      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1,'deposit',$2,'payment_event',$3,$4)",
        [userId, amountKrw.toString(), b.idempotency_key, JSON.stringify({ provider: b.provider })]
      );
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });

  return json(res, 200, { ok: true, credited });
}

