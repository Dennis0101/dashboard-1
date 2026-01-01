export type CoinSymbol = "BTC" | "ETH" | "LTC" | "XRP" | "TRX";

export const SUPPORTED_COINS: CoinSymbol[] = ["BTC", "ETH", "LTC", "XRP", "TRX"];

export const COIN_SCALE: Record<CoinSymbol, number> = {
  BTC: 8,
  ETH: 18,
  LTC: 8,
  XRP: 6,
  TRX: 6
};

export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > 30) {
    // for our scales (<=18) safe
    throw new Error("invalid pow10 exponent");
  }
  return 10n ** BigInt(n);
}

