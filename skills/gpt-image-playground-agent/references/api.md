# GPT Image Playground Agent API 参考

## 辅助脚本

- `skills/gpt-image-playground-agent/scripts/generate-image.mjs`：JSON 文生图调用。
- `skills/gpt-image-playground-agent/scripts/edit-image.mjs`：multipart 编辑调用。

脚本支持 `GPT_IMAGE_AGENT_CONTRACT_CHECK=1` 做只读契约检查，不触发真实生图或编辑。
鉴权支持 `GPT_IMAGE_AGENT_TOKEN` 或 `GPT_IMAGE_APP_PASSWORD_HASH`。
当服务返回相对 `content_url` 或 `metadata_url` 时，辅助脚本会额外输出 `absolute_content_url` 和 `absolute_metadata_url`。

## 能力查询

```http
GET /api/agent/capabilities
```

返回 API 版本、支持的模型、限制、鉴权方式、存储模式、状态后端、幂等设置和端点路径。响应不会公开服务端本地 SQLite 文件路径。

## 生成图片

```http
POST /api/agent/images/generate
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

请求：

```json
{
  "prompt": "a product photo of a ceramic mug",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "background": "auto",
  "moderation": "auto",
  "response_mode": "path"
}
```

响应：

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

## 编辑图片

```http
POST /api/agent/images/edit
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
Content-Type: multipart/form-data
```

字段：

- `prompt`：必填。
- `model`：默认 `gpt-image-2`。
- `n`：`1..10`，默认 `1`。
- `size`：`auto` 或支持的尺寸。
- `quality`：`low`、`medium`、`high` 或 `auto`。
- `response_mode`：`path`、`base64` 或 `both`。
- `image_0..image_9`：源图片。
- `mask`：可选 PNG 遮罩。

## 产物元数据

```http
GET /api/agent/artifacts/{id}
GET /api/agent/artifacts/{id}/content
DELETE /api/agent/artifacts/{id}
```

所有产物端点都需要和生成接口相同的鉴权。

## 错误

错误使用结构化格式：

```json
{
  "error": {
    "code": "validation_error",
    "message": "请求校验失败。",
    "retryable": false,
    "details": {
      "fields": {
        "n": "必须是 1 到 10 之间的整数"
      }
    },
    "request_id": "uuid"
  }
}
```

常见错误码：

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
