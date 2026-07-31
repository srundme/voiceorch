import type { Chapter } from "../types";

export const numbersAndInboundRouting: Chapter = {
  slug: "numbers-and-inbound-routing",
  moduleId: "d4",
  number: "20.4",
  title: "Numbers & Inbound Routing",
  summary:
    "How a phone number attaches to a VoBiz application, how the inbound `To` is canonicalized into a national trunk-0 form to find the agent, direction-aware caller-key resolution, and the atomic campaign dial-claim.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/routes/webhooks.ts",
  prerequisites: ["webhooks-and-xml", "caller-memory-tables"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "For an **inbound** call to work, three things must line up. The phone number must be **attached** to a VoBiz application so VoBiz knows to POST our answer webhook. When the webhook fires, we must turn the dialed number (`To`) into an agent — but the number arrives in many shapes, so we **canonicalize** it. And once the session exists, we must key caller memory to the right human — which depends on the call **direction**.",
        "For **outbound campaign** calls, a fourth concern appears: two independent code paths can race to dial the same lead, so the dial is **claimed atomically** so each attempt is counted exactly once.",
        "This chapter reads the real code for all four. Number formats are the recurring villain: `+91 79714 42376`, `07971442376`, `917971442376`, and `7971442376` are the same phone in four disguises, and every lookup has to see through them.",
      ],
    },
    {
      kind: "concept",
      title: "E.164, the trunk 0, and country codes",
      body: [
        "**E.164** is the international phone-number standard: a `+`, a country code (91 for India), then the national number, e.g. `+917971442376`.",
        "The leading **trunk 0** is a national-dialling artefact: within India you might write `07971442376`, where the `0` means 'this is a domestic call'. It is NOT part of the international number and must be stripped before adding the country code.",
        "So the same phone can appear as `+917971442376` (full E.164), `917971442376` (E.164 without the plus), `07971442376` (national with trunk 0), or `7971442376` (bare national). Any database lookup or memory key that doesn't collapse these variants will store data under one shape and fail to find it under another.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/phone-numbers.ts",
      language: "typescript",
      intro:
        "Attaching a number to a VoBiz application. This is the documented endpoint — a POST that ties the DID to the app whose answer URL points at us. Everything after it is legacy fallback spray.",
      code: `    const plusE164 = e164.startsWith("+") ? e164 : \`+\${digits}\`;
    try {
      const attachResp = await fetch(
        \`\${VOBIZ_ACCOUNT_BASE}/\${authId}/numbers/\${encodeURIComponent(plusE164)}/application\`,
        { method: "POST", headers: h, body: JSON.stringify({ application_id: appId }) },
      );
      const attachText = await attachResp.text().catch(() => "");
      if (attachResp.ok || attachResp.status === 204) {
        documentedAttachOk = true;
        linked = true;
        console.info(\`configureVobizNumberWebhook: documented attach SUCCESS \${attachResp.status} \${plusE164} -> app \${appId}\`);
      }
    } catch (e) {
      console.warn("configureVobizNumberWebhook: documented attach error:", e);
    }`,
      lines: [
        {
          lines: "1",
          label: "%2B-encoded E.164",
          explanation:
            "The endpoint wants the number as `+`-prefixed E.164, URL-encoded (`encodeURIComponent` turns `+` into `%2B`). We normalize to that shape first.",
        },
        {
          lines: "3-5",
          label: "POST number → application",
          explanation:
            "The real VoBiz API: `POST /Account/{authId}/numbers/{+E164}/application` with `{ application_id }`. Attaching the number to the app is what makes VoBiz call OUR answer webhook when someone dials this DID. The app's answer URL is `/api/webhooks/vobiz/voice`.",
        },
        {
          lines: "8-11",
          label: "success sets linked",
          explanation:
            "204 (No Content) or any 2xx means the attach worked. `linked = true` short-circuits the legacy fallback spray below it — a pile of alternate endpoints kept only as insurance for older accounts.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/webhooks.ts",
      language: "typescript",
      intro:
        "Now the inbound side. When there's no `?agentId=` (a real inbound call, not our own outbound), we take the dialed `To` and build a SET of candidate shapes to match against our phone_numbers table.",
      code: `  if (!agentId) {
    const toRaw: string = String(
      req.body?.To ?? req.body?.to ?? req.body?.destination ?? req.body?.Destination ??
      req.query?.To ?? req.query?.to ?? req.query?.destination ?? ""
    ).trim();

    if (toRaw) {
      const candidates = new Set<string>();
      const addCandidate = (v: string | null | undefined): void => {
        const s = (v ?? "").trim();
        if (s) candidates.add(s);
      };
      addCandidate(toRaw);
      addCandidate(toRaw.startsWith("+") ? toRaw.slice(1) : \`+\${toRaw}\`);
      const canonTo = canonicalizeCallerKey(toRaw); // "07971442376" -> "917971442376"
      addCandidate(canonTo);
      if (canonTo) addCandidate(\`+\${canonTo}\`);

      if (toRaw.length >= 10) {
        const last10 = toRaw.slice(-10);
        addCandidate(last10);
        addCandidate(\`+91\${last10}\`);
        addCandidate(\`91\${last10}\`);
      }`,
      lines: [
        {
          lines: "2-5",
          label: "read To from many field names",
          explanation:
            "Different providers/paths spell the dialed number differently: `To`, `to`, `destination`, `Destination`, in body or query. We check them all and take the first non-empty one.",
        },
        {
          lines: "13-16",
          label: "the plus/no-plus and canonical variants",
          explanation:
            "We add `toRaw` as-is, its plus-flipped twin, and the canonical form from `canonicalizeCallerKey` — which collapses the trunk-0 national form `07971442376` into the E.164-digits `917971442376`. That canonical value is the anchor of the whole candidate set.",
        },
        {
          lines: "18-23",
          label: "last-10-digit fallbacks",
          explanation:
            "As a safety net we also add the bare last 10 digits and `+91`/`91` prefixed versions. Numbers get stored inconsistently over a system's life; matching on the last 10 digits catches rows written before canonicalization existed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/webhooks.ts",
      language: "typescript",
      intro:
        "With the candidate set built, we query phone_numbers for any matching row and read off its agentId. A last-resort SQL fallback matches on the right-most 10 digits if nothing else hit.",
      code: `      let [pn] = await db
        .select({ agentId: phoneNumbersTable.agentId, routingRules: phoneNumbersTable.routingRules })
        .from(phoneNumbersTable)
        .where(inArray(phoneNumbersTable.number, [...candidates]));

      if (!pn?.agentId && toRaw.length >= 10) {
        const last10 = toRaw.slice(-10);
        const [fallbackPn] = await db
          .select({ agentId: phoneNumbersTable.agentId, routingRules: phoneNumbersTable.routingRules })
          .from(phoneNumbersTable)
          .where(and(
            sql\`RIGHT(REGEXP_REPLACE(\${phoneNumbersTable.number}, '[^0-9]', '', 'g'), 10) = \${last10}\`,
            sql\`\${phoneNumbersTable.agentId} IS NOT NULL\`
          ));
        if (fallbackPn?.agentId) pn = fallbackPn;
      }

      if (pn?.agentId) {
        agentId = pn.agentId;
        platformTelephony = true;
        routingRules = (pn.routingRules as RoutingRule[] | null) ?? null;
      }
    }
  }`,
      lines: [
        {
          lines: "1-4",
          label: "match any candidate",
          explanation:
            "`inArray(...candidates)` matches a stored number in ANY of the shapes we generated. One query, all disguises.",
        },
        {
          lines: "6-15",
          label: "SQL last-10 fallback",
          explanation:
            "If nothing matched, strip non-digits from every stored number and compare the right-most 10. This catches oddly-formatted rows the candidate set didn't anticipate. It only accepts rows that actually have an agent attached.",
        },
        {
          lines: "17-21",
          label: "resolve agent + routing rules",
          explanation:
            "On a hit we adopt the number's `agentId`, mark the call `platformTelephony = true` (so it uses managed provider keys), and load any per-number `routingRules` (caller-prefix / time-of-day / always → route to a different agent).",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "canonicalizeCallerKey: one function, two jobs",
      body: [
        "The same `canonicalizeCallerKey` used to look up a phone number here is the one that keys **caller memory**. That's deliberate: a number must collapse to the same string whether we're finding its agent or finding the caller's history.",
        "Its rules: trust explicit international forms (`+…` or `00…`) as-is; strip the national trunk 0; and for the configured market (India, calling code 91, national length 10) expand a bare national number by prepending the code. `07971442376` → strip `0` → `7971442376` → prepend `91` → `917971442376`. Same human, one key.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/caller-identity.ts",
      language: "typescript",
      intro:
        "Caller memory keys off the HUMAN's number — but which side is the human depends on direction. resolveCallerKey encodes that, and deliberately refuses to fall back to our own number.",
      code: `export function resolveCallerKey(
  direction: CallDirection,
  fromNumber: string,
  toNumber: string,
): string | null {
  const human = direction === "outbound" ? toNumber : fromNumber;
  return canonicalizeCallerKey(human);
}`,
      lines: [
        {
          lines: "6",
          label: "inbound → From, outbound → To",
          explanation:
            "On an **inbound** call the caller dialed us, so the human is `fromNumber`. On an **outbound** call we dialed them, so the human is `toNumber` — `fromNumber` is our own shared platform number.",
        },
        {
          lines: "7",
          label: "no fallback on purpose",
          explanation:
            "It canonicalizes ONLY the human side. It never falls back to the other side, because on outbound that side is our platform number — and keying every outbound caller to that one number would collapse them all into a single shared memory (cross-caller bleed). Contrast the deprecated `humanPhone`, whose 'first real number wins' heuristic does exactly that on outbound.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The campaign dial claim",
      paragraphs: [
        "Outbound campaigns dial a list of leads. Two independent paths can race to dial the same lead: the rolling-refill loop that keeps a fixed number of calls in flight, and a `processRetries` path that re-fires a deferred lead. If both dialed, we'd place two calls AND double-count the attempt — burning the lead's retry budget and inflating 'Attempt N of N'.",
        "The fix is an **atomic claim**: a single conditional SQL `UPDATE` that flips the lead's status and increments the counter in one statement. Only one racer's UPDATE finds the row in the expected state; the other sees zero rows changed and bails without dialing.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/campaignCaller.ts",
      language: "typescript",
      intro:
        "The non-pre-claimed dial-claim: flip `pending` → `calling`, bump the attempt, and re-assert the retry-timing gate — all in one atomic UPDATE that also makes call_retries.scheduledAt the single source of truth for spacing.",
      code: `    const claimed = await db.execute<{ call_attempts: number }>(sql\`
      UPDATE campaign_leads
      SET call_status = 'calling', call_attempts = call_attempts + 1, last_attempt_at = now()
      WHERE id = \${lead.id}
        AND call_status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM call_retries cr
          WHERE cr.lead_id = campaign_leads.id
            AND cr.status = 'pending'
            AND cr.scheduled_at > now()
        )
      RETURNING call_attempts
    \`);
    if (claimed.rows.length === 0) {
      logger.info({ leadId: lead.id, campaignId: campaign.id }, "Dial skipped - lead not dialable (claimed elsewhere or has a not-yet-due retry)");
      return;
    }
    newAttempts = Number(claimed.rows[0]!.call_attempts);`,
      lines: [
        {
          lines: "2-4",
          label: "flip status + count in one write",
          explanation:
            "Status becomes `calling` and `call_attempts` increments in a single UPDATE. Because it's atomic, the attempt is counted EXACTLY when the claim is won — never twice.",
        },
        {
          lines: "5",
          label: "WHERE call_status = 'pending'",
          explanation:
            "The guard. Only a row still `pending` can be claimed. If the other racer already flipped it to `calling`, this WHERE matches nothing.",
        },
        {
          lines: "6-11",
          label: "the retry-timing gate",
          explanation:
            "`NOT EXISTS (… a pending call_retries row with scheduledAt > now)` refuses to dial a lead that has a not-yet-due retry. This makes `call_retries.scheduledAt` the single source of truth for spacing across every dial path.",
        },
        {
          lines: "14-17",
          label: "loser bails cleanly",
          explanation:
            "Zero rows returned → we didn't win the claim (or the retry isn't due). We log and `return` WITHOUT dialing or touching the counter, so attempts only ever reflect a real outbound dial.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Number attach enables inbound; canonicalization finds the agent and the caller; the claim guards outbound. Click to explore.",
      nodes: [
        { id: "attach", label: "phone-numbers.ts", sublabel: "attach DID → VoBiz app", current: true },
        { id: "webhook", label: "vobiz/voice webhook", sublabel: "To → agentId", current: true },
        { id: "canon", label: "canonicalizeCallerKey", sublabel: "collapses number shapes", chapterSlug: "caller-memory-tables" },
        { id: "resolve", label: "resolveCallerKey", sublabel: "direction-aware human", chapterSlug: "caller-memory-tables" },
        { id: "claim", label: "campaignCaller.ts", sublabel: "atomic dial claim", current: true },
      ],
      edges: [
        { from: "attach", to: "webhook", label: "VoBiz POSTs answer URL" },
        { from: "webhook", to: "canon", label: "canonicalize To" },
        { from: "webhook", to: "resolve", label: "session caller key" },
        { from: "claim", to: "webhook", label: "outbound dir=out" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "The inbound webhook builds a Set of candidate number shapes for the dialed `To`. Why not just query the raw value?",
          choices: [
            "To make the query slower on purpose.",
            "The same phone arrives in many shapes (+91…, 91…, 0…, bare 10-digit); a single stored form wouldn't match all of them, so we generate every likely shape (plus a canonical trunk-0-stripped form) and match any.",
            "Because the database can't index phone numbers.",
            "To avoid using canonicalizeCallerKey.",
          ],
          correctIndex: 1,
          explanation:
            "Numbers are stored and sent in inconsistent formats. The candidate set — including the canonical form and last-10-digit fallbacks — lets one query find the agent regardless of the incoming shape.",
        },
        {
          prompt: "`resolveCallerKey` returns `toNumber` for outbound and `fromNumber` for inbound, and never falls back to the other side. Why the no-fallback rule?",
          choices: [
            "To save memory.",
            "On outbound, the other side (fromNumber) is our shared platform number; falling back to it would key every outbound caller to one number and collapse all their memories together.",
            "Because inbound calls have no From.",
            "Because the To is always null on inbound.",
          ],
          correctIndex: 1,
          explanation:
            "The human is on a different side per direction. Falling back to our own platform number on outbound would cause cross-caller bleed — every outbound caller sharing one memory key.",
        },
        {
          prompt: "How does the atomic dial-claim prevent double-dialing and double-counting a lead?",
          choices: [
            "It locks the whole campaign_leads table.",
            "A single conditional UPDATE flips `pending`→`calling` and increments the attempt only if the row is still `pending` and has no not-yet-due retry; the losing racer sees zero rows changed and bails without dialing.",
            "It dials both and cancels one later.",
            "It uses a random delay so they never collide.",
          ],
          correctIndex: 1,
          explanation:
            "The conditional UPDATE is atomic: only one racer finds the row in the expected state, so the attempt is counted exactly once and only that racer dials. The other returns without side effects.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "A DID must be attached to a VoBiz application (`POST /Account/{authId}/numbers/{+E164}/application`) so VoBiz POSTs our answer webhook on inbound calls.",
        "Inbound routing turns the dialed `To` into an agent by building a Set of candidate number shapes — including the canonical trunk-0-stripped, country-code-prefixed form — and matching any, with a last-10-digit SQL fallback.",
        "`canonicalizeCallerKey` collapses +/no-plus, the `00` prefix, the national trunk 0, and bare-national vs country-code forms into one stable key — used for BOTH number lookup and caller memory.",
        "`resolveCallerKey` picks the human side by direction (inbound→From, outbound→To) and deliberately never falls back, avoiding cross-caller memory bleed onto the shared platform number.",
        "Per-number `routingRules` (caller-prefix / time-range / always) can redirect an inbound call to a different agent after the number resolves.",
        "The campaign dial-claim is a single atomic conditional UPDATE (`WHERE call_status='pending'` + retry-timing gate) so each attempt is counted exactly once and races can't double-dial.",
      ],
    },
  ],
};
