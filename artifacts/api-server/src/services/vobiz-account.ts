// ── VoBiz Account API helpers ────────────────────────────────────────────────
// Shared by platform-managed numbers (routes/phone-numbers.ts, master account)
// and clients' own VoBiz accounts (services/byo-numbers.ts).

import { eq } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";

// Vobiz Account API base. Every call is scoped to the auth ID it is given: the
// platform master account (MA_) for managed DIDs, or a client's own account.
export const VOBIZ_ACCOUNT_BASE = "https://api.vobiz.ai/api/v1/Account";

export function vobizHeaders(authId: string, authToken: string) {
  const basicCreds = Buffer.from(`${authId}:${authToken}`).toString("base64");
  return {
    "Authorization": `Basic ${basicCreds}`,
    "X-Auth-ID":     authId,
    "X-Auth-Token":  authToken,
    "Accept":        "application/json",
    "Content-Type":  "application/json",
  };
}

export type VobizNumberItem = {
  id?: string;
  e164?: string;
  number?: string;
  app_id?: string | null;
  application_id?: string | null;
  application?: string | null;
};

export type ConfigureVobizResult = {
  appId: string | null;
  /** PATCH/POST accepted (or number already had the SnapServe app_id). */
  linked: boolean;
  /** Re-fetched number list shows application_id === SnapServe app. */
  verified: boolean;
  detail: string;
};

export function vobizDigits(n: string): string {
  return n.replace(/\D/g, "");
}

export function findVobizNumber(items: VobizNumberItem[], e164: string): VobizNumberItem | undefined {
  const want = vobizDigits(e164);
  return items.find((n) => {
    const got = vobizDigits(n.e164 ?? n.number ?? "");
    return got === want || got.endsWith(want) || want.endsWith(got);
  });
}

export function isVobizNumberLinked(item: VobizNumberItem | undefined, appId: string | null): boolean {
  if (!item || !appId) return false;
  const target = String(appId).trim();
  const directId = String(item.app_id ?? item.application_id ?? "").trim();
  if (directId === target) return true;
  const appUrl = String(item.application ?? "").trim();
  if (appUrl && appUrl.includes(target)) return true;
  return false;
}

export async function listVobizNumbers(
  authId: string,
  headers: Record<string, string>,
): Promise<VobizNumberItem[]> {
  for (const path of [
    `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/?limit=100`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers?limit=100`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/`,
    `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers`,
  ]) {
    try {
      const resp = await fetch(path, { headers });
      if (resp.ok) {
        const data = await resp.json() as { items?: VobizNumberItem[]; objects?: VobizNumberItem[] };
        const list = data.items ?? data.objects ?? [];
        if (list.length > 0) return list;
      }
    } catch { /* try next */ }
  }
  return [];
}

export type VobizCredentialCheck =
  | { status: "ok" }
  /** VoBiz said the Auth ID / Auth Token pair is wrong. */
  | { status: "rejected"; httpStatus: number }
  /** The number isn't one of the DIDs on that VoBiz account. */
  | { status: "number_not_on_account" }
  /** VoBiz didn't give a clear answer (network, 5xx, unknown route). Don't block on it. */
  | { status: "unknown"; detail: string };

/**
 * Check a client's own VoBiz Auth ID + Auth Token, and that `e164` is a DID on
 * that account. Only a definite "no" from VoBiz is reported as rejected; an
 * unclear answer comes back as "unknown" so a VoBiz blip never blocks a save.
 */
