# Vercel Crypto Remittance System (Serverless + Cron + Discord Interactions)

Vercel 환경에서 **항상 실행되는 데몬 없이**(VPS/PM2 금지) 운영 가능한 형태로 구성된 예제입니다.

## 구성 요소

- **Vercel Serverless Functions (`/api`)**
  - iOS 단축어 입금 인식 Webhook → 잔액 충전
  - 시세/환율/김프 캐시 조회
  - Discord Interactions(Webhook) 처리 (Slash Command / Button 등)
- **Vercel Cron (`vercel.json`)**
  - 시세/환율/김프 주기 캐싱
  - 재고 평가액 주기 업데이트
  - 송금(큐) 처리
- **DB**
  - Vercel Postgres 또는 외부 Postgres (`DATABASE_URL`)

## 빠른 시작

1) 환경변수 설정

- 로컬: `.env.example` → `.env.local`
- Vercel: Project Settings → Environment Variables에 동일 키 추가

2) 의존성 설치

```bash
npm i
```

3) DB 스키마 생성

- 권장: `db/schema.sql` 를 Postgres에 적용
- 또는: 보호된 setup API 호출

```bash
curl -X POST "http://localhost:3000/api/admin/setup?secret=ADMIN_CRON_SECRET"
```

4) Discord Slash Command 등록

```bash
npm run discord:register
```

5) 개발 실행

```bash
npm run dev
```

## 주요 엔드포인트

- `POST /api/ios/deposit` : iOS 단축어가 입금 이벤트 전송
- `GET  /api/prices` : 캐시된 시세/김프/사용자 구매가 조회
- `POST /api/discord/interactions` : Discord Interactions Webhook

## 보안 주의

- `DISCORD_PUBLIC_KEY`, `IOS_WEBHOOK_SECRET`, `ADMIN_CRON_SECRET` 등은 **반드시 Vercel Environment Variables**로만 관리하세요.
- 지갑 private key는 코드/DB에 넣지 않습니다. 실운영은 **외부 custody/지갑 제공자 API** 연동으로 처리하세요(예제는 `mock` 송금 제공자 포함).

