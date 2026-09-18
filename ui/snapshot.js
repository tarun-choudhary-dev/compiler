import { PYODIDE_VERSION } from '../runtime/config.js';

export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 5_000_000;

export function canCreateSnapshot(state, currentSource, sourceAtRun) {
  return state.hasRun && state.phase === 'ready' && !state.dirty && !!state.trace &&
    typeof sourceAtRun === 'string' && currentSource === sourceAtRun;
}

/** A bounded, JSON-only record of the completed run; no Python objects or UI state. */
export function createSnapshot(state, sourceAtRun) {
  const trace = state.trace;
  if (!trace || !state.hasRun || state.dirty || typeof sourceAtRun !== 'string')
    throw new Error('Run the current source before exporting its inspection.');
  return {
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    runtime: { name: 'Pyodide', version: PYODIDE_VERSION, pythonVersion: state.version || null },
    source: sourceAtRun,
    inspection: {
      tokens: state.tokens.map(({ type, value, line, column, endLine, endColumn }) =>
        ({ type, value, line, column, endLine: endLine ?? null, endColumn: endColumn ?? null })),
      ast: { nodes: trace.astNodes.map(({ range, ...node }) => node),
        tree: state.astTree, dump: state.astDump, error: state.astError || null },
      codeObjects: trace.codeObjects,
      codeObjectText: state.codeObject,
      bytecode: state.bytecode,
      instructions: trace.instructions.map(({ range, ...instruction }) => instruction),
      disassembly: state.disassembly,
      compileError: state.compileError || null,
      limits: { tokensTruncated: state.tokensTruncated, instructionsTruncated: trace.instructionsTruncated },
    },
    mappings: {
      coordinateSystem: 'one-based lines, zero-based UTF-16 columns; end exclusive',
      pythonCoordinateSystem: 'one-based lines, zero-based UTF-8 byte columns',
      tokenCoordinateSystem: 'one-based lines and Unicode character columns',
      tokens: trace.tokens.map(token => ({ index: token.index, source: token.range })),
      astNodes: trace.astNodes.map(node => ({ id: node.id, source: node.range })),
      instructions: trace.instructions.map(instruction => ({ id: instruction.id, codeId: instruction.codeId,
        source: instruction.range, pythonSource: instruction.source })),
    },
    execution: { stdout: state.output, stderr: state.stderr, error: state.error || null,
      durationMs: state.duration, outputTruncated: state.truncated },
  };
}

export function serializeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2) + '\n';
  if (new TextEncoder().encode(json).length > MAX_SNAPSHOT_BYTES)
    throw new Error('This inspection is too large to export. Try a shorter program.');
  return json;
}

export function downloadText(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
