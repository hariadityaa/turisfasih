import type { Pack, Phrase } from './types';

/** Phrasebook lists: everything, the survival set, what staff say, and one per topic. No grading. */
export const ALL = 'all';
export const SURVIVAL = 'survival';
export const HEARD = 'heard';
export const STARRED = 'starred';
export const MINE = 'mine';

export interface BookList { key: string; label: string }

/** Stored star ids as a set. Anything that is not a phrase id in the pack is dropped. */
export function cleanStars(raw: unknown, pack: Pack): Set<string> {
  const known = new Set(pack.phrases.phrases.map((p) => p.id));
  return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && known.has(id)) : []);
}

/** Starred phrases first, then the rest. Each group keeps its order. */
export const starredFirst = (phrases: Phrase[], starred: ReadonlySet<string>): Phrase[] =>
  starred.size ? [...phrases.filter((p) => starred.has(p.id)), ...phrases.filter((p) => !starred.has(p.id))] : phrases;

/** The lists after "All", in display order. Empty lists are left out. "Starred" comes first, when anything is starred, then "My words". */
export function bookLists(pack: Pack, starred: ReadonlySet<string> = new Set()): BookList[] {
  const out: BookList[] = [];
  if (bookPhrases(pack, STARRED, starred).length) out.push({ key: STARRED, label: 'Starred' });
  if (bookPhrases(pack, MINE).length) out.push({ key: MINE, label: 'My words' });
  const n = pack.meta.survival?.length ?? 0;
  if (n) out.push({ key: SURVIVAL, label: `Survival ${n}` });
  if (bookPhrases(pack, HEARD).length) out.push({ key: HEARD, label: 'They say' });
  for (const s of pack.meta.situations) if (bookPhrases(pack, s.id).length) out.push({ key: s.id, label: s.label });
  return out;
}

/**
 * Phrases in a list, in pack order (survival keeps its own order). Staff lines appear under HEARD, not under a topic.
 * Starred phrases come first; the Starred list itself holds only them.
 */
export function bookPhrases(pack: Pack, key: string, starred: ReadonlySet<string> = new Set()): Phrase[] {
  const all = pack.phrases.phrases;
  if (key === STARRED) return all.filter((p) => starred.has(p.id));
  return starredFirst(plain(pack, key), starred);
}

function plain(pack: Pack, key: string): Phrase[] {
  const all = pack.phrases.phrases;
  if (key === ALL) return all;
  if (key === SURVIVAL) return (pack.meta.survival ?? []).map((id) => all.find((p) => p.id === id)).filter((p): p is Phrase => !!p);
  if (key === HEARD) return all.filter((p) => p.listen);
  if (key === MINE) return all.filter((p) => p.mine);
  return all.filter((p) => !p.listen && p.tags.includes(key));
}

/** Lowercase without accents, so "xiexie" finds xièxie. */
export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** True when every word of `query` appears in the phrase's English, reading, native text or keywords. An empty query matches all. */
export function matchPhrase(p: Phrase, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([p.english, p.reading, p.native, ...(p.keywords ?? [])].join(' '));
  return words.every((w) => hay.includes(w));
}

export interface BookSection { key: string; label: string; phrases: Phrase[] }

/** The All view without a search: Starred, then each topic by its first tag, then what staff say. Starred phrases repeat in their topic. */
export function bookSections(pack: Pack, starred: ReadonlySet<string> = new Set()): BookSection[] {
  const out: BookSection[] = [];
  const mine = bookPhrases(pack, STARRED, starred);
  if (mine.length) out.push({ key: STARRED, label: 'Starred', phrases: mine });
  for (const s of pack.meta.situations) {
    const group = pack.phrases.phrases.filter((p) => !p.listen && p.tags[0] === s.id);
    if (group.length) out.push({ key: s.id, label: s.label, phrases: starredFirst(group, starred) });
  }
  const heard = bookPhrases(pack, HEARD, starred);
  if (heard.length) out.push({ key: HEARD, label: 'They say', phrases: heard });
  return out;
}

/** Google Translate needs the region only for Chinese; ja-JP becomes ja, zh-TW stays zh-TW. */
const KEEP_REGION = new Set(['zh']);

export function translateUrl(ttsLocale: string, query: string): string {
  const [lang, region] = ttsLocale.split('-');
  const tl = region && KEEP_REGION.has(lang.toLowerCase()) ? `${lang}-${region}` : lang;
  return `https://translate.google.com/?sl=en&tl=${tl}&text=${encodeURIComponent(query)}&op=translate`;
}
