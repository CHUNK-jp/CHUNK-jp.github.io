// github-api.mjs
//
// Thin wrappers around the GitHub REST API commit endpoints. No SDK — uses
// the fetch implementation passed in (defaults to the global fetch).

const OWNER = 'CHUNK-jp';

function buildHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'chunk-jp-devlog',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * List recent commits for a CHUNK-jp repository.
 *
 * @param {string} repo
 * @param {{ token?: string, perPage?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<object[]>}
 */
export async function fetchRecentCommits(repo, { token, perPage = 30, fetchImpl = fetch } = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/commits?per_page=${perPage}`;
  const res = await fetchImpl(url, { headers: buildHeaders(token) });
  if (!res.ok) {
    throw new Error(
      `fetchRecentCommits failed for ${OWNER}/${repo}: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

/**
 * Get full detail (including file-level stats) for a single commit.
 *
 * @param {string} repo
 * @param {string} sha
 * @param {{ token?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<object>}
 */
export async function fetchCommitDetail(repo, sha, { token, fetchImpl = fetch } = {}) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/commits/${sha}`;
  const res = await fetchImpl(url, { headers: buildHeaders(token) });
  if (!res.ok) {
    throw new Error(
      `fetchCommitDetail failed for ${OWNER}/${repo}@${sha}: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}
