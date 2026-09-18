"""Compile, inspect, and execute in CPython. Only JSON crosses back to the UI."""
import ast
import dis
import io
import json
import linecache
import sys
import token
import tokenize
import traceback
import types


def _pylab_make_runner():
    # Capture helpers so user globals cannot accidentally overwrite the runner.
    compile_source, execute, encode = compile, exec, json.dumps
    disassemble, instructions, code_type = dis.dis, dis.get_instructions, types.CodeType
    original_stdout, original_stderr = sys.stdout, sys.stderr
    original_stdin = sys.stdin
    limit = 100_000

    class LimitedText(io.StringIO):
        def write(self, value):
            remaining = limit - self.tell()
            if remaining > 0:
                super().write(value[:remaining])
            return len(value)

    def inspect_tokens(source):
        items = []
        warning = ""
        truncated = False
        try:
            for item in tokenize.generate_tokens(io.StringIO(source).readline):
                if len(items) >= 1500:
                    truncated = True
                    break
                items.append({
                    "type": token.tok_name.get(item.type, "UNKNOWN"),
                    "value": item.string[:1000],
                    "line": item.start[0],
                    "column": item.start[1] + 1,
                })
        except (tokenize.TokenError, IndentationError) as error:
            warning = f"SYNTAX ERROR — tokenization stopped: {error}"
        return items, warning, truncated

    def inspect_ast(root):
        text = LimitedText()
        remaining = 500

        def label(node):
            name = type(node).__name__
            for key in ("name", "id", "attr", "value"):
                if key in ("value",) and not isinstance(node, ast.Constant):
                    continue
                if hasattr(node, key):
                    value = getattr(node, key)
                    if isinstance(value, (str, int, float, complex, bool, type(None))):
                        return f"{name} ({key}={repr(value)[:100]})"
            return name

        def visit(node, prefix="", last=True, root=True):
            nonlocal remaining
            if remaining <= 0:
                return
            remaining -= 1
            text.write(("" if root else prefix + ("└── " if last else "├── ")) + label(node) + "\n")
            children = list(ast.iter_child_nodes(node))
            child_prefix = prefix + ("    " if last else "│   ") if not root else ""
            for index, child in enumerate(children):
                if remaining <= 0:
                    text.write(child_prefix + "└── [Further AST nodes omitted]\n")
                    break
                visit(child, child_prefix, index == len(children) - 1, False)

        visit(root)
        return text.getvalue()

    def describe(root):
        text = LimitedText()
        remaining_objects = 40

        def visit(code, depth=0):
            nonlocal remaining_objects
            if remaining_objects <= 0 or depth > 12:
                text.write("\n[Further nested code objects omitted]\n")
                return
            remaining_objects -= 1
            prefix = "  " * depth
            text.write(f"{prefix}CPYTHON CODE OBJECT: {code.co_name} (line {code.co_firstlineno})\n")
            fields = (
                ("co_name", code.co_name),
                ("co_filename", code.co_filename),
                ("co_argcount", code.co_argcount),
                ("co_posonlyargcount", code.co_posonlyargcount),
                ("co_kwonlyargcount", code.co_kwonlyargcount),
                ("co_nlocals", code.co_nlocals),
                ("co_stacksize", code.co_stacksize),
                ("co_flags", f"0x{code.co_flags:04x}"),
                ("co_names", code.co_names),
                ("co_varnames", code.co_varnames),
                ("co_freevars", code.co_freevars),
                ("co_cellvars", code.co_cellvars),
                ("bytecode length", f"{len(code.co_code)} bytes"),
            )
            for name, value in fields:
                text.write(f"{prefix}{name}: {value!s}\n")
            text.write(f"{prefix}co_consts:\n")
            for index, value in enumerate(code.co_consts):
                rendered = f"<code object {value.co_name}>" if isinstance(value, code_type) else repr(value)
                text.write(f"{prefix}  [{index}] {rendered[:2000]}\n")
            text.write("\n")
            for value in code.co_consts:
                if isinstance(value, code_type):
                    visit(value, depth + 1)
        visit(root)
        return text.getvalue()

    def inspect_bytecode(root):
        text = LimitedText()
        remaining_objects = 40

        def visit(code, depth=0):
            nonlocal remaining_objects
            if remaining_objects <= 0 or depth > 12:
                text.write("[Further nested code objects omitted]\n")
                return
            remaining_objects -= 1
            text.write(f"CODE OBJECT: {code.co_name} (line {code.co_firstlineno})\n")
            text.write(f"Constants: {len(code.co_consts)}  Names: {len(code.co_names)}\n\n")
            text.write(f"{'Offset':<9}{'Opcode':<28}Argument\n")
            for instruction in instructions(code, show_caches=False, adaptive=False):
                argument = "" if instruction.arg is None else str(instruction.arg)
                if instruction.argrepr:
                    argument += f" ({instruction.argrepr[:300]})"
                text.write(f"{instruction.offset:<9}{instruction.opname:<28}{argument}\n")
            raw = code.co_code
            text.write(f"\nBytecode bytes ({len(raw)} bytes, hexadecimal):\n")
            for offset in range(0, min(len(raw), 16000), 16):
                text.write(f"  {offset:04x}  {raw[offset:offset+16].hex(' ')}\n")
            if len(raw) > 16000:
                text.write("  [Further bytes omitted]\n")
            text.write("\n")
            for value in code.co_consts:
                if isinstance(value, code_type):
                    visit(value, depth + 1)

        visit(root)
        return text.getvalue()

    def run(source):
        result = {
            "tokens": [], "tokenError": "", "tokensTruncated": False,
            "astTree": "", "astDump": "", "astError": "", "compileError": "",
            "codeObject": "", "bytecode": "", "disassembly": "",
            "error": "", "errorLine": 0,
        }
        # Restore standard streams and built-in module registrations between runs.
        sys.stdout, sys.stderr, sys.stdin = original_stdout, original_stderr, original_stdin
        linecache.cache['main.py'] = (len(source), None, source.splitlines(True), 'main.py')
        try:
            result['tokens'], result['tokenError'], result['tokensTruncated'] = inspect_tokens(source)
            try:
                tree = ast.parse(source, filename='main.py', mode='exec', type_comments=True)
            except SyntaxError as error:
                result['astError'] = f"SYNTAX ERROR\n{error.__class__.__name__}: {error.msg} (line {error.lineno or '?'})"
                result['compileError'] = result['astError'] + "\nNo code object or bytecode was produced."
                raise
            result['astTree'] = inspect_ast(tree)
            result['astDump'] = ast.dump(tree, indent=2)[:limit]
            code = compile_source(source, 'main.py', 'exec', dont_inherit=True, optimize=0)
            result['codeObject'] = describe(code)
            result['bytecode'] = inspect_bytecode(code)
            listing = LimitedText()
            disassemble(code, file=listing, depth=12, show_caches=False, adaptive=False)
            result['disassembly'] = listing.getvalue()
            namespace = {'__name__': '__main__', '__file__': 'main.py', '__builtins__': __builtins__}
            execute(code, namespace, namespace)
        except BaseException as error:
            if isinstance(error, SyntaxError) and not result['compileError']:
                result['compileError'] = f"SYNTAX ERROR\n{error.__class__.__name__}: {error.msg} (line {error.lineno or '?'})\nNo code object or bytecode was produced."
            # The wrapper's exec frame is an implementation detail, not user code.
            trace = error.__traceback__
            if trace is not None:
                trace = trace.tb_next
            result['error'] = ''.join(traceback.format_exception(type(error), error, trace))[:limit]
            if isinstance(error, SyntaxError):
                result['errorLine'] = error.lineno or 0
            else:
                cursor = trace
                while cursor is not None:
                    if cursor.tb_frame.f_code.co_filename == 'main.py':
                        result['errorLine'] = cursor.tb_lineno
                    cursor = cursor.tb_next
        finally:
            sys.stdout, sys.stderr, sys.stdin = original_stdout, original_stderr, original_stdin
            original_stdout.flush()
            original_stderr.flush()
        return encode(result)

    return run


_pylab_run = _pylab_make_runner()
