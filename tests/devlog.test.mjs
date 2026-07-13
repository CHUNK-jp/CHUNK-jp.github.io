// tests/devlog.test.mjs
//
// Coverage for the DevLog auto-update system. Pure unit tests for
// scripts/lib/devlog-core.mjs, plus an integration test for
// scripts/lib/run-update.mjs with fetch/summarize fully mocked — no real
// network access is made anywhere in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  shouldSummarizeCommit,
  selectNewCommits,
  buildEntry,
  mergeEntries,
  describeChanges,
  MAX_ENTRIES,
  MAX_COMMITS_PER_RUN,
  FIRST_RUN_COMMITS,
} from '../scripts/lib/devlog-core.mjs';
import { runUpdate } from '../scripts/lib/run-update.mjs';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal GitHub "list commits" style commit object.
 */
function makeCommit({
  sha,
  message,
  date = '2026-07-12T08:00:00Z',
  login = 'someone',
  parents = [{ sha: 'parent-sha' }],
} = {}) {
  return {
    sha,
    commit: {
      message,
      author: { name: 'Someone', email: 'someone@example.com', date },
    },
    author: login === null ? null : { login },
    parents,
    html_url: `https://github.com/CHUNK-jp/neiro/commit/${sha}`,
  };
}

// ---------------------------------------------------------------------------
// shouldSummarizeCommit
// ---------------------------------------------------------------------------

test('shouldSummarizeCommit: normal commit is summarized', () => {
  const commit = makeCommit({ sha: 'a1', message: 'Add dark mode toggle' });
  assert.equal(shouldSummarizeCommit(commit), true);
});

test('shouldSummarizeCommit: merge commit (2 parents) is skipped', () => {
  const commit = makeCommit({
    sha: 'a2',
    message: 'Add feature X',
    parents: [{ sha: 'p1' }, { sha: 'p2' }],
  });
  assert.equal(shouldSummarizeCommit(commit), false);
});

test('shouldSummarizeCommit: "Merge branch ..." message is skipped', () => {
  const commit = makeCommit({
    sha: 'a3',
    message: 'Merge branch \'main\' into feature/x',
    parents: [{ sha: 'p1' }],
  });
  assert.equal(shouldSummarizeCommit(commit), false);
});

test('shouldSummarizeCommit: chore:/ci:/build:/style:/release:/bump prefixes are skipped', () => {
  const messages = [
    'chore: update deps',
    'chore(devlog): update devlog.json',
    'ci: fix workflow',
    'ci(actions): bump node version',
    'build: update webpack config',
    'build(deps): bump lodash',
    'style: reformat with prettier',
    'style(lint): fix eslint warnings',
    'release: v1.2.3',
    'bump version to 1.2.3',
  ];
  for (const message of messages) {
    const commit = makeCommit({ sha: `s-${message}`, message });
    assert.equal(
      shouldSummarizeCommit(commit),
      false,
      `expected "${message}" to be filtered`,
    );
  }
});

test('shouldSummarizeCommit: uppercase prefix "Chore:" is still filtered (case-insensitive)', () => {
  const commit = makeCommit({ sha: 'a4', message: 'Chore: tidy up' });
  assert.equal(shouldSummarizeCommit(commit), false);
});

test('shouldSummarizeCommit: github-actions[bot] author is skipped', () => {
  const commit = makeCommit({
    sha: 'a5',
    message: 'Update generated file',
    login: 'github-actions[bot]',
  });
  assert.equal(shouldSummarizeCommit(commit), false);
});

test('shouldSummarizeCommit: [skip devlog] marker is skipped', () => {
  const commit = makeCommit({
    sha: 'a6',
    message: 'Tweak internal script\n\n[skip devlog]',
  });
  assert.equal(shouldSummarizeCommit(commit), false);
});

// ---------------------------------------------------------------------------
// selectNewCommits
// ---------------------------------------------------------------------------

test('selectNewCommits: lastSha in the middle returns only newer commits, oldest first', () => {
  // Newest first, as the GitHub API returns them.
  const c5 = makeCommit({ sha: 'c5', message: '5' });
  const c4 = makeCommit({ sha: 'c4', message: '4' });
  const c3 = makeCommit({ sha: 'c3', message: '3' });
  const c2 = makeCommit({ sha: 'c2', message: '2' });
  const c1 = makeCommit({ sha: 'c1', message: '1' });
  const commits = [c5, c4, c3, c2, c1];

  const result = selectNewCommits(commits, 'c3', { maxCount: 5, firstRunCount: 3 });

  assert.deepEqual(
    result.map((c) => c.sha),
    ['c4', 'c5'],
  );
});

