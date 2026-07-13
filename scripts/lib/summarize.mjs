// summarize.mjs
//
// Calls the Claude Messages API (raw HTTP — no SDK dependency) to turn a
// commit message + change summary into a short Japanese DevLog blurb.

const SYSTEM_PROMPT = `あなたは「CHUNK-jp」の開発ログ（DevLog）を書く編集アシスタントです。CHUNK-jpは、プライバシー重視・ローカルファーストのMacツールとブラウザユーティリティを個人で開発しているインディー開発者ブランドで、開発者向けの「Craft」ラインと、幅広い層向けの「Wonder」ラインがあります。コミット情報をもとに、ポータルサイトに掲載する短い開発ログを日本語で書きます。

ルール:
- 必ず日本語で書く。1〜2文、全体で90文字以内
- 「〜を追加しました」「〜を改善しました」のような、控えめで誠実な開発ログの文体
- 技術用語は必要な範囲でそのまま使ってよい
- 誇張やマーケティング的な表現は使わない
- 出力は要約文のみ。前置き・引用符・箇条書きは不要`;

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
  const userMessage = `リポジトリ: ${repo}（${brand}）\nコミットメッセージ:\n${message}\n\n変更ファイルの概要:\n${changes}`;

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
