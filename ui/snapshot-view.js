import { compareSnapshots } from './compare.js';

const byId = id => document.getElementById(id);
const LABELS = { source: 'SOURCE', tokens: 'TOKENS', ast: 'AST', 'code-object': 'CODE OBJECT', bytecode: 'BYTECODE', disassembly: 'DISASSEMBLY', execution: 'EXECUTION' };
const categoryDescription = {
  source: 'Line-based source comparison.', tokens: 'Token type, value and position. Position-only changes are identified separately.',
  ast: 'Structural AST comparison; this does not establish semantic equivalence.',
  'code-object': 'CPython code-object metadata, where recorded in the snapshot.',
  bytecode: 'Structured instruction differences, including offsets, arguments and source locations.',
  disassembly: 'Structured instructions are compared first. Rendered dis.dis text is not used as the diff key.',
  execution: 'Recorded stdout, stderr and execution error. No code is run during comparison.',
};
const addText = (parent, tag, text) => { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; };

export function renderSnapshotMetadata(host, slot, filename, snapshot) {
  host.replaceChildren();
  addText(host, 'h3', `${slot} · IMPORTED SNAPSHOT · READ ONLY`);
  const list = document.createElement('dl'); host.append(list);
  const entries = [
    ['File', filename], ['Schema', `v${snapshot.version}`],
    ['Runtime', `${snapshot.runtime.name} ${snapshot.runtime.version}`],
    ['Python', snapshot.runtime.pythonVersion || 'Not recorded'],
    ...(snapshot.createdAt ? [['Created', snapshot.createdAt]] : []),
    ['Source size', `${new TextEncoder().encode(snapshot.source).length} bytes`],
    ['Execution', snapshot.execution.error ? 'error' : 'success'],
    ['Mappings', `${snapshot.mappings.tokens.length} tokens · ${snapshot.mappings.astNodes.length} AST nodes · ${snapshot.mappings.instructions.length} instructions`],
  ];
  for (const [key, val] of entries) { addText(list, 'dt', key); addText(list, 'dd', val); }
}

export class ComparisonView {
  constructor() {
    this.category = 'source'; this.result = null; this.tabs = [...document.querySelectorAll('[data-compare]')];
    for (const tab of this.tabs) { tab.id = `compare-tab-${tab.dataset.compare}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'compare-rows'); }
    byId('compare-rows').setAttribute('role', 'tabpanel');
  }
  render(a, b) {
    this.result = compareSnapshots(a?.snapshot, b?.snapshot);
    byId('compare-empty').hidden = !!this.result;
    byId('compare-content').hidden = !this.result;
    if (!this.result) return;
    renderSnapshotMetadata(byId('compare-meta-a'), 'SNAPSHOT A', a.name, a.snapshot);
    renderSnapshotMetadata(byId('compare-meta-b'), 'SNAPSHOT B', b.name, b.snapshot);
    byId('compare-runtime-warning').hidden = !this.result.runtimeDifference;
    const summary = byId('compare-summary'); summary.replaceChildren();
    for (const [key, differences] of Object.entries(this.result.summary))
      addText(summary, 'span', `${LABELS[key]}  ${differences ? `${differences} ${differences === 1 ? 'difference' : 'differences'}` : 'UNCHANGED'}`);
    this.select(this.category);
  }
  select(category, focus = false) {
    if (!LABELS[category]) return;
    this.category = category;
    for (const tab of this.tabs) {
      const selected = tab.dataset.compare === category;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    if (!this.result) return;
    byId('compare-description').textContent = categoryDescription[category];
    byId('compare-rows').setAttribute('aria-labelledby', this.tabs.find(tab => tab.dataset.compare === category).id);
    const host = byId('compare-rows'); host.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'compare-row compare-row-header';
    for (const label of ['STATUS','SNAPSHOT A','SNAPSHOT B']) addText(heading, 'span', label);
    host.append(heading);
    const rows = this.result.categories[category];
    for (const item of rows.slice(0, 1_000)) {
      const line = document.createElement('div'); line.className = 'compare-row'; line.dataset.status = item.status;
      const status = addText(line, 'span', item.detail === 'position only' ? 'POSITION CHANGED' : item.status);
      status.className = 'diff-status';
      if (item.detail && item.detail !== 'position only') addText(status, 'small', item.detail);
      addText(line, 'pre', item.before); addText(line, 'pre', item.after);
      host.append(line);
    }
    if (rows.totalRows > rows.length) addText(host, 'p', `${rows.totalRows - rows.length} further rows omitted from the view. Summary counts include them.`);
    if (!rows.length) addText(host, 'p', 'No data in either snapshot for this category.');
  }
}
