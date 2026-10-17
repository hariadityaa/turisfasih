import { buildItems } from './core/items';
import { mergeMine, mineKey, minePhrases } from './core/mine';
import { cleanStars } from './core/phrasebook';
import { listPacks, loadPack } from './core/packs';
import { MASTERED_DAYS, drillReview, isDue, newState, review, startOfDay, type Grade } from './core/srs';
import { DEFAULTS, cleanSettings, type Settings } from './core/settings';
import type { Item, Pack, PackMeta, Phrase } from './core/types';
import { getCards, kvGet, kvSet, putCard, type CardRecord } from './platform/db';
import { notify } from './platform/notice';
import { speak, voicesReady } from './platform/tts';

export type { Settings };

/** Longest gap between reviews, so nothing disappears for months. */
const MAX_INTERVAL_DAYS = 30;
/** Most cards to bring back in one lesson. The rest wait for the next one. */
const MAX_DUE = 20;

export const app = {
  settings: { ...DEFAULTS } as Settings,
  packs: [] as PackMeta[],
  pack: undefined as unknown as Pack,
  items: [] as Item[],
  itemById: new Map<string, Item>(),
  cards: new Map<string, CardRecord>(),
  /** Starred phrase ids for the current language. */
  stars: new Set<string>(),
};

/** Returns false when no language is chosen yet and there is more than one to choose from. */
export async function initApp(): Promise<boolean> {
  app.packs = await listPacks();
  const saved = await kvGet<unknown>('settings');
  app.settings = cleanSettings(saved);
  void voicesReady();
  if (!app.packs.some((p) => p.code === app.settings.lang)) {
    // With one pack there is nothing to ask.
    if (app.packs.length !== 1) { app.settings.lang = ''; return false; }
    await setLanguage(app.packs[0].code);
    return true;
  }
  await setLanguage(app.settings.lang, false);
  return true;
}

export async function setLanguage(code: string, persist = true) {
  // Load everything first. If any step fails, the app stays on the language it had.
  const pack = mergeMine(await loadPack(code), await kvGet<unknown>(mineKey(code)));
  const items = buildItems(pack);
  const cards = await getCards(code);
  const stars = cleanStars(await kvGet<unknown>(`stars:${code}`), pack);
  app.settings.lang = code;
  app.pack = pack;
  // Picks the native-script font for this language (Japanese and Chinese share characters but not glyphs).
  document.documentElement.dataset.pack = code;
  app.items = items;
  app.itemById = new Map(items.map((i) => [i.id, i]));
  app.cards = cards;
  app.stars = stars;
  if (persist) await saveSettings();
}

/** After a backup is restored: take the saved settings and progress from storage. */
export async function reloadFromStorage() {
  const keep = app.settings.lang;
  const restored = cleanSettings(await kvGet<unknown>('settings'));
  if (!app.packs.some((p) => p.code === restored.lang)) restored.lang = keep;
  app.settings = restored;
  await setLanguage(restored.lang, false);
}
/** Flips a star and saves it. Returns whether the phrase is now starred. */
export function toggleStar(id: string): boolean {
  const on = !app.stars.has(id);
  if (on) app.stars.add(id); else app.stars.delete(id);
  kvSet(`stars:${app.settings.lang}`, [...app.stars]).catch(saveFailed);
  return on;
}
/** Saves the user's words for the current language, then puts them in the pack. Throws if storage fails. */
async function saveMine(list: Phrase[]) {
  const code = app.settings.lang;
  await kvSet(mineKey(code), list);
  app.pack = mergeMine(await loadPack(code), list);
}
export const addMine = (p: Phrase) => saveMine([...minePhrases(app.pack), p]);
export async function deleteMine(id: string) {
  await saveMine(minePhrases(app.pack).filter((p) => p.id !== id));
  if (app.stars.delete(id)) kvSet(`stars:${app.settings.lang}`, [...app.stars]).catch(saveFailed);
}

export const saveSettings = () => kvSet('settings', app.settings);

const saveFailed = () => notify('Could not save that change. It will reset when you close the app.');
/** For controls that do not wait on the save. Tells the user if it did not stick. */
export const saveSettingsQuietly = () => { saveSettings().catch(saveFailed); };

/** Phrases in pack order, which is most useful first. */
export const phrases = (): Item[] => app.items.filter((i) => i.kind === 'phrase');
export const situationLabel = (id: string) => app.pack.meta.situations.find((s) => s.id === id)?.label ?? id;

/** Phrases studied before that are due again, oldest first. */
export function dueItems(pool: Item[] = phrases()): Item[] {
  const t = Date.now();
  return pool.filter((i) => { const c = app.cards.get(i.id); return c && isDue(c, t); })
    .sort((a, b) => app.cards.get(a.id)!.due - app.cards.get(b.id)!.due);
}

/** Phrases never studied, most useful first. */
export const newItems = (pool: Item[] = phrases()): Item[] => pool.filter((i) => !app.cards.has(i.id));

/** Remembered at least once and not forgotten since. */
export const isLearned = (id: string) => (app.cards.get(id)?.interval ?? 0) >= 1;

/** New phrases first studied today. */
const newToday = () => { const t = startOfDay(Date.now()); return [...app.cards.values()].filter((c) => (c.added ?? 0) >= t).length; };

/**
 * Cards due again, then new ones. The daily lesson stops adding new phrases once the day's limit
 * is reached. A topic the learner opens on purpose (`daily` false) always offers a few.
 */
export function lessonItems(pool: Item[] = phrases(), daily = true): { due: Item[]; fresh: Item[] } {
  const room = daily ? Math.max(0, app.settings.newPerSession - newToday()) : app.settings.newPerSession;
  return { due: dueItems(pool).slice(0, MAX_DUE), fresh: newItems(pool).slice(0, room) };
}

/** Saves a card. The lesson carries on if the phone cannot store it, but the user is told. */
async function saveCard(rec: CardRecord) {
  try { await putCard(rec); }
  catch { notify('Could not save your progress. Your phone may be low on storage. Free some space to keep your progress.'); }
}

/** Records a grade and schedules the next review. */
export async function grade(item: Item, g: Grade) {
  const t = Date.now();
  const prev = app.cards.get(item.id);
  const state = review(prev ?? newState(t), g, t, { maxIntervalDays: MAX_INTERVAL_DAYS });
  const rec: CardRecord = { lang: app.settings.lang, id: item.id, added: prev?.added ?? t, ...state };
  app.cards.set(item.id, rec);
  await saveCard(rec);
}

/** Records a drill answer. Right answers on cards that are not due do not move the schedule. */
export async function gradeDrill(item: Item, correct: boolean) {
  const state = drillReview(app.cards.get(item.id), correct, Date.now(), { maxIntervalDays: MAX_INTERVAL_DAYS });
  if (!state) return;
  const rec: CardRecord = { lang: app.settings.lang, id: item.id, ...state };
  app.cards.set(item.id, rec);
  await saveCard(rec);
}

export function say(text: string, audioSrc?: string) {
  return speak(text, {
    locale: app.pack.meta.ttsLocale, rate: app.settings.rate, voiceURI: app.settings.voice[app.settings.lang],
    audioSrc, lang: app.settings.lang,
  });
}

export { MASTERED_DAYS };