test('selectNewCommits: lastSha at the front returns an empty array', () => {
  const c2 = makeCommit({ sha: 'c2', message: '2' });
  const c1 = makeCommit({ sha: 'c1', message: '1' });
  const commits = [c2, c1];

  const result = selectNewCommits(commits, 'c2', { maxCount: 5, firstRunCount: 3 });

  assert.deepEqual(result, []);
});

test('selectNewCommits: lastSha unset (first run) returns the newest firstRunCount commits', () => {
  const c5 = makeCommit({ sha: 'c5', message: '5' });
  const c4 = makeCommit({ sha: 'c4', message: '4' });
  const c3 = makeCommit({ sha: 'c3', message: '3' });
  const c2 = makeCommit({ sha: 'c2', message: '2' });
  const c1 = makeCommit({ sha: 'c1', message: '1' });
  const commits = [c5, c4, c3, c2, c1];

  const result = selectNewCommits(commits, undefined, { maxCount: 5, firstRunCount: 3 });

  assert.deepEqual(
    result.map((c) => c.sha),
    ['c3', 'c4', 'c5'],
  );
});

test('selectNewCommits: lastSha not found returns the newest maxCount commits', () => {
  const commits = Array.from({ length: 8 }, (_, i) =>
    makeCommit({ sha: `c${8 - i}`, message: `${8 - i}` }),
  ); // c8..c1, newest first

  const result = selectNewCommits(commits, 'does-not-exist', {
    maxCount: 5,
    firstRunCount: 3,
  });

  assert.deepEqual(
    result.map((c) => c.sha),
    ['c4', 'c5', 'c6', 'c7', 'c8'],
  );
});

test('selectNewCommits: exceeding maxCount keeps the newer side', () => {
  // 10 commits, newest first; lastSha is 6 commits back — more than maxCount(5).
  const commits = Array.from({ length: 10 }, (_, i) =>
    makeCommit({ sha: `c${10 - i}`, message: `${10 - i}` }),
  ); // c10..c1
  // lastSha = c4 -> commits newer than c4 are c5..c10 (6 commits)
  const result = selectNewCommits(commits, 'c4', { maxCount: 5, firstRunCount: 3 });

  // Should keep the 5 NEWEST of the 6 new commits: c6..c10, oldest-first.
  assert.deepEqual(
    result.map((c) => c.sha),
    ['c6', 'c7', 'c8', 'c9', 'c10'],
  );
});

// ---------------------------------------------------------------------------
// buildEntry
// ---------------------------------------------------------------------------

test('buildEntry: converts UTC commit date to JST, crossing the day boundary', () => {
  const commit = makeCommit({
    sha: 'jst1',
    message: 'Fix bug',
    date: '2026-07-12T16:30:00Z', // 2026-07-13 01:30 JST
  });
  const entry = buildEntry({ repo: 'neiro', summary: 'バグを修正しました', commit });
  assert.equal(entry.date, '2026-07-13');
});

test('buildEntry: converts UTC commit date to JST, same day', () => {
  const commit = makeCommit({
    sha: 'jst2',
    message: 'Add feature',
    date: '2026-07-12T08:00:00Z', // 2026-07-12 17:00 JST
  });
  const entry = buildEntry({ repo: 'neiro', summary: '機能を追加しました', commit });
  assert.equal(entry.date, '2026-07-12');
});

test('buildEntry: sets repo, summary, and commitUrl from commit.html_url', () => {
  const commit = makeCommit({ sha: 'urltest', message: 'Something' });
  const entry = buildEntry({ repo: 'neiro', summary: '要約', commit });
  assert.equal(entry.repo, 'neiro');
  assert.equal(entry.summary, '要約');
  assert.equal(entry.commitUrl, commit.html_url);
  assert.equal(entry.commitUrl, 'https://github.com/CHUNK-jp/neiro/commit/urltest');
});

// ---------------------------------------------------------------------------
// mergeEntries
// ---------------------------------------------------------------------------

test('mergeEntries: incoming entries are added newest-first ahead of existing', () => {
  const existing = [{ repo: 'neiro', summary: 'existing-1', date: '2026-07-10' }];
  const incoming = [
    // oldest-first, as produced by the runner
    { repo: 'neiro', summary: 'new-older', date: '2026-07-11' },
    { repo: 'neiro', summary: 'new-newer', date: '2026-07-12' },
  ];

  const result = mergeEntries(existing, incoming);

  assert.deepEqual(
    result.map((e) => e.summary),
    ['new-newer', 'new-older', 'existing-1'],
  );
});

