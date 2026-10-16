# Callscape JSON contract

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

Every call endpoint must refer to a function in its `functions` array.

## Fields

- `title`: optional string; defaults to `Untitled call graph`.
- `functions`: required array. Each entry needs a unique non-empty string `id` and at least one non-empty `before` or `after` behavior string. Optional `name` defaults to `id`; optional `file` defaults to an empty string.
- `calls`: optional array. Each `from` and `to` is a function ID in `functions`; optional `label` is a compact string such as `before`, `after`, or a condition. Parallel calls are allowed.

Function status follows populated sides: different populated sides mean modified, identical populated sides mean unchanged, only `after` means added, and only `before` means removed. Calls from a caller must appear in execution order. Callscape uses that order for edge numbers and sibling placement (left to right in vertical layout, top to bottom in horizontal layout). Labels must not contain the UI's sequence number. For modified and unchanged functions, hovering a line highlights its counterpart on the other side: the identical line, or for an edited line, the most similar line in its run of changes. That whole run is marked too, so a replaced line with no similar counterpart still shows what replaced it. Hovering a call edge highlights, in the caller, every line that mentions the callee's bare name as a whole identifier (the `name` up to its parameter list, after any qualifier such as `self.`), so a callee `name` should start with the identifier the caller's pseudocode actually uses.

## Pseudocode and diff

Each behavior side is a multiline string with `\n` separators in JSON. Prefer statements that resemble code, preserve indentation, and include enough unchanged surrounding behavior to explain small edits. Keep common lines textually identical and in the same order. The viewer uses an exact-line longest-common-subsequence diff: common lines stay neutral, deleted lines are red, and added lines are green. A moved line may appear as deletion and addition.

Use `""` for an absent side. Do not write separator or change-marker lines. The viewer accepts legacy arrays as newline-separated text and removes lines whose trimmed text is exactly `====================`.

For each separate call tree, start the root function's populated sides with the same short source-language comment, such as `// TypeScript`.

## Files and workflow

Save a UTF-8 `.json` file beneath the chosen graph folder. Callscape recursively discovers JSON files except hidden paths, `node_modules`, `dist`, and root package manifests. The primary command is `callscape [folder]`; it opens the browser and reloads when files change. If the command is unavailable, run `bash install.sh` from a local checkout or use the published-repository form documented in `README.md`. The installer also links this Codex skill. Its in-app delete action removes only a selected JSON file after confirmation. A static `npm run build` embeds the current files as a snapshot and cannot provide the live delete endpoint.

Unless the user requests another location, use `~/src/Planning/code-visualization` for generated graphs and return an absolute file link.

## Python Git diff review

`callescape review` analyzes Python code at `HEAD` and the working tree, then opens the graph in memory. Pass an optional repository directory and `--base REV --head REV` to compare commits. The top-left dropdown can recompute the graph for uncommitted changes (`HEAD` to working tree), the last commit (`HEAD~1` to `HEAD`), or changes against main (merge base of `HEAD` and local `main`, or `origin/main`, to working tree). The latter choices require the corresponding Git history or ref; command-line revision or file filters appear as a custom initial choice. Include and Exclude boxes remain visible for every comparison and accept comma-separated repository-relative globs. Apply filters reruns the current comparison before parsing, and the patterns carry across choices. Blank Include matches all; Exclude takes precedence. `*` and `?` match within a folder, `**` across folders, bare filenames at any depth, and trailing `/` includes folder contents. CLI `--include GLOBS --exclude GLOBS` uses the same filters. Python 3.9+ is required for review, but not for viewing saved graphs. The generator uses `ast` and never executes the analyzed code. It parses only selected changed Python files and includes only functions whose source was modified, added, or removed. Calls are included only between those functions; unchanged callers and callees are omitted. Import-only edits that leave function source identical produce no function node. Local functions, straightforward imports, and same-class `self`/`cls` calls can be resolved when both endpoints are shown; dynamic calls and indirect aliases may be omitted. Matching is by path and qualified name, so renames appear as removal/addition. No JSON file is written, and review mode has no delete action. Switch comparisons or restart the command to analyze newer edits. Inspect the graph for omissions before treating it as a complete call graph.
