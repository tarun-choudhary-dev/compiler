import { PyodideRuntime } from './runtime/runtime.js';
import { EXECUTION_TIMEOUT_MS, MAX_SOURCE_CHARS } from './runtime/config.js';
import { processResult } from './ui/results.js';

export class PythonController {
  constructor({ editor, state, view }) {
    Object.assign(this, { editor, state, view });
    this.runtime = new PyodideRuntime(message => this.receive(message));
  }
  initialize() {
    this.state.phase = 'loading';
    this.state.notice = '';
    this.view.render(this.state);
    return this.runtime.initialize();
  }
  changed() {
    if (this.state.hasRun) { this.state.dirty = true; this.view.render(this.state); }
  }
  run() {
    if (this.state.phase !== 'ready') return;
    const source = this.editor.getValue();
    this.editor.clearError();
    Object.assign(this.state, { output: '', stderr: '', error: '', bytecode: '', disassembly: '', truncated: false, hasRun: true, dirty: false, notice: '', duration: 0 });
    if (!source.trim() || source.length > MAX_SOURCE_CHARS) {
      this.state.error = !source.trim() ? 'Nothing to run. Write some Python code first.' : 'This program is too large. Keep the source under 100,000 characters.';
      this.state.activeTab = 'errors';
      this.view.render(this.state);
      return;
    }
    this.sourceAtRun = source;
    this.state.phase = 'running';
    this.state.runId++;
    this.state.activeTab = 'output';
    this.view.render(this.state);
    this.timer = setTimeout(() => this.stop('Execution stopped after 15 seconds. Python has been reset; simplify your program and run again.'), EXECUTION_TIMEOUT_MS);
    this.runtime.run(this.state.runId, source);
  }
  stop(reason = 'Execution stopped. Python has been reset; you can run your code again.') {
    if (this.state.phase !== 'running') return;
    clearTimeout(this.timer);
    this.runtime.dispose();
    this.state.runId++;
    this.state.error = reason;
    this.state.activeTab = 'errors';
    this.initialize();
  }
  receive(message) {
    if (message.type === 'ready') {
      this.state.phase = 'ready';
      this.state.version = typeof message.version === 'string' && /^\d+\.\d+\.\d+$/.test(message.version) ? message.version : '';
    } else if (message.type === 'fatal') {
      clearTimeout(this.timer);
      this.state.phase = 'unavailable';
      this.state.notice = (typeof message.message === 'string' ? message.message.slice(0, 1000) : 'Python could not load.') + ' The editor is still available. Use Retry to load Python again.';
      if (this.state.hasRun) { this.state.error = this.state.notice; this.state.activeTab = 'errors'; }
    } else if (message.id === this.state.runId && this.state.phase === 'running') {
      const result = processResult(message);
      if (message.type === 'stream') {
        this.state.output = result.output; this.state.stderr = result.stderr; this.state.truncated = result.truncated;
      } else if (message.type === 'result') {
        clearTimeout(this.timer);
        Object.assign(this.state, result, { phase: 'ready', dirty: this.editor.getValue() !== this.sourceAtRun });
        if (result.error || result.stderr) this.state.activeTab = 'errors';
        if (result.error && !this.state.dirty) this.editor.markError(result.errorLine);
      }
    }
    this.view.render(this.state);
  }
  dispose() { clearTimeout(this.timer); this.runtime.dispose(); }
}
