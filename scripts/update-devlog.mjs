#!/usr/bin/env node
// update-devlog.mjs
//
// Thin CLI wrapper around scripts/lib/run-update.mjs.
//
// Usage:
//   node scripts/update-devlog.mjs [--dry-run]
//
// Env:
//   ANTHROPIC_API_KEY  required unless --dry-run
//   GITHUB_TOKEN       optional (raises GitHub API rate limits)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpdate } from './lib/run-update.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const token = process.env.GITHUB_TOKEN;

  if (!dryRun && !apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is required (unless --dry-run is passed).');
    process.exitCode = 1;
    return;
  }

  const devlogPath = path.join(__dirname, '..', 'devlog.json');

  try {
    const result = await runUpdate({
      devlogPath,
      apiKey,
      token,
      dryRun,
    });
    console.log(
      `DevLog updated${dryRun ? ' (dry run)' : ''}: ${result.added} new entr${
        result.added === 1 ? 'y' : 'ies'
      } added, ${result.entries.length} total.`,
    );
  } catch (err) {
    console.error(`Error updating devlog: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
