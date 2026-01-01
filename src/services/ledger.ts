import { withClient } from "../db";

export async function creditKrw(params: {
  userId: string;
  amountKrw: bigint;
  refType: string;
  refId: string;
  meta?: unknown;
}): Promise<void> {
  const amount = params.amountKrw;
  if (amount <= 0n) throw new Error("credit must be positive");

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "UPDATE user_balances SET balance_krw = balance_krw + $2, updated_at = now() WHERE user_id = $1",
        [params.userId, amount.toString()]
      );
      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1, $2, $3, $4, $5, $6)",
        [params.userId, "deposit", amount.toString(), params.refType, params.refId, JSON.stringify(params.meta ?? {})]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

export async function debitKrw(params: {
  userId: string;
  amountKrw: bigint;
  type: "purchase" | "transfer_fee" | "transfer" | "admin_adjust";
  refType: string;
  refId: string;
  meta?: unknown;
}): Promise<void> {
  const amount = params.amountKrw;
  if (amount <= 0n) throw new Error("debit must be positive");

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      // lock balance row
      const b = await client.query<{ balance_krw: string }>(
        "SELECT balance_krw FROM user_balances WHERE user_id = $1 FOR UPDATE",
        [params.userId]
      );
      const cur = b.rowCount ? BigInt(b.rows[0]!.balance_krw) : 0n;
      if (cur < amount) throw new Error("insufficient_krw_balance");

      await client.query(
        "UPDATE user_balances SET balance_krw = balance_krw - $2, updated_at = now() WHERE user_id = $1",
        [params.userId, amount.toString()]
      );
      await client.query(
        "INSERT INTO ledger_entries(user_id, type, amount_krw, ref_type, ref_id, meta) VALUES($1, $2, $3, $4, $5, $6)",
        [params.userId, params.type, (-amount).toString(), params.refType, params.refId, JSON.stringify(params.meta ?? {})]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

