import test from 'node:test';
import assert from 'node:assert/strict';
import { processResult, formatDuration } from '../ui/results.js';
import { PythonController } from '../controller.js';
import { createState } from '../ui/state.js';
import { createTrace, rangeContains, rangeOverlap, rangeEqual, rangeIntersection, lineMatches, smallestContaining } from '../ui/source-map.js';
import { canCreateSnapshot, createSnapshot, serializeSnapshot, SNAPSHOT_VERSION, MAX_SNAPSHOT_BYTES } from '../ui/snapshot.js';
import { parseSnapshotText, readSnapshotFile, validateSnapshot } from '../ui/snapshot-validator.js';
import { compareSnapshots } from '../ui/compare.js';
import { readPythonFile, MAX_PYTHON_FILE_BYTES } from '../ui/python-import.js';

test('local Python import accepts .py and enforces file type and source bounds', async () => {
  const file = (name, content, size = content.length) => ({ name, size, text: async () => content });
  assert.equal(await readPythonFile(file('example.PY', 'print(1)')), 'print(1)');
  await assert.rejects(readPythonFile(file('example.txt', 'print(1)')), /Only \.py/);
  await assert.rejects(readPythonFile(file('large.py', '', MAX_PYTHON_FILE_BYTES + 1)), /too large/);
  await assert.rejects(readPythonFile(file('wide.py', 'x'.repeat(100_001), 100_001)), /too large/);
});

test('replacing source clears previous inspection without starting Python', () => {
  let source = 'print(1)', runs = 0;
  const state = createState(); state.phase = 'ready'; state.hasRun = true;
  state.output = '1\n'; state.bytecode = 'stale'; state.trace = {};
  const editor = { setValue: value => { source = value; }, getValue: () => source,
    clearError() {}, clearTrace() {} };
  const control = new PythonController({ state, editor, view: { render() {} } });
  control.runtime = { run: () => { runs++; }, dispose() {} };
  control.replaceSource('print(2)');
  assert.equal(source, 'print(2)'); assert.equal(runs, 0);
  assert.equal(state.hasRun, false); assert.equal(state.output, '');
  assert.equal(state.bytecode, ''); assert.equal(state.trace, null);
  assert.equal(control.sourceAtRun, undefined);
});

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

test('AST details and token selection reuse the normalized source mapping', () => {
  const source = 'x = 10 * 5';
  const trace = createTrace({ astNodes: [
    { type: 'Assign', lineno: 1, col_offset: 0, end_lineno: 1, end_col_offset: 10, children: ['ast-1'] },
    { type: 'BinOp', lineno: 1, col_offset: 4, end_lineno: 1, end_col_offset: 10,
      fields: [{ name: 'operator', value: 'Mult' }], children: ['ast-2', 'ast-3'] },
    { type: 'Constant', lineno: 1, col_offset: 4, end_lineno: 1, end_col_offset: 6, fields: [{ name: 'value', value: '10' }] },
    { type: 'Constant', lineno: 1, col_offset: 9, end_lineno: 1, end_col_offset: 10, fields: [{ name: 'value', value: '5' }] },
  ], codeObjects: [{ name: '<module>', firstLine: 1 }], instructions: [
    { codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: 4, endLine: 1, endColumn: 6 } },
    { codeId: 'co-0', offset: 4, opcode: 'LOAD_CONST', source: { line: 1, column: 9, endLine: 1, endColumn: 10 } },
    { codeId: 'co-0', offset: 6, opcode: 'BINARY_OP', source: { line: 1, column: 4, endLine: 1, endColumn: 10 } },
  ] }, source, [
    { type: 'NUMBER', value: '10', line: 1, column: 5, endLine: 1, endColumn: 7 },
    { type: 'OP', value: '*', line: 1, column: 8, endLine: 1, endColumn: 9 },
    { type: 'NUMBER', value: '5', line: 1, column: 10, endLine: 1, endColumn: 11 },
  ]);
  assert.deepEqual(trace.astNodes[1].fields, [{ name: 'operator', value: 'Mult' }]);
  assert.deepEqual(trace.astNodes[1].children, ['ast-2', 'ast-3']);
  const ast = trace.selection(1, trace.astNodes[1].range, trace.astNodes[1]);
  assert.deepEqual(ast.tokenIndices, [0, 1, 2]);
  assert.deepEqual(ast.instructionIds, ['co-0:2', 'co-0:4', 'co-0:6']);
  const token = trace.tokenSelection(0);
  assert.equal(token.selectedTokenIndex, 0);
  assert.equal(token.astId, 'ast-2');
  assert.deepEqual(token.instructionIds, ['co-0:2', 'co-0:6']);
  const sourceSelection = trace.selection(1, trace.astNodes[1].range);
  assert.deepEqual(sourceSelection.tokenIndices, [0, 1, 2]);
});

