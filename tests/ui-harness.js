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
  assert(el('trace-content').textContent.includes('NO INSPECTION') && el('download-inspection').disabled && el('copy-inspection').disabled && !el('download-source').disabled, 'empty inspection is explained while source remains downloadable');
  assert(el('output-content').getAttribute('aria-live') === 'polite', 'execution output has a polite live announcement');
  assert(document.querySelectorAll('[data-stage]').length === 7 && document.querySelectorAll('[data-tab]').length === 8, 'seven compact stages and eight result tabs are present');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('output-content').textContent.includes('Hello, world!'), 'default execution result', 20000);
  assert(el('output-content').textContent === 'Hello, world!\n', 'Run executes and shows stdout in the existing result panel');
  click('tab-tokens');
  assert(el('tab-tokens').getAttribute('aria-selected') === 'true' && !el('panel-tokens').hidden && el('tokens-body').children.length > 0, 'Tokens tab shows a structured table');
  document.querySelector('[data-stage="ast"]').click();
  assert(!el('panel-ast').hidden && el('ast-tree-content').textContent.startsWith('Module') && el('ast-dump-content').textContent.includes('Module('), 'AST stage opens both real representations');
  document.querySelector('[data-stage="code-object"]').click();
  assert(!el('panel-code-object').hidden && el('code-object-content').textContent.includes('co_filename: main.py'), 'Code object stage opens metadata');
  document.querySelector('[data-stage="bytecode"]').click();
  assert(!el('panel-bytecode').hidden && el('bytecode-content').textContent.includes('Offset'), 'Bytecode stage opens opcode table and raw bytes');
  document.querySelector('[data-stage="disassembly"]').click();
  assert(!el('panel-disassembly').hidden && el('disassembly-content').textContent.includes('LOAD_CONST'), 'Disassembly stage remains usable');
  document.querySelector('[data-stage="source"]').click();
  assert(editor.hasFocus(), 'Source stage returns keyboard focus to CodeMirror');
  editor.setValue('print(');
  click('run-button');
  await until(() => el('runtime-status').textContent === 'PYTHON READY' && el('errors-content').textContent.includes('SyntaxError'), 'syntax error result', 20000);
  click('tab-tokens');
  assert(el('tokens-warning').textContent.includes('SYNTAX ERROR') && el('tokens-body').children.length > 0, 'invalid source retains partial token table and warning');
  click('tab-ast');
  assert(el('ast-tree-content').textContent.startsWith('SYNTAX ERROR'), 'AST panel reports syntax error');
  click('tab-code-object');
  assert(el('code-object-content').textContent.includes('No code object'), 'code object panel explains invalid source');
  click('tab-bytecode');
  assert(el('bytecode-content').textContent.startsWith('SYNTAX ERROR'), 'bytecode panel clears previous run on syntax error');
  click('tab-disassembly');
  assert(el('disassembly-content').textContent.startsWith('SYNTAX ERROR'), 'disassembly panel remains available on syntax error');
  editor.setValue('print("<img src=x>")');
  document.querySelector('[data-stage="output"]').click();
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
  return { passed: checks.length, checks };
}
