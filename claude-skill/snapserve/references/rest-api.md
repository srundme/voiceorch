# SnapServe REST API — product surface

Base URL: `https://app.snapserve.ai/api`  
Auth: `Authorization: Bearer sk_live_...`

> Prefer MCP named tools. Use `snapserve_api` or raw HTTP for anything below without a wrapper.

## Agents
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/agents` | List / create |
| GET/PATCH/DELETE | `/agents/{id}` | Get / update / delete |
| PATCH | `/agents/{id}/toggle` | Activate |
| GET/POST | `/agents/{id}/versions` | Versions / publish |
| POST | `/agents/{id}/versions/{vid}/restore` | Restore |

## Calls
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/calls` | List |
| GET | `/calls/{id}` | Detail + transcript |
| GET | `/calls/{id}/logs` | Execution log |
| POST | `/calls/outbound` | `{ agentId, toNumber }` |
| PATCH | `/calls/{id}/end` | Hang up |
| POST | `/calls/{id}/transfer` | Transfer |
| GET | `/storage/recordings/{callId}` | Recording |

## Campaigns & website
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/campaigns` | List / create |
| GET/PATCH/DELETE | `/campaigns/{id}` | CRUD (`webhookToken` on get) |
| POST | `/campaigns/{id}/import-leads` | Import |
| GET | `/campaigns/{id}/leads` | Leads |
| GET/POST | `/campaigns/{id}/batches` | Batches |
| POST | `/campaigns/{id}/batches/{bid}/start` | Start dialing |
| **POST** | **`/webhooks/lead/{token}`** | **Public website intake (no API key)** |

## Journeys
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/journeys/presets` | Presets |
| GET/POST | `/journeys` | List / create |
| POST | `/journeys/{id}/apply-preset` | Apply |
| POST | `/journeys/{id}/activate` | Go live |
| POST | `/journeys/{id}/pause` | Pause |

## WhatsApp / Email
| Method | Path | Purpose |
|--------|------|---------|
| GET/PATCH | `/whatsapp/channel` | Native Instant/Business |
| GET/POST | `/whatsapp/connections` | BYO / Request-a-Call |
| GET/PUT | `/email/channel` | Brevo channel |

## Phone / Knowledge / Sheets
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/phone-numbers` | Owned |
| PATCH | `/phone-numbers/{id}/assign` | Assign agent |
| GET | `/knowledge-sources` | KB list |
| POST | `/knowledge-sources/{id}/attach-agent/{agentId}` | Attach |
| GET/POST | `/automatic-calls` | Sheets jobs |
| POST | `/automatic-calls/{id}/start` | Start |

## Dispositions / Squads / Webcall
| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | `/disposition/config/{agentId}` | Taxonomy |
| GET/POST | `/squads` | Squads |
| POST | `/squads/{id}/runs` | Run |
| GET/POST | `/agents/{id}/webcall-links` | Browser links |

## Providers / webhooks / wallet / analytics
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/providers` | BYO keys |
| GET/POST | `/webhook-endpoints` | Outbound events |
| GET | `/wallet` | Balance |
| GET | `/analytics/dashboard` | Overview |
| GET | `/analytics/agents/{id}` | Per agent |

Full OpenAPI: `lib/api-spec/openapi.yaml`. Node SDK: `@snapserve/sdk` (`references/node-sdk.md`).
