# Callescape JSON contract

```json
{
  "title": "Checkout payment extraction",
  "functions": [
    {
      "id": "checkout",
      "name": "checkout(cart)",
      "file": "src/checkout.ts",
      "before": "// TypeScript\nvalidateCart(cart)\nreturn saveOrder(cart)",
      "after": "// TypeScript\nvalidateCart(cart)\nreceipt = processPayment(cart)\nreturn saveOrder(cart, receipt)"
    },
    {
      "id": "payment",
      "name": "processPayment(cart)",
      "file": "src/payment.ts",
      "before": "",
      "after": "return gateway.charge(cart.total)"
    }
  ],
  "calls": [
    { "from": "checkout", "to": "payment", "label": "after" }
  ]
}
```

## Fields

- `title`: optional; defaults to `Untitled call graph`.
- `functions`: required. Each entry needs a unique non-empty `id` and at least one non-empty `before` or `after`. `name` defaults to `id`; `file` defaults to `""`.
- `calls`: optional. `from` and `to` must be ids in `functions`. `label` is a short string such as `before`, `after`, or a condition. Parallel calls are allowed.

## How the viewer reads it

- Status comes from which sides are populated: both and different means modified, both and identical means unchanged, only `after` means added, only `before` means removed.
- A caller's `calls` must be in execution order. That order gives edge numbers and sibling placement. Do not put the number in `label`.
- Hovering a line highlights its counterpart on the other side: the identical line, or the most similar line in the same run of changes, with the whole run marked.
- Hovering a call edge highlights every caller line that mentions the callee's bare name as a whole identifier (the `name` up to `(`, after any `self.` style qualifier). Start a callee's `name` with the identifier the caller actually uses.

## Pseudocode and diff

Each side is one string with `\n` line breaks. Write code-shaped statements, keep indentation, and include enough unchanged context to explain a small edit. Keep common lines textually identical and in the same order: the viewer runs an exact-line longest-common-subsequence diff, so common lines stay neutral, deleted lines are red, and added lines are green. A moved line shows as a deletion plus an addition.

Use `""` for an absent side. Never write separator or change-marker lines. Legacy arrays are joined with newlines, and lines whose trimmed text is `====================` are dropped.

For each separate call tree, start the root function's populated sides with the same short source-language comment, such as `// TypeScript`.

## Files and workflow

Save a UTF-8 `.json` file under the chosen graph folder. `callescape [folder]` discovers JSON files recursively, skipping hidden paths, `node_modules`, `dist`, and root package manifests, and reloads when they change. Its delete action removes only the selected file after confirmation. If the command is missing, run `bash install.sh` from a checkout; see `README.md` for the published-repository form. `npm run build` embeds a static snapshot with no watching or delete endpoint.

Unless the user asks for another location, save generated graphs under `~/src/Planning/code-visualization` and return an absolute file link.

## Git diff review

`callescape review [repo] [--base REV] [--head REV|worktree] [--include GLOBS] [--exclude GLOBS] [--lang LANGS]` runs the registered language analyzers against a Git diff, merges their graphs, and opens the result in memory. Nothing is written and there is no delete action. The in-app dropdown switches between uncommitted changes, the last commit, and changes against main; the Include and Exclude boxes take comma-separated repository-relative globs and apply before parsing. `README.md` describes the options in full.

### Analyzer contract

Analyzers are registered in `bin/analyzers.mts` as a language name, a command, and a script path. The CLI runs each one as

```
COMMAND SCRIPT [repo] --base REV --head REV|worktree --include GLOBS --exclude GLOBS
```

with the same arguments for every analyzer, and reads one JSON object from stdout: `{"repository": ABSOLUTE_ROOT, "graph": GRAPH}` where `GRAPH` follows this contract. An analyzer must:

- consider only files in its language and return an empty `functions` array when none changed;
- prefix every function `id` with the repository-relative path so ids never collide across analyzers;
- exit nonzero with a message on stderr on error. Other stderr output is passed through.

The CLI validates each graph, rejects duplicate ids across analyzers, concatenates functions and calls, and joins the titles of the non-empty graphs.

### Python analyzer

Requires Python 3.9+. It parses changed files with `ast` and never executes them. Expect these limits:

- Only functions whose source changed appear, and calls only between those functions. Import-only edits produce no node.
- Local functions, straightforward imports, and same-class `self`/`cls` calls resolve; dynamic calls and indirect aliases are omitted rather than guessed.
- Matching is by path and qualified name, so a rename is a removal plus an addition.

Treat the result as a conservative view, not a complete call graph.
