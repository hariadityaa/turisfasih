import { app, reloadFromStorage, saveSettingsQuietly, setLanguage, say } from '../app';
import { aiErrorText, generate } from '../core/gemini';
import { loadKey, saveKey } from '../platform/aikey';
import { exportBackup, importBackup } from '../platform/backup';
import { resetLanguage } from '../platform/db';
import { notify } from '../platform/notice';
import { canInstall, install, isStandalone } from '../platform/pwa';
import { matchingVoices, ttsSupported, voicesReady } from '../platform/tts';
import { PRIVACY } from './aiword';
import { h, header, type Screen } from './dom';

export const settingsScreen: Screen = (root) => {
  const s = app.settings;
  const { meta } = app.pack;

  const lang = h('select', { 'aria-label': 'Language', onchange: async (e: Event) => {
    const select = e.target as HTMLSelectElement;
    const chosen = app.packs.find((p) => p.code === select.value);
    try { await setLanguage(select.value); } catch {
      select.value = s.lang;
      notify(`Could not open ${chosen?.name ?? 'that language'}. Try again, or close the app and open it again.`);
      return;
    }
    location.hash = '#/';
  } },
    app.packs.map((p) => h('option', { value: p.code, selected: p.code === s.lang }, `${p.name} (${p.nativeName})`)));

  const warn = h('div', { class: 'warn', role: 'alert', hidden: true });
  const voice = h('select', { 'aria-label': 'Voice', onchange: (e: Event) => { s.voice[s.lang] = (e.target as HTMLSelectElement).value; saveSettingsQuietly(); } },
    h('option', null, 'Loading voices…'));

  /** Voices load late on Android. Draw the page now and fill these in when they arrive. */
  const fillVoices = () => {
    const voices = matchingVoices(meta.ttsLocale);
    const exact = voices.some((v) => v.lang.toLowerCase().replace('_', '-') === meta.ttsLocale.toLowerCase());
    warn.textContent = !ttsSupported
      ? 'This browser has no speech support. Audio will not play.'
      : !voices.length
        ? `No ${meta.name} voice found on this device. Install one in Android Settings → System → Languages → Text-to-speech, then reopen the app.`
        : !exact ? `No ${meta.ttsLocale} voice. Using a ${voices[0].lang} voice instead.` : '';
    warn.hidden = !warn.textContent;
    voice.replaceChildren(...(voices.length
      ? voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.voice[s.lang] }, `${v.name} (${v.lang})`))
      : [h('option', null, 'None available')]));
  };

  const rate = h('input', { type: 'range', min: '0.5', max: '1.2', step: '0.05', value: String(s.rate), 'aria-label': 'Speech speed',
    oninput: (e: Event) => { s.rate = Number((e.target as HTMLInputElement).value); rateLabel.textContent = `${s.rate.toFixed(2)}×`; }, onchange: () => saveSettingsQuietly() });
  const rateLabel = h('span', null, `${s.rate.toFixed(2)}×`);
  const dir = h('select', { 'aria-label': 'Card front', onchange: (e: Event) => { s.cardFront = (e.target as HTMLSelectElement).value as typeof s.cardFront; saveSettingsQuietly(); } },
    h('option', { value: 'english', selected: s.cardFront === 'english' }, 'English (say it)'),
    h('option', { value: 'native', selected: s.cardFront === 'native' }, `${meta.name} (what it means)`));

  const newN = h('select', { 'aria-label': 'New phrases per lesson', onchange: (e: Event) => { s.newPerSession = Number((e.target as HTMLSelectElement).value); saveSettingsQuietly(); } },
    [3, 5, 8, 10].map((n) => h('option', { value: n, selected: n === s.newPerSession }, String(n))));

  const msg = h('p', { class: 'note', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = file.files?.[0];
    file.value = ''; // so picking the same file again still counts as a change
    if (!f) return;
    if (!confirm('Importing replaces all progress on this device. Continue?')) return;
    try {
      const r = await importBackup(f);
      await reloadFromStorage();
      notify(`Restored ${r.cards} phrases.`);
      location.hash = '#/';
    } catch (e) { msg.textContent = `Import failed: ${(e as Error).message}`; }
  } });

  const installNote = h('p', { class: 'note', 'aria-live': 'polite' });
  const shareNote = h('p', { class: 'note', 'aria-live': 'polite' });
  const field = (label: string, ctl: Node, extra?: Node) => h('label', { class: 'field' }, h('span', null, label), ctl, extra);

  const parts = [
    header('Settings'),
    app.packs.length > 1 ? h('h2', { class: 'sect' }, 'Language') : null, app.packs.length > 1 ? field('Learning', lang) : null,
    h('h2', { class: 'sect' }, 'Audio'),
    warn,
    field('Voice', voice),
    field('Speed', rate, rateLabel),
    h('button', { class: 'btn', onclick: () => void say(app.pack.phrases.phrases[0].speak ?? app.pack.phrases.phrases[0].native) }, '🔊 Test voice'),
    h('h2', { class: 'sect' }, 'Lessons'),
    field('Card front', dir), field('New phrases per lesson', newN),
    ...aiSection(),
    h('h2', { class: 'sect' }, 'Backup'),
    h('p', { class: 'note' }, 'Progress lives only on this device. Export a backup now and then.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn', onclick: async () => {
        msg.textContent = '';
        try {
          const how = await exportBackup();
          msg.textContent = how === 'shared' ? 'Backup shared. Keep it somewhere safe, like Google Drive.'
            : how === 'downloaded' ? 'Backup downloaded. Keep the file somewhere safe, like Google Drive.' : '';
        } catch { msg.textContent = 'Could not make a backup. Try again, or close the app and open it again.'; }
      } }, 'Export backup'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Import backup'), file),
    msg,
    h('h2', { class: 'sect' }, 'App'),
    !isStandalone() && canInstall() ? h('button', { class: 'btn', onclick: async () => {
      if ((await install()) !== 'accepted') installNote.textContent = 'To install: tap the Chrome menu (⋮), then Add to Home screen.';
    } }, 'Install app') : null,
    installNote,
    h('p', { class: 'note' }, isStandalone() ? 'Running as installed app.' : canInstall() ? 'Install for full-screen offline use.' : 'Not installable from this browser, or already installed.'),
    h('button', { class: 'btn', onclick: () => void shareApp(shareNote) }, 'Share app'),
    shareNote,
    h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm(`Erase all ${meta.name} progress on this device? This cannot be undone.`)) return;
      try {
        await resetLanguage(s.lang);
        await setLanguage(s.lang, false);
        msg.textContent = 'Progress erased.';
      } catch { msg.textContent = 'Could not erase progress. Try again, or close the app and open it again.'; }
    } }, `Erase ${meta.name} progress`),
  ];
  root.append(...parts.filter((x): x is HTMLElement => !!x));
  void voicesReady(400).then(fillVoices);
};

