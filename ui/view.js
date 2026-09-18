import { formatDuration } from './results.js';

export class PlaygroundView {
  constructor() {
    this.elements = Object.fromEntries(['run-button','stop-button','retry-button','runtime-status','runtime-dot','runtime-notice','python-version','execution-status','output-empty','output-content','bytecode-content','disassembly-content','errors-content','error-count'].map(id => [id, document.getElementById(id)]));
    this.tabs = [...document.querySelectorAll('[data-tab]')];
  }
  selectTab(name, focus = false) {
    for (const tab of this.tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }
  render(state) {
    const el = this.elements;
    el['run-button'].disabled = state.phase !== 'ready';
    el['stop-button'].hidden = state.phase !== 'running';
    el['retry-button'].hidden = state.phase !== 'unavailable';
    el['runtime-status'].textContent = { loading: 'LOADING PYTHON…', ready: 'PYTHON READY', running: 'RUNNING PYTHON…', unavailable: 'PYTHON UNAVAILABLE' }[state.phase] || 'PYTHON UNAVAILABLE';
    el['runtime-dot'].classList.toggle('ready', state.phase === 'ready');
    el['runtime-notice'].hidden = !state.notice;
    el['runtime-notice'].textContent = state.notice;
    el['python-version'].textContent = state.version ? `PYTHON ${state.version}` : 'PYTHON';
    const problem = !!(state.error || state.stderr);
    el['error-count'].hidden = !problem;
    el['execution-status'].textContent = state.phase === 'running' ? 'Executing…' : state.hasRun ? (state.dirty ? 'Source changed · run again' : state.error ? 'Execution stopped' : `Finished in ${formatDuration(state.duration)}`) : 'Ready when you are';
    el['output-empty'].hidden = state.hasRun;
    el['output-content'].hidden = !state.hasRun;
    el['output-content'].textContent = state.output + (state.truncated ? '\n[Output limit reached: further output omitted.]' : '') || (state.phase === 'running' ? 'Running…' : state.error ? 'No standard output. See Errors for details.' : 'Program finished without standard output.');
    el['bytecode-content'].textContent = state.bytecode || (state.hasRun ? 'No bytecode available for this run.' : 'Run your code to inspect its bytecode.');
    el['disassembly-content'].textContent = state.disassembly || (state.hasRun ? 'No disassembly available for this run.' : 'Run your code to inspect its instructions.');
    el['errors-content'].textContent = [state.stderr, state.error].filter(Boolean).join(state.stderr.endsWith('\n') ? '' : '\n') || 'No errors to show.';
    this.selectTab(state.activeTab);
  }
}