test('snapshot is versioned, CPython-specific, and contains only serializable run data', () => {
  const source = 'x = 1';
  const state = createState();
  Object.assign(state, { phase: 'ready', hasRun: true, version: '3.13.2', output: '1\n',
    tokens: [{ type: 'NUMBER', value: '1', line: 1, column: 5, endLine: 1, endColumn: 6 }],
    astTree: 'Module', bytecode: 'LOAD_CONST', disassembly: '2 LOAD_CONST',
    trace: createTrace({ astNodes: [{ type: 'Constant', lineno: 1, col_offset: 4, end_lineno: 1, end_col_offset: 5,
      fields: [{ name: 'value', value: '1' }], children: [] }], codeObjects: [{ name: '<module>', firstLine: 1 }],
    instructions: [{ codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: 4, endLine: 1, endColumn: 5 } }] }, source,
    [{ type: 'NUMBER', value: '1', line: 1, column: 5, endLine: 1, endColumn: 6 }]),
  });
  assert(canCreateSnapshot(state, source, source));
  const snapshot = createSnapshot(state, source);
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.runtime, { name: 'Pyodide', version: '0.29.3', pythonVersion: '3.13.2' });
  assert.equal(snapshot.inspection.ast.nodes[0].fields[0].value, '1');
  assert.equal(snapshot.mappings.instructions[0].source.start.column, 4);
  assert.equal(snapshot.execution.stdout, '1\n');
  assert.equal(snapshot.execution.error, null);
  assert.deepEqual(JSON.parse(serializeSnapshot(snapshot)), snapshot);
  assert(!canCreateSnapshot({ ...state, dirty: true }, source, source));
  assert(!canCreateSnapshot(state, 'changed', source));
  assert.throws(() => serializeSnapshot({ huge: 'x'.repeat(MAX_SNAPSHOT_BYTES) }), /too large/);
});

test('multi-line source selection returns tokens on every overlapping line', () => {
  const tokens = [
    { type: 'NAME', value: 'x', line: 1, column: 1, endLine: 1, endColumn: 2 },
    { type: 'NAME', value: 'y', line: 2, column: 1, endLine: 2, endColumn: 2 },
  ];
  const trace = createTrace({}, 'x\ny', tokens);
  const selection = trace.selection(1, { start: { line: 1, column: 0 }, end: { line: 2, column: 1 } });
  assert.deepEqual(selection.tokenIndices, [0, 1]);
});

function phaseFiveFixture(number = 10) {
  const source = `x = ${number}\nprint(x)`;
  const tokens = [{ type: 'NUMBER', value: String(number), line: 1, column: 5, endLine: 1, endColumn: 5 + String(number).length }];
  const state = createState();
  Object.assign(state, { phase: 'ready', hasRun: true, version: '3.13.2', output: `${number}\n`, tokens,
    astTree: 'Module', astDump: 'Module(body=...)', codeObject: 'code object', bytecode: 'bytes', disassembly: 'dis',
    trace: createTrace({ astNodes: [{ type: 'Constant', lineno: 1, col_offset: 4, end_lineno: 1,
      end_col_offset: 4 + String(number).length, fields: [{ name: 'value', value: String(number) }] }],
    codeObjects: [{ name: '<module>', firstLine: 1, argcount: 0, nlocals: 0, stacksize: 2, flags: 0,
      bytecodeLength: 8, constants: [String(number)], names: ['x'], varnames: [] }],
    instructions: [{ codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', arg: 0, argrepr: String(number),
      source: { line: 1, column: 4, endLine: 1, endColumn: 4 + String(number).length } }] }, source, tokens),
  });
  return createSnapshot(state, source);
}

