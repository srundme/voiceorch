# @snapserveai/sdk

Official Node.js / TypeScript SDK for the [SnapServe](https://snapserve.ai) AI voice agent API.

## Install

```bash
npm install @snapserveai/sdk
```

## Usage

Create an API key from **Dashboard → API Keys** (`sk_live_...`). Default base URL is `https://app.snapserve.ai/api` (not `api.snapserve.ai`). Then:

```ts
import { SnapServe } from "@snapserveai/sdk";

const snapserve = new SnapServe({ apiKey: process.env.SNAPSERVE_API_KEY! });

const agents = await snapserve.agents.list();

const call = await snapserve.calls.createOutbound({
  agentId: agents[0].id,
  toNumber: "+15551234567",
});

const stats = await snapserve.analytics.dashboard();
```

## Resources

- `snapserve.agents` — list / get / create / update / delete / toggle
- `snapserve.calls` — list / get / create / createOutbound / transfer / end / setDisposition
- `snapserve.providers` — list / create / update / delete (your ASR/LLM/TTS/telephony keys)
- `snapserve.phoneNumbers` — list / assign / release
- `snapserve.analytics` — dashboard / recentCalls / callsByStatus / dailyCallVolume / agentStats
- `snapserve.webhookEndpoints` — list / create / update / delete
- `snapserve.wallet` — get / transactions
- `snapserve.account` — get
- `snapserve.scheduling` — listCalendars / listEventTypes / listBookings / publicSlots / publicCreateBooking

Any endpoint without a typed helper is reachable directly:

```ts
await snapserve.request("GET", "/campaigns");
```

## Errors

Failed requests throw `SnapServeApiError` with `.status` and `.body`.

```ts
import { SnapServeApiError } from "@snapserveai/sdk";

try {
  await snapserve.agents.get(999999);
} catch (err) {
  if (err instanceof SnapServeApiError) {
    console.error(err.status, err.message);
  }
}
```
