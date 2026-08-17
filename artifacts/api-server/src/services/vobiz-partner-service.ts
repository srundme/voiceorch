import { logger } from "../lib/logger.js";

const VOBIZ_PARTNER_BASE = "https://api.vobiz.ai/api/v1/partner";

function getPartnerHeaders() {
  const authId = process.env["VOBIZ_AUTH_ID"] ?? "";
  const authToken = process.env["VOBIZ_AUTH_TOKEN"] ?? "";
  return {
    "X-Auth-ID": authId,
    "X-Auth-Token": authToken,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
}

export interface VobizPartnerCustomerAccount {
  auth_id: string;
  auth_token: string;
  name?: string;
  email?: string;
  status?: string;
  balance?: number;
  currency?: string;
}

/**
 * 1. Provision a new customer sub-account under master partner account
 */
export async function provisionPartnerCustomerAccount(
  name: string,
  email: string,
  country: string = "IN",
): Promise<VobizPartnerCustomerAccount | null> {
  const authId = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  if (!authId || !authToken) {
    logger.warn("provisionPartnerCustomerAccount: Master partner credentials not set");
    return null;
  }

  const password = Math.random().toString(36).slice(-8) + "A1!";

  try {
    const resp = await fetch(`${VOBIZ_PARTNER_BASE}/accounts`, {
      method: "POST",
      headers: getPartnerHeaders(),
      body: JSON.stringify({
        name: name || email,
        email,
        password,
        country,
      }),
    });

    const bodyText = await resp.text();
    logger.info(
      { email, status: resp.status, bodySnippet: bodyText.slice(0, 300) },
      "provisionPartnerCustomerAccount response",
    );

    if (resp.ok) {
      const data = JSON.parse(bodyText) as VobizPartnerCustomerAccount;
      if (data.auth_id && data.auth_token) return data;
    }

    if (resp.status === 409) {
      // Account exists — attempt lookup
      return await lookupPartnerCustomerByEmail(email);
    }
  } catch (err) {
    logger.error({ err, email }, "provisionPartnerCustomerAccount error");
  }

  return null;
}

/**
 * 2. Assign a phone number (DID) to a customer sub-account in VoBiz Partner Console
 */
export async function assignNumberToCustomer(
  customerAuthId: string,
  e164Number: string,
): Promise<boolean> {
  const authId = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  if (!authId || !authToken || !customerAuthId || !e164Number) return false;

  const digits = e164Number.replace(/\D/g, "");
  const plusE164 = e164Number.startsWith("+") ? e164Number : `+${digits}`;

  const targets = [
    // DOCUMENTED endpoint (vobiz-phone-numbers skill): lowercase /account/,
    // %2B-encoded E.164 in path, body {sub_account_id}. The partner/* number
    // routes below are legacy guesses (VoBiz partner numbers API is read-only).
    {
      url: `https://api.vobiz.ai/api/v1/account/${authId}/numbers/${encodeURIComponent(plusE164)}/assign-subaccount`,
      body: JSON.stringify({ sub_account_id: customerAuthId }),
    },
    {
      url: `${VOBIZ_PARTNER_BASE}/numbers/assign`,
      body: JSON.stringify({ customer_auth_id: customerAuthId, number: digits }),
    },
    {
      url: `${VOBIZ_PARTNER_BASE}/numbers/assign`,
      body: JSON.stringify({ customer_auth_id: customerAuthId, number: e164Number }),
    },
    {
      url: `${VOBIZ_PARTNER_BASE}/accounts/${customerAuthId}/numbers`,
      body: JSON.stringify({ number: digits }),
    },
    {
      url: `${VOBIZ_PARTNER_BASE}/accounts/${customerAuthId}/numbers`,
      body: JSON.stringify({ number: e164Number }),
    },
  ];

  for (const t of targets) {
    try {
      const resp = await fetch(t.url, {
        method: "POST",
        headers: getPartnerHeaders(),
        body: t.body,
      });
      const text = await resp.text().catch(() => "");
      if (resp.ok || resp.status === 204) {
        logger.info({ customerAuthId, e164Number, url: t.url, status: resp.status }, "assignNumberToCustomer SUCCESS");
        return true;
      }
      logger.info({ customerAuthId, e164Number, url: t.url, status: resp.status, response: text.slice(0, 200) }, "assignNumberToCustomer attempt");
    } catch (e) {
      logger.warn({ err: e, customerAuthId, e164Number, url: t.url }, "assignNumberToCustomer error");
    }
  }

  return false;
}

/**
 * 3. Transfer balance from Master Partner Wallet to customer sub-account
 */
export async function transferMasterBalanceToSubAccount(
  customerAuthId: string,
  amountInr: number = 50,
): Promise<boolean> {
  const authId = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  if (!authId || !authToken || !customerAuthId) return false;

  try {
    const resp = await fetch(`${VOBIZ_PARTNER_BASE}/accounts/${customerAuthId}/transfer-balance`, {
      method: "POST",
      headers: getPartnerHeaders(),
      body: JSON.stringify({ amount: amountInr }),
    });

    const text = await resp.text().catch(() => "");
    logger.info(
      { customerAuthId, amountInr, status: resp.status, response: text.slice(0, 200) },
      "transferMasterBalanceToSubAccount result",
    );
    return resp.ok;
  } catch (err) {
    logger.warn({ err, customerAuthId }, "transferMasterBalanceToSubAccount error");
    return false;
  }
}

function extractPartnerAccountList(data: unknown): VobizPartnerCustomerAccount[] {
  if (Array.isArray(data)) return data as VobizPartnerCustomerAccount[];
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const key of ["accounts", "objects", "items", "customers", "results", "data"]) {
    const v = o[key];
    if (Array.isArray(v)) return v as VobizPartnerCustomerAccount[];
    if (v && typeof v === "object") {
      const nested = (v as Record<string, unknown>)["accounts"];
      if (Array.isArray(nested)) return nested as VobizPartnerCustomerAccount[];
    }
  }
  return [];
}

