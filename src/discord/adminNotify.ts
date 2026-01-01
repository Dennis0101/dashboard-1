import { getEnv } from "../env";

export async function notifyAdmin(message: string): Promise<void> {
  const env = getEnv();
  const url = env.DISCORD_ADMIN_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch {
    // best-effort: ignore
  }
}

