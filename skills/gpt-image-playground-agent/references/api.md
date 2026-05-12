# GPT Image Playground Agent API Reference

## Capabilities

```http
GET /api/agent/capabilities
```

Returns API version, supported models, limits, authentication schemes, storage mode, idempotency settings, and endpoint paths.

## Generate

```http
POST /api/agent/images/generate
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

Request:

```json
{
  "prompt": "a product photo of a ceramic mug",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "quality": "auto",
  "output_format": "png",
  "background": "auto",
  "moderation": "auto",
  "response_mode": "path"
}
```

Response:

```json
{
  "request_id": "uuid",
  "idempotency_key": "stable-key",
  "cached": false,
  "images": [
    {
      "id": "artifact-uuid",
      "filename": "1715400000000-abcdef1234567890-0.png",
      "content_url": "/api/agent/artifacts/artifact-uuid/content",
      "metadata_url": "/api/agent/artifacts/artifact-uuid",
      "output_format": "png",
      "mime_type": "image/png",
      "size_bytes": 12345,
      "width": 1024,
      "height": 1024
    }
  ],
  "usage": {},
  "created_at": "2026-05-12T00:00:00.000Z"
}
```

## Edit

```http
POST /api/agent/images/edit
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: multipart/form-data
```

Fields:

- `prompt`: required.
- `model`: defaults to `gpt-image-2`.
- `n`: `1..10`, defaults to `1`.
- `size`: `auto` or a supported size.
- `quality`: `low`, `medium`, `high`, or `auto`.
- `response_mode`: `path`, `base64`, or `both`.
- `image_0..image_9`: source images.
- `mask`: optional PNG mask.

## Artifact Metadata

```http
GET /api/agent/artifacts/{id}
GET /api/agent/artifacts/{id}/content
DELETE /api/agent/artifacts/{id}
```

All artifact endpoints require the same authentication as generation.

## Errors

Errors are structured:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "retryable": false,
    "details": {
      "fields": {
        "n": "must be an integer between 1 and 10"
      }
    },
    "request_id": "uuid"
  }
}
```

Common codes:

- `validation_error`
- `unauthorized`
- `configuration_error`
- `idempotency_key_required`
- `idempotency_conflict`
- `request_in_progress`
- `artifact_not_found`
- `upstream_rate_limited`
- `upstream_auth_failed`
- `upstream_unavailable`
- `unexpected_error`
