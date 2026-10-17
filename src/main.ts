import './styles/app.css';
import { app, initApp, setLanguage } from './app';
import { h } from './ui/dom';
import { consumeSetupLink } from './platform/aikey';
import { kvGet, kvSet } from './platform/db';
import { installErrorNotices, notify } from './platform/notice';
import { initPwa, install, isStandalone, waitForInstallPrompt } from './platform/pwa';
import { route, startRouter } from './router';
import { dialogueScreen } from './ui/dialogue';
import { kanaScreen } from './ui/kana';
import { numbersScreen } from './ui/numbers';
import { readingScreen } from './ui/reading';
import { settingsScreen } from './ui/settings';
import { buildShell } from './ui/shell';
import { learnScreen, topicScreen } from './ui/learn';
import { phrasebookScreen, showScreen } from './ui/phrasebook';
import { lessonScreen } from './ui/session';

installErrorNotices();
initPwa();
// A "#setup?gemini=…" link saves the key and is stripped from the URL before anything else reads it.
const keyFromLink = consumeSetupLink();

/** First run: blank screen, one question. Picking a language saves it and starts the app. */
function chooseLanguage(mount: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const problem = h('p', { class: 'warn', role: 'alert', hidden: true });
    mount.replaceChildren(h('main', { class: 'welcome' },
      h('h1', null, 'TurisTalk'),
      h('h2', { class: 'sect' }, 'What language do you want to learn?'),
      problem,
      h('div', { class: 'stack' }, app.packs.map((p) =>
        h('button', { class: 'btn big', onclick: async () => {
          try { await setLanguage(p.code); resolve(); } catch (e) {
            console.error(e);
            problem.textContent = `Could not open ${p.name}. Try again, or close the app and open it again.`;
            problem.hidden = false;
          }
        } },
          h('span', { class: 'native', 'data-pack': p.code }, p.nativeName), h('small', null, ` ${p.name}`))))));
  });
}

/**
 * First screen in a browser tab: install, or keep using the web version.
 * Skipped when running installed, when Chrome does not offer install (already installed,
 * unsupported browser), or once the user chose to stay in the browser.
 */
async function offerInstall(mount: HTMLElement, offered: Promise<boolean>): Promise<void> {
  if (isStandalone() || (await kvGet<boolean>('installDeclined')) || !(await offered)) return;
  return new Promise((resolve) => {
    mount.replaceChildren(h('main', { class: 'welcome' },
      h('h1', null, 'TurisTalk'),
      h('h2', { class: 'sect' }, 'Install the app?'),
      h('p', { class: 'note' }, 'Opens full screen from your home screen and works offline.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn big primary', onclick: async () => { await install(); resolve(); } }, 'Install app'),
        h('button', { class: 'btn big', onclick: async () => { try { await kvSet('installDeclined', true); } catch { /* asked again next time */ } resolve(); } }, 'Keep using in browser'))));
  });
}

/** The app could not start. Say so in plain words and offer a retry. */
function showFatal(mount: HTMLElement, e: unknown) {
  console.error(e);
  mount.replaceChildren(h('main', { class: 'welcome' },
    h('h1', null, 'TurisTalk'),
    h('p', { class: 'warn', role: 'alert' }, 'TurisTalk could not start. Close the app and open it again. If it keeps happening, your phone may be low on storage.'),
    h('button', { class: 'btn big primary', onclick: () => location.reload() }, 'Try again')));
}

async function boot() {
  const mount = document.getElementById('app')!;
  const offered = waitForInstallPrompt(1500);
  const ready = initApp(); // load packs while Chrome decides whether to offer install
  ready.catch(() => {}); // rejection is reported below
  try {
    await offerInstall(mount, offered);
    if (!(await ready)) await chooseLanguage(mount);
  } catch (e) {
    showFatal(mount, e);
    return;
  }
  const shell = buildShell();
  mount.replaceChildren(shell);
  route('/', learnScreen);
  route('/lesson', lessonScreen);
  route('/topic', topicScreen);
  route('/phrasebook', phrasebookScreen);
  route('/show', showScreen);
  route('/kana', kanaScreen);
  route('/numbers', numbersScreen(false));
  route('/prices', numbersScreen(true));
  route('/read', readingScreen);
  route('/dialogue', dialogueScreen);
  route('/settings', settingsScreen);
  try { await startRouter(shell.querySelector('#main')!); } catch (e) { showFatal(mount, e); }
  if (keyFromLink) notify('Gemini key saved. Search the phrasebook to add a word.');
}

void boot();
