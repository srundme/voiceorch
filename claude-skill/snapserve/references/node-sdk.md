# Node.js / TypeScript SDK

```bash
npm install @snapserveai/sdk
```

```ts
import { SnapServe } from "@snapserveai/sdk";

const snapserve = new SnapServe({ apiKey: process.env.SNAPSERVE_API_KEY! });

const agents = await snapserve.agents.list();
const call = await snapserve.calls.createOutbound({ agentId: agents[0].id, toNumber: "+15551234567" });
const stats = await snapserve.analytics.dashboard();

// Anything not wrapped yet:
await snapserve.request("GET", "/campaigns");
```

Resource namespaces: `agents`, `calls`, `providers`, `phoneNumbers`, `analytics`,
`webhookEndpoints`, `wallet`, `account`, `scheduling`. Errors throw `SnapServeApiError`
(`.status`, `.body`).
