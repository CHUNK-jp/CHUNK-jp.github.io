// devlog-core.mjs
//
// Pure functions for the DevLog auto-update system. No network access here —
// everything in this file is deterministic and safe to unit-test in isolation.

/** Repos tracked by the DevLog, mapped to their CHUNK-jp brand line. */
export const REPOS = [
  { name: 'chunk-jp.github.io', brand: 'Portal' },
  { name: 'attic', brand: 'Craft' },
  { name: 'mirrorhealth', brand: 'Craft' },
  { name: 'daily-pulse', brand: 'Craft' },
  { name: 'agent-watch', brand: 'Craft' },
  { name: 'pulsejournal', brand: 'Wonder' },
  { name: 'neiro', brand: 'Wonder' },
  { name: 'loan-calculator', brand: 'Browser Utilities' },
  { name: 'bmi-calculator', brand: 'Browser Utilities' },
  { name: 'encryption-tool', brand: 'Browser Utilities' },
];

/** Maximum number of entries retained in devlog.json (FIFO, oldest dropped first). */
export const MAX_ENTRIES = 50;

/** Maximum number of commits processed per repository, per run. */
export const MAX_COMMITS_PER_RUN = 5;

/** Number of commits processed on the first run for a repo with no recorded state. */
export const FIRST_RUN_COMMITS = 3;

const SKIP_PREFIXES = [
  'chore:',
  'chore(',
  'ci:',
  'ci(',
  'build:',
  'build(',
  'style:',
  'style(',
  'release:',
  'bump ',
];

/**
 * Decide whether a commit (GitHub REST "list commits" shape) should be
 * summarized for the DevLog.
 *
 * @param {object} commit
 * @returns {boolean}
 */
export function shouldSummarizeCommit(commit) {
  if (!commit) return false;

  // Merge commits: either 2+ parents, or a "Merge ..." first line (some
  // providers/backfills only carry the message, not accurate parent data).
  const parents = commit.parents;
  if (Array.isArray(parents) && parents.length >= 2) return false;

  const message = commit.commit?.message ?? '';
  const firstLine = message.split('\n')[0] ?? '';

  if (/^Merge /.test(firstLine)) return false;

  const lowerFirstLine = firstLine.toLowerCase();
  if (SKIP_PREFIXES.some((prefix) => lowerFirstLine.startsWith(prefix))) {
    return false;
  }

  if (message.includes('[skip devlog]')) return false;

  const authorLogin = commit.author?.login;
  if (typeof authorLogin === 'string' && authorLogin.endsWith('[bot]')) {
    return false;
  }

  return true;
}

/**
 * Select the commits that are "new" relative to `lastSha`, returned oldest
 * first, capped in size with the newer side taking priority when a cap is
 * applied.
 *
 * @param {object[]} commits GitHub API order: newest first.
 * @param {string|null|undefined} lastSha
 * @param {{ maxCount: number, firstRunCount: number }} options
 * @returns {object[]} oldest-first
 */
export function selectNewCommits(commits, lastSha, { maxCount, firstRunCount }) {
  if (!Array.isArray(commits) || commits.length === 0) return [];

  let selected;

  if (lastSha === null || lastSha === undefined) {
    // First run for this repo: take the newest `firstRunCount` commits.
    selected = commits.slice(0, firstRunCount);
  } else {
    const idx = commits.findIndex((c) => c.sha === lastSha);
    if (idx === -1) {
      // lastSha not found in the fetched window (e.g. force-push): fall
      // back to the newest `maxCount` commits.
      selected = commits.slice(0, maxCount);
    } else {
      // Commits strictly newer than lastSha are commits[0..idx-1].
      const newer = commits.slice(0, idx);
      // Cap at maxCount, keeping the newest ones (newer[0] is the newest).
      selected = newer.slice(0, maxCount);
    }
  }

  // selected is newest-first; return oldest-first.
  return selected.slice().reverse();
}

/**
 * Convert a UTC ISO date string to a JST (UTC+9) "YYYY-MM-DD" date string.
 * @param {string} isoDate
 * @returns {string}
 */
function toJstDateString(isoDate) {
  const utcMs = new Date(isoDate).getTime();
  const jstMs = utcMs + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build a devlog entry from a repo name, a summary string, and a commit
 * object (GitHub REST "list commits" or "get commit" shape).
 *
 * @param {{ repo: string, summary: string, commit: object }} params
 * @returns {{ date: string, repo: string, summary: string, commitUrl: string }}
 */
export function buildEntry({ repo, summary, commit }) {
  const authorDate = commit.commit.author.date;
  return {
    date: toJstDateString(authorDate),
    repo,
    summary,
    commitUrl: commit.html_url,
  };
}

/**
 * Merge newly built entries (oldest-first) into the existing entries array
 * (assumed newest-first), producing a newest-first array capped at `max`
 * entries (oldest entries dropped first, FIFO).
 *
 * @param {object[]} existing newest-first
 * @param {object[]} incoming oldest-first
 * @param {number} [max]
 * @returns {object[]} newest-first, length <= max
 */
export function mergeEntries(existing, incoming, max = MAX_ENTRIES) {
  const incomingNewestFirst = incoming.slice().reverse();
  const merged = [...incomingNewestFirst, ...existing];
  // Repos are processed one at a time, so without this sort a later-processed
  // repo's older commits would sit above earlier-processed newer ones — and
  // the FIFO cut below could then drop newer entries instead of the oldest.
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return merged.slice(0, max);
}

/**
 * Build a Japanese-language description of a commit's file changes from a
 * GitHub "get commit" detail response (`{ stats, files }`).
 *
 * @param {{ stats?: { additions?: number, deletions?: number }, files?: object[] }} [detail]
 * @returns {string}
 */
export function describeChanges(detail) {
  if (!detail || !Array.isArray(detail.files) || detail.files.length === 0) {
    return '(変更ファイル情報なし)';
  }

  const files = detail.files;
  const totalAdditions =
    detail.stats?.additions ?? files.reduce((sum, f) => sum + (f.additions || 0), 0);
  const totalDeletions =
    detail.stats?.deletions ?? files.reduce((sum, f) => sum + (f.deletions || 0), 0);

  const shown = files.slice(0, 10);
  const remaining = files.length - shown.length;

  const fileDescriptions = shown.map(
    (f) => `${f.filename} (+${f.additions ?? 0}/-${f.deletions ?? 0})`,
  );

  let filesPart = fileDescriptions.join(', ');
  if (remaining > 0) {
    filesPart += `, …ほか${remaining}件`;
  }

  return `変更ファイル ${files.length}件（+${totalAdditions} / -${totalDeletions}）: ${filesPart}`;
}
