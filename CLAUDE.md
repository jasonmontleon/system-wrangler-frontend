# System Wrangler — Frontend

React/TypeScript SPA for System Wrangler. Builds to static `dist/` which the Go
backend (sibling repo `system-wrangler-backend`) embeds and serves. **There is no
Node runtime in production.** The dev server proxies `/api/*` to
`localhost:8080`.

Stack: React 19, TypeScript (strict), Vite, **PatternFly v6**.

## License (Apache-2.0)

- Every new source file (`.ts`, `.tsx`, `.js`) MUST begin with this header, on
  its own line, followed by a blank line:
  ```ts
  // SPDX-License-Identifier: Apache-2.0
  ```
- Do not add dependencies under licenses that conflict with Apache-2.0
  redistribution (e.g. GPL/AGPL/LGPL).

## First-time setup

```sh
npm install                              # install dev dependencies
git config core.hooksPath .githooks      # enables pre-commit + commit-msg hooks
```

The `.claude/settings.json` PostToolUse hook auto-adds the SPDX header to new
source files written by Claude Code; no setup required.

## Commits

- **Sign every commit with DCO**: `git commit -s`. No exceptions.
- Don't commit if any quality gate below fails. Fix the root cause; never
  bypass.
- Don't commit `node_modules`, `dist`, or `.env*`.
- Don't push to remotes unless explicitly asked.

## Quality gates (must pass before any commit)

```sh
npm run build              # includes tsc -b — type errors fail here
npm run lint               # once configured
npm test -- --run          # vitest, non-watch
gitleaks protect --staged --redact --verbose    # secret scan on staged changes
```

## Tests & coverage

- Add tests for every new component, hook, or utility.
- Stack: **Vitest + React Testing Library + jsdom**. Do not introduce Jest.
- Test behavior, not implementation. Query by accessible role/label; reserve
  test IDs for cases where there's genuinely no semantic anchor.
- Target **90% line coverage minimum** on any module you touch:
  ```sh
  npm test -- --coverage --run
  ```

## Code style

- TypeScript `strict` is on. No `any` — prefer `unknown` and narrow. If `any`
  is unavoidable, comment WHY.
- Use PatternFly components for UI. **Do not introduce a second component
  library** (MUI, Chakra, shadcn, etc.) — visual consistency matters more than
  per-feature ergonomics.
- Don't restyle PatternFly heavily; if a design doesn't fit a component, raise
  it before adding override CSS.
- State: local `useState`/`useReducer` first. Reach for context or a store
  only when prop-drilling is genuinely painful.
- Routing: not added yet. When needed, use `react-router` data routers.
- Comments: only when WHY is non-obvious.

## Project layout

- `src/main.tsx` — entry; imports PatternFly base CSS.
- `src/App.tsx` — root component (Page + Masthead + Sidebar shell).
- `src/api/` — fetch wrappers and types for backend endpoints.
- `src/pages/` — route-level views (when routing lands).
- `src/components/` — reusable presentational components.

## PatternFly upgrades

- Pin to a major version. Component renames between majors are routine
  (`Masthead*`, `PageSidebar*`). Read the migration guide before bumping.
- Don't run `npm audit fix --force` — it can cross a major version boundary
  silently.

## Don't, without discussion

- Add a frontend server (Express, Next.js). The deployment contract is
  "static assets embedded in the Go binary."
- Add CSS-in-JS libraries (styled-components, emotion). PatternFly tokens
  cover styling needs.
- Pull in heavy date/time libraries; use `Intl.DateTimeFormat` and `Temporal`
  when needed.
