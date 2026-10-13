// The judge's second rung (docs/design/JUDGE-AVAILABILITY-2026-09-07.md,
// section 4): when Groq does not answer, the same gpt-oss weights served by
// Cloudflare Workers AI inside this Worker, behind the AI_FALLBACK flag, with
// the provider named on the response so the record says who answered.
//
// Measured 2026-09-07 night from a throwaway probe: Workers AI holds JUDGE-V1's
// strict JSON schema on gpt-oss-120b in the chat shape, identical output on a
// repeat, 27 to 33 neurons a call, and spends completion tokens on reasoning
// before the JSON, so max_tokens must leave room. Same weights are not the same
// instrument: until the dev-split run on this host is on file, the flag stays
// off in production and this code is a rail, not a promise.
//
// Pure helpers live here so they can be tested without a Worker.

import { GROQ_BLENDED_RATE_PER_1M_USD } from './usage-weights';

/** Groq model id to the Workers AI id for the same weights. */
export const WORKERS_AI_MODEL: Readonly<Record<string, string>> = {
  'openai/gpt-oss-120b': '@cf/openai/gpt-oss-120b',
  'openai/gpt-oss-20b': '@cf/openai/gpt-oss-20b',
};

/** Workers AI list price per million tokens (developers.cloudflare.com, read 2026-09-07). */
const WAI_RATES: Readonly<Record<string, { prompt: number; completion: number }>> = {
  '@cf/openai/gpt-oss-120b': { prompt: 0.35, completion: 0.75 },
  '@cf/openai/gpt-oss-20b': { prompt: 0.20, completion: 0.30 },
};

/**
 * A Groq answer that means "nobody answered": the account refused us (401,
 * 402), the rate or quota (429), the service (5xx), or the fetch itself threw
 * (null). A 4xx about the request (400, 413, 422) is our fault and never falls
 * back: the same body would fail on the second host too.
 */
export function shouldFallBack(status: number | null): boolean {
  if (status === null) return true;
  return status === 401 || status === 402 || status === 429 || status >= 500;
}

/** The flag: exactly the string 'on' in the Worker's vars. Anything else is off. */
export function fallbackEnabled(env: { AI_FALLBACK?: string; AI?: unknown }): boolean {
  return env.AI_FALLBACK === 'on' && !!env.AI;
}

/**
 * The request Workers AI sees: the same messages, schema and sampling the
 * client sent Groq, less the fields Workers AI does not take (seed, n,
 * include_reasoning). max_tokens keeps the client's value: the probe showed the
 * chat shape reasons before it writes the JSON, and the client's ceiling
 * already leaves room.
 */
export function workersAiRequest(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['messages', 'response_format', 'temperature', 'max_tokens', 'reasoning_effort', 'top_p']) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

interface ChatShape {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  output?: Array<{ type?: string; content?: Array<{ text?: string }> }>;
}

/**
 * Workers AI's answer in the OpenAI chat shape the client already parses. The
 * chat endpoint returns that shape as it is; the Responses shape is folded to
 * it. Returns null when no text can be found, so the caller falls through to
 * the honest failure instead of shipping an empty 200.
 */
export function chatResponseFromWorkersAi(out: unknown, model: string): Record<string, unknown> | null {
  const o = (out ?? {}) as ChatShape;
  if (Array.isArray(o.choices) && o.choices.length) {
    const text = o.choices[0]?.message?.content;
    if (typeof text !== 'string' || !text) return null;
    return { ...o, model, provider: 'workers-ai' };
  }
  if (Array.isArray(o.output)) {
    const msg = o.output.filter((x) => x?.type === 'message').pop();
    const text = (msg?.content ?? []).map((c) => c?.text ?? '').join('');
    if (!text) return null;
    return {
      model,
      provider: 'workers-ai',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: o.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
  return null;
}

/** Metering at Workers AI's own rates against the same counter basis the licence cap uses. */
export function workersAiTokenEquivalents(promptTokens: number, completionTokens: number, waiModel: string): number {
  const r = WAI_RATES[waiModel] ?? WAI_RATES['@cf/openai/gpt-oss-120b'];
  return Math.ceil(
    promptTokens * r.prompt / GROQ_BLENDED_RATE_PER_1M_USD
      + completionTokens * r.completion / GROQ_BLENDED_RATE_PER_1M_USD,
  );
}

/** The header the client reads to stamp who answered. */
export const PROVIDER_HEADER = 'x-fw-provider';
