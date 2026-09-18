import { MAX_SNAPSHOT_BYTES, SNAPSHOT_VERSION } from './snapshot.js';
import { createTrace, rangeEqual } from './source-map.js';

export class SnapshotValidationError extends Error {
  constructor(reason) { super(reason); this.name = 'SnapshotValidationError'; }
}
const fail = reason => { throw new SnapshotValidationError(reason); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireRecord = (value, path) => { if (!record(value)) fail(`${path} must be an object.`); return value; };
const requireArray = (value, path, max) => {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  if (value.length > max) fail(`${path} exceeds the ${max}-item limit.`);
  return value;
};
const requireString = (value, path, max, nullable = false) => {
  if (nullable && value === null) return value;
  if (typeof value !== 'string' || value.length > max) fail(`${path} must be text within ${max} characters.`);
  return value;
};
const requireInteger = (value, path, max = 400_000, nullable = false) => {
  if (nullable && value === null) return value;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`${path} must be a bounded nonnegative integer.`);
  return value;
};
const requireBoolean = (value, path) => { if (typeof value !== 'boolean') fail(`${path} must be true or false.`); };
const optionalString = (value, path, max) => { if (value !== undefined) requireString(value, path, max); };
const nullablePosition = (value, path) => {
  if (value === null) return;
  const p = requireRecord(value, path);
  requireInteger(p.line, `${path}.line`, 100_001);
  requireInteger(p.column, `${path}.column`);
};
const range = (value, path) => {
  if (value === null) return;
  const r = requireRecord(value, path);
  nullablePosition(r.start, `${path}.start`);
  nullablePosition(r.end, `${path}.end`);
  if (r.start === null || r.end === null || r.start.line < 1 || r.end.line < r.start.line ||
      r.end.line === r.start.line && r.end.column < r.start.column) fail(`${path} has an invalid source range.`);
};
const pythonSource = (value, path) => {
  if (value === null) return;
  const p = requireRecord(value, path);
  requireInteger(p.line, `${path}.line`, 100_001);
  requireInteger(p.column, `${path}.column`, 400_000, true);
  requireInteger(p.endLine, `${path}.endLine`, 100_001, true);
  requireInteger(p.endColumn, `${path}.endColumn`, 400_000, true);
};

function checkDepth(root) {
  const stack = [{ value: root, depth: 0 }];
  let entries = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 24) fail('Snapshot nesting exceeds the 24-level limit.');
    if (!value || typeof value !== 'object') continue;
    const children = Array.isArray(value) ? value : Object.values(value);
    if (Array.isArray(value) && value.length > 6_000) fail('Snapshot contains an oversized array.');
    if (!Array.isArray(value) && children.length > 200) fail('Snapshot contains an oversized object.');
    entries += children.length;
    if (entries > 100_000) fail('Snapshot structure is too large.');
    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
}

