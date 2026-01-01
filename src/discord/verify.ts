import nacl from "tweetnacl";
import { Buffer } from "node:buffer";

export function verifyDiscordRequest(params: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  rawBody: Buffer;
}): boolean {
  try {
    const sig = Buffer.from(params.signatureHex, "hex");
    const pk = Buffer.from(params.publicKeyHex, "hex");
    const msg = Buffer.concat([Buffer.from(params.timestamp), params.rawBody]);
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

