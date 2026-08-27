#!/usr/bin/env node
/**
 * 校验 xcimoc-js-sources 仓库：
 *  1. index.json 与 sources/ 目录一致性
 *  2. 每个脚本语法正确、SOURCE 元数据合法、必需函数齐全
 * 用法: node scripts/validate.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FUNCS = ['getSearchRequest', 'parseSearch', 'getInfoRequest', 'parseInfo', 'getImagesRequest', 'parseImages'];

// 加载本仓库自带 SDK（源脚本基于 MangaSource/installSource，须先注入）
const SDK_PATH = join(ROOT, 'source_sdk.js');
const SDK = existsSync(SDK_PATH) ? readFileSync(SDK_PATH, 'utf8') : '';

function loadIndex() {
  return JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
}

function validateScript(script, name) {
  const errors = [];
  const sandbox = {
    console,
    SOURCE: undefined,
    hostCall: (method, argsJson) => {
      // 仅 stub 仍需宿主的能力；计算类工具（md5/base64/lz64/aes/urlencode）已纯 JS 化
      let args = {};
      try { args = JSON.parse(argsJson || '{}'); } catch {}
      switch (method) {
        case 'dom': return JSON.stringify({ id: -1 });
        case 'state':
        case 'setting':
        case 'login':
        case 'log': return 'null';
        default: return 'null';
      }
    },
    fetch: () => { throw new Error('fetch stub'); },
  };
  const ctx = vm.createContext(sandbox);
  try {
    vm.runInContext(SDK + '\n' + script, ctx, { filename: name });
  } catch (e) {
    return [`语法/执行错误: ${e.message}`];
  }
  const source = ctx.SOURCE;
  if (!source || typeof source !== 'object') {
    errors.push('缺少 SOURCE 元数据对象');
    return errors;
  }
  if (typeof source.type !== 'number' || !Number.isInteger(source.type) || source.type < 0) {
    errors.push(`SOURCE.type 非法: ${source.type}`);
  }
  if (!source.title) errors.push('SOURCE.title 缺失');
  if (!source.baseUrl) errors.push('SOURCE.baseUrl 缺失');
  for (const fn of REQUIRED_FUNCS) {
    if (typeof ctx[fn] !== 'function') errors.push(`缺少必需函数: ${fn}`);
  }
  // 可选函数必须是函数（如果定义的话）
  for (const fn of ['getChapterRequest', 'getLazyRequest', 'parseLazy', 'getCheckRequest',
    'parseCheck', 'getUrl', 'getHeader', 'parseCategory', 'getCategoryRequest', 'getCategories']) {
    if (ctx[fn] !== undefined && typeof ctx[fn] !== 'function') {
      errors.push(`"${fn}" 不是函数`);
    }
  }
  return errors;
}

let fail = 0;
const index = loadIndex();
console.log(`清单: ${index.sources.length} 个源\n`);

// 1. 清单内每个源的文件存在 + 校验
for (const entry of index.sources) {
  const file = join(ROOT, entry.url);
  const name = entry.url.split('/').pop();
  if (!existsSync(file)) {
    console.log(`❌ ${entry.title} (type=${entry.type}): 文件不存在 ${entry.url}`);
    fail++;
    continue;
  }
  const script = readFileSync(file, 'utf8');
  const errors = validateScript(script, name);
  if (errors.length) {
    console.log(`❌ ${entry.title} (type=${entry.type}): ${errors.join('; ')}`);
    fail++;
  } else {
    console.log(`✅ ${entry.title} (type=${entry.type})`);
  }
}

// 2. sources/ 目录中多余的脚本（不在清单里）
const files = readdirSync(join(ROOT, 'sources')).filter(f => f.endsWith('.js'));
for (const f of files) {
  if (!index.sources.some(e => e.url === `sources/${f}`)) {
    console.log(`⚠️ sources/${f} 不在 index.json 中`);
  }
}

console.log(`\n结果: ${fail === 0 ? '全部通过' : fail + ' 个失败'}`);
process.exit(fail === 0 ? 0 : 1);