test('mergeEntries: caps at MAX_ENTRIES, dropping the oldest (FIFO)', () => {
  // existing: 48 entries, newest-first (e1 newest ... e48 oldest)
  const existing = Array.from({ length: 48 }, (_, i) => ({
    repo: 'neiro',
    summary: `e${i + 1}`,
  }));
  // incoming: 5 new entries, oldest-first (n1 oldest ... n5 newest)
  const incoming = Array.from({ length: 5 }, (_, i) => ({
    repo: 'neiro',
    summary: `n${i + 1}`,
  }));

  const result = mergeEntries(existing, incoming, MAX_ENTRIES);

  assert.equal(result.length, 50);
  // Newest-first: n5..n1, then e1..e45 (e46, e47, e48 dropped as oldest).
  assert.deepEqual(result.slice(0, 5).map((e) => e.summary), [
    'n5',
    'n4',
    'n3',
    'n2',
    'n1',
  ]);
  assert.equal(result[49].summary, 'e45');
  assert.ok(!result.some((e) => e.summary === 'e46'));
  assert.ok(!result.some((e) => e.summary === 'e47'));
  assert.ok(!result.some((e) => e.summary === 'e48'));
});

test('mergeEntries: result is sorted by date descending across repos', () => {
  // A later-processed repo (incoming) can carry commits older than entries
  // already in the file — the merge must still end up newest-first overall.
  const existing = [
    { repo: 'chunk-jp.github.io', summary: 'portal-new', date: '2026-07-13' },
    { repo: 'neiro', summary: 'neiro-mid', date: '2026-07-01' },
  ];
  const incoming = [
    { repo: 'encryption-tool', summary: 'util-old', date: '2026-06-27' },
    { repo: 'encryption-tool', summary: 'util-older-but-listed-later', date: '2026-06-27' },
  ];

  const result = mergeEntries(existing, incoming);

  assert.deepEqual(
    result.map((e) => e.summary),
    ['portal-new', 'neiro-mid', 'util-older-but-listed-later', 'util-old'],
  );

  // FIFO cap must drop by oldest date, not by processing order.
  const capped = mergeEntries(existing, incoming, 3);
  assert.deepEqual(
    capped.map((e) => e.summary),
    ['portal-new', 'neiro-mid', 'util-older-but-listed-later'],
  );
});

test('mergeEntries: exactly at the cap keeps everything', () => {
  const existing = Array.from({ length: 45 }, (_, i) => ({ summary: `e${i + 1}` }));
  const incoming = Array.from({ length: 5 }, (_, i) => ({ summary: `n${i + 1}` }));

  const result = mergeEntries(existing, incoming, MAX_ENTRIES);

  assert.equal(result.length, 50);
});

// ---------------------------------------------------------------------------
// describeChanges
// ---------------------------------------------------------------------------

test('describeChanges: normal detail produces a Japanese summary string', () => {
  const detail = {
    stats: { additions: 120, deletions: 8 },
    files: [
      { filename: 'src/app.js', additions: 80, deletions: 2 },
      { filename: 'foo.js', additions: 40, deletions: 6 },
    ],
  };
  const result = describeChanges(detail);
  assert.equal(
    result,
    '変更ファイル 2件（+120 / -8）: src/app.js (+80/-2), foo.js (+40/-6)',
  );
});

test('describeChanges: 11+ files are truncated with a "…ほかN件" suffix', () => {
  const files = Array.from({ length: 13 }, (_, i) => ({
    filename: `file${i + 1}.js`,
    additions: 1,
    deletions: 0,
  }));
  const detail = { stats: { additions: 13, deletions: 0 }, files };
  const result = describeChanges(detail);

  assert.ok(result.startsWith('変更ファイル 13件（+13 / -0）: '));
  assert.ok(result.includes('…ほか3件'));
  // Only the first 10 filenames should appear.
  assert.ok(result.includes('file10.js'));
  assert.ok(!result.includes('file11.js'));
});

test('describeChanges: missing detail returns the fallback string', () => {
  assert.equal(describeChanges(undefined), '(変更ファイル情報なし)');
  assert.equal(describeChanges(null), '(変更ファイル情報なし)');
  assert.equal(describeChanges({}), '(変更ファイル情報なし)');
  assert.equal(describeChanges({ files: [] }), '(変更ファイル情報なし)');
});

// ---------------------------------------------------------------------------
// runUpdate (integration, fully mocked — no real network access)
// ---------------------------------------------------------------------------

