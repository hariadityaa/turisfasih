import { app, deleteMine, say, toggleStar } from '../app';
import { ALL, HEARD, MINE, bookLists, matchPhrase, bookPhrases, bookSections, translateUrl } from '../core/phrasebook';
import type { Phrase } from '../core/types';
import { hasKey } from '../platform/aikey';
import { notify } from '../platform/notice';
import { stopSpeaking } from '../platform/tts';
import { keepAwake } from '../platform/wake';
import { openAddSheet } from './aiword';
import { h, header, type Screen } from './dom';
import { langSwitch } from './lang';

const byId = (id: string | null | undefined) => app.pack.phrases.phrases.find((p) => p.id === id);
/** Only in-app paths are accepted as a back target. */
const safeBack = (b: string | null) => (b?.startsWith('/') && !b.startsWith('//') ? b : undefined);
const showLink = (p: Phrase, list: string, back?: string) =>
  `#/show?id=${p.id}&list=${list}${back ? `&back=${encodeURIComponent(back)}` : ''}`;
const play = (p: Phrase) => void say(p.speak ?? p.native, p.audioSrc);

/** ☆/★ toggle. `onchange` runs after the star flips. */
export const starButton = (p: Phrase, onchange: () => void, cls = 'star') => {
  const btn = h('button', { class: cls, 'aria-label': `Star: ${p.english}`, 'aria-pressed': String(app.stars.has(p.id)), onclick: () => {
    const on = toggleStar(p.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '★' : '☆';
    onchange();
  } }, app.stars.has(p.id) ? '★' : '☆');
  return btn;
};

/**
 * A phrase row. Tap the text to open it full size, or tap 🔊 to hear it.
 * `list` is the list Prev/Next walks on the full-size card; `back` is where that card returns to.
 */
export const phraseRow = (p: Phrase, list: string, back: string, onstar: () => void = () => {}) => {
  const reply = p.listen ? byId(p.replyId) : undefined;
  return h('li', { class: 'phrase' },
    h('a', { class: 'grow', href: showLink(p, list, back) },
      h('b', null, p.english),
      h('span', { class: 'answer' }, p.reading),
      h('span', { class: 'script' }, p.native),
      reply ? h('small', { class: 'say' }, `Say back: ${reply.english}`) : null,
      p.listen && !reply ? h('small', { class: 'tag' }, 'You will hear this') : null,
      p.mine ? h('small', { class: 'tag' }, 'Mine') : null),
    starButton(p, onstar),
    h('button', { class: 'play', 'aria-label': `Play: ${p.english}`, onclick: () => play(p) }, '🔊'));
};

/** Every phrase, with search and lists: All, Survival, They say, then topics. Useful on the trip itself. */
export const phrasebookScreen: Screen = (root, q) => {
  const allLists = () => [{ key: ALL, label: 'All' }, ...bookLists(app.pack, app.stars)];
  let key = allLists().some((l) => l.key === q.get('list')) ? q.get('list')! : ALL;
  const list = h('div');
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search, e.g. toilet', 'aria-label': 'Search phrases', oninput: () => paint() });
  const chips = h('div', { class: 'chips' });
  const note = h('p', { class: 'note' });

  const paint = () => {
    const lists = allLists();
    if (!lists.some((l) => l.key === key)) key = ALL;
    const words = search.value.trim();
    const back = `/phrasebook?list=${key}`;
    chips.replaceChildren(...lists.map((l) =>
      h('button', { class: `chip${l.key === key ? ' on' : ''}`, onclick: () => { key = l.key; history.replaceState(null, '', `#${`/phrasebook?list=${key}`}`); paint(); } }, l.label)));
    note.textContent = key === HEARD ? 'What staff say to you, and what to say back.'
      : key === MINE ? 'Words you added with AI. Open one to delete it.' : 'Tap a phrase to show it full size, or tap 🔊 to hear it.';
    list.replaceChildren();
    if (words || key !== ALL) {
      const found = bookPhrases(app.pack, key, app.stars).filter((p) => matchPhrase(p, words));
      list.append(found.length ? h('ul', { class: 'list' }, found.map((p) => phraseRow(p, key, back, paint)))
        : h('p', { class: 'note' }, 'No phrase found. ',
          words ? h('a', { href: translateUrl(app.pack.meta.ttsLocale, search.value.trim()), target: '_blank', rel: 'noopener noreferrer' }, 'Look it up in Google Translate') : null,
          words && !navigator.onLine ? ' (needs internet)' : null));
      // Only with a key. Without one the phrasebook looks exactly as it always has.
      if (words && !found.length && hasKey()) list.append(h('button', { class: 'btn', onclick: () => openAddSheet(words, saved) }, `Add '${words}' with AI`));
      return;
    }
    // Everything once: Starred, then phrases you say under their first topic, then what staff say.
    for (const s of bookSections(app.pack, app.stars)) {
      list.append(h('h2', { class: 'sect' }, s.label), h('ul', { class: 'list' }, s.phrases.map((p) => phraseRow(p, s.key, back, paint))));
    }
  };

  /** After a save: show My words, where the new word is. */
  const saved = (p: Phrase) => {
    search.value = '';
    key = MINE;
    history.replaceState(null, '', `#/phrasebook?list=${MINE}`);
    paint();
    notify(`Saved "${p.english}" to My words.`);
  };

  root.append(header('Phrasebook', undefined, langSwitch()), note, search, chips, list);
  paint();
  chips.querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  return stopSpeaking;
};

/** One phrase, as big as it gets, for showing to staff. Prev and Next walk the list it came from. */
export const showScreen: Screen = (root, q) => {
  const list = q.get('list') ?? ALL;
  const back = safeBack(q.get('back')) ?? `/phrasebook?list=${list}`;
  const p = byId(q.get('id'));
  const label = [{ key: ALL, label: 'Phrasebook' }, ...bookLists(app.pack, app.stars)].find((l) => l.key === list)?.label ?? 'Phrasebook';
  root.append(header(label, back));
  if (!p) { root.append(h('p', { class: 'note' }, 'Phrase not found.')); return; }
  // Staff may take a while to read it. Do not let the screen dim.
  const awakeNote = h('p', { class: 'note center', hidden: true }, 'Your screen may switch off while you show this. Turn off battery saver to keep it on.');
  const release = keepAwake(() => { awakeNote.hidden = false; });

  // Rebuilt when the star flips, because starred phrases move to the front.
  const nav = h('div');
  const paintNav = () => {
    const phrases = bookPhrases(app.pack, list, app.stars);
    const i = phrases.findIndex((x) => x.id === p.id);
    const step = (d: number) => showLink(phrases[(i + d + phrases.length) % phrases.length], list, back);
    nav.replaceChildren(...(i >= 0 && phrases.length > 1 ? [h('div', { class: 'grades two' },
      h('a', { class: 'btn', href: step(-1) }, '‹ Previous'),
      h('a', { class: 'btn', href: step(1) }, 'Next ›'))] : []));
  };
  const reply = p.listen ? byId(p.replyId) : undefined;

  root.append(
    h('div', { class: 'flash static show' },
      p.listen ? h('small', { class: 'note' }, 'They said') : null,
      p.mine ? h('small', { class: 'tag' }, 'Mine') : null,
      h('div', { class: 'big show-text', lang: app.pack.meta.ttsLocale }, p.native),
      h('div', { class: 'answer' }, p.reading),
      h('div', { class: 'english' }, p.english)),
    h('div', { class: 'show-actions' },
      h('button', { class: 'btn primary big', onclick: () => play(p) }, '🔊 Play'),
      starButton(p, paintNav, 'btn big star-big')),
  );
  if (reply) {
    root.append(h('h2', { class: 'sect' }, 'Say back'),
      h('a', { class: 'row', href: showLink(reply, list, back) },
        h('span', { class: 'grow' }, h('b', null, reply.english), h('small', null, `${reply.reading} · ${reply.native}`)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }
  paintNav();
  root.append(nav, awakeNote);
  if (p.mine) {
    root.append(h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm(`Delete "${p.english}" from My words?`)) return;
      try { await deleteMine(p.id); } catch { notify('Could not delete the word. Try again.'); return; }
      location.hash = `#${back}`;
    } }, 'Delete from My words'));
  }
  return () => { release(); stopSpeaking(); };
};
