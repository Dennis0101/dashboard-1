export function assertIntSafeKrw(n: unknown): bigint {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") {
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error("amount_krw must be integer");
    return BigInt(n);
  }
  if (typeof n === "string") {
    if (!/^\d+$/.test(n)) throw new Error("amount_krw must be integer string");
    return BigInt(n);
  }
  throw new Error("amount_krw must be integer");
}

export function clampBigInt(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

