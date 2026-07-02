/**
 * /admin/deployments — Deployment & Operations Center endpoints.
 *
 * Fetches commit/deployment history from GitHub, exposes migration status,
 * environment info, and AI-generated release notes (cached in platform_settings).
 *
 * ROUTE ORDER NOTE: Static sub-paths (/latest, /migrations) MUST be registered
 * before the dynamic /:sha route to prevent Express matching them as SHA params.
 */
import { Router, type Request } from "express";
import { db, platformSettingsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { registerTransientKey } from "../services/rate-limit-cleanup.js";
import { logger } from "../lib/logger.js";

const REPO = "srundme/voiceorch";
const RELEASE_NOTES_CACHE_PREFIX = "release_notes_cache:";
const RELEASE_NOTES_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

registerTransientKey({ prefix: RELEASE_NOTES_CACHE_PREFIX, windowMs: RELEASE_NOTES_TTL_MS });

const router = Router();
router.use("/admin", requireAdmin);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ghHeaders(token?: string) {
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "VoiceOrch-Admin",
    ...(token ? { Authorization: `token ${token}` } : {}),
  };
}

async function getManagedLlmKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_qwen_key"));
    return row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
  } catch {
    return process.env["GROQ_API_KEY"] || null;
  }
}

/**
 * Derives a deployment status from GitHub check-runs for a given commit SHA.
 * Falls back to "SUCCESS" if the check-runs API is unavailable or returns no runs.
 */
