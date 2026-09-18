# PYLAB

A complete static Python playground. Write Python, execute it locally in your browser, and inspect the actual tokens, AST, code object, bytecode and disassembly.

There is no execution backend, Python server, database, API key, or execution API. The shipped site is ordinary HTML, CSS, JavaScript, and a Python inspection helper loaded as text into the browser runtime. `runtime/inspector.py` is **never executed by a server**.

## Start locally

Use any static HTTP file server, such as your editor's Live Server extension, with this directory as its document root. Open `index.html` over HTTP, not `file://`: browsers restrict ES modules and asset fetching from local files.

An optional dependency-free local preview is included for Node.js 22 or later:

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:4173**. This development utility only serves files using GET/HEAD. It is not an application backend and does not receive or execute Python. No `npm install` is needed.

1. Wait for **PYTHON READY** (the first download can take a little while).
2. Run `print("Hello, world!")` with **Run code** or **Ctrl/Cmd + Enter**.
3. Switch between **Output**, **Trace**, **Tokens**, **AST**, **Code object**, **Bytecode**, **Disassembly**, and **Errors**. The compact pipeline opens each stage; **Source** focuses the editor and **Run** executes the current source.
4. Use **Stop** to terminate a long-running program and restart Python. Code remains in the editor.

After running, place the cursor on a source line to see its tokens, AST constructs, code-object contexts and instructions in **Trace**. Select an AST node or an instruction in Bytecode/Disassembly to jump to its source range. **Clear** removes the trace highlight. Editing the source invalidates the mapping until the next run.

The AST tree and token table are interactive too. Select a node to inspect its fields and children, or select a token to inspect its value and start/end positions. The Trace tab shows the related items found from CPython's locations. **Download source** saves the current editor text as `program.py`. After a completed run, **Download inspection** saves a versioned JSON snapshot as `pylab-inspection.json`; **Copy inspection** copies that JSON when the browser permits clipboard access. A source edit disables inspection export until you run again.

Tab inserts four-space indentation; Shift + Tab outdents. Escape leaves the editor and focuses the result tabs. Arrow keys, Home, and End navigate tabs.

## Complete source structure

```text
.
├── .gitignore
├── .nojekyll
├── .openai/
│   └── hosting.json          # Optional Sites deployment metadata
├── LICENSE                  # Existing project license (AGPL-3.0)
├── README.md
├── THIRD_PARTY.md
├── index.html               # Accessible app shell, result panels, reading pages
├── style.css                # Monochrome responsive layout and editor theme
├── favicon.svg
├── app.js                   # App wiring, navigation, keyboard controls
├── controller.js            # Run lifecycle, timeout, Stop/retry, stale-run guard
├── package.json             # Optional dependency-free development commands
├── editor/
│   └── editor.js            # CodeMirror adapter, indentation, source/error markers
├── runtime/
│   ├── config.js            # Pinned CDN dependency and resource limits
│   ├── assets.js            # Runtime download/cache, failure/retry handling
│   ├── runtime.js           # Sandbox lifecycle and private message channel
│   ├── sandbox.html         # Opaque-origin iframe and restrictive CSP
│   ├── worker.js            # Pyodide bootstrap and stdout/stderr capture
│   └── inspector.py         # tokenize, AST, compile, locations, dis, exec
├── ui/
│   ├── state.js             # Explicit UI state
│   ├── results.js           # Bounded, validated worker result processing
│   ├── view.js              # Text-only rendering and tab state
│   ├── source-map.js        # Normalized ranges and cached relationships
│   └── snapshot.js          # Versioned JSON inspection and browser downloads
├── vendor/codemirror/
│   ├── codemirror.js
│   ├── codemirror.css
│   ├── python.js
│   ├── matchbrackets.js
│   └── LICENSE
├── scripts/
│   ├── build.mjs            # Copies public files to dist; no bundler
│   └── serve.mjs            # Optional local static preview
└── tests/
    ├── unit.test.mjs        # Controller and result-processing tests
    ├── browser-runtime.mjs  # Headless Chromium integration test runner
    ├── harness.html         # Test fixture; excluded from deployment build
    ├── runtime-harness.js   # Tests the actual browser WASM execution path
    └── ui-harness.js        # Tests the real editor and pipeline controls
```