export async function fetchPartnerCustomerByAuthId(
  customerAuthId: string,
): Promise<VobizPartnerCustomerAccount | null> {
  if (!customerAuthId) return null;
  try {
    const resp = await fetch(`${VOBIZ_PARTNER_BASE}/accounts/${encodeURIComponent(customerAuthId)}`, {
      method: "GET",
      headers: getPartnerHeaders(),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as VobizPartnerCustomerAccount & { account?: VobizPartnerCustomerAccount };
    const account = data.auth_id ? data : data.account;
    if (account?.auth_id) return account;
  } catch (err) {
    logger.warn({ err, customerAuthId }, "fetchPartnerCustomerByAuthId error");
  }
  return null;
}

/**
 * Lookup an existing partner customer by email.
 * Prefer `search` (documented) so we do not miss accounts past page 10.
 */
export async function lookupPartnerCustomerByEmail(
  email: string,
): Promise<VobizPartnerCustomerAccount | null> {
  const targetEmail = email.toLowerCase().trim();
  if (!targetEmail) return null;

  const urls = [
    `${VOBIZ_PARTNER_BASE}/accounts?search=${encodeURIComponent(targetEmail)}&page=1&per_page=20`,
    `${VOBIZ_PARTNER_BASE}/accounts?page=1&per_page=100`,
  ];

  for (const url of urls) {
    let page = 1;
    while (page <= 10) {
      const paged = url.includes("page=1") && page > 1
        ? url.replace("page=1", `page=${page}`)
        : url;
      try {
        const resp = await fetch(paged, { method: "GET", headers: getPartnerHeaders() });
        if (!resp.ok) break;
        const list = extractPartnerAccountList(await resp.json());
        if (list.length === 0) break;

        const match = list.find((acc) => acc.email?.toLowerCase().trim() === targetEmail);
        if (match?.auth_id) {
          const full = match.auth_token
            ? match
            : (await fetchPartnerCustomerByAuthId(match.auth_id)) ?? match;
          logger.info({ email: targetEmail, authId: full.auth_id }, "lookupPartnerCustomerByEmail matched");
          return full;
        }

        if (url.includes("search=")) break;
        page++;
      } catch (err) {
        logger.warn({ err, email, url: paged }, "lookupPartnerCustomerByEmail error");
        break;
      }
    }
  }

  return null;
}
