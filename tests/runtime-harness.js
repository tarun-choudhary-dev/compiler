import { PyodideRuntime } from '../runtime/runtime.js';

/** Exercise the production sandbox/worker/CPython path without browser UI automation. */
export async function runRuntimeTests() {
  const checks = [];
  let resolveMessage, rejectMessage, expectedType, expectedId, id = 0;
  const runtime = new PyodideRuntime(message => {
    if (message.type === 'fatal' && expectedType !== 'fatal') rejectMessage?.(new Error(message.message));
    else if (message.type === expectedType && (expectedId === undefined || message.id === expectedId)) resolveMessage?.(message);
  });
  function wait(type, messageId) {
    expectedType = type; expectedId = messageId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), type === 'ready' ? 120000 : 10000);
      resolveMessage = result => { clearTimeout(timer); resolve(result); };
      rejectMessage = error => { clearTimeout(timer); reject(error); };
    });
  }
  function assert(condition, name) { if (!condition) throw new Error(name); checks.push(name); }
  async function run(source) { const result = wait('result', ++id); runtime.run(id, source); return result; }
  try {
    const originalFetch = window.fetch;
    window.fetch = async () => { throw new Error('Simulated runtime download failure'); };
    const failure = wait('fatal'); runtime.initialize();
    const failed = await failure;
    window.fetch = originalFetch;
    assert(failed.message.includes('Simulated runtime download failure'), 'runtime download failure is readable and retryable');
    const ready = wait('ready'); runtime.initialize();
    const info = await ready;
    assert(/^3\./.test(info.version), `CPython ${info.version} loaded in sandboxed browser worker`);
    let r = await run('print("Hello")\nx = 10\nprint(x * 5)');
    assert(r.stdout === 'Hello\n50\n' && !r.error, 'stdout is exact');
    assert(r.bytecode.includes('Bytecode bytes') && r.bytecode.includes('Constants'), 'real bytecode metadata');
    assert(r.disassembly.includes('LOAD_CONST') && r.disassembly.includes('STORE_NAME'), 'real CPython disassembly');
    r = await run('print("α🙂", end="")'); assert(r.stdout === 'α🙂', 'Unicode and no trailing newline');
    r = await run('import sys\nsys.stderr.write("diagnostic\\n")'); assert(r.stderr === 'diagnostic\n' && !r.error, 'stderr is separate');
    for (const [source, error] of [['def :', 'SyntaxError'], ['print(missing_name)', 'NameError'], ['1 + "a"', 'TypeError'], ['import no_such_pylab_module', 'ModuleNotFoundError'], ['1 / 0', 'ZeroDivisionError']]) {
      r = await run(source); assert(r.error.includes(error) && r.errorLine === 1, `${error} traceback and source line`);
      if (error === 'SyntaxError') assert(!r.bytecode && !r.disassembly, 'syntax errors have no compiled results');
    }
    r = await run('print("before")\nraise ValueError("after")'); assert(r.stdout === 'before\n' && r.error.includes('ValueError'), 'output survives a runtime exception');
    r = await run('def double(x):\n    return x * 2\nprint(double(4))');
    assert(r.stdout === '8\n' && r.bytecode.includes('CODE OBJECT: double') && r.disassembly.includes('Disassembly of'), 'nested code objects are inspected');
    await run('temporary_name = 99'); r = await run('print(temporary_name)'); assert(r.error.includes('NameError'), 'fresh global namespace for every run');
    r = await run('import math\nprint(math.sqrt(81))'); assert(r.stdout === '9.0\n', 'bundled standard library');
    r = await run('input("Name: ")'); assert(r.error.includes('EOFError'), 'unsupported interactive input produces a readable error');
    r = await run('from js import fetch'); assert(r.error.includes('ImportError'), 'Python receives no fetch bridge');
    r = await run('from js import eval'); assert(r.error.includes('ImportError'), 'Python receives no JavaScript eval bridge');
    r = await run('import pyodide_js'); assert(r.error.includes('ModuleNotFoundError'), 'public runtime bridge is removed');
    r = await run('print("x" * 200000)'); assert(r.stdout.length <= 100000 && r.truncated, 'output floods are bounded');
    r = await run('print("<script>alert(1)</script>")'); assert(r.stdout.startsWith('<script>'), 'HTML remains output text');
    runtime.run(++id, 'while True:\n    pass');
    await new Promise(resolve => setTimeout(resolve, 150));
    const reset = wait('ready'); runtime.initialize(); await reset;
    r = await run('print("recovered")'); assert(r.stdout === 'recovered\n', 'infinite worker can be stopped and reset');
    return { passed: checks.length, checks, version: info.version };
  } finally { runtime.dispose(); }
}
