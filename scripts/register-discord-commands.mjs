import process from "node:process";

const {
  DISCORD_APPLICATION_ID,
  DISCORD_BOT_TOKEN
} = process.env;

if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) {
  console.error("Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN");
  process.exit(1);
}

const commands = [
  { name: "충전", description: "입금용 식별코드 생성" },
  { name: "잔액", description: "내 잔액(원화/보유코인) 조회" },
  { name: "시세", description: "캐시된 시세/김프/구매가 조회" },
  { name: "재고", description: "판매 가능 여부/재고 상태 조회" },
  {
    name: "코인구매",
    description: "원화 잔액으로 코인을 구매(재고 차감)",
    options: [
      {
        type: 3,
        name: "코인",
        description: "BTC/ETH/LTC/XRP/TRX",
        required: true,
        choices: ["BTC", "ETH", "LTC", "XRP", "TRX"].map((v) => ({ name: v, value: v }))
      },
      {
        type: 4,
        name: "원화",
        description: "구매할 금액(정수, KRW)",
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: "송금",
    description: "보유 코인을 지정 주소로 송금(큐)",
    options: [
      {
        type: 3,
        name: "코인",
        description: "BTC/ETH/LTC/XRP/TRX",
        required: true,
        choices: ["BTC", "ETH", "LTC", "XRP", "TRX"].map((v) => ({ name: v, value: v }))
      },
      {
        type: 3,
        name: "주소",
        description: "받는 주소",
        required: true
      },
      {
        type: 3,
        name: "수량_atomic",
        description: "송금 수량(atomic 정수, 예: BTC satoshi)",
        required: true
      }
    ]
  }
];

const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: {
    authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(commands)
});

const text = await res.text();
if (!res.ok) {
  console.error("Failed:", res.status, text);
  process.exit(1);
}

console.log("Registered commands:", text);

