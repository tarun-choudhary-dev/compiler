import { MAX_SOURCE_CHARS } from '../runtime/config.js';

// A UTF-8 source character needs at most four bytes; reject before reading large files.
export const MAX_PYTHON_FILE_BYTES = MAX_SOURCE_CHARS * 4 + 4;

export async function readPythonFile(file) {
  if (!file || typeof file.name !== 'string' || !/\.py$/i.test(file.name))
    throw new Error('Only .py files are supported.');
  if (!Number.isSafeInteger(file.size) || file.size > MAX_PYTHON_FILE_BYTES)
    throw new Error('Python file is too large. Keep source under 100,000 characters.');
  const source = await file.text();
  if (source.length > MAX_SOURCE_CHARS)
    throw new Error('Python file is too large. Keep source under 100,000 characters.');
  return source;
}