async function getCommitStatus(sha: string, token?: string): Promise<"SUCCESS" | "FAILED" | "IN_PROGRESS"> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits/${sha}/check-runs?per_page=20`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) return "SUCCESS"; // graceful fallback
    const data = await res.json() as { check_runs: Array<{ conclusion: string | null; status: string }> };
    const runs = data.check_runs ?? [];
    if (runs.length === 0) return "SUCCESS"; // no CI configured — treat merged as success
    if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "FAILED";
    if (runs.some((r) => r.status !== "completed" || r.conclusion === null)) return "IN_PROGRESS";
    return "SUCCESS";
  } catch {
    return "SUCCESS";
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

interface GHCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author?: { login: string } | null;
}

interface GHCommitDetail extends GHCommit {
  stats?: { additions: number; deletions: number; total: number };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

function mapCommitBase(c: GHCommit, status: "SUCCESS" | "FAILED" | "IN_PROGRESS" = "SUCCESS") {
  const firstLine = c.commit.message.split("\n")[0] ?? "";
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: firstLine,
    fullMessage: c.commit.message,
    author: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
    status,
    branch: "main",
    environment: "production",
  };
}

function buildDeploymentDetail(
  data: GHCommitDetail,
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS",
) {
  const base = mapCommitBase(data, status);
  const pushedAt = new Date(base.date).getTime();
  const ageMs = Date.now() - pushedAt;
  const likelyDeployed = status !== "IN_PROGRESS" && ageMs > 3 * 60_000;
  const deployedAt = likelyDeployed ? new Date(pushedAt + 2.5 * 60 * 1000).toISOString() : null;
  const durationSec = likelyDeployed ? 150 : null;

  return {
    ...base,
    deployedAt,
    durationSec,
    likelyDeployed,
    migrationRan: null,
    rollbackAvailable: true,
    stats: data.stats ?? null,
    files: (data.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    })),
    repo: REPO,
  };
}

// ─── GET /admin/deployments — paginated commits (10 per page) ────────────────

router.get("/admin/deployments", async (req, res): Promise<void> => {
  const token = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=10&page=${page}&sha=main`,
      { headers: ghHeaders(token) },
    );
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub API returned ${ghRes.status}` });
      return;
    }
    const commits = (await ghRes.json()) as GHCommit[];

    // Fetch real CI status for each commit in parallel.
    // With a token, GitHub allows 5000 req/hour — 10 parallel check-run
    // requests are well within limits and resolve quickly (usually cached by GH).
    const statuses = await Promise.all(
      commits.map((c) => getCommitStatus(c.sha, token)),
    );

    const hasNextPage = commits.length === 10;
    res.json({
      commits: commits.map((c, i) => mapCommitBase(c, statuses[i] ?? "SUCCESS")),
      hasNextPage,
    });
  } catch (err) {
    req.log.error({ err }, "admin/deployments failed");
    res.status(502).json({ error: "Failed to reach GitHub API" });
  }
});

// ─── GET /admin/deployments/latest ────────────────────────────────────────────
// IMPORTANT: must be registered BEFORE /:sha to avoid being matched as sha="latest"

router.get("/admin/deployments/latest", async (req, res): Promise<void> => {
  const token = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO}/commits/main`,
      { headers: ghHeaders(token) },
    );
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub API returned ${ghRes.status}` });
      return;
    }
    const data = (await ghRes.json()) as GHCommitDetail;
    // Fetch real CI status for the latest commit
    const status = await getCommitStatus(data.sha, token);
    res.json(buildDeploymentDetail(data, status));
  } catch (err) {
    req.log.error({ err }, "admin/deployments/latest failed");
    res.status(502).json({ error: "Failed to reach GitHub API" });
  }
});

// ─── GET /admin/deployments/migrations ────────────────────────────────────────
// IMPORTANT: must be registered BEFORE /:sha to avoid being matched as sha="migrations"

/** Read the drizzle journal file to determine how many migrations are expected. */
function readJournalCount(): number | null {
  const candidates = [
    path.join(process.cwd(), "lib/db/drizzle/meta/_journal.json"),
    path.join(process.cwd(), "../../lib/db/drizzle/meta/_journal.json"),
    path.join(import.meta.dirname ?? __dirname, "../../../../../lib/db/drizzle/meta/_journal.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const journal = JSON.parse(raw) as { entries?: unknown[] };
      if (Array.isArray(journal.entries)) return journal.entries.length;
    } catch {
      // try next candidate
    }
  }
  return null;
}

router.get("/admin/deployments/migrations", async (req, res): Promise<void> => {
  try {
    const result = await pool.query<{
      id: number;
      hash: string;
      created_at: bigint;
    }>(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const rows = result.rows;
    if (rows.length === 0) {
      res.json({ migrations: [], latest: null, status: "pending", pendingCount: null });
      return;
    }

    const migrations = rows.map((r, i) => {
      const prevCreatedAt = rows[i + 1]?.created_at;
      const execTimeMs =
        prevCreatedAt != null
          ? Number(r.created_at) - Number(prevCreatedAt)
          : null;
      return {
        id: r.id,
        hash: r.hash,
        createdAt: new Date(Number(r.created_at)).toISOString(),
        execTimeMs,
      };
    });

    // Compare applied count against journal to detect unapplied migrations.
    const countRes = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount = parseInt(countRes.rows[0]?.count ?? "0", 10);
    const journalCount = readJournalCount();
    const pendingCount =
      journalCount != null ? Math.max(0, journalCount - appliedCount) : null;
    const status = pendingCount == null ? "ok" : pendingCount > 0 ? "pending" : "ok";

    res.json({ migrations, latest: migrations[0] ?? null, status, pendingCount });
  } catch (err) {
    req.log.error({ err }, "admin/deployments/migrations failed");
    res.json({ migrations: [], latest: null, status: "unavailable", pendingCount: null, error: "Migration table unavailable" });
  }
});

// ─── GET /admin/deployments/:sha/release-notes ────────────────────────────────
// IMPORTANT: must be registered BEFORE /:sha (plain) so Express doesn't swallow
// "release-notes" as a second path segment of the /:sha route.

router.get("/admin/deployments/:sha/release-notes", async (req, res): Promise<void> => {
  const { sha } = req.params;
  if (!sha) { res.status(400).json({ error: "Missing sha" }); return; }

  const cacheKey = `${RELEASE_NOTES_CACHE_PREFIX}${sha}`;

  // Check cache
  try {
    const [cached] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, cacheKey));
    if (cached?.value) {
      const parsed = JSON.parse(cached.value) as { notes: string; generatedAt: number };
      if (Date.now() - parsed.generatedAt < RELEASE_NOTES_TTL_MS) {
        res.json({ notes: parsed.notes, cached: true });
        return;
      }
    }
  } catch {
    // ignore cache errors, regenerate
  }

  // Fetch commit detail for context
  const token = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  let commitContext = "";
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO}/commits/${sha}`,
      { headers: ghHeaders(token) },
    );
    if (ghRes.ok) {
      const data = (await ghRes.json()) as GHCommitDetail;
      const files = (data.files ?? [])
        .map((f) => `  ${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`)
        .join("\n");
      commitContext = `Commit: ${data.commit.message}\nAuthor: ${data.commit.author.name}\nDate: ${data.commit.author.date}\nFiles changed:\n${files}`;
    }
  } catch {
    commitContext = `Commit SHA: ${sha}`;
  }

  const llmKey = await getManagedLlmKey();
  if (!llmKey) {
    res.status(503).json({ error: "No managed LLM key configured" });
    return;
  }

  try {
    const llmRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llmKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "You are a release notes writer for a SaaS product. Given a git commit and its changed files, write concise plain-English bullet points (3-6 bullets) describing what changed for the ops team. Focus on impact and what's new or fixed. No technical jargon. Start each bullet with •.",
          },
          { role: "user", content: commitContext },
        ],
        max_tokens: 400,
        temperature: 0.3,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => "");
      logger.warn({ sha, status: llmRes.status, errText }, "LLM release notes failed");
      res.status(502).json({ error: "LLM request failed" });
      return;
    }

    const llmData = await llmRes.json() as { choices: Array<{ message: { content: string } }> };
    const notes = llmData.choices?.[0]?.message?.content?.trim() ?? "";

    try {
      const cacheVal = JSON.stringify({ notes, generatedAt: Date.now() });
      await db
        .insert(platformSettingsTable)
        .values({ key: cacheKey, value: cacheVal })
        .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: cacheVal } });
    } catch (cacheErr) {
      logger.warn({ cacheErr }, "Failed to cache release notes");
    }

    res.json({ notes, cached: false });
  } catch (err) {
    req.log.error({ err }, "admin/deployments/:sha/release-notes failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /admin/deployments/:sha — single commit detail ───────────────────────
// IMPORTANT: registered LAST among /deployments/* routes so static sub-paths
// (/latest, /migrations, /:sha/release-notes) are matched first.

router.get("/admin/deployments/:sha", async (req, res): Promise<void> => {
  const token = process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];
  const { sha } = req.params;
  if (!sha) { res.status(400).json({ error: "Missing sha" }); return; }

  try {
    const [ghRes, status] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`, { headers: ghHeaders(token) }),
      getCommitStatus(sha, token),
    ]);
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub API returned ${ghRes.status}` });
      return;
    }
    const data = (await ghRes.json()) as GHCommitDetail;
    res.json(buildDeploymentDetail(data, status));
  } catch (err) {
    req.log.error({ err }, "admin/deployments/:sha failed");
    res.status(502).json({ error: "Failed to reach GitHub API" });
  }
});

