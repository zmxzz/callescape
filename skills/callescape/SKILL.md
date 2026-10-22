---
name: callescape
description: Create Callescape JSON graphs from source code changes, showing changed functions, their before/after behavior, and caller-to-callee relationships.
---

# Author Callescape graphs

Inspect the relevant source and diff before writing the graph. Include functions whose behavior or call relationships changed, plus added or removed functions needed to explain the call graph. Use actual function names and source paths where evidence permits. Do not invent calls from proximity alone.

Write code-shaped, language-neutral pseudocode in execution order. Keep unchanged lines exactly the same on both sides so Callescape renders them neutral. Use empty strings for absent sides; do not insert change markers. For each independent graph tree, begin the root function's populated sides with the same short source-language comment.

Order each caller's `calls` entries by execution. That order determines both edge numbers and sibling placement in the graph. Use `before` and `after` labels when a call exists on only one side. Do not put sequence numbers in labels; Callescape derives those from array order.

Read [the JSON contract](references/json-format.md) before saving or changing a graph. Validate the output as JSON and, when the project is available, with Callescape's parser. The repository's `install.sh` installs the Callescape commands and this Codex skill from a local checkout or published Git repository. Unless the user chooses a different destination, save under `~/src/Planning/code-visualization`. Return an absolute link to the saved graph.

For an interactive Git diff, use `callescape review` from the target repository. It runs every installed language analyzer (Python today) and merges their graphs; `--lang LANGS` narrows it. It compares `HEAD` with the working tree by default, accepts `--base REV --head REV` for committed revisions, and accepts an optional repository path. The top-left dropdown switches among uncommitted changes, the last commit, and working-tree changes against the merge base with `main` (or `origin/main`); switching recomputes the in-memory graph. Include and Exclude boxes stay visible for every review comparison and accept comma-separated file globs. Apply filters reruns the selected comparison; the patterns carry across choices and are applied before parsing. The command also accepts `--include GLOBS --exclude GLOBS`. Each analyzer parses only selected changed files in its language and shows only functions whose source changed, plus calls between those functions. Unchanged callers and callees, including functions affected only by import edits, are omitted. No JSON file is saved or deleted. It preserves actual source rather than generating pseudocode and omits calls it cannot resolve statically. See the limitations in the JSON contract; do not present it as a complete call graph.