`node scripts/build.mjs` generates `dist/` containing the public entry files, `editor/`, `runtime/`, `ui/`, `vendor/`, license notices, and `.nojekyll`. `dist/` is ignored by Git. No server entry point is generated.

`ui/source-map.js` normalizes source positions, caches line lookups, and resolves source/token/AST/instruction selections. `ui/snapshot.js` packages a completed run for browser-only export. `runtime/inspector.py` provides CPython metadata; `controller.js`, `editor/editor.js`, and `ui/view.js` handle selection state, marks, and rendering.

## How execution works

```text
Browser page → sandboxed iframe → Web Worker → Pyodide → CPython → Python program
      ↑                                                           ↓
Result panels ← validated JSON/text ← MessageChannel ← inspect + stdout/stderr/errors
```

The page fetches five fixed assets for Pyodide 0.29.3 from jsDelivr: its loader, CPython JavaScript glue, WebAssembly binary, standard-library archive, and package lock file. The assets are retained in memory for runtime restarts. CodeMirror is included locally, so a runtime download failure leaves the editor and navigation usable.

An iframe with `sandbox="allow-scripts"` (without `allow-same-origin`) creates a dedicated blob Web Worker. The worker receives only the fixed runtime assets, inspection helper, and Python source. It boots Pyodide from in-memory resources with no execution network access. Normal runs reuse this interpreter; Stop, timeout, or fatal failure terminates it and recreates it.

Each program is compiled as `main.py` and executed with a fresh globals dictionary. Standard streams are captured separately, including Unicode, whitespace, and text without a final newline. Python exceptions become readable tracebacks; syntax and runtime errors point to the relevant editor line. A source edit during execution does not incorrectly highlight a line in the edited version.

The worker returns **one result** per run containing structured tokens, AST nodes, code objects and instructions with source locations, the existing formatted inspection text, stdout, stderr and errors. The page validates and bounds that result. All source-derived values enter the UI as text, including clickable rows; no Python output is interpreted as HTML. The inspector and program run in the same worker, never on the main UI thread.

Fresh globals are not a fresh interpreter: imported modules, changes to built-ins, and Pyodide's ephemeral in-memory filesystem can survive ordinary runs. A worker reset/page reload clears the interpreter. This is a script playground, not a persistent REPL.

## How inspection works

The compilation journey shown in the interface is:

```text
Python source
    ↓ tokenization
Tokens (type, value, line, column)
    ↓ parsing
Abstract syntax tree
    ↓ compile()
CPython code object
    ↓ co_code
Python bytecode
    ↓ CPython virtual machine
Execution and output
```

The viewer runs Python's `tokenize.generate_tokens()` and `ast.parse()` independently on the same source. `compile(source, ...)` then performs CPython's normal compilation, including its own parsing; the displayed AST is the real tree for that source, but is not passed as the literal argument to `compile()`. WebAssembly runs **CPython itself** in the browser. The program's bytecode is interpreted by that CPython runtime.

The Tokens tab shows Python's `tokenize` output, including comments, whitespace-related tokens and start/end positions (displayed as one-based columns). Select a table row to inspect the token and highlight its source. Selecting source text finds all tokens whose ranges overlap it. Unfinished input such as `print(` can yield partial tokens and a warning. Tokenization of malformed source is not guaranteed to be stable across Python versions.

The AST tab shows a selectable traversal of the actual `ast.parse()` tree. The compact detail panel reports the selected node's location, useful fields such as its operator or value, and direct children. Select a child to follow it into source and Trace. Open the disclosure for the original text tree or `ast.dump(..., indent=2)`. A valid AST can exist even when compilation rejects a program, such as a top-level `return`.

`compile(source, 'main.py', 'exec', dont_inherit=True, optimize=0)` produces a genuine CPython code object. The Code object tab reads:

- `co_consts`, `co_names`, `co_varnames`, `co_freevars`, and `co_cellvars`;
- argument counts, local-variable count, `co_stacksize`, and `co_flags`;
- `co_name`, `co_filename`, argument counts and the bytecode length from `co_code`;
- nested code objects for functions, comprehensions, and similar constructs.

