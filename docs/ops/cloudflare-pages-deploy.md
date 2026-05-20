# Cloudflare Deploy Runbook

> Status: deploy-prep baseline for task #11, revised for Workers Static Assets after the first Cloudflare build attempt. This runbook documents the static build contract and the selected `wrangler.jsonc` deployment path. It does not provision Cloudflare resources or store secrets.

## Deployment Contract

miru is a static Vite SPA with no backend, Pages Functions, Worker script, or server-side rendering. Deployment uses **Cloudflare Workers Static Assets** via the repository `wrangler.jsonc`, matching the deployment shape already used by `LoTwT/design-system`.

| Field | Value |
| --- | --- |
| Production branch | `main` |
| Package manager | `pnpm@10.25.0` (`package.json#packageManager`) |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` or `npx wrangler deploy` |
| Build output / assets directory | `dist` |
| Static headers source | `public/_headers` |
| Static headers artifact | `dist/_headers` |
| Worker name | `miru` |
| Canonical domain | `miru.ayingott.me` |
| SPA fallback | `assets.not_found_handling = "single-page-application"` |

The repository `wrangler.jsonc` is the source of truth for deploy configuration:

```jsonc
{
  "name": "miru",
  "compatibility_date": "2026-05-20",
  "build": {
    "command": "pnpm run build"
  },
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  },
  "routes": [
    {
      "pattern": "miru.ayingott.me",
      "custom_domain": true
    }
  ]
}
```

`assets.directory` is required for this path. Without it, `wrangler deploy` can enter framework autoconfiguration and fail with `The assets property in your configuration is missing the required directory property`.

No application secrets are required for miru V0.

## Required Human Inputs

lo-user needs to provide or confirm:

1. Cloudflare account/project access for the agent or a human deploy operator.
2. Worker/project name. Default: `miru`.
3. Production domain: `miru.ayingott.me`.
4. Whether Cloudflare Git deploys should run automatically from `main`, or whether deploy remains manual via an authenticated operator.

`ayingott.me` must be available in the same Cloudflare account as the deploy operator. The checked-in custom-domain route should provision `miru.ayingott.me` during `wrangler deploy`.

## Cloudflare Git Deploy

Use this path once lo-user connects the Cloudflare project to GitHub.

1. In Cloudflare, create/connect a Workers project for `LoTwT/miru`.
2. Keep `wrangler.jsonc` as the source of truth.
3. Ensure the build environment uses pnpm 10.25.0 if the dashboard asks for a package manager version.
4. Configure deploy to run:

   ```sh
   npx wrangler deploy
   ```

Wrangler will run `wrangler.jsonc#build.command` (`pnpm run build`) and deploy static assets from `dist`.

If a Cloudflare UI also has a separate build command field, avoid running a different build command there. A duplicate `pnpm run build` before `wrangler deploy` is harmless but slower; a mismatched command can fail or deploy stale assets.

## Manual Deploy

Use this path for an authenticated human/operator smoke or a one-off production deploy.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
test -f dist/_headers
pnpm run deploy
```

`pnpm run deploy` executes `wrangler deploy`, using the checked-in `wrangler.jsonc`.

CI/manual deploys must provide Cloudflare authentication via `wrangler login` or CI secrets. Do not commit credentials.

## Local Release Smoke

Run this from a clean checkout before any production deploy:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm test:e2e
git diff --check origin/main...HEAD
test -f dist/_headers
pnpm exec wrangler deploy --dry-run --outdir .wrangler/dry-run
```

Expected artifact checks:

```sh
find dist -maxdepth 2 -type f | sort
sed -n '1,120p' dist/_headers
```

`dist/_headers` must include the V0 CSP, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## Post-deploy Smoke

The canonical production URL is `https://miru.ayingott.me`.

```sh
curl -I https://miru.ayingott.me/
curl -I https://miru.ayingott.me/assets/<known-built-asset>
curl -I -H 'Sec-Fetch-Mode: navigate' https://miru.ayingott.me/reader/deep-link
curl -I https://miru.ayingott.me/assets/definitely-missing.js
```

Verify:

- Root document returns `200`.
- Built JS/CSS/font assets return `200`.
- Response headers include:
  - `content-security-policy`
  - `referrer-policy: no-referrer`
  - `x-content-type-options: nosniff`
- Refreshing a deep SPA URL returns the app shell (`200`) rather than a blank page.
- A missing static asset still returns a real `404`, not the app shell.
- First paint shows the self-dogfood sample doc.
- Four input paths still work on the deployed URL: paste, drag-drop, open-file, URL fetch.
- CORS-blocked URL fetch shows the graceful inline error and fallback copy.
- Network audit shows no analytics, telemetry, fingerprinting, miru backend, or miru proxy.

## Rollback

If production deploy fails after release:

1. Stop further deploys from the failing branch/commit.
2. Use the Cloudflare Workers deployment/version rollback UI to restore the last known-good deployment.
3. Post the rollback deployment URL, reverted commit range, and user-visible impact in #miru.
4. Keep the failing commit available for QA reproduction; do not rewrite history.

## Release Evidence Packet

For the V0 release gate, attach or link:

- Main commit SHA.
- Cloudflare Worker/project name and production URL.
- Build transcript for the local release smoke.
- Deploy transcript or Cloudflare deployment/version ID.
- Header evidence (`curl -I` output).
- SPA fallback and missing-asset evidence.
- Browser screenshots or trace for desktop/mobile and light/dark.
- R-PERF-1 mobile 1k/3k markdown reading evidence.
- Known non-blocking risks, including the Shiki lazy renderer chunk monitor item.

## Source References

- Cloudflare Workers Static Assets: <https://developers.cloudflare.com/workers/static-assets/>
- Cloudflare Workers SPA fallback: <https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/>
- Cloudflare Workers static asset headers (`_headers`): <https://developers.cloudflare.com/workers/static-assets/headers/>
- Cloudflare Wrangler configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/>
