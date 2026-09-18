import { RUNTIME_BASE, RUNTIME_FILES, LOAD_TIMEOUT_MS } from './config.js';

let pending;
/** Cache immutable runtime assets across Stop/retry, without caching a failed download. */
export function loadRuntimeAssets() {
  if (pending) return pending;
  pending = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), LOAD_TIMEOUT_MS);
    async function read(url, binary = false) {
      const credentials = new URL(url).origin === location.origin ? 'same-origin' : 'omit';
      const response = await fetch(url, { signal: abort.signal, credentials, referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`Could not download ${new URL(url).pathname.split('/').pop()} (HTTP ${response.status}).`);
      return binary ? response.arrayBuffer() : response.text();
    }
    try {
      const [files, workerSource, inspector] = await Promise.all([
        Promise.all(RUNTIME_FILES.map(async name => [name, await read(new URL(name, RUNTIME_BASE).href, true)])),
        read(new URL('./worker.js', import.meta.url).href),
        read(new URL('./inspector.py', import.meta.url).href),
      ]);
      return { files: Object.fromEntries(files), workerSource, inspector };
    } finally { clearTimeout(timer); }
  })().catch(error => { pending = null; throw error; });
  return pending;
}
