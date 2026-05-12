#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.GPT_IMAGE_PLAYGROUND_URL || 'http://localhost:4783';
const token = process.env.GPT_IMAGE_AGENT_TOKEN || '';
const [imagePath, ...promptParts] = process.argv.slice(2);
const prompt = promptParts.join(' ');
const maxAttempts = Number(process.env.GPT_IMAGE_AGENT_MAX_ATTEMPTS || '3');

if (!imagePath || !prompt) {
  console.error('Usage: edit-image.mjs <image-path> <prompt>');
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
    throw new Error(`capabilities request failed with ${response.status}: ${body}`);
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

const imageBuffer = fs.readFileSync(imagePath);
const imageType = mimeTypeForPath(imagePath);
const idempotencyKey = process.env.GPT_IMAGE_AGENT_IDEMPOTENCY_KEY || `agent-edit-${crypto.randomUUID()}`;

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
let lastRetryAfter = 0;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const response = await fetch(`${baseUrl}/api/agent/images/edit`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...authHeaders()
    },
    body: buildFormData()
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
