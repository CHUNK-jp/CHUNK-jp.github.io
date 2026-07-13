// summarize.mjs
//
// Calls the Claude Messages API (raw HTTP — no SDK dependency) to turn a
// commit message + change summary into a short English DevLog blurb.

const SYSTEM_PROMPT = `You write the DevLog for CHUNK-jp, an independent developer brand building privacy-first, local-first Mac tools and browser utilities. It has a developer-focused "Craft" line and a "Wonder" line for a broader audience. Based on the commit information, write a short development log entry in English for the portal site.

Rules:
- Always write in English. 1-2 sentences, 160 characters or less in total
- Modest, sincere dev-log tone — plain statements like "Added ..." or "Improved ...", the voice of a solo developer noting progress
- Technical terms may be used where needed
- No hype or marketing language
- Output only the summary itself. No preamble, quotes, or bullet points`;

/**
 * Summarize a single commit into a short Japanese DevLog entry via the
 * Claude Messages API.
 *
 * @param {{
 *   repo: string,
 *   brand: string,
 *   message: string,
 *   changes: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   model?: string,
 * }} params
 * @returns {Promise<string>}
 */
export async function summarizeCommit({
  repo,
  brand,
  message,
  changes,
  apiKey,
  fetchImpl = fetch,
  model = 'claude-haiku-4-5-20251001',
}) {
  const userMessage = `Repository: ${repo} (${brand})\nCommit message:\n${message}\n\nChanged files:\n${changes}`;

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore — best-effort error detail
    }
    throw new Error(`summarizeCommit failed: ${res.status} ${res.statusText} ${detail}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';
  return text.trim();
}
