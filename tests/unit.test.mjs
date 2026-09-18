import test from 'node:test';
import assert from 'node:assert/strict';
import { processResult, formatDuration } from '../ui/results.js';
import { PythonController } from '../controller.js';
import { createState } from '../ui/state.js';

test('malformed runtime payloads cannot become accidental UI strings', () => {
  const result = processResult({ stdout: {}, stderr: null, bytecode: undefined, duration: NaN, errorLine: '10' });
  assert.equal(result.output, ''); assert.equal(result.stderr, '');
  assert.equal(result.bytecode, ''); assert.equal(result.duration, 0); assert.equal(result.errorLine, 0);
});
test('output and inspection text is bounded without changing whitespace', () => {
  assert.equal(processResult({ stdout: '  a\n\nb\t' }).output, '  a\n\nb\t');
  assert.equal(processResult({ stdout: 'x'.repeat(120000) }).output.length, 100000);
});
test('duration formatting avoids inconsistent units', () => {
  assert.equal(formatDuration(12.8), '13 ms'); assert.equal(formatDuration(1250), '1.25 s');
});
function controller(source = 'print(1)') {
  const state = createState(); state.phase = 'ready';
  const calls = [];
  const control = new PythonController({ state, editor: { getValue: () => source, clearError() {}, markError() {} }, view: { render() {} } });
  control.runtime = { run: (...args) => calls.push(args), dispose() {} };
  return { control, state, calls };
}
test('empty source is handled before starting a worker', () => {
  const { control, state, calls } = controller(' \n '); control.run();
  assert.match(state.error, /Nothing to run/); assert.equal(calls.length, 0); assert.equal(state.phase, 'ready');
});
test('simultaneous runs and stale responses are ignored', () => {
  const { control, state, calls } = controller();
  control.run(); control.run(); assert.equal(calls.length, 1);
  control.receive({ type: 'result', id: 0, stdout: 'stale' }); assert.equal(state.output, '');
  control.receive({ type: 'result', id: 1, stdout: '1\n', duration: 5 });
  assert.equal(state.output, '1\n'); assert.equal(state.phase, 'ready'); control.dispose();
});
test('syntax errors cannot retain bytecode from the preceding run', () => {
  const { control, state } = controller('def :'); state.bytecode = 'old bytecode';
  control.run(); assert.equal(state.bytecode, '');
  control.receive({ type: 'result', id: 1, error: 'SyntaxError', errorLine: 1 });
  assert.equal(state.activeTab, 'errors'); assert.equal(state.bytecode, ''); control.dispose();
});
