---
name: gpt-image-playground-agent
description: Use when an agent needs to call this repository's GPT Image Playground Agent API to generate or edit images with idempotency, structured errors, and artifact tracking.
---

# GPT Image Playground Agent

Use this skill to call a running GPT Image Playground service through `/api/agent/*`.

## Workflow

1. Call `GET /api/agent/capabilities` before image work.
2. Use `POST /api/agent/images/generate` for text-to-image JSON requests.
3. Use `POST /api/agent/images/edit` for multipart image edits.
4. Always send `Idempotency-Key`.
5. Prefer `response_mode: "path"` so base64 does not fill the model context.
6. Treat `error.retryable=true` as a signal to wait for `Retry-After` before retrying.
7. Use artifact `content_url` only with the same authorization header.

## Authentication

If `AGENT_API_TOKEN` is configured, send:

```text
Authorization: Bearer <token>
```

If the server uses `APP_PASSWORD` instead, send `X-App-Password-Hash`.

## Bundled Scripts

- `scripts/generate-image.mjs`: JSON text-to-image call.
- `scripts/edit-image.mjs`: multipart edit call.

Both scripts read:

- `GPT_IMAGE_PLAYGROUND_URL`
- `GPT_IMAGE_AGENT_TOKEN`
- `GPT_IMAGE_AGENT_IDEMPOTENCY_KEY` when a caller needs to resume the same operation across script processes

## Reference

Read `references/api.md` for endpoint shapes, errors, and examples.
