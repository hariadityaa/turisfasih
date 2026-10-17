import { addMine, app, say, situationLabel } from '../app';
import { aiErrorText, generate, type AiOption } from '../core/gemini';
import { phraseFromOption } from '../core/mine';
import type { Phrase } from '../core/types';
import { loadKey } from '../platform/aikey';
import { h } from './dom';

export const PRIVACY = 'Words you add are sent to Google Gemini. Nothing else leaves the phone.';
export const OFFLINE = 'You are offline. Adding a word needs internet. Words you saved still work offline.';

/** Bottom sheet: English in, 1–3 translations out, pick one and save it to My words. */
export function openAddSheet(query: string, onsaved: (p: Phrase) => void) {
  let ctrl: AbortController | undefined;
  let picked: AiOption | undefined;
  const close = () => { ctrl?.abort(); sheet.close(); sheet.remove(); };

  const input = h('input', { type: 'text', class: 'search', value: query, maxLength: 80, 'aria-label': 'English word or phrase', placeholder: 'English, e.g. bill',
    enterKeyHint: 'go', onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') void run(); } });
  const go = h('button', { class: 'btn primary', onclick: () => void run() }, 'Generate');
  const status = h('p', { class: 'note', 'aria-live': 'polite' });
  const list = h('ul', { class: 'list' });
  const save = h('button', { class: 'btn primary big', hidden: true, disabled: true, onclick: () => void store() }, 'Save to My words');

  const pick = (o: AiOption) => {
    picked = o;
    list.querySelectorAll<HTMLElement>('.option').forEach((el, i) => el.setAttribute('aria-pressed', String(shown[i] === o)));
    save.disabled = false;
  };
  let shown: AiOption[] = [];

  async function run() {
    const words = input.value.trim();
    if (!words) { input.focus(); return; }
    picked = undefined;
    shown = [];
    list.replaceChildren();
    save.hidden = true;
    save.disabled = true;
    if (!navigator.onLine) { status.textContent = OFFLINE; return; }
    ctrl?.abort();
    ctrl = new AbortController();
    go.disabled = true;
    status.textContent = 'Asking Gemini…';
    try {
      const r = await generate(words, loadKey(), app.pack, { signal: ctrl.signal });
      shown = r.options;
      status.textContent = r.options.length ? (r.options.length > 1 ? 'Pick the meaning you want.' : '') : r.error ?? '';
      list.replaceChildren(...r.options.map((o) => h('li', { class: 'phrase' },
        h('button', { class: 'grow option', 'aria-pressed': 'false', onclick: () => pick(o) },
          h('b', { class: 'script-big', lang: app.pack.meta.ttsLocale }, o.native),
          h('span', { class: 'answer' }, o.reading),
          h('small', { class: 'say' }, [o.sense || o.english, situationLabel(o.tag)].join(' · '))),
        h('button', { class: 'play', 'aria-label': `Play: ${o.native}`, onclick: () => void say(o.speak ?? o.native) }, '🔊'))));
      save.hidden = !r.options.length;
      if (r.options.length === 1) pick(r.options[0]);
    } catch (e) {
      if ((e as Error).message === 'Cancelled') return;
      status.textContent = navigator.onLine ? aiErrorText(e) : OFFLINE;
    } finally { go.disabled = false; }
  }

  async function store() {
    if (!picked) return;
    const p = phraseFromOption(picked);
    save.disabled = true;
    try { await addMine(p); } catch {
      status.textContent = 'Could not save the word. Your phone may be low on storage.';
      save.disabled = false;
      return;
    }
    close();
    onsaved(p);
  }

  const sheet = h('dialog', { class: 'sheet', 'aria-label': 'Add word with AI',
    onclick: (e: MouseEvent) => { if (e.target === sheet) close(); }, onclose: () => { ctrl?.abort(); sheet.remove(); } },
    h('div', { class: 'sheet-body' },
      h('h2', { class: 'sect' }, `Add a ${app.pack.meta.name} word with AI`),
      h('div', { class: 'ai-ask' }, input, go),
      status, list, save,
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
      h('p', { class: 'note' }, PRIVACY)));
  document.body.append(sheet);
  sheet.showModal();
  (query ? go : input).focus();
}
