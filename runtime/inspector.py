"""Compile, inspect, and execute in CPython. Only JSON crosses back to the UI."""
import dis
import io
import json
import linecache
import sys
import traceback
import types


def _pylab_make_runner():
    # Capture helpers so user globals cannot accidentally overwrite the runner.
    compile_source, execute, encode = compile, exec, json.dumps
    disassemble, code_type = dis.dis, types.CodeType
    original_stdout, original_stderr = sys.stdout, sys.stderr
    original_stdin = sys.stdin
    limit = 100_000

    class LimitedText(io.StringIO):
        def write(self, value):
            remaining = limit - self.tell()
            if remaining > 0:
                super().write(value[:remaining])
            return len(value)

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
            text.write(f"{prefix}CODE OBJECT: {code.co_name} (line {code.co_firstlineno})\n")
            fields = (
                ("Arguments", code.co_argcount),
                ("Positional-only arguments", code.co_posonlyargcount),
                ("Keyword-only arguments", code.co_kwonlyargcount),
                ("Local variables", code.co_nlocals),
                ("Stack size", code.co_stacksize),
                ("Flags", f"0x{code.co_flags:04x}"),
                ("Names", code.co_names),
                ("Variable names", code.co_varnames),
                ("Free variables", code.co_freevars),
                ("Cell variables", code.co_cellvars),
            )
            for name, value in fields:
                text.write(f"{prefix}{name}: {value!s}\n")
            text.write(f"{prefix}Constants:\n")
            for index, value in enumerate(code.co_consts):
                rendered = f"<code object {value.co_name}>" if isinstance(value, code_type) else repr(value)
                text.write(f"{prefix}  [{index}] {rendered[:2000]}\n")
            text.write(f"{prefix}Bytecode bytes ({len(code.co_code)} bytes):\n")
            raw = code.co_code
            for offset in range(0, min(len(raw), 16000), 16):
                text.write(f"{prefix}  {offset:04x}  {raw[offset:offset+16].hex(' ')}\n")
            if len(raw) > 16000:
                text.write(f"{prefix}  [Further bytes omitted]\n")
            text.write("\n")
            for value in code.co_consts:
                if isinstance(value, code_type):
                    visit(value, depth + 1)
        visit(root)
        return text.getvalue()

    def run(source):
        result = {"bytecode": "", "disassembly": "", "error": "", "errorLine": 0}
        # Restore standard streams and built-in module registrations between runs.
        sys.stdout, sys.stderr, sys.stdin = original_stdout, original_stderr, original_stdin
        linecache.cache['main.py'] = (len(source), None, source.splitlines(True), 'main.py')
        try:
            code = compile_source(source, 'main.py', 'exec', dont_inherit=True, optimize=0)
            result['bytecode'] = describe(code)
            listing = LimitedText()
            disassemble(code, file=listing, depth=12, show_caches=False, adaptive=False)
            result['disassembly'] = listing.getvalue()
            namespace = {'__name__': '__main__', '__file__': 'main.py', '__builtins__': __builtins__}
            execute(code, namespace, namespace)
        except BaseException as error:
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
