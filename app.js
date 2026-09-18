import { PythonEditor } from './editor/editor.js';
import { PythonController } from './controller.js';
import { createState } from './ui/state.js';
import { PlaygroundView } from './ui/view.js';
import { canCreateSnapshot, createSnapshot, serializeSnapshot, downloadText } from './ui/snapshot.js';

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
  tab.addEventListener('click', () => { state.activeTab = tab.dataset.tab; state.activeStage = state.activeTab; view.selectTab(state.activeTab); view.selectStage(state.activeStage); });
  tab.addEventListener('keydown', event => {
    const index = view.tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % view.tabs.length, ArrowLeft: (index + view.tabs.length - 1) % view.tabs.length, Home: 0, End: view.tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    state.activeTab = view.tabs[next].dataset.tab;
    state.activeStage = state.activeTab;
    view.selectTab(state.activeTab, true);
    view.selectStage(state.activeStage);
  });
}

for (const stage of view.stages) {
  stage.addEventListener('click', () => {
    const name = stage.dataset.stage;
    if (name === 'source') {
      state.activeStage = 'source';
      view.selectStage('source');
      editor?.view.focus();
    } else if (name === 'output' && state.phase === 'ready') {
      controller?.run();
    } else {
      state.activeTab = name;
      state.activeStage = name;
      view.selectTab(name);
      view.selectStage(name);
    }
  });
}

try {
  editor = new PythonEditor(document.getElementById('source'), {
    onRun: () => controller?.run(), onChange: () => { controller?.changed(); document.getElementById('export-status').textContent = ''; },
    onCursor: (line, column) => { document.getElementById('cursor-position').textContent = `Ln ${line}, Col ${column}`; controller?.selectSource(); },
  });
  controller = new PythonController({ editor, state, view });
  document.getElementById('editor-host').addEventListener('click', () => controller.selectSource());
  document.querySelector('.result-panels').addEventListener('click', event => {
    const ast = event.target.closest('[data-ast-id]');
    const instruction = event.target.closest('[data-instruction-id]');
    const token = event.target.closest('[data-token-index]');
    if (ast) controller.selectAst(ast.dataset.astId);
    else if (instruction) controller.selectInstruction(instruction.dataset.instructionId);
    else if (token) controller.selectToken(Number(token.dataset.tokenIndex));
  });
  document.getElementById('clear-trace').addEventListener('click', () => controller.clearSelection());
  const exportStatus = document.getElementById('export-status');
  document.getElementById('download-source').addEventListener('click', () => {
    downloadText('program.py', editor.getValue(), 'text/x-python;charset=utf-8');
    exportStatus.textContent = 'Source downloaded.';
  });
  const inspectionJson = () => {
    if (!canCreateSnapshot(state, editor.getValue(), controller.sourceAtRun)) {
      exportStatus.textContent = 'Run the current source before exporting its inspection.';
      return null;
    }
    try { return serializeSnapshot(createSnapshot(state, controller.sourceAtRun)); }
    catch (error) { exportStatus.textContent = error instanceof Error ? error.message : 'Inspection export failed.'; return null; }
  };
  document.getElementById('download-inspection').addEventListener('click', () => {
    const json = inspectionJson();
    if (json === null) return;
    downloadText('pylab-inspection.json', json, 'application/json;charset=utf-8');
    exportStatus.textContent = 'Inspection downloaded.';
  });
  document.getElementById('copy-inspection').addEventListener('click', async () => {
    const json = inspectionJson();
    if (json === null) return;
    if (!navigator.clipboard?.writeText) { exportStatus.textContent = 'Clipboard access is unavailable in this browser.'; return; }
    try { await navigator.clipboard.writeText(json); exportStatus.textContent = 'Inspection copied.'; }
    catch { exportStatus.textContent = 'Clipboard access was blocked. Download the inspection instead.'; }
  });
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
