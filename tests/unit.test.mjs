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
  const { control, state } = controller('def :'); state.bytecode = 'old bytecode'; state.astTree = 'old AST'; state.codeObject = 'old code object';
  control.run(); assert.equal(state.bytecode, '');
  assert.equal(state.astTree, ''); assert.equal(state.codeObject, '');
  control.receive({ type: 'result', id: 1, error: 'SyntaxError', errorLine: 1 });
  assert.equal(state.activeTab, 'errors'); assert.equal(state.bytecode, ''); control.dispose();
});
test('structured tokens are bounded and malformed fields become safe values', () => {
  const result = processResult({ tokens: [null, { type: 'NAME', value: '<script>', line: 2, column: 3 }, { type: {}, value: undefined, line: NaN, column: -4 }] });
  assert.deepEqual(result.tokens[0], { type: 'NAME', value: '<script>', line: 2, column: 3 });
  assert.deepEqual(result.tokens[1], { type: '', value: '', line: 0, column: 0 });
  assert.equal(result.tokens.length, 2);
  const many = processResult({ tokens: Array.from({ length: 1700 }, () => ({ type: 'NAME', value: 'x' })) });
  assert.equal(many.tokens.length, 1500); assert.equal(many.tokensTruncated, true);
});
test('AST and code object text is validated and size-limited', () => {
  const result = processResult({ astTree: 'x'.repeat(120000), astDump: { fake: true }, codeObject: '<img>', astError: null, compileError: 'SYNTAX ERROR' });
  assert.equal(result.astTree.length, 100000); assert.equal(result.astDump, '');
  assert.equal(result.codeObject, '<img>'); assert.equal(result.astError, ''); assert.equal(result.compileError, 'SYNTAX ERROR');
});
test('a new run clears all inspection stages and stale responses remain ignored', () => {
  const { control, state } = controller();
  Object.assign(state, { astTree: 'old', codeObject: 'old', tokens: [{ value: 'old' }], phase: 'ready' });
  control.run();
  assert.deepEqual(state.tokens, []); assert.equal(state.astTree, ''); assert.equal(state.codeObject, '');
  control.receive({ type: 'result', id: 0, tokens: [{ value: 'stale' }], astTree: 'stale' });
  assert.deepEqual(state.tokens, []); assert.equal(state.astTree, ''); control.dispose();
});