test('version-one snapshots validate, including older exports without optional metadata', () => {
  const fixture = phaseFiveFixture();
  assert.deepEqual(parseSnapshotText(serializeSnapshot(fixture)), fixture);
  const old = structuredClone(fixture); delete old.createdAt;
  for (const key of ['argcount','nlocals','stacksize','flags','bytecodeLength','constants','names','varnames','metadataTruncated']) delete old.inspection.codeObjects[0][key];
  assert.equal(validateSnapshot(old).version, 1);
});
test('malformed JSON and unknown or incompatible schema versions are rejected', () => {
  assert.throws(() => parseSnapshotText('{'), /Invalid JSON/);
  for (const version of [0, 2, '1', null]) {
    const record = phaseFiveFixture(); record.version = version;
    assert.throws(() => validateSnapshot(record), /Unsupported snapshot version/);
  }
});
test('missing required fields, wrong types and invalid nested inspection references are rejected', () => {
  const a = phaseFiveFixture(); delete a.inspection; assert.throws(() => validateSnapshot(a), /inspection must be an object/);
  const b = phaseFiveFixture(); b.inspection.tokens = {}; assert.throws(() => validateSnapshot(b), /must be an array/);
  const c = phaseFiveFixture(); c.inspection.instructions[0].codeId = 'co-999'; assert.throws(() => validateSnapshot(c), /unknown code object/);
  const d = phaseFiveFixture(); d.mappings.astNodes[0].id = 'ast-4'; assert.throws(() => validateSnapshot(d), /does not match|is invalid/);
  const e = phaseFiveFixture(); e.mappings.instructions[0].source.end.column = 99;
  assert.throws(() => validateSnapshot(e), /outside the recorded source/);
  const f = phaseFiveFixture(); f.mappings.instructions[0].source.start.column = 3;
  assert.throws(() => validateSnapshot(f), /do not match the recorded inspection locations/);
});
test('oversized files are rejected before reading and oversized or deep JSON is rejected', async () => {
  let read = false;
  await assert.rejects(readSnapshotFile({ size: MAX_SNAPSHOT_BYTES + 1, text: async () => { read = true; return ''; } }), /5 MB/);
  assert.equal(read, false);
  assert.throws(() => parseSnapshotText(' '.repeat(MAX_SNAPSHOT_BYTES + 1)), /5 MB/);
  const deep = phaseFiveFixture(); deep.untrusted = {}; let p = deep.untrusted;
  for (let i = 0; i < 30; i++) p = p.child = {};
  assert.throws(() => validateSnapshot(deep), /nesting/);
  const many = phaseFiveFixture(); many.inspection.tokens = Array(1501).fill(many.inspection.tokens[0]);
  assert.throws(() => validateSnapshot(many), /1500-item limit/);
});
test('HTML and JavaScript-like strings remain inert serialized data', () => {
  const record = phaseFiveFixture();
  record.source = '<script>globalThis.compromised=true</script>\n__import__("os").system("echo x")';
  record.inspection.ast.tree = '<img src=x onerror=alert(1)>';
  record.execution.stdout = '<svg onload=alert(1)>';
  const imported = parseSnapshotText(JSON.stringify(record));
  assert.equal(imported.source, record.source);
  assert.equal(globalThis.compromised, undefined);
});
test('large valid snapshots remain within the import bounds', () => {
  const record = phaseFiveFixture(); record.source = 'x = 10\n'.repeat(10_000);
  assert.equal(parseSnapshotText(JSON.stringify(record)).source.length, 70_000);
});
test('source, tokens, AST, code-object, bytecode and disassembly comparisons use structured data', () => {
  const a = phaseFiveFixture(10), b = phaseFiveFixture(20);
  const result = compareSnapshots(a, b);
  for (const category of ['source','tokens','ast','code-object','bytecode','disassembly','execution']) assert(result.summary[category] > 0, category);
  assert(result.categories.tokens.some(item => item.before.includes('10') && item.after.includes('20')));
  assert(result.categories.ast.some(item => item.before.includes('10') && item.after.includes('20')));
  assert(result.categories.bytecode.some(item => item.before.includes('LOAD_CONST') && item.after.includes('LOAD_CONST')));
  assert.equal(result.categories.bytecode, result.categories.disassembly);
});
test('token position-only changes are distinguished from value changes', () => {
  const a = phaseFiveFixture(), b = phaseFiveFixture();
  b.inspection.tokens[0].column = 6;
  const item = compareSnapshots(a, b).categories.tokens[0];
  assert.equal(item.status, 'CHANGED'); assert.equal(item.detail, 'position only');
});
test('line and token insertions and removals are explicitly marked', () => {
  const a = phaseFiveFixture(), b = phaseFiveFixture();
  a.source = 'first\nlast'; b.source = 'first\ninserted\nlast';
  const added = compareSnapshots(a, b).categories.source;
  assert(added.some(item => item.status === 'ADDED' && item.after === 'inserted'));
  assert(compareSnapshots(b, a).categories.source.some(item => item.status === 'REMOVED' && item.before === 'inserted'));
  b.inspection.tokens.push({ ...b.inspection.tokens[0], type: 'NAME', value: 'new' });
  assert(compareSnapshots(a, b).categories.tokens.some(item => item.status === 'ADDED' && item.after.includes('new')));
  assert(compareSnapshots(b, a).categories.tokens.some(item => item.status === 'REMOVED' && item.before.includes('new')));
});
test('structural and instruction metadata changes appear without relying on rendered dis text', () => {
  const a = phaseFiveFixture(), b = phaseFiveFixture();
  b.inspection.ast.nodes[0].type = 'Name';
  b.inspection.codeObjects[0].stacksize = 3;
  b.inspection.instructions[0].offset = 4;
  b.inspection.instructions[0].source.endColumn = 8;
  b.inspection.disassembly = a.inspection.disassembly;
  const result = compareSnapshots(a, b);
  assert.equal(result.categories.ast[0].status, 'CHANGED');
  assert(result.categories['code-object'][0].before.includes('stacksize: 2') && result.categories['code-object'][0].after.includes('stacksize: 3'));
  assert(result.categories.bytecode[0].detail.includes('offset') && result.categories.bytecode[0].detail.includes('source'));
  assert.equal(result.summary.disassembly, result.summary.bytecode);
});
test('runtime differences are disclosed without assigning a cause', () => {
  const a = phaseFiveFixture(), b = phaseFiveFixture();
  assert.equal(compareSnapshots(a, b).runtimeDifference, false);
  b.runtime.pythonVersion = '3.14.0';
  assert.equal(compareSnapshots(a, b).runtimeDifference, true);
  assert.equal(compareSnapshots(a, null), null);
});
test('large source comparison caps rendered rows but counts all changes', () => {
  const a = phaseFiveFixture(), b = phaseFiveFixture();
  a.source = 'a\n'.repeat(20_000); b.source = 'b\n'.repeat(20_000);
  const rows = compareSnapshots(a, b).categories.source;
  assert.equal(rows.length, 1_000);
  assert.equal(rows.differences, 20_000);
  assert.equal(rows.totalRows, 20_001);
});
test('very wide imported token and instruction ranges use bounded line indexing', () => {
  const source = 'x\n'.repeat(1_000);
  const trace = createTrace({ codeObjects: [{ name: '<module>', firstLine: 1 }],
    instructions: [{ codeId: 'co-0', offset: 2, opcode: 'LOAD_CONST', source: { line: 1, column: 0, endLine: 999, endColumn: 1 } }] },
  source, [{ type: 'STRING', value: 'x', line: 1, column: 1, endLine: 999, endColumn: 2 }]);
  assert.equal(trace.onLine('tokens', 500).length, 1);
  assert.equal(trace.onLine('instructions', 500).length, 1);
});
