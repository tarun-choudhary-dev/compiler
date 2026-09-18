import { PythonEditor } from './editor/editor.js';
import { PythonController } from './controller.js';
import { createState } from './ui/state.js';
import { PlaygroundView } from './ui/view.js';
import { canCreateSnapshot, createSnapshot, serializeSnapshot, downloadText } from './ui/snapshot.js';
import { readSnapshotFile } from './ui/snapshot-validator.js';
import { SnapshotSession } from './ui/snapshot-session.js';
import { ComparisonView, renderSnapshotMetadata } from './ui/snapshot-view.js';

const state = createState();
const view = new PlaygroundView();
const comparison = new ComparisonView();
const slots = { A: null, B: null };
const importGeneration = { A: 0, B: 0 };
let controller, editor, snapshotEditor, snapshotSession, mode = 'live', activeSlot = 'A';
const byId = id => document.getElementById(id);
const liveView = { render: current => { if (mode === 'live') view.render(current); } };
const currentState = () => mode === 'snapshot' && snapshotSession ? snapshotSession.state : state;
const currentSelection = () => mode === 'snapshot' ? snapshotSession : controller;

function showMode(next) {
  if (next === 'snapshot' && !slots[activeSlot]) activeSlot = slots.A ? 'A' : 'B';
  if (next === 'snapshot' && !slots[activeSlot]) next = 'live';
  mode = next;
  byId('live-workspace').hidden = mode !== 'live';
  byId('snapshot-workspace').hidden = mode !== 'snapshot';
  byId('compare-workspace').hidden = mode !== 'compare';
  document.querySelector('.pipeline-nav').hidden = mode !== 'live';
  document.querySelector('.workspace-caption').hidden = mode !== 'live';
  document.querySelector('.export-toolbar').hidden = mode !== 'live';
  byId('runtime-notice').hidden = mode !== 'live' || !state.notice;
  for (const name of ['live','snapshot','compare']) byId(`mode-${name}`).setAttribute('aria-pressed', String(mode === name));
  byId('mode-snapshot').disabled = !slots.A && !slots.B;
  byId('clear-a').disabled = !slots.A;
  byId('clear-b').disabled = !slots.B;
  const pane = byId('inspection-pane');
  if (mode === 'snapshot') {
    byId('snapshot-result-slot').append(pane);
    snapshotSession = new SnapshotSession(slots[activeSlot].snapshot, snapshotEditor, view);
    snapshotSession.suppressCursor = true;
    snapshotEditor.clearTrace(); snapshotEditor.setValue(slots[activeSlot].snapshot.source);
    snapshotSession.suppressCursor = false;
    snapshotEditor.refresh(); snapshotSession.render();
    renderSnapshotMetadata(byId('snapshot-metadata'), `SNAPSHOT ${activeSlot}`, slots[activeSlot].name, slots[activeSlot].snapshot);
  } else {
    byId('live-workspace').insertBefore(pane, document.querySelector('.run-toolbar'));
    if (mode === 'live') { view.render(state); editor?.refresh(); }
    else { comparison.render(slots.A, slots.B); byId('python-version').textContent = 'PYTHON'; }
  }
  document.querySelector('.status-bar>span').textContent = mode === 'live' ? 'Your code runs locally in your browser.' : 'Imported snapshots are read-only data. No Python is executed.';
}

async function importSnapshot(slot, file) {
  if (!file) return;
  const generation = ++importGeneration[slot];
  const status = byId('snapshot-status'); status.classList.remove('invalid');
  status.textContent = `READING SNAPSHOT ${slot}…`;
  try {
    const snapshot = await readSnapshotFile(file);
    if (generation !== importGeneration[slot]) return;
    slots[slot] = { snapshot, name: file.name.slice(0, 200) };
    activeSlot = slot;
    status.textContent = `IMPORTED SNAPSHOT ${slot} · READ ONLY · ${slots[slot].name}`;
    showMode(slots.A && slots.B ? 'compare' : 'snapshot');
  } catch (error) {
    if (generation !== importGeneration[slot]) return;
    status.classList.add('invalid');
    status.textContent = `INVALID SNAPSHOT · ${error instanceof Error ? error.message : 'The file could not be read.'}`;
  }
}

