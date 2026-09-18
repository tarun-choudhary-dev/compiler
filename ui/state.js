export function createState() {
  return { phase: 'loading', version: '', activeTab: 'output', runId: 0,
    output: '', stderr: '', error: '', bytecode: '', disassembly: '',
    hasRun: false, duration: 0, dirty: false, truncated: false, notice: '' };
}
