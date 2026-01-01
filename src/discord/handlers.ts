import { getAdminRoleIds, getEnv } from "../env";
import { formatKrw } from "./format";
import { ephemeral, publicMsg, type InteractionResponse, InteractionResponseType, MessageFlags } from "./types";
import { getOptionValue } from "./options";
import { createDepositIntent } from "../services/deposits";
import { getUserBalanceKrw } from "../services/users";
import { getLatestPriceSnapshots } from "../services/pricing";
import { getInventory } from "../services/inventory";
import { buyCoinWithKrw, getUserCryptoBalances } from "../services/trade";
import { createTransferRequest } from "../services/transfers";

function isAdmin(interaction: any): boolean {
  const adminRoleIds = new Set(getAdminRoleIds());
  if (adminRoleIds.size === 0) return false;
  const roles: string[] = interaction?.member?.roles ?? [];
  return roles.some((r) => adminRoleIds.has(r));
}

function discordUserId(interaction: any): string | null {
  return interaction?.member?.user?.id ?? interaction?.user?.id ?? null;
}

export async function handleInteraction(interaction: any): Promise<InteractionResponse> {
  if (interaction?.type === 1) {
    return { type: InteractionResponseType.PONG };
  }

  if (interaction?.type !== 2) {
    return ephemeral("지원하지 않는 인터랙션 타입입니다.");
  }

  const name: string | undefined = interaction?.data?.name;
  const uid = discordUserId(interaction);
  if (!uid) return ephemeral("사용자 정보를 확인할 수 없습니다.");

  if (name === "충전") {
    const intent = await createDepositIntent(uid);
    const env = getEnv();
    const msg = [
      "**입금 메모(식별코드)**",
      `\`${intent.depositCode}\``,
      "",
      "**iOS 단축어 Webhook 서명 규칙(v1)**",
      "`signature = HMAC_SHA256(IOS_WEBHOOK_SECRET, \"v1:timestamp_ms:device_id:amount_krw:deposit_code:depositor_name\")`",
      "",
      "**Webhook 전송 예시(JSON)**",
      "```json\n{\n  \"device_id\": \"iphone-1\",\n  \"timestamp_ms\": 1730000000000,\n  \"amount_krw\": 10000,\n  \"depositor_name\": \"홍길동\",\n  \"bank_name\": \"국민\",\n  \"deposit_code\": \""
        + intent.depositCode +
        "\",\n  \"signature\": \"(위 규칙으로 계산한 hex)\"\n}\n```",
      "",
      `- 만료: ${intent.expiresAt}`,
      `- 운영 수수료(참고): ${formatKrw(BigInt(env.OPERATOR_FEE_KRW))}`
    ].join("\n");
    return ephemeral(msg);
  }

  if (name === "잔액") {
    const krw = await getUserBalanceKrw(uid);
    const coins = await getUserCryptoBalances(uid);
    const coinLines = Object.keys(coins).length
      ? Object.entries(coins)
          .map(([sym, v]) => `- ${sym}: ${v.atomic_balance} (atomic)`)
          .join("\n")
      : "- (보유 코인 없음)";
    return ephemeral([`**KRW 잔액**: ${formatKrw(krw)}`, "", "**보유 코인(atomic)**", coinLines].join("\n"));
  }

  if (name === "시세") {
    const snaps = await getLatestPriceSnapshots();
    if (snaps.length === 0) return ephemeral("시세 캐시가 없습니다. 잠시 후 다시 시도하세요.");
    const lines = snaps
      .map((s) => `- ${s.symbol}: 구매가 ${formatKrw(s.buy_price_krw)} (김프 ${s.kimchi_premium_bps}bps)`)
      .join("\n");
    return publicMsg(["**실시간(캐시) 시세**", lines].join("\n"));
  }

  if (name === "재고") {
    const inv = await getInventory();
    const admin = isAdmin(interaction);
    const lines = inv
      .map((x) =>
        admin
          ? `- ${x.symbol}: enabled=${x.is_enabled} atomic=${x.atomic_balance.toString()}`
          : `- ${x.symbol}: ${x.is_enabled ? "판매중" : "중단"}`
      )
      .join("\n");
    return publicMsg(["**재고 상태**", lines].join("\n"));
  }

  if (name === "코인구매") {
    const symbol = String(getOptionValue(interaction, "코인") ?? "").toUpperCase();
    const spend = getOptionValue(interaction, "원화");
    const spendKrw = BigInt(String(spend ?? "0"));
    if (!["BTC", "ETH", "LTC", "XRP", "TRX"].includes(symbol)) return ephemeral("지원하지 않는 코인입니다.");
    const r = await buyCoinWithKrw({ discordUserId: uid, symbol: symbol as any, spendKrw });
    if (!r.ok) return ephemeral(`구매 실패: ${r.error}${r.reason ? ` (${r.reason})` : ""}`);
    return ephemeral(
      `구매 완료: ${r.symbol}\n- 사용: ${formatKrw(r.spendKrw)}\n- 구매가(1코인): ${formatKrw(
        r.buyPriceKrw
      )}\n- 수량(atomic): ${r.atomicAmount.toString()}`
    );
  }

  if (name === "송금") {
    const symbol = String(getOptionValue(interaction, "코인") ?? "").toUpperCase();
    const to = String(getOptionValue(interaction, "주소") ?? "");
    const atomicStr = String(getOptionValue(interaction, "수량_atomic") ?? "");
    if (!["BTC", "ETH", "LTC", "XRP", "TRX"].includes(symbol)) return ephemeral("지원하지 않는 코인입니다.");
    if (!/^\d+$/.test(atomicStr)) return ephemeral("수량_atomic은 정수(atomic)로 입력하세요.");
    const atomicAmount = BigInt(atomicStr);
    const r = await createTransferRequest({ discordUserId: uid, symbol: symbol as any, toAddress: to, atomicAmount });
    if (!r.ok) return ephemeral(`송금 요청 실패: ${r.error}${r.reason ? ` (${r.reason})` : ""}`);
    return ephemeral(
      `송금 요청 접수: ${symbol}\n- 요청ID: ${r.id}\n- 수량(atomic): ${r.atomicAmount.toString()}\n- 수수료: ${formatKrw(
        r.feeKrw
      )}\n- 처리 상태: queued`
    );
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `알 수 없는 명령: ${name ?? "(unknown)"}`,
      flags: MessageFlags.EPHEMERAL
    }
  };
}

