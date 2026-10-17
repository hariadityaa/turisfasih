import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildItems } from './items';
import { isValidPhrase, mergeMine, minePhrases, phraseFromOption } from './mine';
import { ALL, MINE, bookLists, bookPhrases, bookSections } from './phrasebook';
import type { Pack, Phrase } from './types';

const json = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const load = (code: string) => {
  const read = (f: string) => json(`content/${code}/${f}.json`);
  return { meta: read('pack'), scripts: read('scripts'), phrases: read('phrases'), numbers: read('numbers'), dialogues: read('dialogues') } as Pack;
};
const pack = load('ja');
const situations = pack.meta.situations.map((s) => s.id);
const word = phraseFromOption({ native: '傘', reading: 'kasa', english: 'Umbrella', sense: 'rain umbrella', tag: 'shopping', keywords: ['brolly'] }, 'u-abc123');

// The schema item for one phrase, so the run-time check can be compared with what CI enforces on packs.
const schemaItem = json('schema/phrases.schema.json').properties.phrases.items;
const ajvPhrase = new Ajv2020({ strict: false }).compile({ ...schemaItem, properties: { ...schemaItem.properties, mine: { const: true } } });

describe('isValidPhrase', () => {
  it.each(['ja', 'zh', 'ko', 'id'])('accepts every phrase in the %s pack', (code) => {
    const p = load(code);
    const ids = p.meta.situations.map((s) => s.id);
    expect(p.phrases.phrases.filter((x) => !isValidPhrase(x, ids))).toEqual([]);
  });

  const broken: [string, unknown][] = [
    ['null', null], ['array', []], ['bad id', { ...word, id: 'U X' }], ['empty native', { ...word, native: '' }],
    ['no reading', { ...word, reading: undefined }], ['empty speak', { ...word, speak: '' }], ['no tags', { ...word, tags: [] }],
    ['duplicate tag', { ...word, tags: ['food', 'food'] }], ['difficulty 4', { ...word, difficulty: 4 }], ['difficulty 1.5', { ...word, difficulty: 1.5 }],
    ['book not boolean', { ...word, book: 'yes' }], ['upper-case keyword', { ...word, keywords: ['Brolly'] }], ['empty keywords', { ...word, keywords: [] }],
    ['mine false', { ...word, mine: false }], ['unknown field', { ...word, colour: 'red' }],
  ];
  it.each(broken)('rejects %s, as the schema does', (_n, v) => {
    const clean = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    expect(ajvPhrase(clean)).toBe(false);
    expect(isValidPhrase(clean, situations)).toBe(false);
  });

  it('rejects a tag that is not a topic in the pack', () => {
    expect(isValidPhrase({ ...word, tags: ['space'] }, situations)).toBe(false);
  });

  it('accepts a saved word', () => {
    expect(ajvPhrase(word)).toBe(true);
    expect(isValidPhrase(word, situations)).toBe(true);
  });
});

describe('phraseFromOption', () => {
  it('makes a phrasebook-only phrase in its topic', () => {
    expect(word).toEqual({ id: 'u-abc123', native: '傘', reading: 'kasa', english: 'Umbrella', tags: ['shopping'], difficulty: 1, book: true, keywords: ['brolly'], mine: true });
  });
  it('leaves out empty keywords and gives a random u- id', () => {
    const p = phraseFromOption({ native: 'x', reading: 'x', english: 'x', sense: '', tag: 'food', keywords: [] });
    expect(p.keywords).toBeUndefined();
    expect(p.id).toMatch(/^u-[a-z0-9]{12}$/);
    expect(isValidPhrase(p, situations)).toBe(true);
  });
});

describe('mergeMine', () => {
  it('adds saved words after the pack phrases without changing the pack', () => {
    const before = pack.phrases.phrases.length;
    const merged = mergeMine(pack, [word]);
    expect(merged.phrases.phrases).toHaveLength(before + 1);
    expect(merged.phrases.phrases.at(-1)).toEqual(word);
    expect(pack.phrases.phrases).toHaveLength(before);
    expect(minePhrases(merged)).toEqual([word]);
  });

  it('returns the pack as is when nothing is saved', () => {
    expect(mergeMine(pack, undefined)).toBe(pack);
  });

  it('skips and logs invalid entries instead of crashing', () => {
    const log = vi.fn();
    const notBook: Phrase = { ...word, id: 'u-b', book: undefined };
    const merged = mergeMine(pack, [word, null, { ...word, id: 'u-c', tags: ['space'] }, notBook, { ...word }, { ...word, id: pack.phrases.phrases[0].id }, { ...word, id: 'u-d', mine: undefined }], log);
    expect(minePhrases(merged)).toEqual([word]);
    expect(log).toHaveBeenCalledTimes(6);
    expect(mergeMine(pack, 'oops', log)).toBe(pack);
  });

  it('never adds lessons, practice items or learned-count phrases', () => {
    const merged = mergeMine(pack, [word]);
    expect(buildItems(merged)).toEqual(buildItems(pack));
    expect(merged.meta.survival).toEqual(pack.meta.survival);
  });

  it('shows saved words under My words, in their topic and under All', () => {
    const merged = mergeMine(pack, [word]);
    expect(bookLists(pack).map((l) => l.key)).not.toContain(MINE);
    expect(bookLists(merged).find((l) => l.key === MINE)).toEqual({ key: MINE, label: 'My words' });
    expect(bookPhrases(merged, MINE)).toEqual([word]);
    expect(bookPhrases(merged, 'shopping')).toContain(word);
    expect(bookPhrases(merged, ALL)).toContain(word);
    expect(bookSections(merged).find((s) => s.key === 'shopping')?.phrases).toContain(word);
  });
});
