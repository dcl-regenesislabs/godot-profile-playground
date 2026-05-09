# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install deps (Node ≥ 20).
- `npm start` — run server (`node server.js`).
- `npm run dev` — run with `node --watch` for auto-reload.

There are no tests, lint, or build steps configured.

## Runtime prerequisites

Docker daemon must be running and the host must be able to pull `quay.io/decentraland/godot-explorer:latest` (override with `DOCKER_IMAGE` to use a locally-built tag). Network access to the catalysts (`CATALYST_URL_ORG`, default `https://peer.decentraland.org`; `CATALYST_URL_ZONE`, default `https://peer.decentraland.zone`) is also required. Each enqueued job carries a `network` field (`org` or `zone`) selecting which catalyst to fetch the profile from; the comparison panel mirrors this with `wearable-preview.decentraland.<tld>/`.

Environment variables: `PORT` (3000), `DOCKER_IMAGE`, `CATALYST_URL_ORG`, `CATALYST_URL_ZONE`, `RENDER_TIMEOUT_MS` (120000).

## Architecture

The service is a thin Express front-end over a one-shot Docker invocation of the Decentraland godot-explorer renderer. Single render flow, no persistence:

1. `server.js` — exposes `GET /healthz` and `POST /api/render`. Reads config from env, serves `public/` statically, and delegates to `renderProfile`. Errors thrown as `HttpError` map to their `status`; everything else becomes 500.
2. `src/catalyst.js` — `normalizeAddress` validates the 0x-prefixed 40-hex ETH address and lowercases it. `fetchProfile` GETs `${CATALYST_URL}/lambdas/profiles/{address}` and extracts `body.avatars[0]` (404 if missing). Throws `HttpError` for both validation and upstream failures.
3. `src/renderer.js` — orchestrates the render:
   - Creates a per-request temp dir under `os.tmpdir()` (`gpv-<uuid>/`) with an `output/` subdir.
   - Writes `avatars.json` with `{ baseUrl: "<catalyst>/content", payload: [{ entity, destPath, width/height, faceDestPath, faceWidth/faceHeight, avatar }] }`. `entity` and output filenames use the lowercased ETH address; body 512×1024, face 256×256.
   - `spawn("docker", ["run", "--rm", "--name", "gpv-<uuid>", "-v", "<tmp>/avatars.json:/app/avatars.json:ro", "-v", "<tmp>/output:/app/output", image])`. The named container is `docker kill`-ed on timeout (504). Non-zero exit → 500 with stderr/stdout.
   - Reads `output/<address>.png` (required) and `output/<address>_face.png` (optional — `.catch(() => null)`) and returns them as `data:image/png;base64,...` strings alongside `name` and `address`.
   - Always `rm -rf`s the temp dir in `finally`.

Key contracts to preserve when changing render code:
- The container expects `/app/avatars.json` (read-only mount) and writes into `/app/output`.
- `entity` in the payload doubles as the output filename stem; renaming the field or filename pattern requires updating both the JSON and the post-run reads.
- `HttpError(status, message)` is the only error type the HTTP layer treats as non-500 — throw it from anywhere in `src/` to surface a specific status.
- For zone (testnet) jobs, `runGodot` must pass `--dclenv zone` to the godot binary. The renderer's wearable fetcher reads `urls::peer_content()` derived from a global `dclenv` (default `org`); pointing the avatars.json `baseUrl` at `peer.decentraland.zone` only fixes the profile fetch, not the `entities/active` POST. Without `--dclenv`, Amoy wearables resolve to `null` and the avatar renders bald. The `--dclenv` flag was added in godot-explorer commit `22fca47c` — older images need the `--fake-deeplink "decentraland://open?dclenv=zone"` workaround. See `decentraland/godot-explorer/docs/PROFILE_IMAGE.md` ("Catalyst environment") for the full explanation.

## Frontend

`public/index.html` is a single static page POSTing to `/api/render` and rendering the returned base64 PNGs. No build pipeline.
