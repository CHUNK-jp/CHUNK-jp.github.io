// run-update.mjs
//
// Orchestrates a single DevLog update run: for each tracked repo, fetch
// recent commits, work out which ones are new, filter + summarize them, and
// merge the results into devlog.json. All external effects (HTTP, file I/O,
// summarization) are dependency-injected so this is fully unit-testable.

import { readFile, writeFile } from 'node:fs/promises';
import {
  REPOS,
  MAX_ENTRIES,
  MAX_COMMITS_PER_RUN,
  FIRST_RUN_COMMITS,
  shouldSummarizeCommit,
  selectNewCommits,
  buildEntry,
  mergeEntries,
  describeChanges,
} from './devlog-core.mjs';
import { fetchRecentCommits, fetchCommitDetail } from './github-api.mjs';
import { summarizeCommit } from './summarize.mjs';

/**
 * @param {{
 *   devlogPath: string,
 *   apiKey?: string,
 *   token?: string,
 *   dryRun?: boolean,
 *   fetchImpl?: typeof fetch,
 *   summarize?: typeof summarizeCommit,
 *   log?: (...args: any[]) => void,
 * }} params
 * @returns {Promise<{ added: number, entries: object[] }>}
 */
export async function runUpdate({
  devlogPath,
  apiKey,
  token,
  dryRun = false,
  fetchImpl = fetch,
  summarize = summarizeCommit,
  log = console.log,
}) {
  const raw = await readFile(devlogPath, 'utf8');
  const devlog = JSON.parse(raw);
  if (!devlog.entries) devlog.entries = [];
  if (!devlog.state) devlog.state = {};

  let totalAdded = 0;
  // Counts repos we got far enough into to at least attempt processing
  // (i.e. fetchRecentCommits succeeded). A repo that fails mid-way through
  // summarizing one commit still counts here, since earlier commits in the
  // same run may have succeeded and progress was made.
  let processedRepoCount = 0;

  for (const { name: repo, brand } of REPOS) {
    try {
      const commits = await fetchRecentCommits(repo, { token, fetchImpl });
      processedRepoCount += 1;

      const lastSha = devlog.state[repo] ?? null;
      const newCommits = selectNewCommits(commits, lastSha, {
        maxCount: MAX_COMMITS_PER_RUN,
        firstRunCount: FIRST_RUN_COMMITS,
      });

      if (newCommits.length === 0) {
        continue;
      }

      let lastSuccessSha = lastSha;
      const repoEntries = []; // oldest-first

      for (const commit of newCommits) {
        try {
          if (shouldSummarizeCommit(commit)) {
            const fullMessage = commit.commit?.message ?? '';
            const firstLine = fullMessage.split('\n')[0];
            let summary;

            if (dryRun) {
              summary = firstLine;
            } else {
              const detail = await fetchCommitDetail(repo, commit.sha, { token, fetchImpl });
              const changes = describeChanges(detail);
              summary = await summarize({
                repo,
                brand,
                message: fullMessage.slice(0, 1000),
                changes,
                apiKey,
                fetchImpl,
              });
            }

            repoEntries.push(buildEntry({ repo, summary, commit }));
          }
          // Commit (summarized or filtered out) is now fully processed.
          lastSuccessSha = commit.sha;
        } catch (commitErr) {
          log(
            `[WARN] ${repo}: failed to process commit ${commit.sha}: ${commitErr.message}`,
          );
          // Stop at the last commit that fully succeeded — do not advance
          // past the failing commit. It will be retried next run.
          break;
        }
      }

      devlog.state[repo] = lastSuccessSha;
      if (repoEntries.length > 0) {
        devlog.entries = mergeEntries(devlog.entries, repoEntries, MAX_ENTRIES);
        totalAdded += repoEntries.length;
      }
    } catch (repoErr) {
      log(`[WARN] ${repo}: ${repoErr.message}`);
    }
  }

  if (processedRepoCount === 0) {
    throw new Error('All repositories failed to process.');
  }

  const output = `${JSON.stringify(devlog, null, 2)}\n`;
  try {
    await writeFile(devlogPath, output, 'utf8');
  } catch (writeErr) {
    throw new Error(`Failed to write devlog.json: ${writeErr.message}`);
  }

  return { added: totalAdded, entries: devlog.entries };
}
