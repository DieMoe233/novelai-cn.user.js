#!/usr/bin/env node
// NovelAI en 词典提取与对照工具
//
// 用法: node tools/extract-en-dict.mjs
//
// 功能:
//   1. 从 novelai.net 当前构建动态定位并提取原始 en 语言字典（与 userscript 相同的定位思路）
//   2. 展平（点分键路径，数组值保持数组）后写入 dict/en.json
//   3. 与上一版 dict/en.json 对比：新增 / 移除 / 内容变化
//   4. 与 novelai-cn.user.js 的 ZH_DICT 对比：未翻译的新键、en 内容已变化而翻译可能过时的键
//
// 注意: 假设字典模块是纯数据模块（不 require 其他模块）。若未来构建违反此假设，需扩展 mock runtime。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const refPath = path.join(root, 'dict', 'en.json');
const scriptPath = path.join(root, 'novelai-cn.user.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return res.text();
}

// 在 mock webpack runtime 中注册 chunk 的模块工厂，再按源码特征 + 导出结构定位 en 字典模块
function extractEnDict(chunkSrc) {
  const factories = {};
  const cache = {};
  function reqFn(id) {
    if (cache[id] !== undefined) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    try {
      factories[id].call(module.exports, module, module.exports, reqFn);
    } catch (e) {
      delete cache[id];
      throw e;
    }
    return module.exports;
  }
  reqFn.m = factories;
  reqFn.d = (t, defs) => {
    for (const k in defs) {
      if (!Object.prototype.hasOwnProperty.call(t, k)) {
        Object.defineProperty(t, k, { enumerable: true, get: defs[k] });
      }
    }
  };
  const wp = [];
  wp.push = (chunk) => {
    for (const id in chunk[1]) factories[id] = chunk[1][id];
    // runtime 回调（chunk[2]）不需要执行：字典模块是纯数据
  };
  globalThis.self = globalThis;
  globalThis.webpackChunk_N_E = wp;
  (0, eval)(chunkSrc);

  for (const id in reqFn.m) {
    let f;
    try { f = reqFn.m[id]; } catch { continue; }
    if (typeof f !== 'function') continue;
    let src;
    try { src = Function.prototype.toString.call(f); } catch { continue; }
    if (!src.includes('lang:"en"') || !src.includes('menubar:{')) continue;
    let mod;
    try { mod = reqFn(id); } catch { continue; }
    const A = mod && mod.A;
    if (A && typeof A === 'object' && A.lang === 'en' && A.menubar && A.general && A.tier) {
      return A;
    }
  }
  throw new Error('en dict module not found in chunk');
}

function flatten(o, prefix = '', out = {}) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    const key = prefix ? prefix + '.' + k : k;
    if (Array.isArray(v) || v === null || typeof v !== 'object') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

function sortKeys(o) {
  const s = {};
  for (const k of Object.keys(o).sort()) s[k] = o[k];
  return s;
}

function parseZhDict(script) {
  const m = script.match(/const ZH_DICT = (\{.*?\});/s);
  if (!m) throw new Error('ZH_DICT not found in userscript');
  return new Function('return (' + m[1] + ');')();
}

// ---- 主流程 ----
console.log('[1/4] 抓取首页…');
const html = await fetchText('https://novelai.net/');
const appMatch = html.match(/\/_next\/static\/chunks\/pages\/_app-[a-z0-9]+\.js/);
if (!appMatch) throw new Error('首页 HTML 中未找到 _app chunk');
const chunkUrl = 'https://novelai.net' + appMatch[0];
console.log('[2/4] 下载 chunk:', chunkUrl);
const chunkSrc = await fetchText(chunkUrl);
console.log('      chunk 大小:', chunkSrc.length, 'bytes');

const dict = extractEnDict(chunkSrc);
const flat = sortKeys(flatten(dict));
console.log('[3/4] 提取到 en 字典:', Object.keys(flat).length, '个键');

let oldFlat = {};
if (fs.existsSync(refPath)) oldFlat = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const oldKeys = new Set(Object.keys(oldFlat));
const newKeys = new Set(Object.keys(flat));
const added = [...newKeys].filter((k) => !oldKeys.has(k));
const removed = [...oldKeys].filter((k) => !newKeys.has(k));
const changed = [...newKeys].filter((k) => oldKeys.has(k) && JSON.stringify(oldFlat[k]) !== JSON.stringify(flat[k]));
fs.mkdirSync(path.dirname(refPath), { recursive: true });
fs.writeFileSync(refPath, JSON.stringify(flat, null, 2) + '\n');
console.log('[4/4] 已写入', path.relative(root, refPath));

const zh = parseZhDict(fs.readFileSync(scriptPath, 'utf8'));
const untranslated = [...newKeys].filter((k) => k !== 'lang' && flat[k] !== '' && !(k in zh));
const stale = changed.filter((k) => k in zh);

console.log();
console.log('=== en 字典变化（相对 dict/en.json 上一版）===');
console.log('新增:', added.length, '| 移除:', removed.length, '| 内容变化:', changed.length);
for (const k of added) console.log('  +', k, '=>', JSON.stringify(flat[k]).slice(0, 120));
for (const k of removed) console.log('  -', k);
for (const k of changed) {
  console.log('  ~', k);
  console.log('      old:', JSON.stringify(oldFlat[k]).slice(0, 120));
  console.log('      new:', JSON.stringify(flat[k]).slice(0, 120));
}
console.log();
console.log('=== ZH_DICT 同步状态 ===');
console.log('未翻译的新键:', untranslated.length);
for (const k of untranslated) console.log('  !', k, '=>', JSON.stringify(flat[k]).slice(0, 120));
console.log('en 内容已变化、翻译可能过时:', stale.length);
for (const k of stale) console.log('  ?', k);
if (!added.length && !removed.length && !changed.length && !untranslated.length && !stale.length) {
  console.log('词典无变化，ZH_DICT 已同步 ✓');
}