for (const slot of ['A','B']) {
  byId(`import-${slot.toLowerCase()}`).addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    await importSnapshot(slot, file);
  });
  byId(`clear-${slot.toLowerCase()}`).addEventListener('click', () => {
    importGeneration[slot]++;
    slots[slot] = null;
    byId('snapshot-status').classList.remove('invalid');
    byId('snapshot-status').textContent = `Snapshot ${slot} cleared.`;
    if (activeSlot === slot) activeSlot = slots.A ? 'A' : 'B';
    showMode(mode === 'snapshot' && !slots[activeSlot] ? 'live' : mode);
  });
}
for (const name of ['live','snapshot','compare']) byId(`mode-${name}`).addEventListener('click', () => showMode(name));
for (const slot of ['A','B']) byId(`inspect-${slot.toLowerCase()}`).addEventListener('click', () => {
  activeSlot = slot; showMode('snapshot');
});
for (const tab of comparison.tabs) {
  tab.addEventListener('click', () => comparison.select(tab.dataset.compare));
  tab.addEventListener('keydown', event => {
    const index = comparison.tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % comparison.tabs.length,
      ArrowLeft: (index + comparison.tabs.length - 1) % comparison.tabs.length,
      Home: 0, End: comparison.tabs.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); comparison.select(comparison.tabs[next].dataset.compare, true); }
  });
}

function navigate() {
  const route = ['playground', 'how-it-works', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'playground';
  for (const page of document.querySelectorAll('.page')) page.hidden = page.id !== route;
  for (const link of document.querySelectorAll('#navigation a')) {
    if (link.hash === `#${route}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.getElementById('navigation').classList.remove('open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
  if (route === 'playground') { editor?.refresh(); if (mode === 'snapshot') snapshotEditor?.refresh(); }
  document.title = `PYLAB — ${{ playground: 'Python playground', 'how-it-works': 'How it works', about: 'About' }[route]}`;
}

document.getElementById('menu-toggle').addEventListener('click', event => {
  const open = document.getElementById('navigation').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', navigate);

for (const tab of view.tabs) {
  tab.addEventListener('click', () => { const current = currentState(); current.activeTab = tab.dataset.tab; current.activeStage = current.activeTab; view.selectTab(current.activeTab); view.selectStage(current.activeStage); });
  tab.addEventListener('keydown', event => {
    const index = view.tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % view.tabs.length, ArrowLeft: (index + view.tabs.length - 1) % view.tabs.length, Home: 0, End: view.tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const current = currentState(); current.activeTab = view.tabs[next].dataset.tab;
    current.activeStage = current.activeTab;
    view.selectTab(current.activeTab, true);
    view.selectStage(current.activeStage);
  });
}

for (const stage of view.stages) {
  stage.addEventListener('click', () => {
    if (mode !== 'live') return;
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
  controller = new PythonController({ editor, state, view: liveView });
  snapshotEditor = new PythonEditor(byId('snapshot-source'), {
    readOnly: true, onRun: () => {}, onChange: () => {},
    onCursor: (line, column) => { byId('snapshot-cursor-position').textContent = `Ln ${line}, Col ${column}`; if (mode === 'snapshot') snapshotSession?.selectSource(); },
  });
  document.getElementById('editor-host').addEventListener('click', () => controller.selectSource());
  byId('snapshot-editor-host').addEventListener('click', () => { if (mode === 'snapshot') snapshotSession?.selectSource(); });
  document.querySelector('.result-panels').addEventListener('click', event => {
    const selection = currentSelection();
    const ast = event.target.closest('[data-ast-id]');
    const instruction = event.target.closest('[data-instruction-id]');
    const token = event.target.closest('[data-token-index]');
    if (ast) selection?.selectAst(ast.dataset.astId);
    else if (instruction) selection?.selectInstruction(instruction.dataset.instructionId);
    else if (token) selection?.selectToken(Number(token.dataset.tokenIndex));
  });
  document.getElementById('clear-trace').addEventListener('click', () => currentSelection()?.clearSelection());
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
    if (mode === 'live' && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && !document.getElementById('playground').hidden) { event.preventDefault(); controller.run(); }
  });
  window.addEventListener('pagehide', () => controller.dispose());
  window.addEventListener('pageshow', event => { if (event.persisted) controller.initialize(); });
  controller.initialize();
  showMode('live');
} catch (error) {
  state.phase = 'unavailable';
  state.notice = error instanceof Error ? error.message : 'The playground could not start. Refresh the page to try again.';
  view.render(state);
}
navigate();