/**
 * Build a fetch mock that answers GitHub "list commits" and "get commit"
 * requests from in-memory fixtures, and throws for anything unexpected
 * (guarding against accidental real network access).
 *
 * @param {{ commitsByRepo?: Record<string, object[]>, detailsByKey?: Record<string, object> }} fixtures
 */
function makeFetchMock({ commitsByRepo = {}, detailsByKey = {} } = {}) {
  return async function fetchMock(url) {
    const listMatch = url.match(
      /^https:\/\/api\.github\.com\/repos\/CHUNK-jp\/([^/]+)\/commits\?per_page=\d+$/,
    );
    if (listMatch) {
      const repo = listMatch[1];
      const list = commitsByRepo[repo] ?? [];
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => list,
        text: async () => JSON.stringify(list),
      };
    }

    const detailMatch = url.match(
      /^https:\/\/api\.github\.com\/repos\/CHUNK-jp\/([^/]+)\/commits\/([^/]+)$/,
    );
    if (detailMatch) {
      const [, repo, sha] = detailMatch;
      const key = `${repo}:${sha}`;
      const detail = detailsByKey[key];
      if (!detail) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({}),
          text: async () => 'not found',
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => detail,
        text: async () => JSON.stringify(detail),
      };
    }

    throw new Error(`Unexpected fetch() call in test: ${url}`);
  };
}

function makeSummarizeMock() {
  const calls = [];
  const fn = async ({ repo, brand, message, changes }) => {
    calls.push({ repo, brand, message, changes });
    return `モック要約: ${message}`;
  };
  fn.calls = calls;
  return fn;
}

