#!/usr/bin/env python3
"""Generate a conservative Callescape graph from two Git revisions of Python code."""

import argparse
import ast
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import subprocess
import sys


def git(root, *args):
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, check=False
    )
    if result.returncode:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(message or f"git {args[0]} failed")
    return result.stdout


def python_paths(root, revision):
    if revision == "worktree":
        raw = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    else:
        raw = git(root, "ls-tree", "-r", "-z", "--name-only", revision)
    return {path.decode("utf-8", errors="surrogateescape") for path in raw.split(b"\0")
            if path.endswith(b".py")}


def path_glob(pattern):
    """Compile a small, repository-relative glob (*, ?, and ** path segments)."""
    if pattern.endswith("/"):
        pattern += "**"
    parts = pattern.split("/")
    expression = ""
    for index, part in enumerate(parts):
        if part == "**":
            expression += ".*" if index == len(parts) - 1 else "(?:[^/]+/)*"
            continue
        for char in part:
            expression += "[^/]*" if char == "*" else "[^/]" if char == "?" else re.escape(char)
        if index < len(parts) - 1:
            expression += "/"
    if "/" not in pattern:
        expression = "(?:.*/)?" + expression
    return re.compile(f"^{expression}$")


def glob_patterns(value):
    patterns = [part.strip() for part in value.split(",") if part.strip()]
    if len(patterns) > 32 or any(len(pattern) > 256 for pattern in patterns):
        raise ValueError("Too many or overly long file patterns")
    return [path_glob(pattern) for pattern in patterns]


def changed_python_paths(root, base, head, include="", exclude=""):
    arguments = ["diff", "--name-only", "-z", "--no-renames", base]
    if head != "worktree":
        arguments.append(head)
    raw = git(root, *arguments, "--", "*.py")
    changed = {path.decode("utf-8", errors="surrogateescape") for path in raw.split(b"\0") if path}
    if head == "worktree":
        untracked = git(root, "ls-files", "-z", "--others", "--exclude-standard", "--", "*.py")
        changed.update(path.decode("utf-8", errors="surrogateescape")
                       for path in untracked.split(b"\0") if path)
    included = glob_patterns(include)
    excluded = glob_patterns(exclude)
    changed = {path for path in changed
               if (not included or any(pattern.fullmatch(path) for pattern in included))
               and not any(pattern.fullmatch(path) for pattern in excluded)}
    return changed


def read_source(root, revision, relative_path):
    if revision == "worktree":
        path = (root / relative_path).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            return None
        return path.read_bytes().decode("utf-8-sig")
    return git(root, "show", f"{revision}:{relative_path}").decode("utf-8-sig")


def module_name(path):
    parts = list(Path(path).with_suffix("").parts)
    if parts[0] == "src":
        parts.pop(0)
    if len(parts) > 1 and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


@dataclass
class Function:
    id: str
    name: str
    file: str
    source: str
    module: str
    qualname: str
    calls: list
    shadows: set


class DefinitionVisitor(ast.NodeVisitor):
    def __init__(self, path, source, module):
        self.path = path
        self.source = source
        self.lines = source.splitlines()
        self.module = module
        self.scope = []
        self.functions = {}

    def visit_ClassDef(self, node):
        self.scope.append((node.name, "class"))
        for child in node.body:
            self.visit(child)
        self.scope.pop()

    def visit_FunctionDef(self, node):
        self.add_function(node)

    def visit_AsyncFunctionDef(self, node):
        self.add_function(node)

    def add_function(self, node):
        qualname = ".".join([name for name, _ in self.scope] + [node.name])
        identifier = f"{self.path}:{qualname}"
        start = min([node.lineno] + [item.lineno for item in node.decorator_list])
        snippet = "\n".join(self.lines[start - 1:node.end_lineno]).rstrip()
        collector = CallVisitor()
        for child in node.body:
            collector.visit(child)
        shadows = {argument.arg for argument in node.args.posonlyargs + node.args.args
                   + node.args.kwonlyargs}
        if node.args.vararg:
            shadows.add(node.args.vararg.arg)
        if node.args.kwarg:
            shadows.add(node.args.kwarg.arg)
        shadows.update(collector.shadows)
        self.functions[identifier] = Function(
            identifier, f"{qualname}({ast.unparse(node.args)})",
            self.path, snippet, self.module, qualname, collector.calls, shadows
        )
        self.scope.append((node.name, "function"))
        for child in node.body:
            self.visit(child)
        self.scope.pop()


class CallVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls = []
        self.shadows = set()

    def visit_FunctionDef(self, node):
        self.shadows.add(node.name)

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef

    def visit_Name(self, node):
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.shadows.add(node.id)

    def visit_Call(self, node):
        # Child calls complete before the enclosing call (f(g()) calls g first).
        self.generic_visit(node)
        self.calls.append(node.func)


def imports_for(tree, module, is_package):
    aliases = {}
    package = module if is_package else module.rpartition(".")[0]
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound = alias.asname or alias.name.split(".")[0]
                aliases[bound] = alias.name if alias.asname else bound
        elif isinstance(node, ast.ImportFrom) and node.module != "__future__":
            prefix = package.split(".") if package else []
            if node.level:
                prefix = prefix[:max(0, len(prefix) - node.level + 1)]
            else:
                prefix = []
            target_module = ".".join(prefix + ([node.module] if node.module else []))
            for alias in node.names:
                if alias.name != "*":
                    aliases[alias.asname or alias.name] = f"{target_module}.{alias.name}"
    return aliases


def dotted_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        left = dotted_name(node.value)
        return f"{left}.{node.attr}" if left else None
    return None


