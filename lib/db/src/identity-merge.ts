/**
 * identity-merge.ts — consolidate duplicate `users` rows created by the
 * Clerk → Google OAuth migration.
 *
 * Background: pre-migration users have a legacy row keyed by a Clerk id
 * (`clerk_id` like `user_3EO1…`) that still owns all their data, plus a new row
 * keyed by their Google account subject id. The live session authenticates as
 * the Google identity, so the legacy-owned data is invisible.
 *
 * Canonical identity format: the **bare** Google `sub` (e.g. `104843180913508370916`).
 * This matches what `attachSession` puts on `req.clerkUserId` and what every
 * ownership-scoped query compares against. We deliberately do NOT use a
 * `google:` prefix — introducing one would create a third id format the app
 * doesn't match. Any `google:<sub>` row is normalized down to the bare `<sub>`.
 *
 * Linking is keyed by email. Google emails are verified, so matching a legacy
 * account to a Google identity by (case-insensitive, non-empty) email is safe.
 *
 * This module is the single source of truth shared by:
 *   - the one-off `merge-user-identities` script (bulk backfill), and
 *   - the Google login callback (`auth.ts`) which links any still-orphaned
 *     account at sign-in time so no new orphans accumulate.
 */
import { sql } from "drizzle-orm";
import { db as defaultDb } from "./index";

/** Minimal executor surface satisfied by both the top-level `db` and a tx. */
export interface SqlExecutor {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}

interface TxCapable extends SqlExecutor {
  transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
}

/**
 * Every column that stores a user's *string* identity (`users.clerk_id`).
 * Covers loose `text` columns and real FK columns to `users.clerk_id`.
 * `wallet_transactions` / `password_reset_otps` are NOT here — they reference
 * `users.id` (integer) and are handled separately.
 *
 * `unique`     → the user column alone is unique (delete a colliding legacy row).
 * `uniqueWith` → user column + these columns form a unique key (delete a
 *                colliding legacy row before relinking the rest).
 *
 * This list mirrors `lib/db/src/schema/`. When a new table gains a user-id
 * column, add it here.
 */
export interface RelinkTarget {
  table: string;
  column: string;
  unique?: boolean;
  uniqueWith?: string[];
}

export const IDENTITY_RELINK_TARGETS: RelinkTarget[] = [
  // ── loose-string `user_id` columns (no FK) ────────────────────────────────
  { table: "campaigns", column: "user_id" },
  { table: "campaign_leads", column: "owner_id" },
  { table: "agents", column: "user_id" },
  { table: "agent_versions", column: "user_id" },
  { table: "calls", column: "user_id" },
  { table: "providers", column: "user_id" },
  { table: "knowledge_bases", column: "user_id" },
  { table: "knowledge_sources", column: "user_id" },
  { table: "knowledge_entries", column: "user_id" },
  { table: "activity_logs", column: "user_id" },
  { table: "usage_events", column: "user_id" },
  { table: "webhook_endpoints", column: "user_id" },
  { table: "scheduling_calendars", column: "user_id" },
  { table: "event_types", column: "user_id" },
  { table: "bookings", column: "user_id" },
  { table: "google_calendar_connections", column: "user_id", uniqueWith: ["email"] },
  { table: "incoming_calls", column: "user_id" },
  { table: "workspace_dnc", column: "user_id" },
  { table: "scheduled_callbacks", column: "user_id" },
  { table: "simulation_test_cases", column: "user_id" },
  { table: "simulation_runs", column: "user_id" },
  { table: "lead_sources", column: "user_id" },
  // ── real FK columns to users.clerk_id (onDelete: cascade) ─────────────────
  { table: "phone_numbers", column: "user_id" },
  { table: "user_api_keys", column: "user_id" },
  { table: "vobiz_accounts", column: "user_id", unique: true },
  { table: "vobiz_kyc_sessions", column: "user_id" },
  { table: "kyc_audit_logs", column: "user_id" },
  { table: "meta_integrations", column: "user_id" },
  { table: "meta_leads", column: "user_id" },
  { table: "call_transfers", column: "user_id" },
  { table: "verified_phone_destinations", column: "user_id", uniqueWith: ["phone_number"] },
  // ── clerk_id keyed tables (no FK) ─────────────────────────────────────────
  { table: "usage_spike_notifications", column: "clerk_id", uniqueWith: ["notified_date"] },
  { table: "usage_spike_dismissals", column: "clerk_id", uniqueWith: ["dismissed_date"] },
];

export type IdentityKind = "legacy" | "google" | "google_prefixed" | "email" | "other";

