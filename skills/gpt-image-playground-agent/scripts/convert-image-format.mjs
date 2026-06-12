#!/usr/bin/env node
import { errorMessage, normalizeOutputFormat, readConfiguredPositiveInteger, readOptionValue } from './lib/script-utils.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const DEFAULT_OUTPUT_FORMAT = 'webp';
const DEFAULT_QUALITY = 100;
const EXTENSIONS = {
  png: '.png',
  jpeg: '.jpeg',
  webp: '.webp'
};

let options;
try {
  options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  validateOptions(options);
} catch (error) {
  console.error(errorMessage(error));
  printUsage();
  process.exit(2);
}

try {
  const plan = await buildConversionPlan(options);
  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, ...plan }, null, 2));
    process.exit(0);
  }
  const result = await convertImage(plan);
  console.log(JSON.stringify({ ok: true, dry_run: false, ...result }, null, 2));
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    inputPath: undefined,
    outputPath: undefined,
    format: DEFAULT_OUTPUT_FORMAT,
    quality: String(DEFAULT_QUALITY),
    overwrite: false,
    dryRun: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output' || arg === '-o') parsed.outputPath = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--format' || arg === '--output-format') parsed.format = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--quality') parsed.quality = readOptionValue(argv, (index += 1), arg);
    else if (arg === '--overwrite') parsed.overwrite = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else if (!parsed.inputPath) parsed.inputPath = arg;
    else throw new Error(`多余参数：${arg}`);
  }
  return parsed;
}

function validateOptions(parsed) {
  if (!parsed.inputPath) throw new Error('缺少输入图片路径。');
  const format = normalizeOutputFormat(parsed.format);
  if (!OUTPUT_FORMATS.has(format)) throw new Error('--format 必须是 png、jpeg 或 webp。');
  readQuality(parsed.quality);
}

async function buildConversionPlan(parsed) {
  const inputPath = path.resolve(parsed.inputPath);
  const inputStat = await readInputFileStat(inputPath);
  const format = normalizeOutputFormat(parsed.format);
  const outputPath = path.resolve(parsed.outputPath || deriveOutputPath(inputPath, format));
  if (inputPath === outputPath) {
    throw new Error('输出路径不能和输入路径相同。');
  }
  if (!parsed.overwrite && await fileExists(outputPath)) {
    throw new Error('输出文件已存在；如需覆盖请添加 --overwrite。');
  }
  return {
    input: {
      path: inputPath,
      size_bytes: inputStat.size
    },
    output: {
      path: outputPath,
      format,
      quality: format === 'png' ? undefined : readQuality(parsed.quality),
      alpha_handling: format === 'jpeg' ? 'flattened_white' : 'preserved'
    },
    overwrite: parsed.overwrite
  };
}

async function convertImage(plan) {
  await fs.mkdir(path.dirname(plan.output.path), { recursive: true });
  let pipeline = sharp(plan.input.path, { animated: false });
  if (plan.output.format === 'jpeg') {
    pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: plan.output.quality });
  } else if (plan.output.format === 'webp') {
    pipeline = pipeline.webp({ quality: plan.output.quality });
  } else {
    pipeline = pipeline.png();
  }
  const info = await pipeline.toFile(plan.output.path);
  const outputStat = await fs.stat(plan.output.path);
  return {
    ...plan,
    output: {
      ...plan.output,
      size_bytes: outputStat.size,
      width: info.width,
      height: info.height
    },
    size_delta_bytes: outputStat.size - plan.input.size_bytes
  };
}

async function readInputFileStat(inputPath) {
  let stat;
  try {
    stat = await fs.stat(inputPath);
  } catch {
    throw new Error(`输入图片不存在：${inputPath}`);
  }
  if (!stat.isFile()) throw new Error(`输入路径不是文件：${inputPath}`);
  return stat;
}

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

function deriveOutputPath(inputPath, format) {
  const parsed = path.parse(inputPath);
  const extension = EXTENSIONS[format];
  const normalizedInputExt = normalizeExtension(parsed.ext);
  const suffix = normalizedInputExt === extension ? '-converted' : '';
  return path.join(parsed.dir, `${parsed.name}${suffix}${extension}`);
}

function normalizeExtension(extension) {
  const lower = extension.toLowerCase();
  return lower === '.jpg' ? '.jpeg' : lower;
}

function readQuality(value) {
  const quality = readConfiguredPositiveInteger(value, '--quality', DEFAULT_QUALITY);
  if (quality < 1 || quality > 100) {
    throw new Error('--quality 必须是 1 到 100 之间的整数。');
  }
  return quality;
}

function printUsage() {
  console.error('用法：convert-image-format.mjs [options] <input-image>');
  console.error('默认转换为 WebP，质量 100。');
  console.error('常用参数：--format webp|png|jpeg --quality 1..100 --output <path> --overwrite --dry-run');
}
