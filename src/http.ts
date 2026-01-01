import type { IncomingMessage } from "node:http";

export async function readRawBody(req: IncomingMessage, limitBytes = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", (err) => reject(err));
  });
  return Buffer.concat(chunks);
}

export function json(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export function methodNotAllowed(res: any, allowed: string[]) {
  res.statusCode = 405;
  res.setHeader("allow", allowed.join(", "));
  res.end("Method Not Allowed");
}

