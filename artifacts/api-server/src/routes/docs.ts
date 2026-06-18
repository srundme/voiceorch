import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

interface ChangelogEntry {
  sha: string;
  type: string;
  scope: string | null;
  description: string;
  date: string;
}

interface ChangelogRelease {
  date: string;
  dateLabel: string;
  features: ChangelogEntry[];
  fixes: ChangelogEntry[];
  improvements: ChangelogEntry[];
  other: ChangelogEntry[];
}

const SKIP_PREFIXES = ["Merge ", "Initial commit"];
const SKIP_TYPES = new Set(["chore", "ci", "test", "wip", "style"]);

function parseEntry(sha: string, rawMessage: string, date: string): ChangelogEntry | null {
  const firstLine = rawMessage.split("\n")[0].trim();

  if (SKIP_PREFIXES.some((p) => firstLine.startsWith(p))) return null;

  const m = firstLine.match(/^(feat|fix|refactor|perf|docs|build|revert)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (m) {
    const [, type, , scope, , description] = m;
    if (SKIP_TYPES.has(type)) return null;
    return { sha, type, scope: scope ?? null, description: description.trim(), date };
  }

  // Non-conventional commits — include meaningful ones as "other"
  if (firstLine.length > 8 && !firstLine.match(/^(chore|ci|test|wip)/i)) {
    return { sha, type: "other", scope: null, description: firstLine, date };
  }

  return null;
}

function weekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0]!;
}

router.get("/docs/changelog", async (req, res) => {
  try {
    const token = process.env["GITHUB_PAT"];
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SnapServe-Docs/1.0",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const ghRes = await fetch(
      "https://api.github.com/repos/srundme/voiceorch/commits?sha=main&per_page=100",
      { headers }
    );

    if (!ghRes.ok) {
      const body = await ghRes.text();
      logger.warn({ status: ghRes.status, body }, "GitHub API error fetching changelog — returning empty");
      res.json([]);
      return;
    }

    const commits = (await ghRes.json()) as GitHubCommit[];
    const weekMap = new Map<string, ChangelogEntry[]>();

    for (const c of commits) {
      const entry = parseEntry(c.sha, c.commit.message, c.commit.author.date);
      if (!entry) continue;
      const key = weekStart(c.commit.author.date);
      if (!weekMap.has(key)) weekMap.set(key, []);
      weekMap.get(key)!.push(entry);
    }

    const releases: ChangelogRelease[] = Array.from(weekMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entries]) => {
        const d = new Date(date);
        return {
          date,
          dateLabel: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          features: entries.filter((e) => e.type === "feat"),
          fixes: entries.filter((e) => e.type === "fix"),
          improvements: entries.filter((e) => ["refactor", "perf", "build", "docs"].includes(e.type)),
          other: entries.filter((e) => e.type === "other"),
        };
      });

    res.json(releases);
  } catch (err) {
    logger.error({ err }, "Failed to fetch changelog — returning empty");
    res.json([]);
  }
});

export default router;
