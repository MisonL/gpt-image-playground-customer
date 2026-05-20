#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = normalizeBaseUrl(process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783');
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';
const [imagePath, ...promptParts] = process.argv.slice(2);
const prompt = promptParts.join(' ');
const parsedMaxAttempts = parseInt(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS || '3', 10);
const maxAttempts = Number.isInteger(parsedMaxAttempts) && parsedMaxAttempts > 0 ? parsedMaxAttempts : 3;
const contractCheck = process.env.GPT_IMAGE_AGENT_CONTRACT_CHECK === '1';
const idempotencyKey = process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY || `agent-edit-${crypto.randomUUID()}`;

if ((!imagePath || !prompt) && !contractCheck) {
  console.error('用法：edit-image.mjs <image-path> <prompt>');
  console.error('契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 edit-image.mjs');
  process.exit(2);
}

function authHeaders() {
  if (token) return { Authorization: `Bearer ${token}` };
  if (passwordHash) return { 'X-App-Password-Hash': passwordHash };
  return {};
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function absoluteUrl(value) {
  if (typeof value !== 'string' || !value) return undefined;
  return new URL(value, `${baseUrl}/`).toString();
}

function enrichImageUrls(result) {
  if (!result || !Array.isArray(result.images)) return result;
  return {
    ...result,
    images: result.images.map((image) => ({
      ...image,
      ...(image.content_url ? { absolute_content_url: absoluteUrl(image.content_url) } : {}),
      ...(image.metadata_url ? { absolute_metadata_url: absoluteUrl(image.metadata_url) } : {})
    }))
  };
}

async function readCapabilities() {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/agent/capabilities`, {
      headers: authHeaders()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接 GPT Image Playground：${baseUrl}。${message}`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`capabilities 请求失败，状态码 ${response.status}：${body}`);
  }
  return response.json();
}

function parseRetryAfterValue(value) {
  if (!value || !/^\d+$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

function shouldRetry(result) {
  return Boolean(result?.error?.retryable);
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

try {
  await readCapabilities();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (contractCheck) {
  const response = await fetch(`${baseUrl}/api/agent/images/edit`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify({ prompt: 'contract check' })
  });
  const result = await response.json();
  if (response.status === 415 && result?.error?.code === 'validation_error') {
    console.log(JSON.stringify({ ok: true, status: response.status, error_code: result.error.code }, null, 2));
    process.exit(0);
  }
  console.error(JSON.stringify({ ok: false, status: response.status, result }, null, 2));
  process.exit(1);
}

try {
  const stats = fs.statSync(imagePath);
  if (!stats.isFile()) {
    console.error(`图片路径不是文件：${imagePath}`);
    process.exit(2);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`无法读取图片文件：${imagePath}。${message}`);
  process.exit(2);
}

const imageBuffer = fs.readFileSync(imagePath);
const imageType = mimeTypeForPath(imagePath);

function buildFormData() {
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('model', 'gpt-image-2');
  formData.append('response_mode', 'path');
  formData.append('image_0', new Blob([imageBuffer], { type: imageType }), path.basename(imagePath));
  return formData;
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

let lastResult;
let lastRetryAfter = null;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let response;
  let result;
  try {
    response = await fetch(`${baseUrl}/api/agent/images/edit`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...authHeaders()
      },
      body: buildFormData()
    });
    result = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { error: { code: 'network_error', message, retryable: true } };
    lastResult = result;
    lastRetryAfter = 1;
    if (attempt === maxAttempts) break;
    await sleep(lastRetryAfter);
    continue;
  }
  if (response.ok) {
    console.log(JSON.stringify(enrichImageUrls(result), null, 2));
    process.exit(0);
  }

  const retryAfter = parseRetryAfterValue(response.headers.get('retry-after'));
  lastResult = result;
  lastRetryAfter = retryAfter;
  if (!shouldRetry(result) || attempt === maxAttempts) break;
  await sleep(retryAfter);
}

console.error(JSON.stringify({ ...lastResult, retry_after: lastRetryAfter }, null, 2));
process.exit(1);