/** Optional Gemini key for "Add word with AI". Without one, the phrasebook works as it always has. */
function aiSection(): HTMLElement[] {
  const key = h('input', { type: 'password', class: 'key', value: loadKey(), autocomplete: 'off', spellcheck: false, 'aria-label': 'Gemini API key', placeholder: 'Paste your key' });
  const result = h('p', { class: 'note', 'aria-live': 'polite' });
  const save = () => {
    try { return saveKey(key.value); } catch { result.textContent = 'Could not save the key. This browser may block storage.'; return null; }
  };
  return [
    h('h2', { class: 'sect' }, 'AI words (optional)'),
    h('p', { class: 'note' }, 'Add any word to the phrasebook with your own free Gemini key. The key stays on this phone and is never in backups.'),
    h('label', { class: 'field' }, h('span', null, 'Gemini API key'), key),
    h('div', { class: 'grades two' },
      h('button', { class: 'btn primary', onclick: () => {
        const k = save();
        if (k !== null) result.textContent = k ? 'Key saved. Search the phrasebook to add a word.' : 'Key removed. AI words are off.';
      } }, 'Save'),
      h('button', { class: 'btn', onclick: async () => {
        const k = key.value.trim();
        if (!k) { result.textContent = 'Paste a key first.'; return; }
        if (!navigator.onLine) { result.textContent = 'You are offline. Testing the key needs internet.'; return; }
        result.textContent = 'Testing…';
        try {
          const r = await generate('water', k, app.pack);
          result.textContent = `✓ ${r.model} works (water: ${r.options[0]?.native ?? 'no answer'}).`;
        } catch (e) { result.textContent = `✕ ${aiErrorText(e)}`; }
      } }, 'Test')),
    result,
    h('details', { class: 'guide' },
      h('summary', null, 'How to get a free Gemini key'),
      h('p', null, "About 2 minutes. You don't need a credit card."),
      h('ol', null,
        h('li', null, 'Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'aistudio.google.com/apikey'), ' on this phone or a computer.'),
        h('li', null, 'Sign in with any Google account.'),
        h('li', null, 'If asked, accept the terms.'),
        h('li', null, 'Tap ', h('b', null, 'Create API key'), '. If it asks for a project, pick the default one.'),
        h('li', null, 'Copy the key.'),
        h('li', null, 'Come back here and paste it into "Gemini API key". Then tap ', h('b', null, 'Save'), ' and ', h('b', null, 'Test'), '.')),
      h('p', { class: 'note' }, 'Good to know:'),
      h('ul', { class: 'note' },
        h('li', null, 'The free key has a daily limit. When it is reached, the app switches to a lighter model.'),
        h('li', null, 'On the free tier, Google may use what you send to improve its products. Adding billing to the key stops this.'),
        h('li', null, 'Keep the key private. Anyone with it can use your quota.'))),
    h('p', { class: 'note' }, PRIVACY),
  ];
}

// Installed apps hide the address bar, so this is the only way to find the link.
async function shareApp(note: HTMLElement) {
  const url = new URL(import.meta.env.BASE_URL, location.href).href;
  note.textContent = '';
  if (navigator.share) {
    try { await navigator.share({ title: 'TurisTalk', url }); return; } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  try { await navigator.clipboard.writeText(url); note.textContent = 'Link copied. Send it to a friend.'; }
  catch { note.textContent = url; }
}
