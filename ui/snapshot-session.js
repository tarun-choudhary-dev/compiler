import { createState } from './state.js';
import { createTrace } from './source-map.js';

/** Read-only adapter for the existing result/trace view. It has no runtime. */
export class SnapshotSession {
  constructor(snapshot, editor, view) {
    this.editor = editor; this.view = view;
    const inspection = snapshot.inspection, execution = snapshot.execution;
    this.state = Object.assign(createState(), {
      phase: 'ready', version: snapshot.runtime.pythonVersion || '', hasRun: true,
      output: execution.stdout, stderr: execution.stderr, error: execution.error || '',
      duration: execution.durationMs, truncated: execution.outputTruncated,
      tokens: inspection.tokens, tokensTruncated: inspection.limits.tokensTruncated,
      astTree: inspection.ast.tree, astDump: inspection.ast.dump, astError: inspection.ast.error || '',
      codeObject: inspection.codeObjectText, bytecode: inspection.bytecode,
      disassembly: inspection.disassembly, compileError: inspection.compileError || '',
      trace: createTrace({ astNodes: inspection.ast.nodes, codeObjects: inspection.codeObjects,
        instructions: inspection.instructions, instructionsTruncated: inspection.limits.instructionsTruncated },
      snapshot.source, inspection.tokens),
    });
  }
  render() { this.view.render(this.state); }
  clearSelection() {
    this.state.selection = null; this.editor.clearTrace();
    this.render();
  }
  showSource(range, line = range?.start.line) {
    this.suppressCursor = true;
    try {
      this.editor.markTrace(range, line);
      if (range) {
        this.editor.view.setSelection({ line: range.start.line - 1, ch: range.start.column },
          { line: range.end.line - 1, ch: range.end.column });
        this.editor.view.scrollIntoView({ from: { line: range.start.line - 1, ch: range.start.column },
          to: { line: range.end.line - 1, ch: range.end.column } }, 60);
      } else if (line) this.editor.view.scrollIntoView({ line: line - 1, ch: 0 }, 60);
    } finally { this.suppressCursor = false; }
  }
  selectSource() {
    if (this.suppressCursor) return;
    const cm = this.editor.view, a = cm.getCursor('from'), b = cm.getCursor('to');
    const range = { start: { line: a.line + 1, column: a.ch }, end: { line: b.line + 1, column: b.ch } };
    this.state.selection = this.state.trace.selection(a.line + 1, range);
    this.editor.markTrace(range, a.line + 1);
    this.state.activeTab = 'trace'; this.render();
  }
  selectAst(id) {
    const node = this.state.trace.astNodes.find(item => item.id === id);
    if (!node) return;
    this.state.selection = node.range ? this.state.trace.selection(node.range.start.line, node.range, node) :
      { astId: id, astCandidates: [id], tokenIndices: [], instructionIds: [], codeIds: [], unavailable: true };
    this.state.selection.kind = 'ast'; this.showSource(node.range); this.render();
  }
  selectToken(index) {
    const selection = this.state.trace.tokenSelection(index);
    if (!selection) return;
    this.state.selection = selection; this.showSource(selection.range); this.render();
  }
  selectInstruction(id) {
    const item = this.state.trace.instructions.find(instruction => instruction.id === id);
    if (!item) return;
    const candidates = item.range ? this.state.trace.astForRange(item.range) : [];
    this.state.selection = item.source?.line ? this.state.trace.selection(item.source.line, item.range,
      candidates.length === 1 ? candidates[0] : null, item) :
      { astId: null, astCandidates: [], tokenIndices: [], instructionIds: [], codeIds: [item.codeId], unavailable: true };
    this.state.selection.kind = 'instruction';
    this.state.selection.selectedInstructionId = id;
    this.state.selection.astCandidates = candidates.map(node => node.id);
    this.showSource(item.range, item.source?.line); this.render();
  }
}
