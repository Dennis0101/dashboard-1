import { withClient } from "../db";

export async function getOrCreateUserByDiscordId(discordUserId: string): Promise<{ userId: string }> {
  return await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE discord_user_id = $1",
        [discordUserId]
      );
      if (existing.rowCount === 1) {
        await client.query("COMMIT");
        return { userId: existing.rows[0]!.id };
      }

      const created = await client.query<{ id: string }>(
        "INSERT INTO users(discord_user_id) VALUES($1) RETURNING id",
        [discordUserId]
      );
      const userId = created.rows[0]!.id;
      await client.query("INSERT INTO user_balances(user_id, balance_krw) VALUES($1, 0) ON CONFLICT DO NOTHING", [
        userId
      ]);
      await client.query("COMMIT");
      return { userId };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

export async function getUserBalanceKrw(discordUserId: string): Promise<bigint> {
  const { userId } = await getOrCreateUserByDiscordId(discordUserId);
  return await withClient(async (client) => {
    const r = await client.query<{ balance_krw: string }>("SELECT balance_krw FROM user_balances WHERE user_id = $1", [
      userId
    ]);
    if (r.rowCount !== 1) return 0n;
    return BigInt(r.rows[0]!.balance_krw);
  });
}

