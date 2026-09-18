// Comparisons operate only on validated, serialized snapshot data.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const row = (status, before, after, detail = '') => ({ status, before, after, detail });

// Small lookahead handles insertions without quadratic diff memory or pretending
// that a shifted position changed the meaning of every following item.
function sequence(a, b, key, describe, change = (x, y) => same(x, y) ? '' : 'value') {
  const rows = [];
  let differences = 0, totalRows = 0;
  const emit = (status, before, after, detail = '') => {
    if (status !== 'UNCHANGED') differences++;
    totalRows++;
    if (rows.length < 1_000) rows.push(row(status, before, after, detail));
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i === a.length) { emit('ADDED', '', describe(b[j++])); continue; }
    if (j === b.length) { emit('REMOVED', describe(a[i++]), ''); continue; }
    if (key(a[i]) === key(b[j])) {
      const detail = change(a[i], b[j]);
      emit(detail ? 'CHANGED' : 'UNCHANGED', describe(a[i]), describe(b[j]), detail); i++; j++; continue;
    }
    const inB = b.slice(j + 1, j + 9).findIndex(item => key(item) === key(a[i]));
    const inA = a.slice(i + 1, i + 9).findIndex(item => key(item) === key(b[j]));
    if (inB >= 0 && (inA < 0 || inB <= inA)) emit('ADDED', '', describe(b[j++]));
    else if (inA >= 0) emit('REMOVED', describe(a[i++]), '');
    else { emit('CHANGED', describe(a[i++]), describe(b[j++]), 'structure or value'); }
  }
  rows.differences = differences; rows.totalRows = totalRows;
  return rows;
}
const value = x => JSON.stringify(x);
const sourceLines = source => source.split('\n');
const tokenKey = x => x.type;
const tokenText = x => `${x.type} ${value(x.value)} @ ${x.line}:${x.column}–${x.endLine ?? '?'}:${x.endColumn ?? '?'}`;
const tokenChange = (a, b) => a.value !== b.value ? 'value' :
  [a.line, a.column, a.endLine, a.endColumn].some((v, i) => v !== [b.line,b.column,b.endLine,b.endColumn][i]) ? 'position only' : '';
const astText = x => `${'  '.repeat(Math.min(x.depth, 12))}${x.type}${x.fields.length ? ` ${x.fields.map(f => `${f.name}: ${f.value}`).join(', ')}` : ''}`;
const astChange = (a, b) => a.type !== b.type ? 'node type' : !same(a.fields, b.fields) ? 'fields' :
  !same(a.children.length, b.children.length) ? 'children' : a.parentId !== b.parentId ? 'structure' : '';
const codeFields = ['argcount','nlocals','stacksize','flags','constants','names','varnames','bytecodeLength'];
const brief = item => {
  const text = value(item);
  return text === undefined ? 'not recorded' : text.length > 140 ? `${text.slice(0, 140)}…` : text;
};
const codeText = c => `${c.name} (${c.id})\n${codeFields.map(k => `${k}: ${brief(c[k])}`).join('  ·  ')}`;
const codeChange = (a, b) => codeFields.filter(k => !same(a[k], b[k])).join(', ');
const instructionKey = x => `${x.codeId}:${x.opcode}`;
const instructionText = x => `${x.codeId} ${x.offset} ${x.opcode} ${x.arg ?? ''}${x.argrepr ? ` (${x.argrepr})` : ''}${x.source ? ` @ ${x.source.line}:${x.source.column ?? '?'}–${x.source.endLine ?? '?'}:${x.source.endColumn ?? '?'}` : ' @ unavailable'}`;
const instructionChange = (a, b) => ['offset','opcode','arg','argrepr','source'].filter(k => !same(a[k], b[k])).join(', ');
const count = rows => rows.differences ?? rows.reduce((n, item) => n + (item.status === 'UNCHANGED' ? 0 : 1), 0);

export function compareSnapshots(a, b) {
  if (!a || !b) return null;
  const ai = a.inspection, bi = b.inspection;
  const source = sequence(sourceLines(a.source), sourceLines(b.source), x => x, x => x);
  const tokens = sequence(ai.tokens, bi.tokens, tokenKey, tokenText, tokenChange);
  const ast = sequence(ai.ast.nodes, bi.ast.nodes, x => `${x.depth}:${x.type}`, astText, astChange);
  const codeObjects = sequence(ai.codeObjects, bi.codeObjects, x => `${x.parentId}:${x.name}`, codeText, codeChange);
  const bytecode = sequence(ai.instructions, bi.instructions, instructionKey, instructionText, instructionChange);
  // The readable listing is secondary. Both tabs compare structured instructions.
  const disassembly = bytecode;
  const execution = [
    ...['stdout','stderr','error','durationMs','outputTruncated'].map(k => row(same(a.execution[k], b.execution[k]) ? 'UNCHANGED' : 'CHANGED', `${k}: ${value(a.execution[k])}`, `${k}: ${value(b.execution[k])}`, k)),
  ];
  const categories = { source, tokens, ast, 'code-object': codeObjects, bytecode, disassembly, execution };
  const summary = Object.fromEntries(Object.entries(categories).map(([key, rows]) => [key, count(rows)]));
  const runtimeDifference = ['name','version','pythonVersion'].some(k => a.runtime[k] !== b.runtime[k]);
  return { categories, summary, runtimeDifference };
}
