import { formatDuration } from './results.js';

export class PlaygroundView {
  constructor() {
    this.elements = Object.fromEntries(['run-button','stop-button','retry-button','runtime-status','runtime-dot','runtime-notice','python-version','execution-status','output-empty','output-content','tokens-warning','tokens-placeholder','tokens-table','tokens-body','ast-tree-content','ast-dump-content','code-object-content','bytecode-content','disassembly-content','errors-content','error-count','trace-content','clear-trace','download-source','download-inspection','copy-inspection','export-status'].map(id => [id, document.getElementById(id)]));
    this.elements['output-content'].setAttribute('aria-live', 'polite');
    this.tabs = [...document.querySelectorAll('[data-tab]')];
    this.stages = [...document.querySelectorAll('[data-stage]')];
    this.renderedTokens = null;
    this.renderedTrace = null;
    this.astRows = new Map(); this.instructionRows = new Map(); this.tokenRows = [];
    this.highlightedRows = new Set();
    for (const [panelId, listId, title] of [['panel-ast','ast-node-list','Show text tree'], ['panel-bytecode','bytecode-instructions','Show raw bytecode and metadata'], ['panel-disassembly','disassembly-instructions','Show dis.dis listing']]) {
      const panel = document.getElementById(panelId);
      const pre = panel.querySelector('pre');
      const list = document.createElement('div'); list.id = listId; list.className = 'inspection-list';
      const details = document.createElement('details'); details.className = 'raw-inspection';
      const summary = document.createElement('summary'); summary.textContent = title;
      pre.before(list); details.append(summary, pre); list.after(details);
    }
    const details = document.createElement('section'); details.id = 'ast-selected-detail'; details.className = 'detail-panel'; details.hidden = true;
    document.getElementById('ast-node-list').before(details);
    const tokenDetails = document.createElement('section'); tokenDetails.id = 'token-selected-detail'; tokenDetails.className = 'detail-panel'; tokenDetails.hidden = true;
    document.getElementById('tokens-table').before(tokenDetails);
  }
  selectTab(name, focus = false) {
    for (const tab of this.tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }
  selectStage(name) {
    for (const stage of this.stages) {
      if (stage.dataset.stage === name) stage.setAttribute('aria-current', 'step');
      else stage.removeAttribute('aria-current');
    }
  }
  render(state) {
    const el = this.elements;
    el['run-button'].disabled = state.phase !== 'ready';
    el['stop-button'].hidden = state.phase !== 'running';
    el['retry-button'].hidden = state.phase !== 'unavailable';
    el['runtime-status'].textContent = { loading: 'LOADING PYTHON…', ready: 'PYTHON READY', running: 'RUNNING PYTHON…', unavailable: 'PYTHON UNAVAILABLE' }[state.phase] || 'PYTHON UNAVAILABLE';
    el['runtime-dot'].classList.toggle('ready', state.phase === 'ready');
    el['runtime-notice'].hidden = !state.notice;
    el['runtime-notice'].textContent = state.notice;
    el['python-version'].textContent = state.version ? `PYTHON ${state.version}` : 'PYTHON';
    const problem = !!(state.error || state.stderr);
    el['error-count'].hidden = !problem;
    el['execution-status'].textContent = state.phase === 'running' ? 'Executing…' : state.hasRun ? (state.dirty ? 'Source changed · run again' : state.error ? 'Execution stopped' : `Finished in ${formatDuration(state.duration)}`) : 'Ready when you are';
    el['output-empty'].hidden = state.hasRun;
    el['output-content'].hidden = !state.hasRun;
    el['output-content'].textContent = state.output + (state.truncated ? '\n[Output limit reached: further output omitted.]' : '') || (state.phase === 'running' ? 'Running…' : state.error ? 'No standard output. See Errors for details.' : 'Program finished without standard output.');
    el['tokens-warning'].textContent = [state.tokenError, state.tokensTruncated ? 'Further tokens omitted.' : ''].filter(Boolean).join('\n');
    el['tokens-warning'].hidden = !el['tokens-warning'].textContent;
    el['tokens-placeholder'].hidden = state.tokens.length > 0;
    el['tokens-placeholder'].textContent = state.hasRun ? (state.phase === 'running' ? 'Tokenizing…' : 'NO TOKENS AVAILABLE\nNo tokens were produced for this run.') : 'NO INSPECTION\nRun the program to inspect its tokens.';
    el['tokens-table'].hidden = state.tokens.length === 0;
    if (this.renderedTokens !== state.tokens) {
      const rows = document.createDocumentFragment();
      this.tokenRows = [];
      for (const item of state.tokens) {
        const row = document.createElement('tr');
        row.dataset.tokenIndex = this.tokenRows.length;
        this.tokenRows.push(row);
        for (const [index, value] of [item.type, JSON.stringify(item.value), item.line, item.column].entries()) {
          const cell = document.createElement('td');
          if (index === 0) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'token-button';
            button.dataset.tokenIndex = row.dataset.tokenIndex;
            button.setAttribute('aria-label', `Inspect ${item.type} token ${JSON.stringify(item.value).slice(0, 60)} at line ${item.line}, column ${item.column}`);
            button.textContent = String(value); cell.append(button);
          } else cell.textContent = String(value);
          row.append(cell);
        }
        rows.append(row);
      }
      el['tokens-body'].replaceChildren(rows);
      this.renderedTokens = state.tokens;
    }
    el['ast-tree-content'].textContent = state.astTree || state.astError || (state.hasRun ? (state.phase === 'running' ? 'Parsing…' : 'NO AST AVAILABLE\nNo AST was produced for this run.') : 'NO INSPECTION\nRun the program to inspect its AST.');
    el['ast-dump-content'].textContent = state.astDump;
    document.querySelector('.ast-dump').hidden = !state.astDump;
    el['code-object-content'].textContent = state.codeObject || state.compileError || (state.hasRun ? 'No code object available for this run.' : 'Run your code to inspect its code object.');
    el['bytecode-content'].textContent = state.bytecode || state.compileError || (state.hasRun ? 'No bytecode available for this run.' : 'Run your code to inspect its bytecode.');
    el['disassembly-content'].textContent = state.disassembly || state.compileError || (state.hasRun ? 'No disassembly available for this run.' : 'Run your code to inspect its instructions.');
    el['errors-content'].textContent = [state.stderr, state.error].filter(Boolean).join(state.stderr.endsWith('\n') ? '' : '\n') || 'No errors to show.';
    this.renderInspection(state);
    this.renderTrace(state);
    const canExport = state.hasRun && state.phase === 'ready' && !state.dirty && !!state.trace;
    el['download-inspection'].disabled = !canExport;
    el['copy-inspection'].disabled = !canExport;
    this.selectTab(state.activeTab);
    this.selectStage(state.activeStage);
  }
  renderInspection(state) {
    const trace = state.trace;
    if (trace !== this.renderedTrace) {
      this.renderedTrace = trace;
      this.astRows.clear(); this.instructionRows.clear(); this.highlightedRows.clear();
      const ast = document.createDocumentFragment(), instructions = document.createDocumentFragment(), disassembly = document.createDocumentFragment();
      if (trace) {
        for (const node of trace.astNodes) {
          const row = document.createElement('button'); row.type = 'button'; row.className = 'inspection-row'; row.dataset.astId = node.id;
          row.style.setProperty('--depth', Math.min(node.depth, 8));
          row.textContent = `${node.label}  ${this.location(node.range)}`;
          if (!node.range) row.classList.add('location-unavailable');
          this.astRows.set(node.id, row);
          ast.append(row);
        }
        for (const code of trace.codeObjects) {
          for (const list of [instructions, disassembly]) {
            const heading = document.createElement('p'); heading.className = 'inspection-group';
            heading.textContent = `CODE OBJECT  ${code.name}  ·  ${code.id}`;
            list.append(heading);
          }
          for (const item of trace.instructions.filter(i => i.codeId === code.id)) {
            for (const list of [instructions, disassembly]) {
              const row = document.createElement('button'); row.type = 'button'; row.className = 'inspection-row instruction-row';
              row.dataset.instructionId = item.id;
              const location = document.createElement('span'); location.className = 'instruction-source'; location.textContent = this.instructionLocation(item);
              const offset = document.createElement('span'); offset.textContent = String(item.offset);
              const operation = document.createElement('span'); operation.textContent = item.opcode;
              const argument = document.createElement('span'); argument.textContent = `${item.arg ?? ''}${item.argrepr ? ` (${item.argrepr})` : ''}`;
              row.append(location, offset, operation, argument);
              if (!item.source) row.classList.add('location-unavailable');
              if (!this.instructionRows.has(item.id)) this.instructionRows.set(item.id, []);
              this.instructionRows.get(item.id).push(row);
              list.append(row);
            }
          }
        }
      }
      document.getElementById('ast-node-list').replaceChildren(ast);
      document.getElementById('bytecode-instructions').replaceChildren(instructions);
      document.getElementById('disassembly-instructions').replaceChildren(disassembly);
    }
    const selection = state.selection;
    for (const row of this.highlightedRows) row.classList.remove('is-selected', 'is-related');
    this.highlightedRows.clear();
    const mark = (row, cls) => { if (row) { row.classList.add(cls); this.highlightedRows.add(row); } };
    for (const id of selection?.astCandidates ?? []) mark(this.astRows.get(id), id === selection.astId ? 'is-selected' : 'is-related');
    if (selection?.astId) mark(this.astRows.get(selection.astId), 'is-selected');
    for (const id of selection?.instructionIds ?? []) for (const row of this.instructionRows.get(id) ?? []) mark(row, id === selection.selectedInstructionId ? 'is-selected' : 'is-related');
    for (const row of this.instructionRows.get(selection?.selectedInstructionId) ?? []) mark(row, 'is-selected');
    for (const index of selection?.tokenIndices ?? []) mark(this.tokenRows[index], index === selection.selectedTokenIndex ? 'is-selected' : 'is-related');
    const detail = document.getElementById('ast-selected-detail');
    const selectedNode = trace?.astNodes.find(node => node.id === selection?.astId);
    detail.hidden = !selectedNode;
    this.renderAstDetail(detail, selectedNode, trace, selection);
    const tokenDetail = document.getElementById('token-selected-detail');
    const selectedToken = trace?.tokens[selection?.selectedTokenIndex];
    tokenDetail.hidden = !selectedToken;
    this.renderTokenDetail(tokenDetail, selectedToken);
  }
  renderAstDetail(host, node, trace, selection) {
    host.replaceChildren();
    if (!node) return;
    const title = document.createElement('p'); title.className = 'detail-kicker'; title.textContent = 'AST NODE';
    const name = document.createElement('h3'); name.textContent = node.type;
    host.append(title, name);
    this.detailRows(host, [['Location', this.location(node.range)],
      ...node.fields.map(field => [field.name === 'operator' ? 'Operator' : field.name, field.value]),
      ['Related tokens', String(selection?.tokenIndices.length ?? 0)],
      ['Related instructions', String(selection?.instructionIds.length ?? 0)]]);
    const children = node.children.map(id => trace.astNodes.find(item => item.id === id)).filter(Boolean);
    if (children.length) {
      const label = document.createElement('p'); label.className = 'detail-kicker'; label.textContent = 'CHILDREN'; host.append(label);
      const list = document.createElement('div'); list.className = 'detail-children';
      for (const child of children.slice(0, 40)) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.astId = child.id;
        button.textContent = child.label; list.append(button);
      }
      if (children.length > 40) { const p = document.createElement('p'); p.textContent = `${children.length - 40} further children in the tree.`; list.append(p); }
      host.append(list);
    }
  }
  renderTokenDetail(host, token) {
    host.replaceChildren();
    if (!token) return;
    const title = document.createElement('p'); title.className = 'detail-kicker'; title.textContent = 'TOKEN';
    const name = document.createElement('h3'); name.textContent = token.type;
    host.append(title, name);
    this.detailRows(host, [['Value', JSON.stringify(token.value)],
      ['Start', `line ${token.line}, column ${token.column}`],
      ['End', token.endLine == null ? 'unavailable' : `line ${token.endLine}, column ${token.endColumn}`]]);
  }
  detailRows(host, entries) {
    const list = document.createElement('dl'); list.className = 'detail-grid';
    for (const [label, value] of entries) {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value;
      list.append(term, description);
    }
    host.append(list);
  }
  location(range) {
    if (!range) return 'source unavailable';
    const a = range.start, b = range.end;
    return `line ${a.line}, col ${a.column + 1}${a.line === b.line ? `–${b.column + 1}` : ` → line ${b.line}, col ${b.column + 1}`}`;
  }
  instructionLocation(item) {
    if (!item.source) return '—';
    return item.source.column === null ? `${item.source.line}:?` : `${item.source.line}:${item.source.column + 1}`;
  }
  renderTrace(state) {
    const host = this.elements['trace-content'];
    const selection = state.selection, trace = state.trace;
    this.elements['clear-trace'].hidden = !selection;
    if (state.dirty) { host.textContent = 'Source changed. Run again to refresh the mapping.'; return; }
    if (!selection || !trace) { host.textContent = state.hasRun ? 'Place the cursor on a source line, or select a token, AST node, or instruction.' : 'NO INSPECTION\nRun the program to generate compiler inspection data.'; return; }
    host.replaceChildren();
    const summary = document.createElement('div'); summary.className = 'inspection-summary';
    const selected = document.createElement('span'); selected.textContent = `SELECTED  ${selection.kind === 'token' ? 'Token' : selection.kind === 'ast' ? 'AST node' : selection.kind === 'instruction' ? 'Instruction' : 'Source'}`;
    const counts = document.createElement('span'); counts.textContent = `${selection.astId ? trace.astNodes.find(n => n.id === selection.astId)?.type ?? 'AST' : 'No AST'}  ·  ${selection.tokenIndices.length} tokens  ·  ${selection.instructionIds.length} instructions`;
    summary.append(selected, counts); host.append(summary);
    const group = (title, entries, render, empty = 'Unavailable for this source') => {
      const section = document.createElement('section'); section.className = 'trace-group';
      const heading = document.createElement('h3'); heading.textContent = title; section.append(heading);
      if (!entries.length) { const p = document.createElement('p'); p.textContent = empty; section.append(p); }
      for (const entry of entries.slice(0, 60)) section.append(render(entry));
      if (entries.length > 60) { const p = document.createElement('p'); p.textContent = `${entries.length - 60} further items in their inspection tab.`; section.append(p); }
      host.append(section);
    };
    const text = value => { const p = document.createElement('p'); p.textContent = value; return p; };
    const link = (value, attribute, id) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'trace-link'; button.dataset[attribute] = id; button.textContent = value; return button; };
    group('SOURCE', selection.line ? [selection] : [], s => text(s.range ? this.location(s.range) : `line ${s.line}`), 'No source range available for this selection.');
    group('TOKENS', selection.tokenIndices.map(i => trace.tokens[i]).filter(Boolean), t => link(`${t.type}  ${JSON.stringify(t.value)}`, 'tokenIndex', t.index));
    const nodes = selection.astCandidates.length ? selection.astCandidates : selection.astId ? [selection.astId] : [];
    group('AST', nodes.map(id => trace.astNodes.find(n => n.id === id)).filter(Boolean), n => link(`${n.label}  ·  ${this.location(n.range)}`, 'astId', n.id));
    group('CODE OBJECT', selection.codeIds.map(id => trace.codeObjects.find(c => c.id === id)).filter(Boolean), c => text(`${c.name}  (${c.id}, line ${c.firstLine ?? '?'})`));
    const related = selection.kind === 'instruction' ? [selection.selectedInstructionId] : selection.instructionIds;
    const items = related.map(id => trace.instructions.find(i => i.id === id)).filter(Boolean);
    for (const heading of ['BYTECODE', 'DISASSEMBLY']) group(heading, items, i => link(`${i.codeId}  ${this.instructionLocation(i)}  ${i.offset}  ${i.opcode}  ${i.argrepr}`, 'instructionId', i.id));
    if (trace.instructionsTruncated) host.append(text('Further instructions omitted at the inspection limit.'));
  }
}
