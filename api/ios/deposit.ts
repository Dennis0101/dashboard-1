import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getAllowedDeviceIds, getEnv } from "../../src/env";
import { json, methodNotAllowed, readRawBody } from "../../src/http";
import { hmacHex, safeEqualHex } from "../../src/crypto";
import { assertIntSafeKrw } from "../../src/money";
import { applyIosDeposit, computeIdempotencyKey } from "../../src/services/deposits";

const BodySchema = z.object({
  device_id: z.string().min(1),
  timestamp_ms: z.coerce.number().int().positive(),
  amount_krw: z.union([z.string(), z.number()]),
  depositor_name: z.string().optional(),
  bank_name: z.string().optional(),
  deposit_code: z.string().optional(),
  notification_text: z.string().optional(),

  // Either header `x-ios-signature` or this field.
  signature: z.string().optional()
});

function canonicalMessage(input: {
  timestampMs: number;
  deviceId: string;
  amountKrw: bigint;
  depositCode?: string;
  depositorName?: string;
}): string {
  return [
    "v1",
    String(input.timestampMs),
    input.deviceId,
    input.amountKrw.toString(),
    input.depositCode ?? "",
    input.depositorName ?? ""
  ].join(":");
}

export default async function handler(req: IncomingMessage & { headers: any }, res: ServerResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const env = getEnv();
  const raw = await readRawBody(req, 256 * 1024);
  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(res, 400, { ok: false, error: "invalid_json" });
  }

  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) return json(res, 400, { ok: false, error: "invalid_body", details: parsed.error.flatten() });

  const b = parsed.data;
  const amountKrw = assertIntSafeKrw(b.amount_krw);
  if (amountKrw <= 0n) return json(res, 400, { ok: false, error: "amount_must_be_positive" });
  if (amountKrw > 10_000_000_000n) return json(res, 400, { ok: false, error: "amount_too_large" });

  const allowed = getAllowedDeviceIds();
  if (allowed.length > 0 && !allowed.includes(b.device_id)) {
    return json(res, 401, { ok: false, error: "device_not_allowed" });
  }

  const maxSkew = env.IOS_MAX_SKEW_MS ?? 120_000;
  const now = Date.now();
  if (Math.abs(now - b.timestamp_ms) > maxSkew) {
    return json(res, 401, { ok: false, error: "timestamp_out_of_range" });
  }

  const sigHeader = (req.headers["x-ios-signature"] ?? req.headers["X-IOS-Signature"]) as string | undefined;
  const signature = (sigHeader || b.signature || "").trim();
  if (!signature) return json(res, 401, { ok: false, error: "missing_signature" });

  const msg = canonicalMessage({
    timestampMs: b.timestamp_ms,
    deviceId: b.device_id,
    amountKrw,
    depositCode: b.deposit_code,
    depositorName: b.depositor_name
  });
  const expected = hmacHex(env.IOS_WEBHOOK_SECRET, msg);
  if (!safeEqualHex(expected, signature)) {
    return json(res, 401, { ok: false, error: "invalid_signature" });
  }

  const idempotencyKey = computeIdempotencyKey({
    device_id: b.device_id,
    timestamp_ms: b.timestamp_ms,
    amount_krw: amountKrw.toString(),
    deposit_code: b.deposit_code ?? "",
    depositor_name: b.depositor_name ?? ""
  });

  const occurredAtIso = new Date(b.timestamp_ms).toISOString();
  const result = await applyIosDeposit({
    idempotencyKey,
    deviceId: b.device_id,
    bankName: b.bank_name,
    depositorName: b.depositor_name,
    depositCode: b.deposit_code,
    amountKrw,
    occurredAtIso,
    raw: { ...b, notification_text: b.notification_text ?? null }
  });

  return json(res, 200, {
    ok: true,
    credited: result.credited,
    reason: result.reason ?? null,
    amount_krw: amountKrw.toString()
  });
}

