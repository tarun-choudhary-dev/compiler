import { MAX_OUTPUT_CHARS } from '../runtime/config.js';

const safeText = value => typeof value === 'string' ? value.slice(0, MAX_OUTPUT_CHARS) : '';
/** Validate the untrusted worker response before it reaches text-only DOM sinks. */
export function processResult(message) {
  const tokens = Array.isArray(message.tokens) ? message.tokens.slice(0, 1500).filter(item => item && typeof item === 'object').map(item => ({
    type: safeText(item.type).slice(0, 32), value: safeText(item.value).slice(0, 1000),
    line: Number.isSafeInteger(item.line) && item.line >= 0 ? item.line : 0,
    column: Number.isSafeInteger(item.column) && item.column >= 0 ? item.column : 0,
  })) : [];
  return {
    output: safeText(message.stdout), stderr: safeText(message.stderr),
    error: safeText(message.error), tokens, tokenError: safeText(message.tokenError),
    tokensTruncated: message.tokensTruncated === true || (Array.isArray(message.tokens) && message.tokens.length > 1500),
    astTree: safeText(message.astTree), astDump: safeText(message.astDump),
    astError: safeText(message.astError), compileError: safeText(message.compileError),
    codeObject: safeText(message.codeObject), bytecode: safeText(message.bytecode),
    disassembly: safeText(message.disassembly), truncated: message.truncated === true,
    duration: Number.isFinite(message.duration) ? Math.max(0, message.duration) : 0,
    errorLine: Number.isInteger(message.errorLine) ? message.errorLine : 0,
  };
}

export function formatDuration(milliseconds) {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(2)} s`;
}
