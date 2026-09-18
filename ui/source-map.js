/** Editor ranges use one-based lines and zero-based UTF-16 columns; ends are exclusive. */
const position = (line, column) => ({ line, column });
const compare = (a, b) => a.line - b.line || a.column - b.column;
export const rangeEqual = (a, b) => !!a && !!b && compare(a.start, b.start) === 0 && compare(a.end, b.end) === 0;
export const rangeContains = (outer, inner) => !!outer && !!inner && compare(outer.start, inner.start) <= 0 &&
  (compare(inner.start, inner.end) === 0 ? compare(outer.end, inner.end) > 0 : compare(outer.end, inner.end) >= 0);
export const rangeOverlap = (a, b) => !!a && !!b && compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0;
export function rangeIntersection(a, b) {
  if (!rangeOverlap(a, b)) return null;
  return { start: compare(a.start, b.start) >= 0 ? a.start : b.start,
    end: compare(a.end, b.end) <= 0 ? a.end : b.end };
}
export const lineMatches = (range, line) => !!range && range.start.line <= line &&
  (range.end.line > line || range.end.line === line && range.end.column > 0 || range.start.line === line && range.end.line === line);
const size = r => (r.end.line - r.start.line) * 100001 + r.end.column - r.start.column;
export function smallestContaining(items, target) {
  return items.filter(item => rangeContains(item.range, target)).sort((a, b) => size(a.range) - size(b.range) || b.depth - a.depth)[0] ?? null;
}
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const string = (value, length = 200) => typeof value === 'string' ? value.slice(0, length) : '';

