# 图片上游清单

图片上游清单是服务端用于上游诊断和能力约束的配置契约，不是浏览器插件系统，也不会执行任意请求模板。

## 适用范围

- 服务端按编号渠道读取 `OPENAI_CHANNEL_N_PROVIDER_MANIFEST`。
- 解析渠道配置时会校验清单。
- 清单可以收窄 `n`、`partial_images`、上传限制和 `gpt-image-2` 尺寸策略等请求约束。
- `/api/runtime-capabilities` 只暴露脱敏摘要：上游标识、方式类型、请求内容类型、响应格式和是否声明异步轮询。
- 运行时能力响应绝不包含 API 密钥或额外请求头。
- 上传限制受全局上限约束：`max_images` 不超过 10，`max_single_bytes` 不超过 25 MiB，`max_total_bytes` 不超过 100 MiB。

## 最小示例

```json
{
  "schema_version": 1,
  "id": "custom_async",
  "name": "自定义异步上游",
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

## 必须覆盖的失败场景

- 非法 JSON 必须在配置解析时失败。
- 不支持的 `schema_version` 必须显式失败。
- 清单 `id` 必须稳定且全为小写。
- 提交路径必须是以 `/` 开头的相对 API 路径。
- 提交方法只支持 `POST`。
- 提交内容类型只支持 `application/json` 或 `multipart/form-data`。
- 轮询方法只支持 `GET` 或 `POST`。
- `base_profile` 必须与渠道上游配置匹配。
- 范围约束必须拒绝 `min > max`。
- 上传约束必须拒绝超过全局上限的值。
- 运行时能力不得包含 API 密钥、应用密钥或原始额外请求头。

## 当前边界

应用仍通过现有 OpenAI 兼容 Images API 和 Responses 后端路径发送图片请求。清单目前提供经过校验的约束和诊断，使新上游方式能够在没有静默降级或隐藏浏览器行为的前提下接入。
