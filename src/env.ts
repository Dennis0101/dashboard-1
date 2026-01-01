import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),

  IOS_WEBHOOK_SECRET: z.string().min(16),
  IOS_ALLOWED_DEVICE_IDS: z.string().optional(),
  IOS_MAX_SKEW_MS: z.coerce.number().int().positive().optional(),

  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_ADMIN_WEBHOOK_URL: z.string().url().optional(),

  ADMIN_CRON_SECRET: z.string().min(16),
  DISCORD_ADMIN_ROLE_IDS: z.string().optional(),

  OPERATOR_FEE_KRW: z.coerce.number().int().nonnegative().default(0),
  KIMCHI_PREMIUM_BPS: z.coerce.number().int().nonnegative().default(0),

  TRANSFER_PROVIDER: z.enum(["mock", "provider"]).default("mock")
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}

export function getAdminRoleIds(): string[] {
  const env = getEnv();
  const raw = env.DISCORD_ADMIN_ROLE_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAllowedDeviceIds(): string[] {
  const env = getEnv();
  const raw = env.IOS_ALLOWED_DEVICE_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