// ─── GET /admin/env-info ──────────────────────────────────────────────────────

router.get("/admin/env-info", async (req, res): Promise<void> => {
  const adminToken = req.headers["x-admin-token"] as string | undefined;
  const superAdminToken = process.env["SUPER_ADMIN_TOKEN"];
  // If SUPER_ADMIN_TOKEN is set, only that specific token grants super-admin.
  // If unset, any authenticated admin is considered a super-admin (dev mode).
  const isSuperAdmin = superAdminToken
    ? !!adminToken && adminToken === superAdminToken
    : true;

  res.json({
    nodeEnv: process.env["NODE_ENV"] ?? "unknown",
    branch: process.env["RAILWAY_GIT_BRANCH"] ?? process.env["GIT_BRANCH"] ?? "main",
    commitSha: (process.env["RAILWAY_GIT_COMMIT_SHA"] ?? "").slice(0, 7) || null,
    railwayProjectName: process.env["RAILWAY_PROJECT_NAME"] ?? null,
    railwayEnvironment: process.env["RAILWAY_ENVIRONMENT"] ?? null,
    deploymentSource: process.env["RAILWAY_PROJECT_NAME"] ? "Railway" : "local",
    triggeredBy: process.env["RAILWAY_GIT_AUTHOR"] ?? null,
    repo: REPO,
    isSuperAdmin,
  });
});

export default router;
