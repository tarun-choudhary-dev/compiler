import { spawn } from 'node:child_process';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Set CHROME_PATH to a Chromium browser to run the browser runtime integration tests.');
const profile = await mkdtemp(join(tmpdir(), 'pylab-runtime-test-'));
const server = await serve(fileURLToPath(new URL('../', import.meta.url)), 0);
const url = `http://127.0.0.1:${server.address().port}/tests/harness.html`;
const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostic = '';
chrome.stderr.on('data', chunk => { diagnostic += chunk.toString(); });
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error(`Headless browser did not start: ${diagnostic}`);
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(tab => tab.url === url);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!target) throw new Error('Runtime test page did not load.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const verbose = process.env.DEBUG_RUNTIME_TESTS === '1';
  let onLoaded;
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Page.loadEventFired') onLoaded?.();
    if (data.method === 'Log.entryAdded') console.error(data.params.entry.level, data.params.entry.text);
    if (data.method === 'Network.loadingFailed' && data.params.errorText !== 'net::ERR_ABORTED') console.error('Network failure:', data.params.errorText, data.params.blockedReason || '');
    if (verbose && data.method === 'Network.responseReceived') console.log('Asset:', data.params.response.status, new URL(data.params.response.url).pathname);
    if (data.method === 'Runtime.consoleAPICalled') console.log('Browser:', data.params.type, data.params.args.map(arg => arg.value || arg.description).join(' '));
    if (data.method === 'Runtime.exceptionThrown') console.error('Browser exception:', data.params.exceptionDetails);
    if (data.method === 'Target.attachedToTarget') {
      command('Runtime.enable', {}, data.params.sessionId);
      command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, data.params.sessionId);
    }
    if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
  };
  function command(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise(resolve => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  await command('Page.enable');
  await command('Log.enable');
  await command('Network.enable');
  await command('Runtime.enable');
  await command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  const loaded = new Promise(resolve => { onLoaded = resolve; });
  await command('Page.navigate', { url });
  await loaded;
  const result = await command('Runtime.evaluate', { expression: `import(${JSON.stringify(new URL('runtime-harness.js', url).href)}).then(module => module.runRuntimeTests())`, awaitPromise: true, returnByValue: true, timeout: 240000 });
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result.error || result.result.exceptionDetails));
  console.log(JSON.stringify(result.result.result.value, null, 2));
  const appUrl = new URL('../index.html', url).href;
  const appLoaded = new Promise(resolve => { onLoaded = resolve; });
  await command('Page.navigate', { url: appUrl });
  await appLoaded;
  const uiResult = await command('Runtime.evaluate', { expression: `import(${JSON.stringify(new URL('ui-harness.js', url).href)}).then(module => module.runUiTests())`, awaitPromise: true, returnByValue: true, timeout: 240000 });
  if (uiResult.error || uiResult.result?.exceptionDetails) throw new Error(JSON.stringify(uiResult.error || uiResult.result.exceptionDetails));
  console.log(JSON.stringify({ ui: uiResult.result.result.value }, null, 2));
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await command('Runtime.evaluate', { expression: `(() => {
    const menu = document.getElementById('snapshot-menu');
    const visible = getComputedStyle(menu).display !== 'none';
    menu.open = true;
    const headerControlsReachable = ['import-python-button', 'export-menu', 'run-button', 'snapshot-menu']
      .every(id => { const rect = document.getElementById(id).getBoundingClientRect(); return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth; });
    const footerFits = document.querySelector('.editor-footer').getBoundingClientRect().right <= innerWidth;
    return { width: innerWidth, visible, expanded: menu.open, headerControlsReachable, footerFits,
      stacked: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ').length === 1,
      noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
      editorUsable: !!document.querySelector('.CodeMirror').CodeMirror,
      darkMenu: getComputedStyle(document.querySelector('.snapshot-toolbar')).backgroundColor === 'rgb(29, 29, 29)',
      darkEditor: getComputedStyle(document.querySelector('.CodeMirror')).backgroundColor === 'rgb(29, 29, 29)' };
  })()`, returnByValue: true });
  const checks = mobile.result?.result?.value;
  if (mobile.error || !checks || checks.width !== 390 || !checks.visible || !checks.expanded || !checks.headerControlsReachable || !checks.footerFits || !checks.stacked || !checks.noPageOverflow || !checks.editorUsable || !checks.darkMenu || !checks.darkEditor) throw new Error(`Mobile layout failed: ${JSON.stringify(checks || mobile)}`);
  console.log(JSON.stringify({ mobile: { passed: 10, checks } }, null, 2));
  const mobileSnapshots = await command('Runtime.evaluate', { expression: `(async () => {
    const files = window.__pylabTestSnapshots;
    const load = async (slot, json) => {
      const input = document.getElementById('import-' + slot), transfer = new DataTransfer();
      transfer.items.add(new File([json], slot + '.json', { type: 'application/json' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 100 && document.getElementById('snapshot-status').textContent.includes('cleared'); i++) await new Promise(r => setTimeout(r, 10));
      await new Promise(r => setTimeout(r, 40));
    };
    await load('a', files[0]);
    const snapshotStacked = getComputedStyle(document.getElementById('snapshot-workspace')).gridTemplateColumns.split(' ').length === 1;
    const snapshotNoOverflow = document.documentElement.scrollWidth <= innerWidth;
    const snapshotDark = getComputedStyle(document.getElementById('snapshot-workspace')).backgroundColor === 'rgb(24, 24, 24)';
    await load('b', files[1]);
    return { snapshotStacked, snapshotNoOverflow, snapshotDark,
      compareStacked: getComputedStyle(document.querySelector('.compare-sides')).gridTemplateColumns.split(' ').length === 1,
      compareNoOverflow: document.documentElement.scrollWidth <= innerWidth,
      compareVisible: !document.getElementById('compare-workspace').hidden,
      compareDark: getComputedStyle(document.getElementById('compare-workspace')).backgroundColor === 'rgb(24, 24, 24)' };
  })()`, awaitPromise: true, returnByValue: true });
  const layout = mobileSnapshots.result?.result?.value;
  if (mobileSnapshots.error || !layout || Object.values(layout).some(value => value !== true)) throw new Error(`Mobile snapshots failed: ${JSON.stringify(layout || mobileSnapshots)}`);
  console.log(JSON.stringify({ mobileSnapshots: { passed: 7, checks: layout } }, null, 2));
} finally { socket?.close(); chrome.kill(); server.close(); }
