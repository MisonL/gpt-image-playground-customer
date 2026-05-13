#!/usr/bin/env node
import crypto from 'node:crypto';

const baseUrl = process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783';
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const prompt = process.argv.slice(2).join(' ');
const maxAttempts = Number(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS || '3');

if (!prompt) {
  console.error('用法：generate-image.mjs <prompt>');
  process.exit(2);
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readCapabilities() {
  const response = await fetch(`${baseUrl}/api/agent/capabilities`, {
    headers: authHeaders()
  });
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

await readCapabilities();

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
    console.log(JSON.stringify(result, null, 2));
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
