#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import path from 'node:path';

await rm(path.join(process.cwd(), '.next', 'standalone'), { recursive: true, force: true });
