import type { Pack, Phrase } from './types';

/**
 * "Add word with AI": the user's own Gemini key, called straight from the browser.
 * Nothing here touches storage; the key is passed in by the caller.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Tried in order. A step that times out, is rate limited (429) or fails on Google's side (5xx) falls through to the next. */
export const CHAIN = [
  { model: 'gemini-3.8-flash', timeoutMs: 30_000 },
  // Answers in a few seconds when healthy. Past 12 s it has usually hung.
  { model: 'gemini-3.5-flash-lite', timeoutMs: 12_000 },
];
/** The last step always gets this much, so a slow answer is not lost. */
export const TIMEOUT_MS = 30_000;
export const MAX_OPTIONS = 3;

/** Per pack: how to write the native text and the reading. Packs without rules get none. */
export const LANGUAGE_RULES: Record<string, string> = {
  ja: 'Natural Japanese with kanji and kana. Hepburn romaji, lowercase, spaced by word. Spell long vowels out (ou, uu, aa), no macrons: "arigatou", "menyuu". Particles "wa", "o", "e". Put kana in "speak" if a kanji reading is ambiguous.',
  zh: 'Traditional characters, Taiwan usage (捷運 not 地鐵, 計程車 not 出租車). Pinyin with tone marks, syllables of a word joined, words spaced: "wǎnshang hǎo". Apostrophe before a syllable starting with a/o/e: "wǎn\'ān".',
  ko: 'Standard Seoul Korean, polite 요 endings for sentences. Revised Romanization, lowercase, spaced as the Hangul is, by pronunciation. Hyphen only where a syllable boundary is unclear.',
  id: 'Everyday Indonesian (Jakarta/Bali), polite not formal. English-speaker respelling with hyphens between syllables and spaces between words: "seh-nahng behr-teh-moo".',
};

/** Up to 4 phrasebook-only entries, spread across the pack, as style examples. */
export function examples(pack: Pack, n = 4): Pick<Phrase, 'native' | 'reading' | 'english' | 'keywords'>[] {
  const book = pack.phrases.phrases.filter((p) => p.book && !p.mine);
  const step = Math.max(1, Math.floor(book.length / n));
  return book.filter((_, i) => i % step === 0).slice(0, n)
    .map(({ native, reading, english, keywords }) => ({ native, reading, english, ...(keywords ? { keywords } : {}) }));
}

export function systemInstruction(pack: Pack): string {
  const { meta } = pack;
  return `You translate words and short phrases for TurisTalk, a travel phrasebook.
The user is a tourist. They will show or say your output to shop, hotel, restaurant or transport staff.
Language: ${meta.name} (${meta.ttsLocale}).
${LANGUAGE_RULES[meta.code] ?? ''}
Rules:
- Translate what a tourist would actually say or need, not a dictionary gloss.
- A single noun stays a single noun. Phrases and requests use the polite form for strangers and staff.
- Use everyday words locals use, not formal or literary ones.
- If the English has more than one travel meaning (e.g. "bill": check vs banknote), return up to 3 options, one per meaning. Otherwise exactly 1.
- "sense": at most 6 English words naming the meaning covered.
- "reading" follows the reading rules exactly and matches "native" syllable for syllable.
- Set "speak" only if a TTS voice would likely misread "native".
- "tag": the single best topic id from ${JSON.stringify(meta.situations.map((s) => s.id))}.
- "keywords": 0–4 lowercase English synonyms a tourist might search for instead, not repeating the input.
- If the input isn't something a traveller would need, or you aren't confident, return no options and explain in "error".
Match the style of these phrasebook entries:
${JSON.stringify(examples(pack), null, 1)}`;
}

/** Gemini's OpenAPI-style schema. `tag` is limited to the pack's topics. */
export function responseSchema(pack: Pack) {
  const str = { type: 'STRING' };
  return {
    type: 'OBJECT',
    properties: {
      options: {
        type: 'ARRAY',
        maxItems: MAX_OPTIONS,
        items: {
          type: 'OBJECT',
          properties: {
            native: str, reading: str, speak: str, english: str, sense: str,
            tag: { type: 'STRING', enum: pack.meta.situations.map((s) => s.id) },
            keywords: { type: 'ARRAY', items: str },
          },
          required: ['native', 'reading', 'english', 'sense', 'tag'],
        },
      },
      error: str,
    },
    required: ['options'],
  };
}