export function classifyClerkId(clerkId: string): IdentityKind {
  if (clerkId.startsWith("email:")) return "email";
  if (clerkId.startsWith("user_")) return "legacy";
  if (clerkId.startsWith("google:")) return "google_prefixed";
  if (/^\d+$/.test(clerkId)) return "google";
  return "other";
}

/** Bare Google sub for a google/google-prefixed id, else null. */
export function canonicalGoogleSub(clerkId: string): string | null {
  if (clerkId.startsWith("google:")) {
    const bare = clerkId.slice("google:".length);
    return /^\d+$/.test(bare) ? bare : null;
  }
  return /^\d+$/.test(clerkId) ? clerkId : null;
}

export interface UserIdentityRow {
  id: number;
  clerkId: string;
  email: string | null;
  walletBalanceCents: number;
  freeCreditsGranted: boolean;
  apiKey: string | null;
  orgKey: string | null;
  passwordHash: string | null;
  razorpayCustomerId: string | null;
  razorpayTokenId: string | null;
  onboardingCompleted: boolean;
  onboardingData: unknown | null;
  preferences: unknown | null;
}

export interface MergeGroup {
  /** Lower-cased email shared by survivor + sources. */
  email: string;
  /** Canonical bare-numeric clerk_id every source is relinked onto. */
  canonicalClerkId: string;
  /** The surviving users row (its clerk_id == canonicalClerkId after merge). */
  survivor: UserIdentityRow;
  /** True when the survivor row's clerk_id must be renamed to the bare form. */
  survivorNeedsRename: boolean;
  /** Legacy / duplicate rows whose data is relinked onto the survivor. */
  sources: UserIdentityRow[];
}

const USER_SELECT_COLUMNS = sql`
  id, clerk_id AS "clerkId", email,
  wallet_balance_cents AS "walletBalanceCents",
  free_credits_granted AS "freeCreditsGranted",
  api_key AS "apiKey", org_key AS "orgKey",
  password_hash AS "passwordHash",
  razorpay_customer_id AS "razorpayCustomerId",
  razorpay_token_id AS "razorpayTokenId",
  onboarding_completed AS "onboardingCompleted",
  onboarding_data AS "onboardingData",
  preferences
`;

async function selectUsersByEmail(exec: SqlExecutor, email: string): Promise<UserIdentityRow[]> {
  const res = await exec.execute(
    sql`SELECT ${USER_SELECT_COLUMNS} FROM users WHERE lower(email) = ${email} ORDER BY id ASC`,
  );
  return res.rows as UserIdentityRow[];
}

/**
 * Build the merge plan for one email's rows. Returns null when there is nothing
 * to merge (no Google identity present, or no legacy/duplicate sources).
 *
 * Survivor selection: prefer a bare-numeric Google row (the live session
 * format); fall back to a `google:`-prefixed row (which is then renamed to the
 * bare form). `email:` (password) accounts are never treated as a Google
 * identity and are never merged as sources.
 */
export function buildMergeGroup(email: string, rows: UserIdentityRow[]): MergeGroup | null {
  const bare = rows
    .filter((r) => classifyClerkId(r.clerkId) === "google")
    .sort((a, b) => a.id - b.id);
  const prefixed = rows
    .filter((r) => classifyClerkId(r.clerkId) === "google_prefixed")
    .sort((a, b) => a.id - b.id);

  let survivor: UserIdentityRow | undefined;
  let canonicalClerkId: string | undefined;
  let survivorNeedsRename = false;

  if (bare.length > 0) {
    survivor = bare[0];
    canonicalClerkId = survivor.clerkId;
  } else if (prefixed.length > 0) {
    survivor = prefixed[0];
    canonicalClerkId = canonicalGoogleSub(survivor.clerkId)!;
    survivorNeedsRename = true;
  } else {
    return null; // no Google identity for this email — nothing to consolidate
  }

  // Everything that is a legacy row, an extra bare row, or an extra/prefixed
  // duplicate becomes a source merged onto the survivor. `email:`/`other` rows
  // are left untouched (separate intentional accounts).
  const sources = rows.filter((r) => {
    if (r.id === survivor!.id) return false;
    const kind = classifyClerkId(r.clerkId);
    return kind === "legacy" || kind === "google" || kind === "google_prefixed";
  });

  if (sources.length === 0 && !survivorNeedsRename) return null;

  return { email, canonicalClerkId, survivor, survivorNeedsRename, sources };
}

/** Scan the whole `users` table and return every merge group that has work. */
export async function planAllMerges(exec: SqlExecutor = defaultDb as unknown as SqlExecutor): Promise<MergeGroup[]> {
  const res = await exec.execute(
    sql`SELECT DISTINCT lower(email) AS email FROM users WHERE email IS NOT NULL AND email <> '' ORDER BY email ASC`,
  );
  const emails = (res.rows as { email: string }[]).map((r) => r.email);
  const groups: MergeGroup[] = [];
  for (const email of emails) {
    const rows = await selectUsersByEmail(exec, email);
    const group = buildMergeGroup(email, rows);
    if (group) groups.push(group);
  }
  return groups;
}