async function withTempDevlog(initial, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devlog-test-'));
  const devlogPath = path.join(dir, 'devlog.json');
  writeFileSync(devlogPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  try {
    // Await here — fn is async, and the temp dir must not be removed until
    // it has fully finished reading/writing devlog.json.
    return await fn(devlogPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('runUpdate: summarizes only new commits and skips filtered ones; state advances to the latest sha', async () => {
  await withTempDevlog({ entries: [], state: { neiro: 'c1' } }, async (devlogPath) => {
    const c1 = makeCommit({ sha: 'c1', message: 'Initial commit', date: '2026-07-01T00:00:00Z' });
    const c2 = makeCommit({ sha: 'c2', message: 'Add search feature', date: '2026-07-02T00:00:00Z' });
    const c3 = makeCommit({ sha: 'c3', message: 'chore: bump deps', date: '2026-07-03T00:00:00Z' });
    const c4 = makeCommit({ sha: 'c4', message: 'Improve error handling', date: '2026-07-04T00:00:00Z' });

    const fetchImpl = makeFetchMock({
      commitsByRepo: { neiro: [c4, c3, c2, c1] }, // newest first
      detailsByKey: {
        'neiro:c2': { stats: { additions: 5, deletions: 1 }, files: [{ filename: 'a.js', additions: 5, deletions: 1 }] },
        'neiro:c4': { stats: { additions: 3, deletions: 0 }, files: [{ filename: 'b.js', additions: 3, deletions: 0 }] },
      },
    });
    const summarize = makeSummarizeMock();

    const result = await runUpdate({
      devlogPath,
      apiKey: 'test-key',
      token: undefined,
      fetchImpl,
      summarize,
      log: () => {},
    });

    // Only c2 and c4 should have been summarized (c3 is chore: and filtered).
    assert.equal(summarize.calls.length, 2);
    assert.ok(summarize.calls.some((c) => c.message === 'Add search feature'));
    assert.ok(summarize.calls.some((c) => c.message === 'Improve error handling'));
    assert.ok(!summarize.calls.some((c) => c.message.includes('bump deps')));

    assert.equal(result.added, 2);
    // Newest first: c4's entry, then c2's entry.
    assert.equal(result.entries.length, 2);
    assert.match(result.entries[0].summary, /Improve error handling/);
    assert.match(result.entries[1].summary, /Add search feature/);

    const written = JSON.parse(readFileSync(devlogPath, 'utf8'));
    assert.equal(written.state.neiro, 'c4');
  });
});

test('runUpdate: dry run uses the commit message as summary and never calls summarize', async () => {
  await withTempDevlog({ entries: [], state: {} }, async (devlogPath) => {
    const c1 = makeCommit({ sha: 'd1', message: 'Add offline mode', date: '2026-07-05T00:00:00Z' });

    const fetchImpl = makeFetchMock({ commitsByRepo: { neiro: [c1] } });
    const summarize = makeSummarizeMock();

    const result = await runUpdate({
      devlogPath,
      apiKey: undefined,
      dryRun: true,
      fetchImpl,
      summarize,
      log: () => {},
    });

    assert.equal(summarize.calls.length, 0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].summary, 'Add offline mode');

    const written = JSON.parse(readFileSync(devlogPath, 'utf8'));
    assert.equal(written.state.neiro, 'd1');
  });
});

test('runUpdate: state only advances to the last successfully summarized commit when summarize fails mid-way', async () => {
  await withTempDevlog({ entries: [], state: {} }, async (devlogPath) => {
    // First run for neiro: FIRST_RUN_COMMITS = 3, but we only give 2 commits.
    const c1 = makeCommit({ sha: 'f1', message: 'First commit', date: '2026-07-06T00:00:00Z' });
    const c2 = makeCommit({ sha: 'f2', message: 'Second commit', date: '2026-07-07T00:00:00Z' });

    const fetchImpl = makeFetchMock({
      commitsByRepo: { neiro: [c2, c1] }, // newest first
      detailsByKey: {
        'neiro:f1': { stats: { additions: 1, deletions: 0 }, files: [{ filename: 'a.js', additions: 1, deletions: 0 }] },
        'neiro:f2': { stats: { additions: 1, deletions: 0 }, files: [{ filename: 'b.js', additions: 1, deletions: 0 }] },
      },
    });

    // Succeeds for f1 (processed first, oldest-first), fails for f2.
    const logs = [];
    const summarize = async ({ message }) => {
      if (message === 'Second commit') {
        throw new Error('simulated API failure');
      }
      return `モック要約: ${message}`;
    };

    const result = await runUpdate({
      devlogPath,
      apiKey: 'test-key',
      fetchImpl,
      summarize,
      log: (msg) => logs.push(msg),
    });

    // Only f1 was fully processed and summarized.
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0].summary, /First commit/);

    const written = JSON.parse(readFileSync(devlogPath, 'utf8'));
    // State should stop at f1 (last success), not advance to f2.
    assert.equal(written.state.neiro, 'f1');

    // A warning should have been logged for the failure.
    assert.ok(logs.some((l) => l.includes('neiro') && l.includes('f2')));
  });
});

test('runUpdate: running twice in a row does not produce duplicate entries', async () => {
  await withTempDevlog({ entries: [], state: {} }, async (devlogPath) => {
    const c1 = makeCommit({ sha: 'g1', message: 'Only commit', date: '2026-07-08T00:00:00Z' });

    const fetchImpl = makeFetchMock({
      commitsByRepo: { neiro: [c1] },
      detailsByKey: {
        'neiro:g1': { stats: { additions: 2, deletions: 0 }, files: [{ filename: 'a.js', additions: 2, deletions: 0 }] },
      },
    });
    const summarize = makeSummarizeMock();

    const first = await runUpdate({
      devlogPath,
      apiKey: 'test-key',
      fetchImpl,
      summarize,
      log: () => {},
    });
    assert.equal(first.entries.length, 1);

    // Second run: same commit list, same fetch mock. selectNewCommits
    // should now find no new commits since state.neiro === 'g1'.
    const second = await runUpdate({
      devlogPath,
      apiKey: 'test-key',
      fetchImpl,
      summarize,
      log: () => {},
    });

    assert.equal(second.added, 0);
    assert.equal(second.entries.length, 1);
    assert.equal(summarize.calls.length, 1); // still only the first call

    const written = JSON.parse(readFileSync(devlogPath, 'utf8'));
    assert.equal(written.state.neiro, 'g1');
    assert.equal(written.entries.length, 1);
  });
});

test('runUpdate: writes devlog.json with 2-space indentation and a trailing newline', async () => {
  await withTempDevlog({ entries: [], state: {} }, async (devlogPath) => {
    const c1 = makeCommit({ sha: 'h1', message: 'Formatting check', date: '2026-07-09T00:00:00Z' });
    const fetchImpl = makeFetchMock({
      commitsByRepo: { neiro: [c1] },
      detailsByKey: {
        'neiro:h1': { stats: { additions: 1, deletions: 0 }, files: [{ filename: 'a.js', additions: 1, deletions: 0 }] },
      },
    });
    const summarize = makeSummarizeMock();

    await runUpdate({ devlogPath, apiKey: 'test-key', fetchImpl, summarize, log: () => {} });

    const raw = readFileSync(devlogPath, 'utf8');
    assert.ok(raw.endsWith('\n'));
    assert.ok(raw.includes('\n  "entries"'));
    assert.ok(raw.includes('\n    {')); // entry objects indented 4 spaces
  });
});
