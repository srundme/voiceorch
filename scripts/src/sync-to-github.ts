/**
 * Sync local commits to GitHub via the Git Data API.
 *
 * Strategy:
 *   1. Get GitHub's current HEAD + full recursive tree (blob SHAs).
 *   2. Get local HEAD tree via `git ls-tree -r HEAD` (blob SHAs).
 *   3. Upload blobs only for files whose SHA differs (new or changed).
 *   4. Build a new tree using `base_tree` so unchanged files are inherited.
 *   5. Create a commit + fast-forward the ref.
 *
 * This avoids uploading identical blobs and makes incremental pushes fast.
 * On initial sync with diverged histories, only truly changed files are uploaded.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const TOKEN =
  process.env["GITHUB_PERSONAL_ACCESS_TOKEN"] ??
  process.env["GITHUB_PAT"] ??
  "";

if (!TOKEN) {
  console.error("ERROR: GITHUB_PERSONAL_ACCESS_TOKEN is not set");
  process.exit(1);
}

const OWNER  = "srundme";
const REPO   = "voiceorch";
const BRANCH = "main";
const API    = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function gh(urlPath: string, init: RequestInit = {}) {
  const url = urlPath.startsWith("http") ? urlPath : `${API}/${urlPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 400)}`);
  }
  return res.json() as Promise<any>;
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha?: string | null;
}

async function main() {
  // ── 1. Resolve local HEAD ────────────────────────────────────────────────
  const localHead = git("git rev-parse HEAD");
  console.log(`Local HEAD : ${localHead}`);

  // ── 2. Get GitHub's current HEAD and tree ────────────────────────────────
  let githubHead = "";
  let githubTreeSha = "";
  const githubBlobs: Map<string, string> = new Map(); // path → sha

  try {
    const ref = await gh(`git/refs/heads/${BRANCH}`);
    githubHead = ref.object.sha as string;
    console.log(`GitHub HEAD: ${githubHead}`);

    // Fetch GitHub's full recursive tree for SHA comparison
    const parentCommit = await gh(`git/commits/${githubHead}`);
    githubTreeSha = parentCommit.tree.sha as string;

    let page = await gh(`git/trees/${githubTreeSha}?recursive=1`);
    for (const entry of page.tree ?? []) {
      if (entry.type === "blob") {
        githubBlobs.set(entry.path, entry.sha);
      }
    }
    if (page.truncated) {
      // Very large repos: fall back to full blob uploads for missing entries
      console.log("Warning: GitHub tree was truncated — some blobs may be re-uploaded.");
    }
    console.log(`GitHub tree: ${githubBlobs.size} blobs indexed`);
  } catch (err: any) {
    if (err.message?.includes("404") || err.message?.includes("not found")) {
      console.log("GitHub HEAD: (branch not found — will create)");
    } else {
      throw err;
    }
  }

  // ── 3. Build local blob map via git ls-tree ───────────────────────────────
  // Format: <mode> blob <sha>\t<path>
  const lsTree = git("git ls-tree -r HEAD");
  const localBlobs: Map<string, { sha: string; mode: string }> = new Map();
  for (const line of lsTree.split("\n").filter(Boolean)) {
    const m = line.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/);
    if (m) localBlobs.set(m[3]!, { sha: m[2]!, mode: m[1]! });
  }
  console.log(`Local tree : ${localBlobs.size} blobs`);

  // ── 4. Find files that need uploading ────────────────────────────────────
  const toUpload: string[] = [];
  for (const [filePath, { sha }] of localBlobs) {
    if (githubBlobs.get(filePath) !== sha) {
      toUpload.push(filePath);
    }
  }

  // Detect deleted files (in GitHub but not in local tree)
  const deletedPaths: string[] = [];
  for (const ghPath of githubBlobs.keys()) {
    if (!localBlobs.has(ghPath)) {
      deletedPaths.push(ghPath);
    }
  }

  console.log(
    `Changed: ${toUpload.length} file(s) to upload, ${deletedPaths.length} deleted`
  );

  if (toUpload.length === 0 && deletedPaths.length === 0) {
    console.log("Already in sync. Nothing to push.");
    return;
  }

  // ── 5. Upload blobs for changed/new files ────────────────────────────────
  const newTreeEntries: TreeEntry[] = [];

  for (let i = 0; i < toUpload.length; i++) {
    const relPath = toUpload[i]!;
    const { mode } = localBlobs.get(relPath)!;
    const absPath = path.join(REPO_ROOT, relPath);

    console.log(`  uploading [${i + 1}/${toUpload.length}]: ${relPath}`);

    if (!fs.existsSync(absPath)) {
      console.log(`  skipped (not on disk): ${relPath}`);
      continue;
    }

    const content = fs.readFileSync(absPath);
    const blob = await gh("git/blobs", {
      method: "POST",
      body: JSON.stringify({
        content: content.toString("base64"),
        encoding: "base64",
      }),
    });
    console.log(`  blob sha: ${blob.sha}`);

    newTreeEntries.push({
      path: relPath,
      mode: mode === "100755" ? "100755" : "100644",
      type: "blob",
      sha: blob.sha as string,
    });
  }

  // Deletions: sha must be null explicitly — GitHub Trees API uses null to signal removal
  for (const relPath of deletedPaths) {
    newTreeEntries.push({
      path: relPath,
      mode: "100644",
      type: "blob",
      sha: null,
    });
  }

  // ── 6. Create new tree ────────────────────────────────────────────────────
  if (newTreeEntries.length === 0) {
    console.log("Nothing to push after filtering (all changed files were absent locally — already in sync).");
    return;
  }

  const treePayload: Record<string, unknown> = { tree: newTreeEntries };
  if (githubTreeSha) treePayload["base_tree"] = githubTreeSha;

  const newTree = await gh("git/trees", {
    method: "POST",
    body: JSON.stringify(treePayload),
  });
  console.log(`New tree  : ${newTree.sha}`);

  // ── 7. Build commit message ───────────────────────────────────────────────
  const latestMsg = git("git log -1 --pretty=format:%s HEAD");
  let commitCount = 1;
  if (githubHead) {
    try {
      // Count local commits since the GitHub HEAD (if in history)
      commitCount = parseInt(
        git(`git rev-list --count ${githubHead}..HEAD`),
        10
      );
    } catch {
      commitCount = parseInt(git("git rev-list --count HEAD"), 10);
    }
  } else {
    commitCount = parseInt(git("git rev-list --count HEAD"), 10);
  }

  const message =
    commitCount > 1
      ? `sync: ${commitCount} commits — latest: ${latestMsg}`
      : `sync: ${latestMsg}`;

  // ── 8. Create commit ──────────────────────────────────────────────────────
  const commitPayload: Record<string, unknown> = {
    message,
    tree: newTree.sha,
    ...(githubHead ? { parents: [githubHead] } : {}),
  };

  const newCommit = await gh("git/commits", {
    method: "POST",
    body: JSON.stringify(commitPayload),
  });
  console.log(`New commit: ${newCommit.sha}`);

  // ── 9. Update / create the branch ref ────────────────────────────────────
  if (githubHead) {
    await gh(`git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha, force: true }),
    });
  } else {
    await gh("git/refs", {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${BRANCH}`,
        sha: newCommit.sha,
      }),
    });
  }

  console.log(
    `\nDone — synced ${newTreeEntries.length} file change(s) to ${OWNER}/${REPO}@${BRANCH}.`
  );
  console.log("Railway will redeploy automatically.");
}

main().catch((err) => {
  console.error("Sync failed:", err.message ?? err);
  process.exit(1);
});
