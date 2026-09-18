import { MAX_OUTPUT_CHARS } from '../runtime/config.js';

const safeText = value => typeof value === 'string' ? value.slice(0, MAX_OUTPUT_CHARS) : '';
/** Validate the untrusted worker response before it reaches text-only DOM sinks. */
export function processResult(message) {
  return {
    output: safeText(message.stdout), stderr: safeText(message.stderr),
    error: safeText(message.error), bytecode: safeText(message.bytecode),
    disassembly: safeText(message.disassembly), truncated: message.truncated === true,
    duration: Number.isFinite(message.duration) ? Math.max(0, message.duration) : 0,
    errorLine: Number.isInteger(message.errorLine) ? message.errorLine : 0,
  };
}

export function formatDuration(milliseconds) {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(2)} s`;
}
