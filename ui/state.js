export function createState() {
  return { phase: 'loading', version: '', activeTab: 'output', activeStage: 'source', runId: 0,
    output: '', stderr: '', error: '', tokens: [], tokenError: '', tokensTruncated: false,
    astTree: '', astDump: '', astError: '', compileError: '', codeObject: '', bytecode: '', disassembly: '',
    hasRun: false, duration: 0, dirty: false, truncated: false, notice: '' };
}
