# Deploy on Vercel with Neon

Free tier only: Vercel **Hobby** for the page and the API, Neon **Free** for the database. No paid add-on.

## What runs where

| Part | On Vercel | Set by |
|---|---|---|
| The page | `dist/` (from `npm run build`) as static files | `vercel.json` `buildCommand`, `outputDirectory` |
| The API | one Node function, `api/index.ts` → `server/vercel.ts`: the laptop's `handler` and `createApp`, the routing worker threads included | `vercel.json` `functions`, `rewrites` |
| The network files | `public/data/*.bin`, `*.json` copied into the function (about 37 MB with `node_modules`) | `vercel.json` `includeFiles` |
| The database | Neon PostgreSQL, through `DATABASE_URL`; the tables are created by the first request (`server/store/postgres.ts` migrations) | the Neon integration |
| Who gets in | everyone with the link: no login | |

## Facts this setup relies on (checked 2026-11-19)

| Fact | Source |
|---|---|
| Node 26.x (default), 24.x, 22.x; `"engines": { "node": ">=23.6" }` deploys the latest 26.x | [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) |
| Hobby function: 2 GB / 1 vCPU (not configurable), `maxDuration` 300 s at most (we set 60 s), 250 MB uncompressed bundle, 4.5 MB request/response body | [Functions limits](https://vercel.com/docs/functions/limitations) |
| Neon integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`; values are Sensitive by default (not readable back) | [Neon: Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration) |
| Neon Free: 1 GB per project, 100 CU-hours per project per month, scales to zero after 5 min, no card | [Neon pricing](https://neon.com/pricing) |

## Steps

Run in the repo root, logged in to the Vercel CLI (`npx vercel whoami`).

1. **Link the folder to a new Vercel project** (writes `.vercel/`, which git ignores):
   ```
   npx vercel link
   ```
   Scope: your Hobby account. Link to an existing project: No. Name: `visnarn`. Directory: `./`. Settings come from
   `vercel.json` (Vite, `npm run build`, `dist`): do not change them.

2. **Add Neon, Free plan.** In the dashboard: the project → **Storage** → **Create Database** → **Neon** →
   region **US East (N. Virginia)** (beside the function's default region `iad1`) → plan **Free** → Create →
   connect it to the project for **Production** and **Preview**; leave "Create database branch for deployment" off.
   The same from the terminal:
   ```
   npx vercel integration add neon
   ```
   Check that `DATABASE_URL` is now set:
   ```
   npx vercel env ls
   ```
   The laptop does not need it: without `DATABASE_URL` the app keeps its own database in `~/.visnarn/postgres`.

3. **Deploy:**
   ```
   npx vercel deploy --prod
   ```
   Open the URL it prints.
   The first request creates the tables in Neon, so it takes a few seconds longer.

4. **Deploy on every push to GitHub** (the private repo `jkyyang/VisNarn`):
   ```
   npx vercel git connect
   ```
   From then on a push to `main` deploys production and a push to another branch deploys a preview.
   The weekly network update (`scripts/update-network.ts`) commits `public/data` on the laptop; it is deployed
   when that commit is pushed.

## Later

- **Shops on the site:** Neon starts empty. Add them on the Shops screen, or import a CSV there.
- **Previews:** Vercel's default Standard Protection asks for a Vercel login on preview URLs; production is open.
