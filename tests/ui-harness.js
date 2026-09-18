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
  assert(document.querySelectorAll('[data-stage]').length === 7 && document.querySelectorAll('[data-tab]').length === 7, 'seven compact stages and seven result tabs are present');
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
  return { passed: checks.length, checks };
}
