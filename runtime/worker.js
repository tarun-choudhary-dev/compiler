/* Classic worker loaded as a blob by sandbox.html. Its CSP blocks all network access. */
(() => {
  'use strict';
  const send = globalThis.postMessage.bind(globalThis);
  let pyodide, execute, busy = false, runId = 0, maxOutput = 100000;
  let stdout = '', stderr = '', truncated = false, lastStream = 0;
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const cleanError = error => error instanceof Error ? error.message : 'An unexpected Python runtime error occurred.';

  function capture(channel, bytes) {
    const value = decoders[channel].decode(bytes, { stream: true });
    const used = stdout.length + stderr.length;
    const available = Math.max(0, maxOutput - used);
    if (value.length > available) truncated = true;
    if (channel === 'stdout') stdout += value.slice(0, available);
    else stderr += value.slice(0, available);
    if (runId && performance.now() - lastStream > 80) {
      lastStream = performance.now();
      send({ type: 'stream', id: runId, stdout, stderr, truncated });
    }
    return bytes.length;
  }

  async function initialize(data) {
    const { files, inspector } = data.assets;
    maxOutput = data.maxOutput;
    // Pyodide's loader sees fixed in-memory assets, never the actual fetch API.
    // CSP independently prevents network requests, including through alternate APIs.
    const runtimeBase = 'https://runtime.invalid/';
    const responses = new Map(Object.entries(files).map(([name, bytes]) => [runtimeBase + name, bytes]));
    Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false, value: async input => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!responses.has(url)) throw new TypeError('Network access is disabled in this Python playground.');
      return new Response(responses.get(url), { headers: { 'Content-Type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } });
    }});
    const urls = ['pyodide.js', 'pyodide.asm.js'].map(name => URL.createObjectURL(new Blob([files[name]], { type: 'text/javascript' })));
    try {
      importScripts(...urls);
      pyodide = await loadPyodide({
        indexURL: runtimeBase,
        lockFileContents: new TextDecoder().decode(files['pyodide-lock.json']),
        jsglobals: Object.freeze(Object.create(null)),
        stdin: () => null,
        stdout: () => {}, stderr: () => {},
      });
    } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
    pyodide.setStdout({ write: bytes => capture('stdout', bytes) });
    pyodide.setStderr({ write: bytes => capture('stderr', bytes) });
    pyodide.runPython(inspector);
    execute = pyodide.globals.get('_pylab_run');
    const version = pyodide.runPython("'.'.join(map(str, __import__('sys').version_info[:3]))");
    // Remove the convenient public JS runtime bridge. Empty `js` exposes no APIs.
    // This is defense in depth; the opaque origin + CSP are the browser boundary.
    pyodide.unregisterJsModule('pyodide_js');
    pyodide.runPython("import sys\nsys.modules.pop('pyodide_js', None)\nsys.modules.pop('js', None)");
    send({ type: 'ready', version });
  }

  globalThis.onmessage = async ({ data }) => {
    if (data.type === 'init') {
      try { await initialize(data); }
      catch (error) { send({ type: 'fatal', message: `Python could not start. ${cleanError(error)}` }); }
      return;
    }
    if (data.type !== 'run' || busy || !execute || typeof data.source !== 'string') return;
    busy = true;
    runId = data.id;
    stdout = ''; stderr = ''; truncated = false; lastStream = 0;
    decoders.stdout = new TextDecoder(); decoders.stderr = new TextDecoder();
    const started = performance.now();
    try {
      const result = JSON.parse(execute(data.source));
      send({ type: 'result', id: runId, ...result, stdout, stderr, truncated, duration: performance.now() - started });
    } catch (error) {
      send({ type: 'fatal', message: `The Python runtime needs to restart. ${cleanError(error)}` });
    } finally { busy = false; runId = 0; }
  };
})();
