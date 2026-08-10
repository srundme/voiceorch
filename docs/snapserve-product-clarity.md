# SnapServe — product clarity (mental model)

**One sentence:** An **agent** owns the conversation and messages; a **campaign** owns the lead list and dial; **Connections** wires data in/out; **squads** hand work between agents; **meetings** put the same agent into Meet/Zoom/Teams.

## Who owns what

| Layer | Owns | Does **not** own |
|-------|------|------------------|
| **Agent** (Builder) | Prompt, voice, tools, KB, **outcomes / dispositions**, **after-call WhatsApp & email rules**, meeting prompt & deck | Bulk dial lists, CRM push |
| **Campaign** | Lead sources, dial queue, retries, **lead transfer** (webhook / Sheets by disposition) | WA/email templates (configure on agent + Connections) |
| **Connections** | WhatsApp, Email (Brevo), Sheets, Website form, Meta leads, **Bookings calendar**, Meeting bots entry | The conversation script |
| **Squad** | Mid-call handoff + follow-up tasks between agents | Campaign dialer |
| **Meetings** (`/app/meet`) | Join Meet/Zoom/Teams with an agent | Phone DID (separate) |

## Disposition vs after-call vs lead transfer

```text
Call ends
   → AI picks a disposition (agent Outcomes taxonomy)
   → Funnel meaning (Interested / Callback / DNC) for analytics
   → Agent after-call messages (WhatsApp / email by rule or “every call”)
   → Campaign lead transfer (optional: push matching leads to webhook / Sheets)
```

| Concept | Where you set it | When it fires |
|---------|------------------|---------------|
| **Outcomes** (taxonomy + data fields) | Agent → **Outcomes** tab | Every completed call (AI extract) |
| **Funnel meaning** | Agent → Outcomes | Maps labels → Interested / Callback / DNC |
| **After-call messages** | Agent → Outcomes | WA/email after disposition (needs Connections) |
| **Lead transfer** | Campaign → Configuration | Push lead to CRM/Sheets/webhook by disposition |
| **Sheets writeback** | Sheets Automatic Calls pipeline | Outcome columns on the sheet |

If WhatsApp/email Channels are not connected yet, you can still save after-call rules — messages send only after Connections are live.

## Navigation (live product)

**Home · Campaigns · Agents · Phone numbers · Connections · History**  
(+ Knowledge, Memory, Squads, Analytics, Bookings as needed)

| Go here for… | Path |
|--------------|------|
| Build / test agent | `/app/agents` |
| Start dialing leads | `/app/campaigns` |
| Wire WA / email / Sheets / website / Meta | `/app/connections` |
| Send agent into a video meeting | `/app/meet` |
| Multi-agent handoff | `/app/squads` |
| Call transcripts & recordings | `/app/history` (or History) |

## Greeting clarity

- Set an explicit **Greeting message** on the agent for the exact first line.
- The **agent display name** is an internal label — it is **not** automatically your company brand on the call.
- Prefer writing company name in the **prompt IDENTITY / CALL FLOW**, not only in the agent title.

## Related docs

- [Product knowledge base](./snapserve-product-knowledge-base.md) — campaigns + meeting join paths  
- [Meetings](./meetings.md) — full meeting-agent feature map  
- [Voiceathon playbook](./voiceathon-participant-playbook.md) — hackathon path  
- In-app: [Platform concepts](https://app.snapserve.ai/docs/platform-concepts) · [Meetings guide](https://app.snapserve.ai/docs/meetings) · [API Reference](https://app.snapserve.ai/docs/api-reference)