def resolve_call(func, expression, indexes, imports):
    name = dotted_name(expression)
    if not name:
        return None
    parts = name.split(".")
    module_functions = indexes["by_module"].get(func.module, {})
    if len(parts) == 1:
        nested = f"{func.qualname}.{name}"
        if nested in module_functions:
            return module_functions[nested]
        if name in func.shadows:
            return None
        if name in module_functions:
            return module_functions[name]
    elif parts[0] in {"self", "cls"} and "." in func.qualname:
        class_name = func.qualname.rpartition(".")[0]
        target = f"{class_name}.{'.'.join(parts[1:])}"
        if target in module_functions:
            return module_functions[target]
    if parts[0] in func.shadows:
        return None
    if name in module_functions:
        return module_functions[name]
    alias = imports.get(func.module, {}).get(parts[0])
    if not alias:
        return None
    name = ".".join([alias] + parts[1:])
    parts = name.split(".")
    for split in range(len(parts) - 1, 0, -1):
        module = ".".join(parts[:split])
        definitions = indexes["by_module"].get(module, {})
        target = definitions.get(".".join(parts[split:]))
        if target:
            return target
    return None


class Snapshot:
    def __init__(self, root, revision):
        self.root = root
        self.revision = revision
        self.paths = python_paths(root, revision)
        self.loaded = set()
        self.functions = {}
        self.imports = {}

    def load(self, paths, strict=False):
        for path in sorted((paths & self.paths) - self.loaded):
            self.loaded.add(path)
            try:
                source = read_source(self.root, self.revision, path)
                if source is None:
                    continue
                tree = ast.parse(source, filename=path)
            except (SyntaxError, UnicodeError, OSError) as error:
                if strict:
                    raise ValueError(f"Cannot parse {path} at {self.revision}: {error}") from error
                print(f"Skipping dependency {path} at {self.revision}: {error}", file=sys.stderr)
                continue
            module = module_name(path)
            if module in self.imports:
                print(f"Skipping ambiguous module {module} in {path}", file=sys.stderr)
                continue
            self.imports[module] = imports_for(tree, module, path.endswith("/__init__.py"))
            visitor = DefinitionVisitor(path, source, module)
            visitor.visit(tree)
            self.functions.update(visitor.functions)

    def edges(self):
        by_module = {}
        for func in self.functions.values():
            by_module.setdefault(func.module, {})[func.qualname] = func.id
        indexes = {"by_module": by_module}
        return {
            func.id: [target for expression in func.calls
                      if (target := resolve_call(func, expression, indexes, self.imports))]
            for func in self.functions.values()
        }


def merge_calls(before, after):
    matcher = SequenceMatcher(a=before, b=after, autojunk=False)
    merged = []
    for operation, a_start, a_end, b_start, b_end in matcher.get_opcodes():
        if operation in {"equal", "delete", "replace"}:
            merged.extend((target, "" if operation == "equal" else "before")
                          for target in before[a_start:a_end])
        if operation in {"insert", "replace"}:
            merged.extend((target, "after") for target in after[b_start:b_end])
    return merged


def generate(root, base, head, include="", exclude=""):
    changed_paths = changed_python_paths(root, base, head, include, exclude)
    if not changed_paths:
        return {"title": f"Python changes: {base} → {head}", "functions": [], "calls": []}

    print(f"Reviewing {len(changed_paths)} changed Python file(s)", file=sys.stderr)
    before_snapshot = Snapshot(root, base)
    after_snapshot = Snapshot(root, head)
    before_snapshot.load(changed_paths, strict=True)
    after_snapshot.load(changed_paths, strict=True)
    before = before_snapshot.functions
    after = after_snapshot.functions
    changed_ids = {identifier for identifier in set(before) | set(after)
                   if identifier not in before or identifier not in after
                   or before[identifier].source != after[identifier].source}

    if not changed_ids:
        return {"title": f"Python changes: {base} → {head}", "functions": [], "calls": []}

    before_edges = before_snapshot.edges()
    after_edges = after_snapshot.edges()
    functions = []
    for identifier in sorted(changed_ids):
        old = before.get(identifier)
        new = after.get(identifier)
        current = new or old
        functions.append({"id": identifier, "name": current.name, "file": current.file,
                          "before": old.source if old else "",
                          "after": new.source if new else ""})
    calls = []
    for caller in sorted(changed_ids):
        for callee, label in merge_calls(before_edges.get(caller, []), after_edges.get(caller, [])):
            if callee in changed_ids:
                calls.append({"from": caller, "to": callee, "label": label})
    return {"title": f"Python changes: {base} → {head}", "functions": functions,
            "calls": calls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", nargs="?", default=".", help="Git repository (default: current directory)")
    parser.add_argument("--base", default="HEAD", help="Base Git revision (default: HEAD)")
    parser.add_argument("--head", default="worktree", help="Head Git revision or worktree")
    parser.add_argument("--include", default="", help="Comma-separated changed-file globs to include")
    parser.add_argument("--exclude", default="", help="Comma-separated changed-file globs to exclude")
    args = parser.parse_args()
    if sys.version_info < (3, 9):
        parser.exit(1, "callescape review: Python 3.9 or newer is required\n")
    try:
        root = Path(git(Path(args.repo).resolve(), "rev-parse", "--show-toplevel")
                    .decode().rstrip("\n")).resolve()
        graph = generate(root, args.base, args.head, args.include, args.exclude)
        print(json.dumps({"repository": str(root), "graph": graph}, ensure_ascii=False))
    except (ValueError, OSError) as error:
        parser.exit(1, f"callescape review: {error}\n")


if __name__ == "__main__":
    main()
