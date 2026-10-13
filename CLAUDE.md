# Whitespace
Full spec: SPEC.md. Read the relevant section before changing code.

## Project
- TypeScript strict, npm workspaces: shared, api, web
- Every Qloo call goes through api/src/qloo/client.ts
- Qloo key stays on the server; base URL from QLOO_BASE_URL
- Agent replies and zone briefs may only name entities returned by Qloo in the current analysis: the LLM writes [[id]] tokens and code substitutes the names
- Scoring lives in shared/src/scoring as pure functions with tests; the browser and the server run the same code
- Never commit real Qloo responses (Qloo terms): api/fixtures holds synthetic data only; recordings live in api/recordings, which is gitignored
- DEMO_MODE must work from recordings or synthetic fixtures and be clearly labeled in the UI
- Qloo silently ignores unknown parameters: the client only sends parameters from its per-filter.type allowlist
- Qloo API reference that the docs site won't serve to tools: docs/QLOO-NOTES.md
- Qloo allows 5 requests/s and 10,000 requests/month: reuse cached responses in api/recordings, never loop live calls in tests or scripts
- The live demo must keep working until judging ends on 2026-11-16
- User-facing text in English
- Run npm test and npm run lint before finishing a task

## Commands
- npm run dev: api on :8787 and web on :5173 (Vite proxies /api and /health to the api)
- npm run demo: the same with DEMO_MODE=true
- npm test, npm run lint, npm run typecheck, npm run build
- npm run fixtures: regenerates api/fixtures deterministically from scripts/make-fixtures.ts
- npm run docker:build, then docker run -p 8090:8080 -e DEMO_MODE=true whitespace: the production container (docs/DEPLOY.md)
- npm run smoke -- <url> and npm run warm -- <url>: check and warm a running server

## Setup quirks
- @whitespace/shared exports a "development" condition pointing at src: tsx runs with --conditions=development and Vite picks it up in dev; builds and node use dist. postinstall builds shared so editors see its types
- The api dev script pins PORT=8787 because the Vite proxy targets it; PORT from the environment is for hosting platforms
- MapLibre's worker is imported with ?worker&url and passed to setWorkerUrl, and maplibre-gl stays out of optimizeDeps; otherwise the production build ships without the worker
- The first map load in dev is slow while Vite transforms the worker
- @hono/node-server's serveStatic calls onFound after it builds the response, so headers set there are lost; cache headers are set in a middleware after next()
- Hosting must not sleep: the demo has to answer judges until 2026-11-16; the per-IP limit on /api/scout refunds answers served entirely from cache

## Git
- Work directly on main; create a branch only when asked
- No git push without an explicit request
- Never use git push --force or git reset --hard
- Never delete files without confirmation
- Show the diff before every commit
- Small commits: one logical change per commit, do not mix tasks
- Do not mention Claude, Anthropic or AI assistance in code, commits or PRs; no Co-Authored-By or "Generated with" lines

## Code style
- No code comments; if a comment seems truly necessary, ask first and add it only after approval