export interface RelinkCount {
  table: string;
  column: string;
  rows: number;
}

/** Read-only: count how many rows each target would relink for a group. */
export async function countRelinks(exec: SqlExecutor, group: MergeGroup): Promise<RelinkCount[]> {
  const sourceIds = group.sources.map((s) => s.clerkId);
  const out: RelinkCount[] = [];
  if (sourceIds.length === 0) return out;
  for (const target of IDENTITY_RELINK_TARGETS) {
    let total = 0;
    for (const src of sourceIds) {
      const res = await exec.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(target.table)} WHERE ${sql.identifier(target.column)} = ${src}`,
      );
      total += Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
    }
    if (total > 0) out.push({ table: target.table, column: target.column, rows: total });
  }
  return out;
}

/** Total wallet cents that will be added to the survivor from its sources. */
export function sumSourceWallet(group: MergeGroup): number {
  return group.sources.reduce((acc, s) => acc + (s.walletBalanceCents ?? 0), 0);
}

function firstNonNull<T>(rows: UserIdentityRow[], pick: (r: UserIdentityRow) => T | null): T | null {
  for (const r of rows) {
    const v = pick(r);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Execute a single group's merge. MUST be called inside a transaction — the
 * caller owns the transaction boundary so the script can wrap each email group
 * and the login callback can wrap its own.
 *
 * Order (FK-safe):
 *   1. rename survivor clerk_id to the bare canonical form (if needed)
 *   2. relink every string identity column from each source → canonical
 *   3. repoint wallet_transactions (users.id FK) from source → survivor
 *   4. free unique source columns + merge wallet/credits/settings into survivor
 *   5. delete the now-empty source users rows (cascades ephemeral OTP rows)
 */
export async function executeMergeGroup(tx: SqlExecutor, group: MergeGroup): Promise<void> {
  const { canonicalClerkId, survivor, survivorNeedsRename, sources } = group;

  // 1. Normalize survivor clerk_id to the bare canonical form.
  if (survivorNeedsRename && survivor.clerkId !== canonicalClerkId) {
    await tx.execute(
      sql`UPDATE users SET clerk_id = ${canonicalClerkId} WHERE id = ${survivor.id}`,
    );
  }

  // 2. Relink every string identity column.
  for (const src of sources) {
    if (src.clerkId === canonicalClerkId) continue;
    for (const target of IDENTITY_RELINK_TARGETS) {
      if (target.unique) {
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(target.table)} AS t
              WHERE t.${sql.identifier(target.column)} = ${src.clerkId}
                AND EXISTS (SELECT 1 FROM ${sql.identifier(target.table)} s
                            WHERE s.${sql.identifier(target.column)} = ${canonicalClerkId})`,
        );
      } else if (target.uniqueWith && target.uniqueWith.length > 0) {
        const conds = target.uniqueWith.map(
          (k) => sql`s.${sql.identifier(k)} IS NOT DISTINCT FROM t.${sql.identifier(k)}`,
        );
        let conj = conds[0]!;
        for (let i = 1; i < conds.length; i++) conj = sql`${conj} AND ${conds[i]!}`;
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(target.table)} AS t
              WHERE t.${sql.identifier(target.column)} = ${src.clerkId}
                AND EXISTS (SELECT 1 FROM ${sql.identifier(target.table)} s
                            WHERE s.${sql.identifier(target.column)} = ${canonicalClerkId}
                              AND ${conj})`,
        );
      }
      await tx.execute(
        sql`UPDATE ${sql.identifier(target.table)}
            SET ${sql.identifier(target.column)} = ${canonicalClerkId}
            WHERE ${sql.identifier(target.column)} = ${src.clerkId}`,
      );
    }
  }

  if (sources.length === 0) return;

  const sourceIdList = sql.join(sources.map((s) => sql`${s.id}`), sql`, `);

  // 3. Repoint wallet_transactions (integer FK to users.id).
  await tx.execute(
    sql`UPDATE wallet_transactions SET user_id = ${survivor.id} WHERE user_id IN (${sourceIdList})`,
  );

  // 4. Merge wallet/credits/settings into survivor.
  const addCents = sumSourceWallet(group);
  const anyGranted = sources.some((s) => s.freeCreditsGranted);
  const anyOnboarded = sources.some((s) => s.onboardingCompleted);
  const legacyApiKey = firstNonNull(sources, (r) => r.apiKey);
  const legacyOrgKey = firstNonNull(sources, (r) => r.orgKey);
  const legacyPwd = firstNonNull(sources, (r) => r.passwordHash);
  const legacyRzpCust = firstNonNull(sources, (r) => r.razorpayCustomerId);
  const legacyRzpTok = firstNonNull(sources, (r) => r.razorpayTokenId);
  const legacyOnboarding = firstNonNull(sources, (r) => r.onboardingData);
  const legacyPrefs = firstNonNull(sources, (r) => r.preferences);

  // Free the unique api/org keys on source rows so the survivor can adopt them.
  await tx.execute(
    sql`UPDATE users SET api_key = NULL, org_key = NULL WHERE id IN (${sourceIdList})`,
  );

  await tx.execute(sql`
    UPDATE users SET
      wallet_balance_cents = wallet_balance_cents + ${addCents},
      free_credits_granted = free_credits_granted OR ${anyGranted},
      api_key = COALESCE(api_key, ${legacyApiKey}),
      org_key = COALESCE(org_key, ${legacyOrgKey}),
      password_hash = COALESCE(password_hash, ${legacyPwd}),
      razorpay_customer_id = COALESCE(razorpay_customer_id, ${legacyRzpCust}),
      razorpay_token_id = COALESCE(razorpay_token_id, ${legacyRzpTok}),
      onboarding_completed = onboarding_completed OR ${anyOnboarded},
      onboarding_data = COALESCE(onboarding_data, ${legacyOnboarding === null ? null : JSON.stringify(legacyOnboarding)}::jsonb),
      preferences = COALESCE(preferences, ${legacyPrefs === null ? null : JSON.stringify(legacyPrefs)}::jsonb)
    WHERE id = ${survivor.id}
  `);

  // 5. Delete the now-empty source users rows.
  await tx.execute(sql`DELETE FROM users WHERE id IN (${sourceIdList})`);
}

export interface LoginLinkResult {
  /** Number of legacy/duplicate rows merged onto the canonical identity. */
  merged: number;
  /** True if a fresh canonical survivor row was created to receive the data. */
  createdSurvivor: boolean;
  /** Canonical clerk_id of the surviving row, or null if nothing was done. */
  survivorClerkId: string | null;
}

function randomKey(prefix: string): string {
  // Cheap unique key; mirrors the vok_/voo_ format used elsewhere.
  const rand = Array.from({ length: 48 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${prefix}${rand}`;
}