The Bytecode tab pairs decoded instructions from `dis.get_instructions()` with the raw `co_code` bytes in hexadecimal, including nested code objects. `dis.dis(..., adaptive=False, show_caches=False)` provides the separate human-readable Disassembly tab for nested functions/classes too. Raw bytes include inline caches while the instruction listings hide them, so offsets can have gaps. A runtime exception preserves completed inspection results; a syntax error shows the parsing/compilation error in later stages and no fabricated code object.

Python bytecode is **not native machine code** and is **not WebAssembly**:

```text
Python source → tokens → AST → code object → Python bytecode
                                                   ↓ interpreted by
                                     CPython's Python virtual machine
                                                   ↓ runs as
                                  WebAssembly in the browser engine
```

The reported Python version comes from the running interpreter, not a hard-coded UI label. Instructions and bytecode formats are version-specific.

## Source mapping

PYLAB retains token start/end positions, AST `lineno`/`col_offset`/`end_lineno`/`end_col_offset`, and `dis.Instruction.positions` from compiled CPython code objects. The Python inspector serializes these values with stable AST IDs and distinct IDs for nested code objects. It does not change the AST or pass raw Python objects through `postMessage`. The browser normalizes ranges, caches line relationships for the current run, and uses CodeMirror marks to highlight source. AST and instruction columns are UTF-8 byte offsets; token columns count Python characters; CodeMirror uses UTF-16 offsets. The conversion handles non-ASCII identifiers and strings.

The **Trace** tab gives line-based relationships when a source line is selected. A more precise source region, AST node or instruction uses available ranges to narrow candidates. The AST list, bytecode list and disassembly list can jump back to source; the original text tree, raw bytes and `dis.dis` listing remain in disclosures. Syntax errors still leave partial tokens while later stages show as unavailable. The mapping is not always one-to-one: a statement can generate many instructions, multiple constructs can share a location, and some instructions have missing or only line-level metadata. PYLAB displays missing locations explicitly rather than inventing an exact association. The trace describes compiler metadata, not a step-by-step execution history.

## Inspection snapshots

`pylab-inspection.json` uses schema version `1`. It contains the source from the completed run, the actual Pyodide and Python version identifiers, bounded tokens and AST nodes, code-object records, CPython bytecode text and structured instructions, disassembly, normalized source mappings, and captured stdout/stderr/error. It contains JSON data only; importing it is not supported and downloading it never executes Python. The browser builds the file with `Blob` and an object URL. Copy uses the Clipboard API only when available; downloads require no clipboard permission.

The bytecode and disassembly are **CPython-specific and version-dependent**. Compilation can fold constants or otherwise transform an AST construct, so an AST `BinOp` need not produce a `BINARY_OP`. Missing locations remain `null`; exported mappings are evidence from CPython metadata, not a perfect debugger map. Snapshot export is capped at 5 MB and disabled while the current source differs from the last completed run. Source download always uses the current editor text.

## Isolation and limits

- The runtime iframe has an opaque origin and no same-origin access to the app. Its blob worker inherits a CSP with `connect-src 'none'` and no external script sources.
- Runtime assets are downloaded by the host before execution. The worker's replacement `fetch` only resolves a fixed in-memory asset map; it has no network fallback. CSP independently blocks network through other APIs.
- Pyodide's `jsglobals` is an empty, frozen object. No DOM, fetch, clipboard, camera, microphone, geolocation, or host filesystem APIs are supplied to Python. The public `pyodide_js` bridge is unregistered.
- The page accepts only execution messages over a dedicated MessageChannel. It never evaluates result strings or inserts them as HTML.
- Only one execution can run at once. Programs have a 15-second wall-time limit. Output is limited to 100,000 characters; source to 100,000 characters. Token display stops after 1,500 entries, AST at 500 nodes, nested code inspection at 40 code objects or 12 levels, and structured instructions at 4,000 entries. Inspection text is also bounded and reports omissions where appropriate.
- Browsers do not provide a portable hard memory quota for workers. Extreme allocation can still exhaust a tab before the watchdog can recover it. Pyodide and Python introspection are not, by themselves, a hostile-code sandbox. Keep this deployment on a dedicated origin without sensitive same-origin services, and do not weaken the iframe sandbox or CSP.
- Python's in-memory virtual filesystem exists as part of CPython/Pyodide; this app does not expose or mount the user's real filesystem.

