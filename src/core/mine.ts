import type { AiOption } from './gemini';
import type { Pack, Phrase } from './types';

/** Words the user added with AI. Stored per language in kv under `mine:<lang>`, as phrasebook-only phrases. */
export const mineKey = (lang: string) => `mine:${lang}`;

const ID = /^[a-z0-9][a-z0-9-]*$/;
const KEYWORD = /^[a-z0-9][a-z0-9 '-]*$/;
const ALLOWED = new Set(['id', 'native', 'reading', 'english', 'speak', 'tags', 'difficulty', 'audioSrc', 'listen', 'replyId', 'book', 'keywords', 'mine']);
const nonEmpty = (v: unknown) => typeof v === 'string' && v.length > 0;
const unique = (a: unknown[]) => new Set(a).size === a.length;

/**
 * The phrase rules from schema/phrases.schema.json and scripts/validate.ts, for one phrase at run time:
 * shape, id and keyword patterns, and every tag a topic in the pack.
 */
export function isValidPhrase(v: unknown, situations: readonly string[]): v is Phrase {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  if (Object.keys(p).some((k) => !ALLOWED.has(k))) return false;
  if (typeof p.id !== 'string' || !ID.test(p.id)) return false;
  if (!nonEmpty(p.native) || !nonEmpty(p.reading) || !nonEmpty(p.english)) return false;
  for (const k of ['speak', 'audioSrc'] as const) if (k in p && !nonEmpty(p[k])) return false;
  if (!Array.isArray(p.tags) || !p.tags.length || !unique(p.tags)) return false;
  if (!p.tags.every((t) => typeof t === 'string' && ID.test(t) && situations.includes(t))) return false;
  if (!Number.isInteger(p.difficulty) || (p.difficulty as number) < 1 || (p.difficulty as number) > 3) return false;
  for (const k of ['listen', 'book'] as const) if (k in p && typeof p[k] !== 'boolean') return false;
  if ('replyId' in p && (typeof p.replyId !== 'string' || !ID.test(p.replyId))) return false;
  if ('keywords' in p) {
    const kw = p.keywords;
    if (!Array.isArray(kw) || !kw.length || !unique(kw) || !kw.every((k) => typeof k === 'string' && KEYWORD.test(k))) return false;
  }
  if ('mine' in p && p.mine !== true) return false;
  return true;
}

const randomId = () => `u-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('')}`;

/** A chosen AI option as a saved phrase. */
export function phraseFromOption(o: AiOption, id = randomId()): Phrase {
  return {
    id, native: o.native, reading: o.reading, english: o.english, ...(o.speak ? { speak: o.speak } : {}),
    tags: [o.tag], difficulty: 1, book: true, ...(o.keywords.length ? { keywords: o.keywords } : {}), mine: true,
  };
}

/**
 * The pack with the user's saved words added after its own phrases. The pack passed in is not changed.
 * An entry that fails validation, is not phrasebook-only, or reuses an id is skipped and logged.
 */
export function mergeMine(pack: Pack, raw: unknown, log: (msg: string, entry: unknown) => void = console.warn): Pack {
  if (raw === undefined) return pack;
  if (!Array.isArray(raw)) { log('Ignoring saved words: not a list', raw); return pack; }
  const situations = pack.meta.situations.map((s) => s.id);
  const ids = new Set(pack.phrases.phrases.map((p) => p.id));
  const mine: Phrase[] = [];
  for (const entry of raw) {
    if (!isValidPhrase(entry, situations) || entry.book !== true || entry.mine !== true || entry.listen || ids.has(entry.id)) {
      log('Skipping an invalid saved word', entry);
      continue;
    }
    ids.add(entry.id);
    mine.push(entry);
  }
  return { ...pack, phrases: { ...pack.phrases, phrases: [...pack.phrases.phrases, ...mine] } };
}

export const minePhrases = (pack: Pack): Phrase[] => pack.phrases.phrases.filter((p) => p.mine);
