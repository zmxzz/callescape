# Callscape maintenance

- Work through the remaining files in `tasks/` in numerical order. When a task is complete, remove its task file and row from `tasks/README.md` in that task's commit.
- Keep `callscape [folder]` as the primary runtime. It starts Vite programmatically so arbitrary-folder discovery, watching, and guarded deletion work.
- Keep Vite and `@vitejs/plugin-react` in runtime dependencies. `install.sh` installs the app with `npm ci --omit=dev` and also links the Codex skill; keep it usable from both a local checkout and a published Git repository.
- Treat `virtual:graph-files` in `vite.config.ts` as the filesystem boundary. Browser code consumes its snapshot; it must not scan arbitrary local folders itself.
- Keep graph parsing and exact-line diffing in `src/graph.ts`, Dagre sizing/layout in `src/layout.ts`, and UI behavior in `src/App.tsx` and `src/styles.css` unless a split materially improves maintenance.
- Preserve the delete endpoint's root containment and path-segment checks and the UI confirmation dialog.
- The canonical authoring skill is in `skills/callescape/`. Keep its `SKILL.md` and `references/json-format.md` synchronized whenever schema, rendering, commands, discovery, deletion, or workflow changes. The local Codex skill installation should point to that directory.
- Use repository commands for verification. Run `npm run build` when source or embedded graphs change. `dist/` is generated and ignored by Git.
- Do not run linting until the user has functionally tested the app and explicitly asks for linting.