export function buildRequest(model: string, text: string, key: string, pack: Pack): { url: string; init: RequestInit } {
  return {
    url: `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction(pack) }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: responseSchema(pack), temperature: 0.2 },
      }),
    },
  };
}

/** network, timeout, http, output and cancel. Only `retryable` errors move on to the next model. */
export class AiError extends Error {
  constructor(message: string, readonly kind: 'network' | 'timeout' | 'http' | 'output' | 'cancel', readonly retryable = false, readonly status = 0) {
    super(message);
  }
}

export const httpError = (status: number, detail: string) =>
  new AiError(`HTTP ${status}${detail ? `: ${detail}` : ''}`, 'http', status === 429 || status >= 500, status);

/** The answer text from a generateContent response. Thought parts are skipped. */
export function extractText(json: any): string {
  const cand = json?.candidates?.[0];
  if (!cand) {
    const reason = json?.promptFeedback?.blockReason;
    throw new AiError(reason ? `Blocked: ${reason}` : 'No answer came back', 'output', true);
  }
  const text = ((cand.content?.parts ?? []) as { text?: unknown; thought?: boolean }[])
    .filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (!text) throw new AiError(`Empty answer (${cand.finishReason ?? 'unknown'})`, 'output', true);
  return text;
}

export interface AiOption { native: string; reading: string; speak?: string; english: string; sense: string; tag: string; keywords: string[] }
export interface AiResult { options: AiOption[]; error?: string }

const KEYWORD = /^[a-z0-9][a-z0-9 '-]*$/;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Checks the model's JSON against what a phrase needs. Options with a missing field or an unknown topic are dropped.
 * No usable option always comes with an error to show. Throws AiError ('output') when it is not the expected shape at all.
 */
export function parseResult(raw: string, pack: Pack, input = ''): AiResult {
  let j: any;
  try { j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new AiError('The answer was not valid JSON', 'output', true); }
  if (!j || typeof j !== 'object' || !Array.isArray(j.options)) throw new AiError('The answer had no options list', 'output', true);
  const topics = new Set(pack.meta.situations.map((s) => s.id));
  const asked = input.trim().toLowerCase();
  const options: AiOption[] = [];
  for (const o of j.options.slice(0, MAX_OPTIONS)) {
    if (!o || typeof o !== 'object') continue;
    const [native, reading, english, sense, tag, speak] = [o.native, o.reading, o.english, o.sense, o.tag, o.speak].map(text);
    if (!native || !reading || !english || !topics.has(tag)) continue;
    const keywords = [...new Set((Array.isArray(o.keywords) ? o.keywords : []).map((k: unknown) => text(k).toLowerCase()))]
      .filter((k): k is string => KEYWORD.test(k as string) && k !== asked).slice(0, 4);
    options.push({ native, reading, english, sense, tag, keywords, ...(speak && speak !== native ? { speak } : {}) });
  }
  const error = text(j.error);
  if (!options.length) return { options, error: error || 'No translation came back. Try other words.' };
  return error ? { options, error } : { options };
}

export interface CallOptions { fetchFn?: typeof fetch; signal?: AbortSignal; chain?: typeof CHAIN; timeoutMs?: number }

/** One call to one model. A cancel is never retried. */
async function callModel(model: string, input: string, key: string, pack: Pack, budget: number, { fetchFn = fetch, signal }: CallOptions): Promise<AiResult> {
  if (signal?.aborted) throw new AiError('Cancelled', 'cancel');
  const { url, init } = buildRequest(model, input, key, pack);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  const onCancel = () => ctrl.abort();
  signal?.addEventListener('abort', onCancel);
  let res: Response;
  try { res = await fetchFn(url, { ...init, signal: ctrl.signal }); }
  catch (e) {
    if (signal?.aborted) throw new AiError('Cancelled', 'cancel');
    if ((e as Error)?.name === 'AbortError') throw new AiError('Timed out', 'timeout', true);
    throw new AiError(`Network error: ${(e as Error)?.message ?? e}`, 'network', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* not JSON; handled below */ }
  if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
  if (!json) throw new AiError('The answer was not JSON', 'output', true);
  return parseResult(extractText(json), pack, input);
}

/** Walks the model chain. Returns the first answer, or throws the error that stopped it. */
export async function generate(input: string, key: string, pack: Pack, opts: CallOptions = {}): Promise<AiResult & { model: string }> {
  const { chain = CHAIN, timeoutMs = TIMEOUT_MS } = opts;
  let last: AiError | undefined;
  for (const [i, step] of chain.entries()) {
    const budget = i === chain.length - 1 ? timeoutMs : Math.min(step.timeoutMs, timeoutMs);
    try { return { ...(await callModel(step.model, input, key, pack, budget, opts)), model: step.model }; }
    catch (e) {
      if (!(e instanceof AiError) || !e.retryable) throw e;
      last = e;
    }
  }
  throw last ?? new AiError('No model to try', 'output');
}

/** What to tell the user when generate() throws. */
export function aiErrorText(e: unknown): string {
  if (!(e instanceof AiError)) return 'Something went wrong. Try again.';
  if (e.kind === 'network') return 'Could not reach Gemini. Check your internet connection and try again.';
  if (e.kind === 'timeout') return 'Gemini took too long. Try again in a minute.';
  if (e.status === 400 || e.status === 401 || e.status === 403) return `Gemini did not accept the key. Check it in Settings. (${e.message})`;
  if (e.status === 429) return 'The key has reached its limit for now. Try again later.';
  return `Gemini could not answer. ${e.message}`;
}
