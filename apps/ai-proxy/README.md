# AI Proxy (iflow OpenAI-compatible)

A minimal bridge that adapts the app's AI SDK "UI Message Stream" to an OpenAI-compatible API hosted at `https://apis.iflow.cn/v1`.

- Exposes `POST /ai/chat` expected by the desktop app
- Internally calls iflow's OpenAI-compatible chat completions via AI SDK
- Streams responses as SSE JSON events for the frontend to render progressively

## Quick start

1. Install deps

```bash
pnpm install
```

2. Configure env

Copy `.env.example` to `.env.local` and set your key:

```
IFLOW_API_KEY=sk-...
PORT=3000
# Optional: Follow API base used to resolve "Current" context content
# Defaults to https://api.follow.is
UPSTREAM_API_URL=https://api.follow.is
# Optional: Auth for resolving Current entry (copy from browser cookies)
# __Secure-better-auth.session_token=<token>
UPSTREAM_SESSION_TOKEN=
```

3. Run the proxy

```bash
pnpm --filter @follow/ai-proxy dev
```

4. Point the desktop app to this proxy

Set `apps/desktop/.env`:

```
VITE_API_URL=http://localhost:3000
```

Then start the desktop app (web renderer is fine):

```bash
cd apps/desktop && pnpm run dev:web
```

Open the AI panel or the homepage to trigger "timeline summary". Requests will hit `POST /ai/chat` on this proxy.

By default, when the chat payload contains a `data-block` with `{ type: 'mainEntry', value: '<entryId>' }`, the proxy now resolves the “Current” context by calling its own local routes and only then fetching upstream:

- Local routes on this proxy
  - `GET /proxy/entries?id=<entryId>`
  - `GET /proxy/entries/readability?id=<entryId>`
- These forward to `UPSTREAM_API_URL` with best‑effort auth (env `UPSTREAM_SESSION_TOKEN` or forwarded Cookie header) and return the upstream JSON.
- This ensures Current-context fetching also “goes through” your local 3000 server.

## Notes

- CORS is enabled with `credentials: true` and allows `X-Client-Id`/`X-Session-Id` headers.
- The frontend may include `body.model` (e.g. `openai/gpt-4o-mini`); the proxy strips the provider prefix (`openai/`) and passes the model id to the provider.
- When `scene === "timeline-summary"`, a concise system prompt is injected to guide summarization.
- `GET /ai/chat/:id/stream` returns 204 for reconnects (optional).
- "Current" context: when a message contains a `data-block` with `{ type: 'mainEntry', value: '<entryId>' }`,
  the proxy fetches the entry (and readability content as fallback) via the local `/proxy/*` routes (which forward to
  `UPSTREAM_API_URL`) and injects a
  compact text context at the start of the first user message. The previous `selectedText`-only behavior is disabled.
  - If the upstream requires auth, set `UPSTREAM_SESSION_TOKEN` so the proxy can read private content.

## Customize

- Change default model by editing `modelId` fallback in `src/server.ts`.
- Add more routes (e.g. `/ai/chat/config`, `/ai/summary-title`) if you want feature parity with the hosted API.

## Use with Desktop

You can send only the AI endpoints to this proxy without changing other APIs:

1. Start the proxy

```
pnpm --filter @follow/ai-proxy dev
```

2. Point only AI to the proxy

- Local renderer (http://localhost:2233): set `apps/desktop/.env`:

```
VITE_AI_API_URL=http://localhost:3000
```

This keeps `VITE_API_URL` for the rest of the app intact while AI calls go to `VITE_AI_API_URL/ai/chat`.

- Debug Proxy page (https on app.folo.is): browsers block mixed content, so `http://localhost:3000` won’t work directly. Use an HTTPS tunnel (e.g. Cloudflare Tunnel or ngrok) to expose your local proxy, then open:

```
https://app.folo.is/__debug_proxy?debug-host=http://localhost:2233&ai-host=https://<your-https-tunnel-domain>
```

The `ai-host` query param overrides the AI base URL at runtime. Ensure your tunnel allows CORS from `https://app.folo.is`.

## Security

- Never commit your API key. Use environment variables / deployment platform secrets.
