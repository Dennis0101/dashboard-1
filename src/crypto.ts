import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function randomCode(length = 10): string {
  const bytes = randomBytes(Math.ceil(length));
  return bytes.toString("base64url").slice(0, length).toUpperCase();
}

