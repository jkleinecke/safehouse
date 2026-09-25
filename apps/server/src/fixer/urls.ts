/**
 * Where things live on an AI server, from its base URL. Their own module so
 * both the chat client (llm.ts) and what asks the server about its model
 * (model-info.ts) can use them without importing each other.
 */

/** `…/v1/chat/completions`, tolerating a base URL that already ends in `/v1`. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

/**
 * The server's root, with any `/v1` suffix removed.
 *
 * Not every endpoint lives under `/v1`: llama.cpp serves `/props` — the
 * capability report the vision probe reads — at the root, so a base URL
 * written the documented way (ending in `/v1`) turns that into `/v1/props`
 * and a 404. Both spellings have to land in the same place.
 */
export function serverRootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
}

/** `…/v1/models`, tolerating a base URL that already ends in `/v1`. */
export function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
}
