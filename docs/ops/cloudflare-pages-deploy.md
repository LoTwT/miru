# Cloudflare Pages Deploy Runbook

> Status: deploy-prep baseline for task #11. This runbook documents the static build contract and the Cloudflare Pages setup path. It does not provision Cloudflare resources or store secrets.

## Deployment Contract

miru is a static Vite SPA with no backend, Pages Functions, or server-side rendering.

| Field | Value |
| --- | --- |
| Production branch | `main` |
| Package manager | `pnpm@10.25.0` (`package.json#packageManager`) |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Static headers source | `public/_headers` |
| Static headers artifact | `dist/_headers` |

Cloudflare's Pages build preset for Vue/Vite uses `npm run build` with `dist` as the output directory; miru keeps the same output directory and swaps the command to pnpm. Cloudflare Pages also supports overriding tool versions with build environment variables, including `PNPM_VERSION`, if the default build image pnpm version is not the repo-pinned version.

Recommended Pages environment variables:

| Name | Value | Why |
| --- | --- | --- |
| `PNPM_VERSION` | `10.25.0` | Match `packageManager` and avoid build-image drift. |

No application secrets are required for miru V0.

## Required Human Inputs

lo-user needs to provide or confirm:

1. Cloudflare account/project access for the agent or a human deploy operator.
2. Pages project name. Suggested: `miru`.
3. Deployment mode:
   - **Git integration** (recommended for long-term production): Cloudflare connects to `LoTwT/miru` and deploys pushes to `main`.
   - **Wrangler Direct Upload** (acceptable for manual preview or one-off production): build locally/CI, then upload `dist`.
4. Production domain:
   - default `<project>.pages.dev`, or
   - custom domain to attach after first production deploy.

Important: Cloudflare documents that a Direct Upload project cannot be switched to Git integration later. If the expected long-term workflow is automatic deploys from `main`, create the Pages project through Git integration from the start.

## Option A: Git Integration (Recommended)

Use this path once lo-user connects the Cloudflare Pages project to GitHub.

1. In Cloudflare dashboard, create a Pages project from the Git repository `LoTwT/miru`.
2. Configure:

   | Setting | Value |
   | --- | --- |
   | Framework preset | Vue or Vite |
   | Production branch | `main` |
   | Build command | `pnpm run build` |
   | Build output directory | `dist` |
   | Environment variable | `PNPM_VERSION=10.25.0` |

3. Keep preview deployments enabled for pull request branches if Cloudflare comments are useful for QA/UX screenshot review.
4. After the first successful deploy, record the production URL in this runbook or the release issue/task.

## Option B: Wrangler Direct Upload

Use this path only when a human intentionally chooses manual upload or CI-managed deploys.

Prerequisites:

- Cloudflare Pages project exists, or the deploy command is allowed to create one interactively.
- Operator is authenticated with Wrangler (`wrangler login`) or has CI secrets configured.
- Build output is already present in `dist`.

Manual production deploy:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
test -f dist/_headers
npx wrangler pages deploy dist --project-name=<PROJECT_NAME> --branch=main
```

CI deploy command shape, if a GitHub Action is added later:

```sh
CLOUDFLARE_ACCOUNT_ID=<ACCOUNT_ID> npx wrangler pages deploy dist --project-name=<PROJECT_NAME>
```

CI must store `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository secrets. The token needs Cloudflare Pages edit permission for the account. Do not commit credentials.

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
```

Expected artifact checks:

```sh
find dist -maxdepth 2 -type f | sort
sed -n '1,120p' dist/_headers
```

`dist/_headers` must include the V0 CSP, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

## Post-deploy Smoke

Replace `https://<DEPLOY_URL>` with the actual Pages deployment URL.

```sh
curl -I https://<DEPLOY_URL>/
curl -I https://<DEPLOY_URL>/assets/<known-built-asset>
```

Verify:

- Root document returns `200`.
- Built JS/CSS/font assets return `200`.
- Response headers include:
  - `content-security-policy`
  - `referrer-policy: no-referrer`
  - `x-content-type-options: nosniff`
- Refreshing the app URL does not blank the SPA.
- First paint shows the self-dogfood sample doc.
- Four input paths still work on the deployed URL: paste, drag-drop, open-file, URL fetch.
- CORS-blocked URL fetch shows the graceful inline error and fallback copy.
- Network audit shows no analytics, telemetry, fingerprinting, miru backend, or miru proxy.

## Rollback

If production deploy fails after release:

1. Stop further deploys from the failing branch/commit.
2. Use the Cloudflare Pages deployment list/rollback UI to restore the last known-good production deployment.
3. Post the rollback deployment URL, reverted commit range, and user-visible impact in #miru.
4. Keep the failing commit available for QA reproduction; do not rewrite history.

## Release Evidence Packet

For the V0 release gate, attach or link:

- Main commit SHA.
- Cloudflare Pages project name and production URL.
- Build transcript for the local release smoke.
- Deploy transcript or Cloudflare dashboard deployment ID.
- Header evidence (`curl -I` output).
- Browser screenshots or trace for desktop/mobile and light/dark.
- R-PERF-1 mobile 1k/3k markdown reading evidence.
- Known non-blocking risks, including the Shiki lazy renderer chunk monitor item.

## Source References

- Cloudflare Pages build configuration: <https://developers.cloudflare.com/pages/configuration/build-configuration/>
- Cloudflare Pages build image/tool version overrides: <https://developers.cloudflare.com/pages/configuration/build-image/>
- Cloudflare Pages custom headers (`_headers`): <https://developers.cloudflare.com/pages/configuration/headers/>
- Cloudflare Pages Direct Upload: <https://developers.cloudflare.com/pages/get-started/direct-upload/>
- Cloudflare Pages Direct Upload with CI/Wrangler: <https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/>
