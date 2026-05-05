# godot-profile-viewer

Local web service that renders a Decentraland avatar from an Ethereum address.
Backend is Node + Express; rendering runs inside the
[`godot-explorer`](https://github.com/decentraland/godot-explorer) Docker image.

## How it works

1. Browser POSTs an ETH address to `/api/render`.
2. Server fetches the profile from the catalyst (`/lambdas/profiles/{address}`).
3. Server writes an `avatars.json` payload to a temp dir and runs
   `docker run --rm -v <tmp>/avatars.json:/app/avatars.json -v <tmp>/output:/app/output <image>`.
4. The container renders body + face PNGs; server returns them as base64 data URLs.

## Prerequisites

- Node.js ≥ 20
- Docker daemon running
- Network access (first run pulls `quay.io/decentraland/godot-explorer:latest`)

## Run

```sh
npm install
npm start
```

Open <http://localhost:3000>.

## Environment variables

| Var                 | Default                                            | Notes                                  |
| ------------------- | -------------------------------------------------- | -------------------------------------- |
| `PORT`              | `3000`                                             | HTTP port                              |
| `DOCKER_IMAGE`      | `quay.io/decentraland/godot-explorer:latest`       | Override to use a locally-built tag    |
| `CATALYST_URL`      | `https://peer.decentraland.org`                    | Decentraland catalyst base URL         |
| `RENDER_TIMEOUT_MS` | `120000`                                           | Kills the container if it hangs        |

## API

- `GET /healthz` → `{ ok: true }`
- `POST /api/render` body `{ "address": "0x..." }` → `{ name, address, body, face }`
  (`body` and `face` are `data:image/png;base64,...` strings.)
