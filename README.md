# Callescape

Callescape shows a code change as a call graph. Each changed function is a card with its before and after source side by side, and arrows show who calls whom, in call order.

Two ways to use it:

- `callescape review` builds the graph from a Git diff and keeps it in memory. Python is supported today; other languages plug in as analyzers.
- `callescape [folder]` opens graph JSON files you saved or wrote yourself.

## Install

Requires Node.js 22.18+ or 24+ and npm. Python 3.9+ is needed only for the Python analyzer.

```bash
git clone git@github.com:zmxzz/callescape.git
cd callescape
bash install.sh
```

The installer puts `callescape` in `~/.local/bin` (with `callscape` as an alias for the older spelling) and links the Codex skill at `~/.codex/skills/callescape`. It respects `CODEX_HOME` and never overwrites commands or skills it did not create. If the command is not found, add the bin directory to your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Options: `--prefix DIR` installs elsewhere, `--source DIR` installs from another checkout, `--repo URL` installs from a published repository.

## Review Git changes

```bash
cd /path/to/project
callescape review                          # working tree vs HEAD
callescape review --base HEAD~1 --head HEAD
callescape review /path/to/project         # without cd
```

The graph opens in your browser. The **Compare** dropdown switches between:

- **Uncommitted changes**: `HEAD` vs the working tree.
- **Last commit**: `HEAD~1` vs `HEAD`. Needs a parent commit.
- **Changes against main**: merge base of `HEAD` and `main` (or `origin/main`) vs the working tree. Needs that ref.
- **Custom comparison**: whatever `--base`, `--head`, or filters you passed on the command line.

Switching recomputes the graph in memory. Rerun the comparison to pick up newer edits.

**Include** and **Exclude** take comma-separated, repository-relative globs and apply to every comparison. Blank Include means all files; Exclude wins. `*` and `?` match within one folder, `**` matches across folders, a bare filename matches at any depth, and a trailing `/` includes a folder's contents. Excluded files are never parsed. The same patterns can be passed as `--include GLOBS --exclude GLOBS`.

Review runs every registered language analyzer and merges their graphs. `--lang python` (comma-separated for several) runs only those; an unknown language is an error.

The Python analyzer parses source with `ast` and never runs it. It shows only functions whose source changed, and draws a call only when both ends are shown. Calls it cannot resolve statically are left out rather than guessed. Renames appear as a removal plus an addition. Nothing is written to the repository, and the delete button is disabled in review mode.

## Open saved graphs

```bash
callescape /path/to/graphs
```

Or run `callescape` inside the folder. It finds JSON files in subfolders, lists them in the sidebar, and reloads when they change. Hidden folders, `node_modules`, `dist`, and root package manifests are skipped. Deleting a file from the sidebar asks for confirmation and only works on JSON files inside the chosen folder.

A small graph:

```json
{
  "title": "Move payment out of checkout",
  "functions": [
    {
      "id": "checkout",
      "name": "checkout(cart)",
      "file": "src/checkout.py",
      "before": "return charge_card(cart)",
      "after": "return process_payment(cart)"
    },
    {
      "id": "payment",
      "name": "process_payment(cart)",
      "file": "src/payment.py",
      "before": "",
      "after": "return gateway.charge(cart.total)"
    }
  ],
  "calls": [
    { "from": "checkout", "to": "payment", "label": "after" }
  ]
}
```

Each function needs a unique `id` and a nonempty `before` or `after`. Keep unchanged lines identical on both sides so they render neutral. List each caller's `calls` in call order. See [example.json](example.json) and [the JSON contract](skills/callescape/references/json-format.md).

## Work on Callescape

```bash
npm install
npm run dev                                    # graph folder = checkout, or $CALLSCAPE_GRAPH_ROOT
npm test                                       # Vitest
python3 -m unittest discover -s tests -v       # Python analyzer tests
npm run build                                  # static snapshot in dist/, no watching or delete endpoint
```

There is no lint script.

### Add a language analyzer

Register the language, command, and script path in `bin/analyzers.mts`. The CLI runs every analyzer with the same arguments and merges the results, so an analyzer must ignore other languages and prefix function ids with the file path. The exact arguments and output are in [the analyzer contract](skills/callescape/references/json-format.md#analyzer-contract).
