import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AiError, CHAIN, LANGUAGE_RULES, buildRequest, examples, extractText, generate, parseResult, responseSchema, systemInstruction } from './gemini';
import type { Pack } from './types';

const load = (code: string) => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../content/${code}/${f}.json`, import.meta.url), 'utf8'));
  return { meta: read('pack'), scripts: read('scripts'), phrases: read('phrases'), numbers: read('numbers'), dialogues: read('dialogues') } as Pack;
};
const CODES = ['ja', 'zh', 'ko', 'id'];
const ja = load('ja');

/** A generateContent response whose answer text is `body`. */
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(status === 200
  ? { candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: 'STOP' }] }
  : { error: { message: 'nope' } }), { status });
const water = { options: [{ native: '水', reading: 'mizu', english: 'Water', sense: 'drinking water', tag: 'food', keywords: ['drink'] }] };

describe.each(CODES)('prompt and schema for %s', (code) => {
  const pack = load(code);
  const ids = pack.meta.situations.map((s) => s.id);

  it('fills the system instruction from the pack', () => {
    const s = systemInstruction(pack);
    expect(s).toContain(`Language: ${pack.meta.name} (${pack.meta.ttsLocale}).`);
    expect(s).toContain(LANGUAGE_RULES[code]);
    expect(s).toContain(JSON.stringify(ids));
    expect(s).not.toMatch(/\{\{|\}\}/);
  });

  it('uses 4 phrasebook-only phrases as examples', () => {
    const ex = examples(pack);
    expect(ex).toHaveLength(4);
    const book = new Map(pack.phrases.phrases.filter((p) => p.book).map((p) => [p.native, p]));
    for (const e of ex) {
      expect(book.get(e.native)?.english).toBe(e.english);
      expect(Object.keys(e).every((k) => ['native', 'reading', 'english', 'keywords'].includes(k))).toBe(true);
    }
    expect(systemInstruction(pack)).toContain(JSON.stringify(ex, null, 1));
  });

  it('limits tag to the pack topics and options to 3', () => {
    const schema = responseSchema(pack);
    expect(schema.required).toEqual(['options']);
    expect(schema.properties.options.maxItems).toBe(3);
    expect(schema.properties.options.items.properties.tag.enum).toEqual(ids);
    expect(schema.properties.options.items.required).toEqual(['native', 'reading', 'english', 'sense', 'tag']);
  });
});

describe('buildRequest', () => {
  it('sends the English only, as JSON at temperature 0.2, with the key in a header', () => {
    const { url, init } = buildRequest('gemini-3.8-flash', 'bill', 'KEY', ja);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain('KEY');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'bill' }] }]);
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json', responseSchema: responseSchema(ja), temperature: 0.2 });
    expect(body.system_instruction.parts[0].text).toBe(systemInstruction(ja));
  });
});

describe('parseResult', () => {
  it('accepts a good answer', () => {
    expect(parseResult(JSON.stringify(water), ja, 'water')).toEqual({ options: [{ ...water.options[0] }] });
  });

  it('keeps up to 3 options, one per meaning', () => {
    const opt = (native: string, sense: string) => ({ native, reading: 'x', english: 'Bill', sense, tag: 'shopping' });
    const r = parseResult(JSON.stringify({ options: [opt('お会計', 'restaurant check'), opt('お札', 'banknote'), opt('a', 'a'), opt('b', 'b')] }), ja);
    expect(r.options.map((o) => o.native)).toEqual(['お会計', 'お札', 'a']);
  });

  it('returns the model error when there are no options', () => {
    expect(parseResult(JSON.stringify({ options: [], error: 'Not a travel word.' }), ja)).toEqual({ options: [], error: 'Not a travel word.' });
    expect(parseResult(JSON.stringify({ options: [] }), ja).error).toMatch(/No translation/);
  });

  it('drops options with a missing field or unknown topic, and cleans keywords and speak', () => {
    const r = parseResult(JSON.stringify({ options: [
      { native: '', reading: 'x', english: 'x', sense: 'x', tag: 'food' },
      { native: 'x', reading: 'x', english: 'x', sense: 'x', tag: 'space' },
      { native: '水', reading: ' mizu ', english: 'Water', sense: 's', tag: 'food', speak: '水', keywords: ['Drink', 'drink', 'water', '水', 5, 'a', 'b', 'c', 'd'] },
    ] }), ja, 'Water');
    expect(r.options).toEqual([{ native: '水', reading: 'mizu', english: 'Water', sense: 's', tag: 'food', keywords: ['drink', 'a', 'b', 'c'] }]);
  });

  it.each([['not JSON', 'hello'], ['no options list', '{"error":"x"}'], ['null', 'null'], ['array', '[]']])('throws on %s', (_n, raw) => {
    expect(() => parseResult(raw, ja)).toThrow(AiError);
  });

  it('reads fenced JSON', () => {
    expect(parseResult('```json\n' + JSON.stringify(water) + '\n```', ja).options).toHaveLength(1);
  });
});

describe('extractText', () => {
  it('joins text parts and skips thoughts', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'a', thought: true }, { text: '{}' }] } }] })).toBe('{}');
  });
  it('reports a block', () => {
    expect(() => extractText({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/Blocked: SAFETY/);
  });
});

describe('generate', () => {
  it('returns the first model answer', async () => {
    const fetchFn = vi.fn(async () => reply(water));
    const r = await generate('water', 'K', ja, { fetchFn });
    expect(r.model).toBe(CHAIN[0].model);
    expect(r.options[0].native).toBe('水');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])('falls back to the next model on HTTP %i', async (status) => {
    const fetchFn = vi.fn().mockResolvedValueOnce(reply(null, status)).mockResolvedValueOnce(reply(water));
    const r = await generate('water', 'K', ja, { fetchFn });
    expect(r.model).toBe(CHAIN[1].model);
    expect(fetchFn.mock.calls[1][0]).toContain(CHAIN[1].model);
  });

  it('falls back on a timeout', async () => {
    const hang = (_u: unknown, init: RequestInit) => new Promise<Response>((_r, reject) =>
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const fetchFn = vi.fn().mockImplementationOnce(hang).mockResolvedValueOnce(reply(water));
    const r = await generate('water', 'K', ja, { fetchFn, chain: [{ model: 'a', timeoutMs: 5 }, { model: 'b', timeoutMs: 5 }] });
    expect(r.model).toBe('b');
  });

  it.each([400, 403, 404])('stops on HTTP %i', async (status) => {
    const fetchFn = vi.fn(async () => reply(null, status));
    await expect(generate('water', 'K', ja, { fetchFn })).rejects.toMatchObject({ kind: 'http', status });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when every model fails', async () => {
    const fetchFn = vi.fn(async () => reply(null, 503));
    await expect(generate('water', 'K', ja, { fetchFn })).rejects.toMatchObject({ status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(CHAIN.length);
  });
});
