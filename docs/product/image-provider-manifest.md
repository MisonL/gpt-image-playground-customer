# Image Provider Manifest

Provider manifest is a server-side configuration contract for image upstream diagnostics and capability constraints.
It is not a browser-side plugin system and it does not execute arbitrary request templates.

## Scope

- The server reads `OPENAI_CHANNEL_N_PROVIDER_MANIFEST` for a numbered channel.
- The manifest is validated during channel config parsing.
- The manifest can narrow request constraints such as `n`, `partial_images`, upload limits, and `gpt-image-2` size policy.
- `/api/runtime-capabilities` exposes only a sanitized summary: provider id, mode type, request content type, response format, and whether async polling is declared.
- API keys and extra headers are never included in runtime capability responses.
- Upload constraints are capped globally: `max_images` cannot exceed 10, `max_single_bytes` cannot exceed 25 MiB, and `max_total_bytes` cannot exceed 100 MiB.

## Minimal Example

```json
{
  "schema_version": 1,
  "id": "custom_async",
  "name": "Custom Async Provider",
  "base_profile": "openai-compatible",
  "modes": {
    "generate": {
      "submit": {
        "path": "/images/generations",
        "content_type": "application/json",
        "response_format": "custom-json"
      },
      "poll": {
        "path": "/jobs/{id}",
        "status_path": "status",
        "success_values": ["succeeded"],
        "failure_values": ["failed"]
      }
    },
    "edit": {
      "submit": {
        "path": "/images/edits",
        "content_type": "multipart/form-data",
        "response_format": "openai-images"
      }
    }
  },
  "constraints": {
    "generate_count": { "min": 1, "max": 2 },
    "edit_count": { "min": 1, "max": 1 },
    "partial_images": { "min": 0, "max": 2 },
    "upload": {
      "max_images": 4,
      "max_single_bytes": 10485760,
      "max_total_bytes": 41943040
    },
    "gpt_image_2": {
      "allow_transparent_background": false,
      "size_policy": "openai-compatible"
    }
  }
}
```

## Failure Fixtures To Keep Covered

- Invalid JSON fails during config parsing.
- Unsupported `schema_version` fails explicitly.
- Manifest `id` must be stable and lower-case.
- Submit path must be a relative API path beginning with `/`.
- Submit method only supports `POST`.
- Submit content type only supports `application/json` or `multipart/form-data`.
- Poll method only supports `GET` or `POST`.
- `base_profile` must match the channel upstream profile.
- Range constraints reject `min > max`.
- Upload constraints reject values above the global caps.
- Runtime capabilities must not include API keys, app secrets, or raw extra headers.

## Current Boundary

The app still sends image requests through the existing OpenAI-compatible Images API and Responses backend paths.
Manifest support currently provides validated constraints and diagnostics so new upstream modes can be introduced without silent fallback or hidden browser-side behavior.
