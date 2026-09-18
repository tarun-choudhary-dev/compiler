/** CodeMirror is vendored so the editor is usable even when the runtime CDN fails. */
export class PythonEditor {
  constructor(textarea, { onRun, onChange, onCursor, readOnly = false }) {
    this.errorLine = null;
    this.traceLine = null;
    this.traceMark = null;
    if (!window.CodeMirror) throw new Error('The editor could not load. Check that vendor/codemirror is present.');
    this.view = window.CodeMirror.fromTextArea(textarea, {
      mode: { name: 'python', version: 3 }, lineNumbers: true, readOnly,
      indentUnit: 4, tabSize: 4, indentWithTabs: false, matchBrackets: true,
      lineWrapping: false, viewportMargin: 20, inputStyle: 'contenteditable',
      screenReaderLabel: 'Python source code',
      extraKeys: {
        'Ctrl-Enter': () => { if (!readOnly) onRun(); }, 'Cmd-Enter': () => { if (!readOnly) onRun(); },
        Tab: cm => cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection(' '.repeat(4 - cm.getCursor().ch % 4)),
        'Shift-Tab': cm => cm.indentSelection('subtract'),
        // Keep a keyboard route out of the editor even though Tab indents.
        Esc: cm => { cm.getInputField().blur(); document.getElementById('tab-output').focus(); },
      },
    });
    this.view.on('change', () => { this.clearError(); onChange(); });
    this.view.on('cursorActivity', () => { const p = this.view.getCursor(); onCursor(p.line + 1, p.ch + 1); });
  }
  getValue() { return this.view.getValue(); }
  setValue(value) { this.view.setValue(value); }
  refresh() { this.view.refresh(); }
  clearError() { if (this.errorLine !== null) this.view.removeLineClass(this.errorLine, 'background', 'editor-error-line'); this.errorLine = null; }
  clearTrace() {
    this.traceMark?.clear(); this.traceMark = null;
    if (this.traceLine !== null) this.view.removeLineClass(this.traceLine, 'background', 'editor-trace-line');
    this.traceLine = null;
  }
  markTrace(range, line) {
    this.clearTrace();
    if (line > 0 && line <= this.view.lineCount()) this.traceLine = this.view.addLineClass(line - 1, 'background', 'editor-trace-line');
    if (range && (range.start.line !== range.end.line || range.start.column !== range.end.column))
      this.traceMark = this.view.markText({ line: range.start.line - 1, ch: range.start.column },
        { line: range.end.line - 1, ch: range.end.column }, { className: 'editor-trace-range' });
  }
  markError(line) {
    this.clearError();
    if (Number.isInteger(line) && line > 0 && line <= this.view.lineCount()) {
      this.errorLine = this.view.addLineClass(line - 1, 'background', 'editor-error-line');
    }
  }
}