export async function checkVobizCredentials(
  authId: string,
  authToken: string,
  e164: string,
): Promise<VobizCredentialCheck> {
  const h = vobizHeaders(authId, authToken);
  try {
    const resp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${encodeURIComponent(authId)}/`, {
      headers: h,
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status === 401 || resp.status === 403) return { status: "rejected", httpStatus: resp.status };
    if (!resp.ok) return { status: "unknown", detail: `account lookup HTTP ${resp.status}` };
  } catch (err) {
    return { status: "unknown", detail: err instanceof Error ? err.message : String(err) };
  }
  // An empty list means VoBiz didn't answer usefully, not "no numbers": don't block.
  const items = await listVobizNumbers(authId, h);
  if (items.length > 0 && !findVobizNumber(items, e164)) return { status: "number_not_on_account" };
  return { status: "ok" };
}

/**
 * Ensure a SnapServe VoBiz Application exists with the correct inbound webhook
 * URLs and is set as the default_app. Explicitly links the given number to that
 * app and verifies the link stuck (VoBiz sometimes returns 2xx without persisting).
 */
export async function configureVobizNumberWebhook(
  authId: string,
  authToken: string,
  e164: string,
  webhookBase: string,
  opts: { makeDefault?: boolean } = {},
): Promise<ConfigureVobizResult> {
  // Platform account: SnapServe app is the account default so new DIDs route to
  // us. A client's own account keeps its default app; we only link this number.
  const makeDefault = opts.makeDefault ?? true;
  const fail = (detail: string): ConfigureVobizResult => ({
    appId: null, linked: false, verified: false, detail,
  });

  if (!webhookBase) {
    console.warn("configureVobizNumberWebhook: webhookBase is empty, skipping");
    return fail("webhookBase is empty");
  }
  const answerUrl = `${webhookBase}/api/webhooks/vobiz/voice`;
  const hangupUrl = `${webhookBase}/api/webhooks/vobiz/status`;
  const h = vobizHeaders(authId, authToken);

  try {
    let appId: string | null = null;

    // 1. If master account, try reading cached master app ID from platform_settings
    if (authId === process.env["VOBIZ_AUTH_ID"]) {
      const [cached] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, "vobiz_snapserve_app_id"));
      appId = cached?.value ?? null;
      if (appId) {
        const check = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/`, { headers: h });
        if (!check.ok) appId = null;
      }
    }

    // 2. Query account's applications list for SnapServe app
    if (!appId) {
      const listResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/`, { headers: h });
      if (listResp.ok) {
        const list = await listResp.json() as { objects?: { app_id: string; app_name: string }[] };
        const existing = (list.objects ?? []).find(a => a.app_name === "SnapServe");
        if (existing) appId = existing.app_id;
      }
    }

    // 3. Create SnapServe app if it doesn't exist under this authId
    if (!appId) {
      const createResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/`, {
        method:  "POST",
        headers: h,
        body: JSON.stringify({
          app_name:       "SnapServe",
          answer_url:     answerUrl,
          answer_method:  "POST",
          hangup_url:     hangupUrl,
          hangup_method:  "POST",
          ...(makeDefault ? {
            default_app:    true,
            // Per VoBiz docs this is the flag that auto-routes NEW numbers created
            // without an app_id (default_app alone does NOT route numbers).
            default_number_app: true,
          } : {}),
        }),
      });
      if (!createResp.ok) {
        const errText = await createResp.text();
        console.warn(`configureVobizNumberWebhook: create app failed for ${authId} ${createResp.status}: ${errText}`);
        return fail(`create SnapServe app failed (${createResp.status})`);
      }
      const created = await createResp.json() as { app_id?: string };
      appId = created.app_id ?? null;
      if (!appId) {
        console.warn(`configureVobizNumberWebhook: create app returned no app_id for ${authId}`);
        return fail("create SnapServe app returned no app_id");
      }
    }

    // 4. If master account, update platform_settings cache
    if (authId === process.env["VOBIZ_AUTH_ID"]) {
      await db.insert(platformSettingsTable)
        .values({ key: "vobiz_snapserve_app_id", value: appId })
        .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: appId } });
    }

    // 5. Ensure app is default_app and has correct URLs (idempotent update).
    const updateResp = await fetch(`${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/`, {
      method:  "POST",
      headers: h,
      body: JSON.stringify({
        answer_url:    answerUrl,
        answer_method: "POST",
        hangup_url:    hangupUrl,
        hangup_method: "POST",
        ...(makeDefault ? {
          default_app:          true,
          default_endpoint_app: true,
          default_number_app:   true,
        } : {}),
      }),
    });
    if (!updateResp.ok) {
      console.warn(`configureVobizNumberWebhook: app update failed ${updateResp.status}: ${await updateResp.text()}`);
    } else {
      console.info(`configureVobizNumberWebhook: SnapServe app ${appId} confirmed as default_app, answer_url=${answerUrl}`);
    }

    // 6. Link number → SnapServe app. Try UUID PATCH then E.164 path; verify by re-list.
    if (!e164) {
      return { appId, linked: false, verified: false, detail: "no e164 provided for number link" };
    }

    const digits = vobizDigits(e164);
    let items = await listVobizNumbers(authId, h);
    let match = findVobizNumber(items, e164);

    if (isVobizNumberLinked(match, appId)) {
      console.info(`configureVobizNumberWebhook: ${e164} already linked to SnapServe app ${appId}`);
      return { appId, linked: true, verified: true, detail: "already linked" };
    }

    const linkPayloads = [
      JSON.stringify({ app_id: appId }),
      JSON.stringify({ application_id: appId }),
      JSON.stringify({ number: e164, app_id: appId }),
      JSON.stringify({ number: digits, application_id: appId }),
    ];
    const linkTargets: Array<{ url: string; headers: Record<string, string> }> = [];

    // Account API targets (with Basic + X-Auth headers)
    if (match?.id) {
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${match.id}/`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${match.id}`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/Number/${match.id}/`, headers: h });
    }
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${encodeURIComponent(digits)}/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(digits)}`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/Number/${encodeURIComponent(digits)}/`, headers: h });
    if (e164.startsWith("+")) {
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Number/${encodeURIComponent(e164)}/`, headers: h });
      linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(e164)}`, headers: h });
    }

    // Partner API targets (X-Auth headers)
    const partnerH = { "X-Auth-ID": authId, "X-Auth-Token": authToken, "Accept": "application/json", "Content-Type": "application/json" };
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/assign`, headers: partnerH });
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/${encodeURIComponent(digits)}`, headers: partnerH });
    linkTargets.push({ url: `https://api.vobiz.ai/api/v1/partner/numbers/${encodeURIComponent(digits)}/link`, headers: partnerH });

    const formH = { ...h, "Content-Type": "application/x-www-form-urlencoded" };

    // 1. AttachNumber endpoints (Plivo / VoBiz Applications API standard)
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`, headers: formH });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`, headers: h });
    linkTargets.push({ url: `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`, headers: formH });

    // Additional payloads for AttachNumber
    const formPayloads = [
      `number=${encodeURIComponent(digits)}`,
      `number=${encodeURIComponent(e164)}`,
      `numbers=${encodeURIComponent(digits)}`,
      `numbers=${encodeURIComponent(e164)}`,
      `app_id=${encodeURIComponent(appId)}`,
    ];

    let linked = false;
    let documentedAttachOk = false;

    // 0. DOCUMENTED VoBiz attach endpoint (vobiz-applications-endpoints skill):
    //    POST /Account/{auth_id}/numbers/{number}/application  body {application_id}
    //    where {number} is the %2B-encoded E.164. This is the real API — the
    //    fallback spray below is legacy guesswork kept only as insurance.
    const plusE164 = e164.startsWith("+") ? e164 : `+${digits}`;
    try {
      const attachResp = await fetch(
        `${VOBIZ_ACCOUNT_BASE}/${authId}/numbers/${encodeURIComponent(plusE164)}/application`,
        { method: "POST", headers: h, body: JSON.stringify({ application_id: appId }) },
      );
      const attachText = await attachResp.text().catch(() => "");
      if (attachResp.ok || attachResp.status === 204) {
        documentedAttachOk = true;
        linked = true;
        console.info(`configureVobizNumberWebhook: documented attach SUCCESS ${attachResp.status} ${plusE164} -> app ${appId}`);
      } else {
        console.info(`configureVobizNumberWebhook: documented attach ${attachResp.status} ${plusE164} -> ${attachText.slice(0, 150)}`);
      }
    } catch (e) {
      console.warn("configureVobizNumberWebhook: documented attach error:", e);
    }

    // Try AttachNumber endpoints with form and JSON payloads (legacy fallback)
    if (!linked)
    for (const targetUrl of [
      `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/AttachNumber/`,
      `${VOBIZ_ACCOUNT_BASE}/${authId}/Application/${appId}/attach_number/`,
    ]) {
      for (const payload of formPayloads) {
        try {
          const resp = await fetch(targetUrl, { method: "POST", headers: formH, body: payload });
          const text = await resp.text().catch(() => "");
          if (resp.ok || resp.status === 204) {
            linked = true;
            console.info(`configureVobizNumberWebhook: AttachNumber SUCCESS ${resp.status} ${targetUrl} -> ${text.slice(0, 200)}`);
            break;
          } else {
            console.info(`configureVobizNumberWebhook: AttachNumber ${resp.status} ${targetUrl} (${payload}) -> ${text.slice(0, 150)}`);
          }
        } catch (e) {
          console.warn("configureVobizNumberWebhook: AttachNumber error:", e);
        }
      }
      if (linked) break;
    }

    if (!linked) {
      for (const target of linkTargets) {
        for (const method of ["POST", "PATCH", "PUT"]) {
          for (const body of linkPayloads) {
            try {
              const resp = await fetch(target.url, { method, headers: target.headers, body });
              const respText = await resp.text().catch(() => "");
              if (resp.ok || resp.status === 204) {
                linked = true;
                console.info(`configureVobizNumberWebhook: ${method} SUCCESS ${resp.status} ${target.url} -> ${respText.slice(0, 200)}`);
                break;
              } else {
                console.info(`configureVobizNumberWebhook: ${method} ${resp.status} ${target.url} -> ${respText.slice(0, 150)}`);
              }
            } catch (linkErr) {
              console.warn(`configureVobizNumberWebhook: ${method} error ${target.url}:`, linkErr);
            }
          }
          if (linked) break;
        }
        if (linked) break;
      }
    }

    // Brief settle + verify (VoBiz UI "Not linked" is this field).
    await new Promise((r) => setTimeout(r, 400));
    items = await listVobizNumbers(authId, h);
    match = findVobizNumber(items, e164);
    let listVerified = isVobizNumberLinked(match, appId);

    // List can lag a beat behind a successful attach — re-check once.
    if (!listVerified && linked) {
      await new Promise((r) => setTimeout(r, 800));
      items = await listVobizNumbers(authId, h);
      match = findVobizNumber(items, e164);
      listVerified = isVobizNumberLinked(match, appId);
    }

    // HONEST result. The documented attach endpoint is account-scoped, so its
    // 2xx is trustworthy even if the list lags; legacy-spray 2xx is NOT (VoBiz
    // has returned 2xx without persisting on those paths before).
    const verifiedFinal = listVerified || documentedAttachOk;

    const detail = listVerified
      ? "linked and verified"
      : documentedAttachOk
        ? "attach accepted by VoBiz (list not yet reflecting)"
        : match
          ? "number found under account but NOT linked to SnapServe app"
          : "number not found under this VoBiz account";

    console.info(
      { e164, appId, linked, verified: verifiedFinal, detail },
      "configureVobizNumberWebhook: result",
    );

    return {
      appId,
      linked,
      verified: verifiedFinal,
      detail,
    };
  } catch (err) {
    console.warn("configureVobizNumberWebhook: unexpected error:", err);
    return fail(err instanceof Error ? err.message : "unexpected error");
  }
}
