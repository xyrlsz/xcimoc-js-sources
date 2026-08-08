#!/usr/bin/env node
/**
 * 冒烟测试：加载每个脚本，实际调用 getSearchRequest/getInfoRequest/getImagesRequest/
 * getHeader/getCategories（不依赖真实网络，DOM/fetch 用会抛错的 stub），
 * 捕获运行时错误与返回结构异常。
 * 用法: node scripts/smoke.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));

// 加载主仓库的 SDK（与 App 运行时一致；缺失时降级为不注入）
const SDK_PATH = join(ROOT, '..', 'XCimoc', 'app', 'src', 'main', 'assets', 'js', 'source_sdk.js');
const SDK = existsSync(SDK_PATH) ? readFileSync(SDK_PATH, 'utf8') : '';

function makeSandbox(name) {
  const failures = [];
  const sandbox = {
    console,
    hostCall: (method, argsJson) => {
      const args = JSON.parse(argsJson || '[]');
      switch (method) {
        case 'urlencode': return encodeURIComponent(args[0] || '');
        case 'urldecode':
          try { return decodeURIComponent(args[0] || ''); } catch { return args[0] || ''; }
        case 'base64encode': return Buffer.from(args[0] || '', 'utf8').toString('base64');
        case 'base64decode': return Buffer.from(args[0] || '', 'base64').toString('utf8');
        case 'base64url_decode':
          return Buffer.from(String(args[0] || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        case 'md5': return 'MD5STUB';
        case 't2s': return args[0] || '';
        case 'aes_cbc':
        case 'aes_cbc_raw': return '';
        case 'set_state': return 'null';
        case 'get_state': return '""';
        case 'fetch':
        case 'dom_selectAll':
        case 'dom_text':
        case 'dom_attr':
          throw new Error('网络/DOM 不应在冒烟测试中被调用: ' + method);
        default:
          throw new Error('unknown hostCall: ' + method);
      }
    },
    fetch: () => { throw new Error('fetch 不应在冒烟测试中被调用'); },
    log: (...a) => failures.push(a.join(' ')),
  };
  const ctx = vm.createContext(sandbox);
  return { ctx, failures };
}

function checkRequestShape(fn, result) {
  // 请求构建函数：允许 null 或 {url, method, headers, body}
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') {
    throw new Error(`${fn} 返回非对象: ${JSON.stringify(result)}`);
  }
  if (!result.url && !result.body) {
    throw new Error(`${fn} 缺少 url: ${JSON.stringify(result).slice(0, 120)}`);
  }
  return null;
}

let pass = 0, fail = 0;
for (const entry of index.sources) {
  const file = join(ROOT, entry.url);
  const script = readFileSync(file, 'utf8');
  const { ctx, failures } = makeSandbox(entry.title);
  try {
    vm.runInContext(SDK + '\n' + script, ctx, { filename: entry.url });
  } catch (e) {
    console.log(`❌ ${entry.title}: 加载失败 ${e.message}`);
    fail++;
    continue;
  }
  let errs = [];
  const calls = [
    ['getSearchRequest', ['测试', 1]],
    ['getInfoRequest', ['testcid']],
    ['getImagesRequest', ['testcid', 'testpath']],
    ['getHeader', []],
    ['getCategories', []],
  ];
  for (const [fn, args] of calls) {
    if (typeof ctx[fn] !== 'function') continue;
    try {
      const r = ctx[fn](...args);
      if (fn === 'getCategories') {
        if (r !== undefined && r !== null && (!r.format || typeof r.format !== 'string')) {
          errs.push(`${fn} 缺少 format`);
        }
      } else if (fn === 'getHeader') {
        // headers 允许 null 或对象
        if (r !== null && r !== undefined && typeof r !== 'object') {
          errs.push(`${fn} 返回非对象`);
        }
      } else {
        checkRequestShape(fn, r);
      }
    } catch (e) {
      errs.push(`${fn}: ${e.message}`);
    }
  }
  errs = errs.concat(failures);
  if (errs.length) {
    console.log(`❌ ${entry.title}: ${errs.join('; ')}`);
    fail++;
  } else {
    console.log(`✅ ${entry.title}`);
    pass++;
  }
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