No account, source persistence, analytics, package installation, interactive `input()`, terminal, REPL, or network-enabled Python is implemented. `input()` reaches EOF and reports an error. Most bundled standard-library modules work; modules that need native OS capabilities or separately downloaded packages may not.

## External dependencies

| Dependency | Version / delivery | Purpose |
| --- | --- | --- |
| Pyodide | 0.29.3, pinned jsDelivr asset URLs | CPython compiled to WebAssembly and bundled standard library |
| CodeMirror | 5.65.20, vendored files | Python syntax highlighting, line numbers, editing, bracket matching |
| Browser APIs | Current browser with ES modules, WebAssembly, Worker, MessageChannel | Local execution and isolated messaging |
| Node.js | 22+, optional development tooling only | Static preview, copying files, automated tests |

There are no npm dependencies and no external fonts. See [THIRD_PARTY.md](THIRD_PARTY.md) for upstream licenses and documentation. Initial runtime downloads require internet access. The app does not claim to work offline across reloads.

To self-host runtime assets later, download the five files listed in `runtime/config.js`, keep them on the same pinned version, and point `RUNTIME_BASE` to their absolute URL (or a URL resolved with `import.meta.url`). The parent CSP must allow that asset location. **Do not relax the execution sandbox's CSP.** The asset adapter already supplies the runtime from memory, so no runtime changes are needed.

## Static deployment

All assets and links are relative, including the iframe and runtime helper. The app supports a repository subpath such as `/compiler/`. Navigation uses hashes, so no rewrite rules or server routing are needed.

For a clean deployment folder:

```sh
node scripts/build.mjs
```

Upload the **contents** of `dist/` as the website root. The host must serve `.js` as JavaScript and `.html` as HTML. No environment variables or database are required.

### GitHub Pages

The repository root is already runnable static source. Push it to GitHub, open **Settings → Pages → Deploy from a branch**, select your branch and **/(root)**, and save. `.nojekyll` disables Jekyll processing. Alternatively, publish only `dist/` through a Pages artifact workflow or a dedicated publishing branch. See [GitHub's publishing source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

### Cloudflare Pages

Choose a static/no-framework project. Set the build command to `node scripts/build.mjs` and output directory to `dist`, or directly upload `dist/`. Do not configure Functions. See [Cloudflare's static HTML guide](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

### Netlify

Set build command `node scripts/build.mjs` and publish directory `dist`, or drag the built folder into Netlify's manual deployment flow. See [Netlify's build overview](https://docs.netlify.com/build/frameworks/overview/).

### Vercel

Choose **Other** as the framework preset, use `node scripts/build.mjs` as the build command, and override the output directory to `dist`. No Functions are needed. See [Vercel's build configuration](https://vercel.com/docs/builds/configure-a-build).

`.openai/hosting.json` is optional metadata for the Sites preview; the other hosts do not use it.

## Tests

```sh
node --test tests/unit.test.mjs
node tests/browser-runtime.mjs
```

The second command starts a temporary static file server and an isolated headless Chromium profile, then runs production Pyodide inside the real sandbox/worker. Set `CHROME_PATH` if Chrome/Edge is not at a detected path. Runtime download access is required. The fixture is excluded from `dist/`.

The integration suite covers actual output, no-newline Unicode, stderr, exception types and lines, all inspection stages, nested functions/classes, loops, imports, Unicode identifiers and strings, syntax errors, fresh globals, bridge restrictions, output limits, and terminating/restarting an infinite loop. It also checks real CPython positions, AST fields and child links, interactive token/AST/instruction selection, downloads, snapshot contents, copy fallback, empty states, large inspections, and the mobile layout. Unit tests cover run lifecycle, result validation, range operations, Unicode conversion, token/AST relationships, snapshot schema and size bounds.

For release QA, also check current Firefox and Safari, mobile touch editing, keyboard/screen-reader navigation, slow or blocked runtime downloads, long lines, and 200% text enlargement. Browser rendering and accessibility require their own manual review; automated runtime checks do not establish those properties.

## What to build next

Next, add optional read-only snapshot import with strict schema validation and no automatic execution, then consider a focused side-by-side comparison of two saved inspections. Keep multi-file workspaces, REPL state, packages and additional language runtimes behind separate adapters so the current execution path remains small.
