import { PyodideRuntime } from './runtime/runtime.js';
import { EXECUTION_TIMEOUT_MS, MAX_SOURCE_CHARS } from './runtime/config.js';
import { processResult } from './ui/results.js';
import { createTrace } from './ui/source-map.js';

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
    this.state.activeStage = 'source';
    this.clearSelection(false);
    if (this.state.hasRun) { this.state.dirty = true; this.view.render(this.state); }
  }
  replaceSource(source) {
    if (this.state.phase === 'running') this.stop();
    this.editor.setValue(source);
    this.editor.clearError();
    this.clearSelection(false);
    Object.assign(this.state, {
      activeTab: 'output', activeStage: 'source', output: '', stderr: '', error: '',
      tokens: [], tokenError: '', tokensTruncated: false, astTree: '', astDump: '',
      astError: '', compileError: '', codeObject: '', bytecode: '', disassembly: '',
      traceData: null, trace: null, truncated: false, hasRun: false, dirty: false,
      notice: '', duration: 0,
    });
    this.sourceAtRun = undefined;
    this.view.render(this.state);
  }
  clearSelection(render = true) {
    this.state.selection = null;
    this.editor.clearTrace?.();
    if (render && this.editor.view?.somethingSelected()) {
      this.suppressCursor = true;
      try { this.editor.view.setCursor(this.editor.view.getCursor('head')); }
      finally { this.suppressCursor = false; }
    }
    if (render) this.view.render(this.state);
  }
  selectSource() {
    if (this.suppressCursor || !this.state.trace || this.state.dirty || this.editor.getValue() !== this.sourceAtRun) return;
    const cm = this.editor.view;
    const from = cm.getCursor('from'), to = cm.getCursor('to');
    const range = { start: { line: from.line + 1, column: from.ch }, end: { line: to.line + 1, column: to.ch } };
    this.state.selection = this.state.trace.selection(from.line + 1, range);
    this.editor.markTrace(range, from.line + 1);
    this.state.activeTab = 'trace'; this.state.activeStage = 'trace';
    this.view.render(this.state);
  }
  selectAst(id) {
    if (this.state.dirty || !this.state.trace) return;
    const node = this.state.trace.astNodes.find(item => item.id === id);
    if (!node) return;
    this.state.selection = node.range ? this.state.trace.selection(node.range.start.line, node.range, node) :
      { astId: id, astCandidates: [id], tokenIndices: [], instructionIds: [], codeIds: [], unavailable: true };
    this.state.selection.kind = 'ast';
    this.showSource(node.range);
    this.view.render(this.state);
  }
  selectToken(index) {
    if (this.state.dirty || !this.state.trace) return;
    const selection = this.state.trace.tokenSelection(index);
    if (!selection) return;
    this.state.selection = selection;
    this.showSource(selection.range);
    this.view.render(this.state);
  }
  selectInstruction(id) {
    if (this.state.dirty || !this.state.trace) return;
    const instruction = this.state.trace.instructions.find(item => item.id === id);
    if (!instruction) return;
    const line = instruction.source?.line;
    const candidates = instruction.range ? this.state.trace.astForRange(instruction.range) : [];
    this.state.selection = line ? this.state.trace.selection(line, instruction.range, candidates.length === 1 ? candidates[0] : null, instruction) :
      { astId: null, astCandidates: [], tokenIndices: [], instructionIds: [], codeIds: [instruction.codeId], unavailable: true };
    this.state.selection.kind = 'instruction';
    this.state.selection.selectedInstructionId = id;
    this.state.selection.astCandidates = candidates.map(node => node.id);
    if (instruction.range) this.showSource(instruction.range);
    else if (line) {
      this.suppressCursor = true;
      try { this.editor.view.setCursor({ line: line - 1, ch: 0 }); }
      finally { this.suppressCursor = false; }
      this.editor.markTrace(null, line);
      this.editor.view.scrollIntoView({ line: line - 1, ch: 0 }, 60);
    }
    else this.showSource(null);
    this.view.render(this.state);
  }
  showSource(range) {
    if (!range) {
      this.editor.clearTrace?.();
      if (this.editor.view?.somethingSelected()) {
        this.suppressCursor = true;
        try { this.editor.view.setCursor(this.editor.view.getCursor('head')); }
        finally { this.suppressCursor = false; }
      }
      return;
    }
    this.suppressCursor = true;
    try {
      this.editor.markTrace(range, range.start.line);
      this.editor.view.setSelection({ line: range.start.line - 1, ch: range.start.column },
        { line: range.end.line - 1, ch: range.end.column });
      this.editor.view.scrollIntoView({ from: { line: range.start.line - 1, ch: range.start.column },
        to: { line: range.end.line - 1, ch: range.end.column } }, 60);
    } finally { this.suppressCursor = false; }
  }
  run() {
    if (this.state.phase !== 'ready') return;
    const source = this.editor.getValue();
    this.editor.clearError();
    this.clearSelection(false);
    Object.assign(this.state, {
      output: '', stderr: '', error: '', tokens: [], tokenError: '', tokensTruncated: false,
      astTree: '', astDump: '', astError: '', compileError: '', codeObject: '', bytecode: '', disassembly: '',
      traceData: null, trace: null, truncated: false, hasRun: true, dirty: false, notice: '', duration: 0,
    });
    if (!source.trim() || source.length > MAX_SOURCE_CHARS) {
      this.state.error = !source.trim() ? 'Nothing to run. Write some Python code first.' : 'This program is too large. Keep the source under 100,000 characters.';
      this.state.activeTab = 'errors';
      this.state.activeStage = '';
      this.view.render(this.state);
      return;
    }
    this.sourceAtRun = source;
    this.state.phase = 'running';
    this.state.runId++;
    this.state.activeTab = 'output';
    this.state.activeStage = 'output';
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
    this.state.activeStage = '';
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
        if (!this.state.dirty) this.state.trace = createTrace(result.traceData, this.sourceAtRun, result.tokens);
        if (result.error || result.stderr) { this.state.activeTab = 'errors'; this.state.activeStage = ''; }
        if (result.error && !this.state.dirty) this.editor.markError(result.errorLine);
      }
    }
    this.view.render(this.state);
  }
  dispose() { clearTimeout(this.timer); this.runtime.dispose(); }
}
