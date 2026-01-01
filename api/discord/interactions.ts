import type { IncomingMessage, ServerResponse } from "node:http";
import { getEnv } from "../../src/env";
import { readRawBody } from "../../src/http";
import { verifyDiscordRequest } from "../../src/discord/verify";
import { handleInteraction } from "../../src/discord/handlers";

export default async function handler(req: IncomingMessage & { headers: any }, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const env = getEnv();
  const raw = await readRawBody(req, 1024 * 1024);

  const signature = String(req.headers["x-signature-ed25519"] ?? "");
  const timestamp = String(req.headers["x-signature-timestamp"] ?? "");
  const ok = verifyDiscordRequest({
    publicKeyHex: env.DISCORD_PUBLIC_KEY,
    signatureHex: signature,
    timestamp,
    rawBody: raw
  });
  if (!ok) {
    res.statusCode = 401;
    res.end("invalid request signature");
    return;
  }

  let interaction: any;
  try {
    interaction = JSON.parse(raw.toString("utf8"));
  } catch {
    res.statusCode = 400;
    res.end("invalid json");
    return;
  }

  const response = await handleInteraction(interaction);
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

