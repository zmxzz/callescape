---
name: callescape
description: Create Callescape JSON graphs from source code changes, showing changed functions, their before/after behavior, and caller-to-callee relationships.
---

# Author Callescape graphs

Read the source and the diff before writing. Include functions whose behavior or calls changed, plus added or removed functions needed to explain the graph. Use real function names and paths; never infer a call from proximity alone.

Write code-shaped, language-neutral pseudocode in execution order. Keep unchanged lines identical on both sides, use `""` for an absent side, and never insert change markers. Start each call tree's root function with the same short source-language comment on both sides.

Order each caller's `calls` by execution; that order sets edge numbers and sibling placement. Label a call `before` or `after` when it exists on one side only. Never put sequence numbers in labels.

Read [the JSON contract](references/json-format.md) before saving or changing a graph, and validate the output as JSON. Unless the user picks another location, save under `~/src/Planning/code-visualization` and return an absolute link. The repository's `install.sh` installs the `callescape` command and this skill.

For an interactive Git diff, run `callescape review` in the target repository. It defaults to `HEAD` vs the working tree, accepts `--base REV --head REV`, `--include` / `--exclude` globs, and `--lang`, and lets you switch comparisons in the app. It keeps real source, omits calls it cannot resolve statically, and saves nothing. The contract lists its limits; do not present the result as a complete call graph.
