#!/usr/bin/env node
import crypto from 'node:crypto';

const baseUrl = normalizeBaseUrl(process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783');
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const passwordHash = process.env.GPT_IMAGE_APP_PASSWORD_HASH || '';
const prompt = process.argv.slice(2).join(' ');
const maxAttempts = Number(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS || '3');
const contractCheck = process.env.GPT_IMAGE_AGENT_CONTRACT_CHECK === '1';

if (!prompt && !contractCheck) {
  console.error('用法：generate-image.mjs <prompt>');
  console.error('契约检查：GPT_IMAGE_AGENT_CONTRACT_CHECK=1 generate-image.mjs');
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

function parseRetryAfter(response) {
  const value = response.headers.get('retry-after');
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
  const response = await fetch(`${baseUrl}/api/agent/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify({
      prompt: 'contract check',
      model: 'gpt-image-2',
      response_mode: 'path'
    })
  });
  const result = await response.json();
  if (response.status === 400 && result?.error?.code === 'idempotency_key_required') {
    console.log(JSON.stringify({ ok: true, status: response.status, error_code: result.error.code }, null, 2));
    process.exit(0);
  }
  console.error(JSON.stringify({ ok: false, status: response.status, result }, null, 2));
  process.exit(1);
}

const idempotencyKey = process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY || `agent-generate-${crypto.randomUUID()}`;
let lastResult;
let lastRetryAfter = 0;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const response = await fetch(`${baseUrl}/api/agent/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...authHeaders()
    },
    body: JSON.stringify({
      prompt,
      model: 'gpt-image-2',
      response_mode: 'path'
    })
  });

  const result = await response.json();
  if (response.ok) {
    console.log(JSON.stringify(enrichImageUrls(result), null, 2));
    process.exit(0);
  }

  const retryAfter = response.headers.get('retry-after');
  lastResult = result;
  lastRetryAfter = retryAfter;
  if (!shouldRetry(result) || attempt === maxAttempts) break;
  await sleep(parseRetryAfter(response));
}

console.error(JSON.stringify({ ...lastResult, retry_after: lastRetryAfter }, null, 2));
process.exit(1);