export function createTrace(raw, source, tokens = []) {
  const lines = source.split('\n');
  const encoder = new TextEncoder();
  const byteColumns = new Map(), characterColumns = new Map();
  const validLine = line => Number.isSafeInteger(line) && line > 0 && line <= lines.length;
  // CPython AST/dis columns count UTF-8 bytes; CodeMirror counts UTF-16 units.
  function byteColumn(line, offset) {
    if (!validLine(line) || integer(offset) === null) return null;
    if (!byteColumns.has(line)) {
      const columns = new Map([[0, 0]]);
      let bytes = 0, units = 0;
      for (const scalar of lines[line - 1]) {
        bytes += encoder.encode(scalar).length;
        units += scalar.length;
        columns.set(bytes, units);
      }
      byteColumns.set(line, columns);
    }
    return byteColumns.get(line).get(offset) ?? null;
  }
  function tokenColumn(line, oneBased) {
    const index = integer(oneBased) === null ? null : oneBased - 1;
    if (!validLine(line) || index < 0) return null;
    if (!characterColumns.has(line)) {
      const columns = [0];
      let units = 0;
      for (const scalar of lines[line - 1]) { units += scalar.length; columns.push(units); }
      characterColumns.set(line, columns);
    }
    return characterColumns.get(line)[index] ?? null;
  }
  function makeRange(startLine, startColumn, endLine, endColumn, convert) {
    if (!validLine(startLine) || !validLine(endLine)) return null;
    const a = convert(startLine, startColumn), b = convert(endLine, endColumn);
    if (a === null || b === null) return null;
    const range = { start: position(startLine, a), end: position(endLine, b) };
    return compare(range.start, range.end) <= 0 ? range : null;
  }
  const sourceRange = (startLine, startColumn, endLine, endColumn) => makeRange(startLine, startColumn, endLine, endColumn, byteColumn);
  const tokenRange = item => makeRange(item.line, item.column, item.endLine, item.endColumn, tokenColumn);
  const data = raw && typeof raw === 'object' ? raw : {};
  const astNodes = (Array.isArray(data.astNodes) ? data.astNodes.slice(0, 500) : []).filter(n => n && typeof n === 'object').map((n, index) => ({
    id: `ast-${index}`, parentId: /^ast-\d+$/.test(n.parentId) ? n.parentId : null,
    depth: Math.min(integer(n.depth) ?? 0, 12), type: string(n.type, 60), label: string(n.label),
    lineno: n.lineno, col_offset: n.col_offset, end_lineno: n.end_lineno, end_col_offset: n.end_col_offset,
    fields: (Array.isArray(n.fields) ? n.fields.slice(0, 8) : []).filter(f => f && typeof f === 'object').map(f => ({
      name: string(f.name, 40), value: string(f.value, 120),
    })),
    children: (Array.isArray(n.children) ? n.children.slice(0, 500) : []).filter(id => typeof id === 'string' && /^ast-\d+$/.test(id)),
    range: sourceRange(n.lineno, n.col_offset, n.end_lineno, n.end_col_offset),
  }));
  const codeObjects = (Array.isArray(data.codeObjects) ? data.codeObjects.slice(0, 40) : []).filter(c => c && typeof c === 'object').map((c, index) => ({
    id: `co-${index}`, parentId: /^co-\d+$/.test(c.parentId) ? c.parentId : null,
    name: string(c.name, 100), firstLine: validLine(c.firstLine) ? c.firstLine : null,
    depth: Math.min(integer(c.depth) ?? 0, 12),
    argcount: integer(c.argcount), nlocals: integer(c.nlocals), stacksize: integer(c.stacksize),
    flags: integer(c.flags), bytecodeLength: integer(c.bytecodeLength),
    constants: Array.isArray(c.constants) ? c.constants.slice(0, 200).map(value => string(value, 120)) : null,
    names: Array.isArray(c.names) ? c.names.slice(0, 200).map(value => string(value, 100)) : null,
    varnames: Array.isArray(c.varnames) ? c.varnames.slice(0, 200).map(value => string(value, 100)) : null,
    metadataTruncated: c.metadataTruncated === true,
  }));
  const ids = new Set(codeObjects.map(c => c.id));
  const instructions = (Array.isArray(data.instructions) ? data.instructions.slice(0, 4000) : []).filter(i => i && typeof i === 'object' && ids.has(i.codeId) && integer(i.offset) !== null).map(i => {
    const loc = i.source && typeof i.source === 'object' && validLine(i.source.line) ? {
      line: i.source.line, column: integer(i.source.column),
      endLine: validLine(i.source.endLine) ? i.source.endLine : null,
      endColumn: integer(i.source.endColumn),
    } : null;
    return { id: `${i.codeId}:${i.offset}`, codeId: i.codeId, offset: i.offset,
      opcode: string(i.opcode, 60), arg: integer(i.arg), argrepr: string(i.argrepr), source: loc,
      range: loc && loc.endLine !== null ? sourceRange(loc.line, loc.column, loc.endLine, loc.endColumn) : null };
  });
  const mappedTokens = tokens.slice(0, 1500).map((item, index) => ({ ...item, index, range: tokenRange(item) }));
  const byLine = { tokens: new Map(), astNodes: new Map(), instructions: new Map() };
  const wide = { tokens: [], astNodes: [], instructions: [] };
  function index(kind, entries) {
    for (const entry of entries) {
      const first = entry.range?.start.line ?? (kind === 'instructions' ? entry.source?.line : entry.line);
      const last = entry.range?.end.line ?? first;
      if (!validLine(first)) continue;
      if (last - first > 200) { wide[kind].push(entry); continue; }
      for (let line = first; line <= Math.min(last, lines.length); line++) {
        if (entry.range && !lineMatches(entry.range, line)) continue;
        if (!byLine[kind].has(line)) byLine[kind].set(line, []);
        byLine[kind].get(line).push(entry);
      }
    }
  }
  index('tokens', mappedTokens); index('astNodes', astNodes); index('instructions', instructions);
  const onLine = (kind, line) => wide[kind].length ?
    [...(byLine[kind].get(line) ?? []), ...wide[kind].filter(item => lineMatches(item.range, line))] : byLine[kind].get(line) ?? [];
  const astForRange = range => {
    if (!range) return [];
    const candidates = astNodes.filter(n => n.range && rangeContains(n.range, range));
    const exact = candidates.filter(n => rangeEqual(n.range, range));
    if (exact.length) return exact;
    const best = smallestContaining(candidates, range);
    return best ? candidates.filter(n => rangeEqual(n.range, best.range)) : [];
  };
  function selection(line, range = null, preferredAst = null, preferredInstruction = null) {
    if (!validLine(line)) return null;
    const covering = onLine('astNodes', line).filter(n => n.range && (range ? rangeContains(n.range, range) : true));
    const ast = preferredAst ?? (range ? smallestContaining(covering, range) : covering.sort((a,b) => size(a.range) - size(b.range))[0] ?? null);
    const narrowed = range && (compare(range.start, range.end) !== 0 || preferredInstruction);
    const tokenItems = (narrowed ? mappedTokens : onLine('tokens', line)).filter(t => !narrowed || t.range && rangeOverlap(t.range, range));
    const instructionItems = preferredInstruction ? [preferredInstruction] : (narrowed ? instructions : onLine('instructions', line)).filter(i =>
      !narrowed || i.range && rangeOverlap(i.range, range));
    const codeIds = [...new Set(instructionItems.map(i => i.codeId))];
    return { line, range, astId: ast?.id ?? null,
      astCandidates: preferredInstruction?.range ? astForRange(preferredInstruction.range).map(n => n.id) :
        range ? covering.sort((a, b) => a.depth - b.depth).map(n => n.id) : ast ? [ast.id] : [],
      tokenIndices: tokenItems.map(t => t.index), instructionIds: instructionItems.map(i => i.id), codeIds,
      selectedInstructionId: preferredInstruction?.id ?? null };
  }
  function tokenSelection(index) {
    const token = mappedTokens[index];
    if (!token) return null;
    const hasSpan = token.range && compare(token.range.start, token.range.end) < 0;
    const chosen = hasSpan ? selection(token.range.start.line, token.range) :
      { line: null, range: null, astId: null, astCandidates: [], tokenIndices: [], instructionIds: [], codeIds: [], unavailable: true };
    chosen.kind = 'token';
    chosen.selectedTokenIndex = index;
    chosen.tokenIndices = [index];
    return chosen;
  }
  return { lines, astNodes, codeObjects, instructions, tokens: mappedTokens,
    instructionsTruncated: data.instructionsTruncated === true, onLine, selection,
    astForRange, tokenSelection, sourceRange, tokenRange };
}
