import test from 'node:test';
import assert from 'node:assert/strict';
import { processResult, formatDuration } from '../ui/results.js';
import { PythonController } from '../controller.js';
import { createState } from '../ui/state.js';
import { createTrace, rangeContains, rangeOverlap, rangeEqual, rangeIntersection, lineMatches, smallestContaining } from '../ui/source-map.js';

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

test('normalized range operations use exclusive ends and choose the smallest AST construct', () => {
  const a = { start: { line: 2, column: 0 }, end: { line: 2, column: 6 } };
  const b = { start: { line: 2, column: 2 }, end: { line: 2, column: 4 } };
  const c = { start: { line: 2, column: 6 }, end: { line: 3, column: 1 } };
  assert(rangeContains(a, b) && rangeOverlap(a, b) && rangeEqual(rangeIntersection(a, b), b));
  assert(!rangeOverlap(a, c) && lineMatches(c, 3));
  assert(!rangeContains(a, { start: a.end, end: a.end }));
  assert.equal(smallestContaining([{ id: 'a', range: a }, { id: 'b', range: b }], { start: b.start, end: b.start }).id, 'b');
});

test('tokens count Unicode scalars while AST and dis count UTF-8 bytes', () => {
  const trace = createTrace({ astNodes: [{ type: 'Constant', lineno: 1, col_offset: 8, end_lineno: 1, end_col_offset: 14 }],
    codeObjects: [{ name: '<module>', firstLine: 1 }],
    instructions: [{ codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: 8, endLine: 1, endColumn: 14 } }] },
    'café = "🙂"', [{ type: 'STRING', value: '"🙂"', line: 1, column: 8, endLine: 1, endColumn: 11 }]);
  assert.deepEqual(trace.astNodes[0].range, { start: { line: 1, column: 7 }, end: { line: 1, column: 11 } });
  assert.deepEqual(trace.instructions[0].range, trace.astNodes[0].range);
  assert.deepEqual(trace.tokens[0].range, trace.astNodes[0].range);
  assert.equal(trace.astForRange(trace.instructions[0].range)[0].type, 'Constant');
});

test('missing instruction locations stay explicit and source lines do not inherit them', () => {
  const trace = createTrace({ codeObjects: [{ name: '<module>', firstLine: 1 }],
    instructions: [{ codeId: 'co-0', offset: 0, opcode: 'RESUME', source: null },
      { codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: null, endLine: null, endColumn: null } }] }, 'x = 1');
  assert.equal(trace.instructions[0].source, null);
  assert.equal(trace.instructions[0].range, null);
  assert.deepEqual(trace.onLine('instructions', 1).map(i => i.offset), [2]);
  assert.equal(trace.instructions[1].range, null);
});

test('selection switches source lines without recomputing the inspection and respects bounds', () => {
  const raw = { astNodes: [{ type: 'Assign', lineno: 1, col_offset: 0, end_lineno: 1, end_col_offset: 5 },
    { type: 'Assign', lineno: 2, col_offset: 0, end_lineno: 2, end_col_offset: 5 }],
    codeObjects: [{ name: '<module>', firstLine: 1 }],
    instructions: [{ codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: 4, endLine: 1, endColumn: 5 } },
      { codeId: 'co-0', offset: 4, opcode: 'STORE_NAME', source: { line: 1, column: 0, endLine: 1, endColumn: 1 } },
      { codeId: 'co-0', offset: 6, opcode: 'LOAD_CONST', source: { line: 2, column: 4, endLine: 2, endColumn: 5 } }] };
  const trace = createTrace(raw, 'x = 1\ny = 2', []);
  const first = trace.selection(1, { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } });
  const second = trace.selection(2, { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } });
  assert.deepEqual(first.instructionIds, ['co-0:2', 'co-0:4']);
  assert.deepEqual(second.instructionIds, ['co-0:6']);
  assert.notEqual(first.astId, second.astId);
  assert(createTrace({ astNodes: Array(600).fill({ type: 'Name' }), codeObjects: Array(60).fill({ name: 'x' }), instructions: Array(5000).fill({ codeId: 'co-0', offset: 1 }) }, 'x').astNodes.length <= 500);
});

test('stale worker mappings cannot replace a newer run and source changes clear the selection', () => {
  const { control, state } = controller('x = 1');
  control.run();
  control.receive({ type: 'result', id: 0, trace: { astNodes: [{ type: 'stale' }] } });
  assert.equal(state.trace, null);
  control.receive({ type: 'result', id: 1, trace: { astNodes: [{ type: 'Assign', lineno: 1, col_offset: 0, end_lineno: 1, end_col_offset: 5 }] } });
  assert.equal(state.trace.astNodes[0].type, 'Assign');
  state.selection = state.trace.selection(1);
  control.changed();
  assert.equal(state.selection, null);
  control.run();
  assert.equal(state.trace, null);
  control.receive({ type: 'result', id: 1, trace: { astNodes: [{ type: 'stale' }] } });
  assert.equal(state.trace, null);
  control.dispose();
});
