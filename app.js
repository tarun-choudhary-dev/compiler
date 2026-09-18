import { PythonEditor } from './editor/editor.js';
import { PythonController } from './controller.js';
import { createState } from './ui/state.js';
import { PlaygroundView } from './ui/view.js';

const state = createState();
const view = new PlaygroundView();
let controller, editor;

function navigate() {
  const route = ['playground', 'how-it-works', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'playground';
  for (const page of document.querySelectorAll('.page')) page.hidden = page.id !== route;
  for (const link of document.querySelectorAll('#navigation a')) {
    if (link.hash === `#${route}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.getElementById('navigation').classList.remove('open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
  if (route === 'playground') editor?.refresh();
  document.title = `PYLAB — ${{ playground: 'Python playground', 'how-it-works': 'How it works', about: 'About' }[route]}`;
}

document.getElementById('menu-toggle').addEventListener('click', event => {
  const open = document.getElementById('navigation').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', navigate);

for (const tab of view.tabs) {
  tab.addEventListener('click', () => { state.activeTab = tab.dataset.tab; view.selectTab(state.activeTab); });
  tab.addEventListener('keydown', event => {
    const index = view.tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % 4, ArrowLeft: (index + 3) % 4, Home: 0, End: 3 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    state.activeTab = view.tabs[next].dataset.tab;
    view.selectTab(state.activeTab, true);
  });
}

try {
  editor = new PythonEditor(document.getElementById('source'), {
    onRun: () => controller?.run(), onChange: () => controller?.changed(),
    onCursor: (line, column) => { document.getElementById('cursor-position').textContent = `Ln ${line}, Col ${column}`; },
  });
  controller = new PythonController({ editor, state, view });
  document.getElementById('run-button').addEventListener('click', () => controller.run());
  document.getElementById('stop-button').addEventListener('click', () => controller.stop());
  document.getElementById('retry-button').addEventListener('click', () => controller.initialize());
  if (/Mac|iPhone|iPad/.test(navigator.platform)) document.getElementById('modifier-key').textContent = '⌘';
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !document.getElementById('playground').hidden) { event.preventDefault(); controller.run(); }
  });
  window.addEventListener('pagehide', () => controller.dispose());
  window.addEventListener('pageshow', event => { if (event.persisted) controller.initialize(); });
  controller.initialize();
} catch (error) {
  state.phase = 'unavailable';
  state.notice = error instanceof Error ? error.message : 'The playground could not start. Refresh the page to try again.';
  view.render(state);
}
navigate();
