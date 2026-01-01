import { Pool, type PoolClient } from "pg";
import { getEnv } from "./env";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const env = getEnv();
  _pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  });
  return _pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

