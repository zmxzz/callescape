# Callscape

Callscape makes code changes easier to follow. It shows functions as a call graph, with their before-and-after code side by side. Arrows show who calls whom, in call order.

There are two ways to use it:

- `callescape review` opens a graph of changes in a Git repository. The graph lives in memory; you don't need to create a JSON file. Python is the supported language today; other languages plug in as analyzers.
- `callscape [folder]` opens Callscape graph JSON files you have saved or written yourself.

## Install

You'll need Node.js 22.18+ or 24+ and npm. Python 3.9+ is needed only for the Python analyzer behind `callescape review`.

Install Callscape and the Codex authoring skill for your user account:

```bash
git clone git@github.com:zmxzz/callescape.git
cd callescape
bash install.sh
```

The installer installs runtime dependencies, adds `callscape` and `callescape` under `~/.local/bin`, and links the Codex skill under `~/.codex/skills/callescape`. From a checkout, the skill link points to the canonical `skills/callescape` directory so edits stay current. The installer respects `CODEX_HOME` and won't overwrite unrelated commands or skills. If your shell can't find the commands, add the bin directory to your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Use `--prefix DIRECTORY` for another app installation location, `--source DIRECTORY` for another local checkout, or `--repo URL` for a published Git repository.

## Review Git changes

Go to the repository you want to inspect and run:

```bash
cd /path/to/project
callescape review
```

This compares the current working tree with `HEAD` and opens the graph in your browser. To compare two commits instead:

```bash
callescape review --base HEAD~1 --head HEAD
```

In review mode, use the comparison dropdown at the top left to switch between uncommitted changes (`HEAD` versus the working tree), the last commit (`HEAD~1` versus `HEAD`), and changes against main (the merge base of `HEAD` and local `main`, or `origin/main`, versus the working tree). A comparison passed with `--base`, `--head`, or CLI file filters initially appears as “Custom comparison.” Switching choices recomputes the graph in memory without restarting the app. The last-commit choice requires a parent commit; the main choice requires a `main` or `origin/main` ref.

The sidebar always shows **Include** and **Exclude** file filters in review mode. Enter comma-separated repository-relative globs, then choose **Apply filters** to rerun the selected comparison. The same patterns carry across comparison choices. For example, Include `src/**/*.py` and Exclude `**/test_*.py`. Blank Include matches all changed files; Exclude wins over Include. `*` and `?` match within one folder, `**` matches across folders, a bare filename matches at any depth, and a trailing `/` includes a folder's contents. Filters run before parsing, so excluded files are not analyzed. The same patterns can be passed to the command as `--include GLOBS --exclude GLOBS`.

You can also pass the repository path, so you don't have to change directories:

```bash
callescape review /path/to/project
```

Review runs every installed language analyzer and merges their graphs. Pass `--lang python` (comma-separated for several) to run only some of them; an unknown language is an error.

The Python analyzer reads Python source but never runs it. It parses only changed Python files and shows functions whose source was modified, added, or removed. Calls are drawn only when both functions are shown; unchanged callers and callees are omitted. Import-only edits that leave function source identical do not produce function nodes. Because Python can choose call targets at runtime, Callscape leaves calls it cannot resolve out of the graph rather than guessing. Renamed functions appear as a removal and an addition. Switch comparisons or restart the command to pick up newer edits.

Nothing is saved to the repository: the review graph stays in memory, and the delete button is disabled in review mode.

## Open saved graphs

If you have Callscape JSON files, point the viewer at their folder:

```bash
callscape /path/to/graphs
```

Or run `callscape` from inside that folder. The app finds JSON files in subfolders, shows them in the sidebar, and reloads when they change. You can delete a selected graph file from the sidebar after confirming. Hidden folders, `node_modules`, `dist`, and root package manifests are skipped; deletion is restricted to JSON files inside the chosen folder.

A small graph looks like this:

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

Each function needs a unique `id` and a nonempty `before` or `after` side. Keep unchanged lines identical on both sides so they stay neutral; removed lines appear red and added lines green. Put each caller's `calls` in call order. See [example.json](example.json) for a fuller example and [the JSON format reference](skills/callescape/references/json-format.md) for all fields and conventions.

## Work on Callscape

From the repository checkout:

```bash
npm install
npm run dev
```

`npm run dev` uses the checkout as its graph folder unless you set `CALLSCAPE_GRAPH_ROOT`. `npm run build` creates a static snapshot in `dist/`; that build does not watch graph files or provide the delete endpoint. For the full folder workflow, use `callscape [folder]`.

Run the JavaScript tests with `npm test` (Vitest) and the Python review tests with `python3 -m unittest discover -s tests -v`. There is no lint script.

### Add a language analyzer

An analyzer is a program that reads a Git repository and prints one JSON object. Register it in `bin/analyzers.mts` with its language name, the command that runs it, and its script path. The CLI runs every registered analyzer with the same arguments and merges the graphs, so each analyzer must ignore files outside its language and must prefix function ids with the file path so ids never collide. The exact arguments and output are in [the JSON contract](skills/callescape/references/json-format.md#analyzer-contract).
