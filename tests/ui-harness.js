/** Exercise the actual editor, tabs and pipeline controls in the static page. */
export async function runUiTests() {
  const checks = [];
  function assert(condition, name) { if (!condition) throw new Error(name); checks.push(name); }
  async function until(predicate, name, timeout = 120000) {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > timeout) throw new Error(`Timed out waiting for ${name}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  const el = id => document.getElementById(id);
  const click = id => el(id).click();
  await until(() => el('runtime-status')?.textContent === 'PYTHON READY' || el('runtime-status')?.textContent === 'PYTHON UNAVAILABLE', 'Python ready');
  if (el('runtime-status').textContent !== 'PYTHON READY') throw new Error(el('runtime-notice').textContent);
  const editor = document.querySelector('.CodeMirror')?.CodeMirror;
  assert(editor?.getValue() === 'print("Hello, world!")', 'existing CodeMirror editor remains editable');
  assert(getComputedStyle(document.documentElement).backgroundColor === 'rgb(17, 17, 17)' &&
    getComputedStyle(document.documentElement).color === 'rgb(237, 237, 237)', 'page uses compact charcoal and muted light text');
  assert(getComputedStyle(editor.getWrapperElement()).backgroundColor === 'rgb(29, 29, 29)' &&
    getComputedStyle(document.querySelector('.CodeMirror-gutters')).backgroundColor === 'rgb(29, 29, 29)', 'editor and line-number gutter use the dark surface');
  assert(getComputedStyle(el('run-button')).backgroundColor === 'rgb(222, 222, 222)' &&
    getComputedStyle(el('run-button')).color === 'rgb(23, 23, 23)' &&
    getComputedStyle(el('live-workspace')).borderBottomColor === 'rgb(51, 51, 51)', 'Run button and workspace border remain distinct');
  assert(el('trace-content').textContent.includes('NO INSPECTION') && el('download-inspection').disabled && el('copy-inspection').disabled && !el('download-source').disabled, 'empty inspection is explained while source remains downloadable');
  assert(el('output-content').getAttribute('aria-live') === 'polite', 'execution output has a polite live announcement');
  assert(!document.querySelector('.pipeline-nav') && document.querySelectorAll('[data-tab]').length === 8, 'all eight inspection tabs remain without a duplicate pipeline strip');
  assert(el('import-python-button') && el('editor-import-button') && el('import-python-input').accept.includes('.py') && el('export-menu') && el('snapshot-menu'), 'compact header exposes Python import, export and secondary snapshot tools');
  assert(el('code-title').textContent.includes('main.py') && el('execution-status').textContent === 'READY' && !document.querySelector('.page-heading'), 'editor and result headers are compact and ready');
  assert(document.querySelector('.status-bar a').href === 'https://github.com/tarun-choudhary-dev/compiler' && document.querySelector('.status-bar').textContent.includes('AGPL-3.0'), 'small footer links to the AGPL-3.0 project');
  el('export-menu').open = true;
  assert(el('download-source').textContent === 'Download Python' && el('download-inspection').disabled && el('copy-inspection').disabled, 'Export menu preserves actions and disables unavailable inspection');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent.includes('Hello, world!'), 'default execution result', 20000);
  assert(el('output-content').textContent === 'Hello, world!\n', 'Run executes and shows stdout in the existing result panel');
  const pythonInput = el('import-python-input');
  let pickerOpened = false;
  const nativeInputClick = pythonInput.click;
  pythonInput.click = () => { pickerOpened = true; };
  click('import-python-button');
  assert(pickerOpened, 'Import button opens the local Python file picker');
  pythonInput.click = nativeInputClick;
  const selectPython = (contents, name) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], name, { type: 'text/x-python' }));
    pythonInput.files = transfer.files;
    pythonInput.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const runtimeModule = await import('../runtime/runtime.js');
  const previousPythonRun = runtimeModule.PyodideRuntime.prototype.run;
  let pythonImportRuns = 0;
  runtimeModule.PyodideRuntime.prototype.run = function (...args) { pythonImportRuns++; return previousPythonRun.apply(this, args); };
  selectPython('print("Imported locally")', 'example.py');
  await until(() => el('import-status').textContent.includes('imported.'), 'Python file import', 2000);
  assert(editor.getValue() === 'print("Imported locally")' && !el('import-status').hidden && el('output-empty').hidden === false && el('download-inspection').disabled && el('execution-status').textContent === 'READY' && pythonImportRuns === 0, 'imported Python replaces source without executing or retaining stale inspection');
  selectPython('print("Invalid")', 'example.txt');
  await until(() => el('import-status').textContent.includes('Only .py'), 'invalid Python file type', 2000);
  assert(editor.getValue() === 'print("Imported locally")', 'invalid file type leaves source unchanged');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === 'Imported locally\n', 'imported Python runs only on request', 20000);
  assert(pythonImportRuns === 1, 'imported Python reaches Pyodide only after Run');
  runtimeModule.PyodideRuntime.prototype.run = previousPythonRun;
  assert(el('execution-status').textContent === 'READY', 'successful run returns the result header to READY');
  click('tab-tokens');
  assert(el('tab-tokens').getAttribute('aria-selected') === 'true' && !el('panel-tokens').hidden && el('tokens-body').children.length > 0, 'Tokens tab shows a structured table');
  click('tab-ast');
  assert(!el('panel-ast').hidden && el('ast-tree-content').textContent.startsWith('Module') && el('ast-dump-content').textContent.includes('Module('), 'AST tab opens both real representations');
  click('tab-code-object');
  assert(!el('panel-code-object').hidden && el('code-object-content').textContent.includes('co_filename: main.py'), 'Code object tab opens metadata');
  click('tab-bytecode');
  assert(!el('panel-bytecode').hidden && el('bytecode-content').textContent.includes('Offset'), 'Bytecode tab opens opcode table and raw bytes');
  click('tab-disassembly');
  assert(!el('panel-disassembly').hidden && el('disassembly-content').textContent.includes('LOAD_CONST'), 'Disassembly tab remains usable');
  editor.focus();
  assert(editor.hasFocus(), 'CodeMirror remains keyboard focusable');
  editor.setValue('print(');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('errors-content').textContent.includes('SyntaxError'), 'syntax error result', 20000);
  click('tab-tokens');
  assert(el('tokens-warning').textContent.includes('SYNTAX ERROR') && el('tokens-body').children.length > 0, 'invalid source retains partial token table and warning');
  assert(el('execution-status').textContent === 'ERROR', 'result header reports execution errors compactly');
  click('tab-ast');
  assert(el('ast-tree-content').textContent.startsWith('SYNTAX ERROR'), 'AST panel reports syntax error');
  click('tab-code-object');
  assert(el('code-object-content').textContent.includes('No code object'), 'code object panel explains invalid source');
  click('tab-bytecode');
  assert(el('bytecode-content').textContent.startsWith('SYNTAX ERROR'), 'bytecode panel clears previous run on syntax error');
  click('tab-disassembly');
  assert(el('disassembly-content').textContent.startsWith('SYNTAX ERROR'), 'disassembly panel remains available on syntax error');
  editor.setValue('print("<img src=x>")');
  click('tab-output'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent.includes('<img src=x>'), 'pipeline Run result', 20000);
  assert(!el('panel-output').querySelector('img') && el('output-content').textContent === '<img src=x>\n', 'pipeline Run safely renders source output as text');

  editor.setValue('x = 10\ny = 20\nz = x + y\nprint(z)');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '30\n', 'mapping execution', 20000);
  assert(el('bytecode-instructions').querySelectorAll('[data-instruction-id]').length > 0 && el('ast-node-list').querySelectorAll('[data-ast-id]').length > 0, 'real AST and bytecode rows are selectable');
  editor.setCursor({ line: 0, ch: 2 });
  assert(el('trace-content').textContent.includes('line 1') && el('trace-content').textContent.includes('10'), 'source line 1 reveals tokens and instructions');
  editor.setCursor({ line: 1, ch: 0 });
  assert(el('trace-content').textContent.includes('line 2') && el('trace-content').textContent.includes('20'), 'source line 2 has its own mapping');
  editor.setCursor({ line: 2, ch: 4 });
  assert(el('tab-trace').getAttribute('aria-selected') === 'true' && el('trace-content').textContent.includes('BinOp') && el('trace-content').textContent.includes('BINARY_OP'), 'source line 3 traces AST and bytecode');
  assert(el('ast-node-list').querySelector('.is-selected')?.textContent.includes('Name'), 'source region selects the smallest AST node');
  editor.setCursor({ line: 3, ch: 1 });
  assert(el('trace-content').textContent.includes('line 4') && el('trace-content').textContent.includes('CALL'), 'source line 4 has distinct execution instructions');
  click('tab-ast');
  [...el('ast-node-list').querySelectorAll('[data-ast-id]')].find(row => row.textContent.startsWith('BinOp')).click();
  assert(editor.getSelection() === 'x + y' && !!document.querySelector('.editor-trace-range') && el('ast-selected-detail').textContent.includes('BinOp'), 'AST selection highlights its exact CodeMirror source range');
  click('tab-bytecode');
  assert(!!document.querySelector('.editor-trace-range'), 'switching tabs keeps the selected source highlight');
  [...el('bytecode-instructions').querySelectorAll('[data-instruction-id]')].find(row => row.textContent.includes('BINARY_OP') && row.textContent.includes('3:')).click();
  assert(editor.getSelection() === 'x + y' && el('bytecode-instructions').querySelector('.is-selected')?.textContent.includes('BINARY_OP'), 'bytecode instruction jumps to CPython source location');
  click('tab-disassembly');
  [...el('disassembly-instructions').querySelectorAll('[data-instruction-id]')].find(row => row.textContent.includes('LOAD_NAME') && row.textContent.includes('3:')).click();
  assert(editor.getSelection() === 'x' && el('disassembly-instructions').querySelector('.is-selected')?.textContent.includes('LOAD_NAME'), 'disassembly instruction maps back to a specific source name');
  click('tab-trace'); click('clear-trace');
  assert(!document.querySelector('.editor-trace-range') && !document.querySelector('.editor-trace-line') && !editor.getSelection() && el('clear-trace').hidden, 'clearing selection removes CodeMirror marks and related state');
  editor.setCursor({ line: 0, ch: 0 }); editor.replaceRange('q', { line: 0, ch: 0 }, { line: 0, ch: 1 });
  assert(el('trace-content').textContent.includes('Run again') && !document.querySelector('.editor-trace-line'), 'source edits invalidate cached selections');
  editor.setValue('def hello('); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('errors-content').textContent.includes('SyntaxError'), 'invalid trace execution', 20000);
  editor.setCursor({ line: 0, ch: 1 });
  assert(el('trace-content').textContent.includes('def') && el('trace-content').textContent.includes('Unavailable'), 'invalid source traces partial tokens and explicitly unavailable later stages');
  editor.setValue('def add(a, b):\n    return a + b\nresult = add(2, 3)\nprint(result)'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '5\n', 'nested function trace', 20000);
  click('tab-bytecode');
  const functionRow = [...el('bytecode-instructions').querySelectorAll('[data-instruction-id^="co-1:"]')].find(row => row.textContent.includes('BINARY_OP'));
  assert(!!functionRow && el('bytecode-instructions').textContent.includes('CODE OBJECT  <module>') && el('bytecode-instructions').textContent.includes('CODE OBJECT  add'), 'module and function instructions remain distinct');
  functionRow.click();
  assert(editor.getSelection() === 'a + b', 'nested function bytecode maps to its own source');
  editor.setValue('for i in range(5):\n    if i % 2 == 0:\n        print(i)'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '0\n2\n4\n', 'loop trace', 20000);
  editor.setCursor({ line: 1, ch: 7 });
  assert(el('trace-content').textContent.includes('COMPARE_OP') && el('trace-content').textContent.includes('BINARY_OP'), 'condition line relates to multiple instructions');
  editor.setValue('café = "🙂"\nprint(café)'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '🙂\n', 'Unicode trace', 20000);
  click('tab-ast');
  [...el('ast-node-list').querySelectorAll('[data-ast-id]')].find(row => row.textContent.startsWith("Constant (value='🙂')")).click();
  assert(editor.getSelection() === '"🙂"', 'UTF-8 CPython columns highlight the correct UTF-16 editor range');

  editor.setValue('x = 10 * 5\nprint(x)'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '50\n', 'AST and token explorer run', 20000);
  click('tab-ast');
  const binOp = [...el('ast-node-list').querySelectorAll('[data-ast-id]')].find(row => row.textContent.startsWith('BinOp'));
  assert(binOp.tagName === 'BUTTON', 'AST tree uses keyboard-focusable native buttons');
  binOp.click();
  assert(editor.getSelection() === '10 * 5' && el('ast-selected-detail').textContent.includes('Operator') && el('ast-selected-detail').textContent.includes('Mult'), 'AST detail shows real operator and source location');
  assert(el('ast-selected-detail').querySelectorAll('.detail-children [data-ast-id]').length >= 2 && el('ast-selected-detail').textContent.includes('Constant'), 'AST detail shows clickable child nodes');
  assert(el('trace-content').textContent.includes('LOAD_CONST  50') && el('trace-content').querySelector('.inspection-summary').textContent.includes('1 instructions'), 'AST trace reflects CPython constant folding instead of inventing instructions');
  [...el('ast-selected-detail').querySelectorAll('.detail-children [data-ast-id]')].find(row => row.textContent.includes('10')).click();
  assert(editor.getSelection() === '10', 'AST detail child navigation returns to its exact source');
  editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 10 });
  assert(el('tab-trace').getAttribute('aria-selected') === 'true' && el('trace-content').textContent.includes('NUMBER  "10"') && el('trace-content').textContent.includes('OP  "*"') && el('trace-content').textContent.includes('NUMBER  "5"'), 'source text selection finds every overlapping token');
  assert(el('trace-content').querySelector('.inspection-summary').textContent.includes('3 tokens'), 'selection summary counts related tokens');
  click('tab-tokens');
  const tenRow = [...el('tokens-body').children].find(row => row.children[1].textContent === '"10"');
  assert(tenRow.querySelector('button')?.tagName === 'BUTTON', 'token table provides native keyboard controls');
  tenRow.querySelector('button').click();
  assert(editor.getSelection() === '10' && tenRow.classList.contains('is-selected') && el('token-selected-detail').textContent.includes('line 1, column 5') && el('token-selected-detail').textContent.includes('line 1, column 7'), 'token detail and source range update on selection');
  assert(el('trace-content').querySelector('.inspection-summary').textContent.includes('Token'), 'token selection updates the compact trace summary');

  editor.setValue('a = 10\nx = a * 5\nprint(x)'); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent === '50\n', 'variable expression run', 20000);
  click('tab-ast');
  [...el('ast-node-list').querySelectorAll('[data-ast-id]')].find(row => row.textContent.startsWith('BinOp')).click();
  assert(el('trace-content').textContent.includes('LOAD_NAME') && el('trace-content').textContent.includes('LOAD_CONST') && el('trace-content').textContent.includes('BINARY_OP'), 'AST range reveals multiple actual bytecode instructions');

  let exportedSnapshot;
  const nativeCreateUrl = URL.createObjectURL, nativeAnchorClick = HTMLAnchorElement.prototype.click;
  const downloads = [];
  URL.createObjectURL = blob => { downloads.push({ blob }); return `blob:pylab-test-${downloads.length}`; };
  HTMLAnchorElement.prototype.click = function () { downloads.at(-1).filename = this.download; };
  try {
    click('download-source');
    assert(downloads.at(-1).filename === 'program.py' && await downloads.at(-1).blob.text() === editor.getValue(), 'source download contains the current editor text');
    assert(!el('download-inspection').disabled, 'completed inspection enables snapshot export');
    click('download-inspection');
    const snapshot = JSON.parse(await downloads.at(-1).blob.text());
    exportedSnapshot = snapshot;
    assert(downloads.at(-1).filename === 'pylab-inspection.json' && snapshot.version === 1 && snapshot.source === editor.getValue(), 'inspection download uses a versioned JSON file');
    assert(snapshot.runtime.pythonVersion === el('python-version').textContent.replace('PYTHON ', '') && snapshot.runtime.version === '0.29.3' && snapshot.inspection.ast.nodes.some(node => node.type === 'BinOp') && snapshot.inspection.instructions.length > 0 && snapshot.mappings.instructions.length > 0 && snapshot.execution.stdout === '50\n', 'snapshot contains runtime, AST, instructions, mappings and execution');
    const oldClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let copied = '';
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
      click('copy-inspection');
      await until(() => el('export-status').textContent === 'Inspection copied.', 'copy inspection', 2000);
      assert(JSON.parse(copied).source === editor.getValue(), 'copy inspection writes the same JSON snapshot');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      click('copy-inspection');
      assert(el('export-status').textContent.includes('unavailable'), 'clipboard unavailability fails gracefully');
    } finally { if (oldClipboard) Object.defineProperty(navigator, 'clipboard', oldClipboard); else delete navigator.clipboard; }
    editor.setValue('x = 99');
    assert(el('download-inspection').disabled && el('copy-inspection').disabled, 'source edits disable stale inspection export');
    click('download-source');
    assert(await downloads.at(-1).blob.text() === 'x = 99', 'source download follows unsaved edits');
  } finally { URL.createObjectURL = nativeCreateUrl; HTMLAnchorElement.prototype.click = nativeAnchorClick; }

  editor.setValue('def hello('); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('errors-content').textContent.includes('SyntaxError'), 'invalid snapshot run', 20000);
  assert(el('tokens-body').children.length > 0 && el('ast-node-list').children.length === 0 && !el('download-inspection').disabled, 'invalid Python preserves tokens and permits partial inspection export');
  {
    const previousCreateUrl = URL.createObjectURL, previousAnchorClick = HTMLAnchorElement.prototype.click;
    let invalidBlob;
    URL.createObjectURL = blob => { invalidBlob = blob; return 'blob:pylab-invalid-test'; };
    HTMLAnchorElement.prototype.click = function () {};
    try {
      click('download-inspection');
      const invalidSnapshot = JSON.parse(await invalidBlob.text());
      assert(invalidSnapshot.inspection.tokens.length > 0 && invalidSnapshot.inspection.ast.nodes.length === 0 && invalidSnapshot.inspection.instructions.length === 0 && invalidSnapshot.execution.error.includes('SyntaxError'), 'invalid Python exports only available inspection data');
    } finally { URL.createObjectURL = previousCreateUrl; HTMLAnchorElement.prototype.click = previousAnchorClick; }
  }
  editor.setValue('a = 1\n'.repeat(600)); click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('tokens-body').children.length === 1500, 'large inspection render', 20000);
  assert(el('ast-node-list').children.length <= 500 && el('bytecode-instructions').querySelectorAll('[data-instruction-id]').length <= 4000, 'large inspection UI respects node and instruction bounds');
  const { PyodideRuntime } = await import('../runtime/runtime.js');
  const originalRun = PyodideRuntime.prototype.run;
  let importedRuns = 0;
  PyodideRuntime.prototype.run = function (...args) { importedRuns++; return originalRun.apply(this, args); };
  const importFile = (slot, contents, name = `${slot}.json`) => {
    const input = el(`import-${slot.toLowerCase()}`), transfer = new DataTransfer();
    transfer.items.add(new File([contents], name, { type: 'application/json' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    const liveSource = editor.getValue(), liveOutput = el('output-content').textContent;
    importFile('A', '{', 'broken.json');
    await until(() => el('snapshot-status').textContent.includes('INVALID SNAPSHOT'), 'invalid snapshot status', 2000);
    assert(el('snapshot-status').textContent.includes('Invalid JSON') && el('mode-live').getAttribute('aria-pressed') === 'true', 'invalid JSON is rejected without changing the live workspace');
    const importedA = structuredClone(exportedSnapshot);
    importedA.source = '1 / 0 \n1 / 0    \n1 / 0   ';
    importedA.inspection.ast.tree = '<img src=x onerror=alert(1)>';
    importedA.execution.stdout = '<svg onload=alert(1)>';
    importFile('A', JSON.stringify(importedA), 'untrusted-a.json');
    await until(() => el('mode-snapshot').getAttribute('aria-pressed') === 'true' || el('snapshot-status').textContent.includes('INVALID SNAPSHOT'), 'snapshot mode', 2000);
    if (el('snapshot-status').textContent.includes('INVALID SNAPSHOT')) throw new Error(el('snapshot-status').textContent);
    const readOnlyEditor = el('snapshot-editor-host').querySelector('.CodeMirror').CodeMirror;
    assert(readOnlyEditor.getOption('readOnly') === true && readOnlyEditor.getValue() === importedA.source && el('snapshot-metadata').textContent.includes('READ ONLY'), 'imported source opens in a separate read-only CodeMirror');
    assert(getComputedStyle(readOnlyEditor.getWrapperElement()).backgroundColor === 'rgb(29, 29, 29)', 'imported read-only editor keeps the dark theme');
    importFile('A', '{ "version": 2 }', 'wrong-version.json');
    await until(() => el('snapshot-status').textContent.includes('INVALID SNAPSHOT'), 'invalid replacement status', 2000);
    assert(readOnlyEditor.getValue() === importedA.source && el('mode-snapshot').getAttribute('aria-pressed') === 'true', 'invalid replacement preserves the previously loaded snapshot');
    assert(editor.getValue() === liveSource && importedRuns === 0 && el('live-workspace').hidden, 'import never replaces live source or sends imported Python to Pyodide');
    assert(el('snapshot-metadata').textContent.includes('0.29.3') && el('snapshot-metadata').textContent.includes('Schema') && el('snapshot-metadata').textContent.includes('Created'), 'snapshot metadata uses recorded schema, runtime and creation time');
    click('tab-output');
    assert(el('output-content').textContent === '<svg onload=alert(1)>' && !el('inspection-pane').querySelector('svg'), 'imported execution text renders without creating HTML elements');
    click('tab-ast');
    assert(el('ast-tree-content').textContent.includes('<img') && !el('inspection-pane').querySelector('img'), 'HTML-like AST text is inert');
    assert(el('tokens-body').children.length > 0 && el('ast-node-list').children.length > 0 && el('bytecode-instructions').children.length > 0, 'snapshot mode reuses token, AST and instruction views');
    [...el('ast-node-list').querySelectorAll('[data-ast-id]')].find(row => row.textContent.startsWith('BinOp')).click();
    assert(readOnlyEditor.getSelection().length > 0 && importedRuns === 0, 'snapshot AST selection traces source without execution');
    click('mode-live');
    assert(editor.getValue() === liveSource && el('output-content').textContent === liveOutput && el('mode-live').getAttribute('aria-pressed') === 'true', 'returning to live restores its editor and execution result');
    click('mode-snapshot');
    assert(el('snapshot-source').readOnly && readOnlyEditor.getValue() === importedA.source, 'snapshot mode remains read-only when revisited');
    const importedB = structuredClone(importedA);
    importedB.source = '2 / 0 \n2 / 0    \n2 / 0   ';
    importedB.runtime.pythonVersion = '3.14.0';
    importedB.inspection.tokens[0].value = 'changed';
    importedB.inspection.ast.nodes.find(node => node.fields.length).fields[0].value = 'changed';
    importedB.inspection.codeObjects[0].constants = ['changed'];
    importedB.inspection.instructions[0].argrepr = 'changed';
    window.__pylabTestSnapshots = [JSON.stringify(importedA), JSON.stringify(importedB)];
    importFile('B', JSON.stringify(importedB), 'untrusted-b.json');
    await until(() => el('mode-compare').getAttribute('aria-pressed') === 'true' && !el('compare-content').hidden, 'comparison mode', 2000);
    assert(el('compare-meta-a').textContent.includes('untrusted-a.json') && el('compare-meta-b').textContent.includes('untrusted-b.json') && !el('compare-runtime-warning').hidden, 'two imported snapshots show side-by-side metadata and runtime warning');
    assert(getComputedStyle(el('compare-workspace')).backgroundColor === 'rgb(24, 24, 24)' &&
      getComputedStyle(document.querySelector('.compare-row[data-status=CHANGED]')).backgroundColor === 'rgb(44, 44, 44)', 'comparison differences use a distinct charcoal surface');
    click('inspect-a');
    assert(readOnlyEditor.getValue() === importedA.source && el('mode-snapshot').getAttribute('aria-pressed') === 'true', 'comparison opens snapshot A for read-only inspection');
    click('mode-compare'); click('inspect-b');
    assert(readOnlyEditor.getValue() === importedB.source && el('mode-snapshot').getAttribute('aria-pressed') === 'true', 'comparison opens snapshot B for read-only inspection');
    click('mode-compare');
    assert(el('compare-summary').textContent.includes('SOURCE') && el('compare-summary').textContent.includes('AST') && el('compare-summary').textContent.includes('BYTECODE'), 'comparison summary covers pipeline categories');
    for (const category of ['source','tokens','ast','code-object','bytecode','disassembly','execution']) {
      document.querySelector(`[data-compare="${category}"]`).click();
      assert(document.querySelector(`[data-compare="${category}"]`).getAttribute('aria-selected') === 'true' && el('compare-rows').children.length > 1, `${category} comparison is keyboard-accessible and populated`);
    }
    assert(importedRuns === 0, 'two-snapshot comparison never executes either Python source');
    click('clear-b');
    assert(!el('compare-empty').hidden && el('compare-content').hidden, 'clearing B produces a clear empty comparison');
    click('clear-a'); click('mode-live');
    assert(editor.getValue() === liveSource && el('output-content').textContent === liveOutput, 'clearing snapshots leaves live state untouched');
    click('run-button');
    await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('execution-status').textContent === 'READY' && importedRuns === 1, 'live run after snapshot modes', 20000);
    assert(importedRuns === 1 && editor.getValue() === liveSource, 'live execution remains available after import and comparison');
    editor.setValue('while True: pass');
    click('run-button');
    assert(el('execution-status').textContent === 'RUNNING' && !el('stop-button').hidden && el('run-button').hidden, 'running state swaps Run for Stop');
    click('stop-button');
    await until(() => el('runtime-status').textContent === 'PYTHON READY', 'Python ready after Stop', 20000);
    assert(el('execution-status').textContent === 'STOPPED' && el('stop-button').hidden && !el('run-button').disabled, 'Stop terminates execution and restores Run');
  } finally { PyodideRuntime.prototype.run = originalRun; }
  return { passed: checks.length, checks };
}