export function validateSnapshot(value) {
  const root = requireRecord(value, 'Snapshot');
  checkDepth(root);
  if (root.version !== SNAPSHOT_VERSION) fail(`Unsupported snapshot version. Expected v${SNAPSHOT_VERSION}.`);
  if (root.createdAt !== undefined) {
    requireString(root.createdAt, 'createdAt', 40);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(root.createdAt) || Number.isNaN(Date.parse(root.createdAt))) fail('createdAt is invalid.');
  }
  const runtime = requireRecord(root.runtime, 'runtime');
  requireString(runtime.name, 'runtime.name', 80);
  requireString(runtime.version, 'runtime.version', 80);
  requireString(runtime.pythonVersion, 'runtime.pythonVersion', 80, true);
  requireString(root.source, 'source', 100_000);
  const sourceLines = root.source.split('\n');
  const mappedRange = (value, path) => {
    range(value, path);
    if (value === null) return;
    for (const point of [value.start, value.end])
      if (point.line > sourceLines.length || point.column > sourceLines[point.line - 1].length)
        fail(`${path} lies outside the recorded source.`);
  };

  const inspection = requireRecord(root.inspection, 'inspection');
  const tokens = requireArray(inspection.tokens, 'inspection.tokens', 1_500);
  tokens.forEach((token, index) => {
    const path = `inspection.tokens[${index}]`, t = requireRecord(token, path);
    requireString(t.type, `${path}.type`, 32); requireString(t.value, `${path}.value`, 1_000);
    requireInteger(t.line, `${path}.line`, 100_001); requireInteger(t.column, `${path}.column`);
    requireInteger(t.endLine, `${path}.endLine`, 100_001, true);
    requireInteger(t.endColumn, `${path}.endColumn`, 400_000, true);
  });
  const ast = requireRecord(inspection.ast, 'inspection.ast');
  requireString(ast.tree, 'inspection.ast.tree', 100_000);
  requireString(ast.dump, 'inspection.ast.dump', 100_000);
  requireString(ast.error, 'inspection.ast.error', 100_000, true);
  const nodes = requireArray(ast.nodes, 'inspection.ast.nodes', 500);
  nodes.forEach((node, index) => {
    const path = `inspection.ast.nodes[${index}]`, n = requireRecord(node, path);
    if (n.id !== `ast-${index}`) fail(`${path}.id is invalid.`);
    requireString(n.parentId, `${path}.parentId`, 16, true);
    requireInteger(n.depth, `${path}.depth`, 12);
    requireString(n.type, `${path}.type`, 60); requireString(n.label, `${path}.label`, 200);
    for (const field of ['lineno','col_offset','end_lineno','end_col_offset']) requireInteger(n[field], `${path}.${field}`, 400_000, true);
    requireArray(n.fields, `${path}.fields`, 8).forEach((field, fieldIndex) => {
      const f = requireRecord(field, `${path}.fields[${fieldIndex}]`);
      requireString(f.name, `${path}.fields[${fieldIndex}].name`, 40);
      requireString(f.value, `${path}.fields[${fieldIndex}].value`, 120);
    });
    requireArray(n.children, `${path}.children`, 500).forEach(id => requireString(id, `${path}.children ID`, 16));
  });
  for (const node of nodes) {
    if (node.parentId !== null && !nodes.some(parent => parent.id === node.parentId)) fail(`AST parent ${node.parentId} is missing.`);
    if (node.children.some(id => !nodes.some(child => child.id === id && child.parentId === node.id))) fail(`AST children for ${node.id} are invalid.`);
  }

  const codeObjects = requireArray(inspection.codeObjects, 'inspection.codeObjects', 40);
  codeObjects.forEach((code, index) => {
    const path = `inspection.codeObjects[${index}]`, c = requireRecord(code, path);
    if (c.id !== `co-${index}`) fail(`${path}.id is invalid.`);
    requireString(c.parentId, `${path}.parentId`, 16, true);
    requireString(c.name, `${path}.name`, 100);
    requireInteger(c.firstLine, `${path}.firstLine`, 100_001, true);
    requireInteger(c.depth, `${path}.depth`, 12);
    for (const name of ['argcount','nlocals','stacksize','flags','bytecodeLength'])
      if (c[name] !== undefined) requireInteger(c[name], `${path}.${name}`, 400_000, true);
    for (const name of ['constants','names','varnames']) {
      if (c[name] !== undefined && c[name] !== null)
        requireArray(c[name], `${path}.${name}`, 200).forEach(item => requireString(item, `${path}.${name} item`, 120));
    }
    if (c.metadataTruncated !== undefined) requireBoolean(c.metadataTruncated, `${path}.metadataTruncated`);
  });
  for (const code of codeObjects) if (code.parentId !== null && !codeObjects.some(parent => parent.id === code.parentId)) fail(`Code-object parent ${code.parentId} is missing.`);
  requireString(inspection.codeObjectText, 'inspection.codeObjectText', 100_000);
  requireString(inspection.bytecode, 'inspection.bytecode', 100_000);
  requireString(inspection.disassembly, 'inspection.disassembly', 100_000);
  requireString(inspection.compileError, 'inspection.compileError', 100_000, true);
  const limits = requireRecord(inspection.limits, 'inspection.limits');
  requireBoolean(limits.tokensTruncated, 'inspection.limits.tokensTruncated');
  requireBoolean(limits.instructionsTruncated, 'inspection.limits.instructionsTruncated');
  const instructions = requireArray(inspection.instructions, 'inspection.instructions', 4_000);
  instructions.forEach((instruction, index) => {
    const path = `inspection.instructions[${index}]`, i = requireRecord(instruction, path);
    requireString(i.id, `${path}.id`, 32); requireString(i.codeId, `${path}.codeId`, 16);
    if (!codeObjects.some(code => code.id === i.codeId)) fail(`${path} references an unknown code object.`);
    requireInteger(i.offset, `${path}.offset`);
    if (i.id !== `${i.codeId}:${i.offset}`) fail(`${path}.id does not match its code object and offset.`);
    requireString(i.opcode, `${path}.opcode`, 60); requireInteger(i.arg, `${path}.arg`, 400_000, true);
    requireString(i.argrepr, `${path}.argrepr`, 200);
    pythonSource(i.source, `${path}.source`);
  });

  const mappings = requireRecord(root.mappings, 'mappings');
  requireString(mappings.coordinateSystem, 'mappings.coordinateSystem', 160);
  optionalString(mappings.pythonCoordinateSystem, 'mappings.pythonCoordinateSystem', 160);
  optionalString(mappings.tokenCoordinateSystem, 'mappings.tokenCoordinateSystem', 160);
  const tokenMappings = requireArray(mappings.tokens, 'mappings.tokens', 1_500);
  const astMappings = requireArray(mappings.astNodes, 'mappings.astNodes', 500);
  const instructionMappings = requireArray(mappings.instructions, 'mappings.instructions', 4_000);
  if (tokenMappings.length !== tokens.length || astMappings.length !== nodes.length || instructionMappings.length !== instructions.length)
    fail('Mapping counts do not match inspection data.');
  tokenMappings.forEach((mapping, index) => {
    const m = requireRecord(mapping, `mappings.tokens[${index}]`);
    if (m.index !== index) fail(`mappings.tokens[${index}].index is invalid.`);
    mappedRange(m.source, `mappings.tokens[${index}].source`);
  });
  astMappings.forEach((mapping, index) => {
    const m = requireRecord(mapping, `mappings.astNodes[${index}]`);
    if (m.id !== nodes[index].id) fail(`mappings.astNodes[${index}].id is invalid.`);
    mappedRange(m.source, `mappings.astNodes[${index}].source`);
  });
  instructionMappings.forEach((mapping, index) => {
    const m = requireRecord(mapping, `mappings.instructions[${index}]`);
    if (m.id !== instructions[index].id || m.codeId !== instructions[index].codeId) fail(`mappings.instructions[${index}] does not match its instruction.`);
    mappedRange(m.source, `mappings.instructions[${index}].source`);
    pythonSource(m.pythonSource, `mappings.instructions[${index}].pythonSource`);
  });
  // A v1 export's normalized mappings must agree with its recorded source and
  // CPython positions. This also prevents a malformed file from displaying a
  // relationship that the inspection data itself cannot support.
  const expected = createTrace({ astNodes: nodes, codeObjects, instructions }, root.source, tokens);
  const sameRange = (a, b) => a === null && b === null || rangeEqual(a, b);
  const samePython = (a, b) => a === null && b === null || !!a && !!b &&
    ['line','column','endLine','endColumn'].every(key => a[key] === b[key]);
  const tokenMismatch = tokenMappings.findIndex((m, i) => !sameRange(m.source, expected.tokens[i]?.range));
  const astMismatch = astMappings.findIndex((m, i) => !sameRange(m.source, expected.astNodes[i]?.range));
  const instructionMismatch = instructionMappings.findIndex((m, i) => !sameRange(m.source, expected.instructions[i]?.range) ||
    !samePython(m.pythonSource, expected.instructions[i]?.source));
  if (tokenMismatch >= 0 || astMismatch >= 0 || instructionMismatch >= 0)
    fail(`Source mappings do not match the recorded inspection locations (${tokenMismatch >= 0 ? `token ${tokenMismatch}` : astMismatch >= 0 ? `AST node ${astMismatch}` : `instruction ${instructionMismatch}`}).`);
  const execution = requireRecord(root.execution, 'execution');
  requireString(execution.stdout, 'execution.stdout', 100_000);
  requireString(execution.stderr, 'execution.stderr', 100_000);
  requireString(execution.error, 'execution.error', 100_000, true);
  if (typeof execution.durationMs !== 'number' || !Number.isFinite(execution.durationMs) || execution.durationMs < 0) fail('execution.durationMs is invalid.');
  requireBoolean(execution.outputTruncated, 'execution.outputTruncated');
  return root;
}

export function parseSnapshotText(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES)
    fail('Snapshot exceeds the 5 MB limit.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('Invalid JSON.'); }
  return validateSnapshot(parsed);
}

export async function readSnapshotFile(file) {
  if (!file || typeof file.size !== 'number') fail('Choose a JSON snapshot file.');
  if (file.size > MAX_SNAPSHOT_BYTES) fail('Snapshot exceeds the 5 MB limit.');
  return parseSnapshotText(await file.text());
}