/**
 * Login-time linking. Call from the Google callback once the canonical bare sub
 * is known. Merges any legacy / duplicate rows sharing this verified email onto
 * the canonical identity. Safe to run on every login (no-op when already clean).
 *
 * If the canonical row does not exist yet (a Clerk user signing in with Google
 * for the very first time), a fresh canonical row is created — without granting
 * welcome credit — and the legacy data + wallet balance are merged onto it.
 */
export async function linkLegacyIdentitiesAtLogin(
  database: TxCapable,
  args: { email: string | null; canonicalClerkId: string; name?: string | null },
): Promise<LoginLinkResult> {
  const email = args.email?.trim().toLowerCase();
  if (!email) return { merged: 0, createdSurvivor: false, survivorClerkId: null };

  return database.transaction(async (tx) => {
    const rows = await selectUsersByEmail(tx, email);
    const canonicalRow = rows.find((r) => r.clerkId === args.canonicalClerkId);
    const sources = rows.filter((r) => {
      if (canonicalRow && r.id === canonicalRow.id) return false;
      const kind = classifyClerkId(r.clerkId);
      return kind === "legacy" || kind === "google" || kind === "google_prefixed";
    });

    if (sources.length === 0) {
      return {
        merged: 0,
        createdSurvivor: false,
        survivorClerkId: canonicalRow?.clerkId ?? null,
      };
    }

    let survivor = canonicalRow;
    let createdSurvivor = false;
    if (!survivor) {
      // No canonical row yet — create an empty one to receive the merged data.
      const name = args.name ?? null;
      const res = await tx.execute(sql`
        INSERT INTO users (clerk_id, email, name, wallet_balance_cents, free_credits_granted, api_key, org_key)
        VALUES (${args.canonicalClerkId}, ${email}, ${name}, 0, false, ${randomKey("vok_")}, ${randomKey("voo_")})
        RETURNING ${USER_SELECT_COLUMNS}
      `);
      survivor = (res.rows[0] as UserIdentityRow);
      createdSurvivor = true;
    }

    await executeMergeGroup(tx, {
      email,
      canonicalClerkId: args.canonicalClerkId,
      survivor,
      survivorNeedsRename: false,
      sources,
    });

    return { merged: sources.length, createdSurvivor, survivorClerkId: args.canonicalClerkId };
  });
}
