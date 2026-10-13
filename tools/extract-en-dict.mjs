#!/usr/bin/env node
// NovelAI en 词典提取与对照工具（Turbopack 构建）
//
// 用法: node tools/extract-en-dict.mjs
//
// 功能:
//   1. 抓取 novelai.net 首页，逐个下载其引用的 JS chunk，
//      在其中定位 en 语言字典模块（源码特征 lang:"en" + 结构校验）并提取字典对象字面量
//   2. 展平（点分键路径，数组值保持数组）后写入 dict/en.json
//   3. 与上一版 dict/en.json 对比：新增 / 移除 / 内容变化
//   4. 与 novelai-cn.user.js 的 ZH_DICT 对比：未翻译的新键、en 内容已变化而翻译可能过时的键

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

// ---- 源码级提取：模板感知的括号配对，从 {lang:"en" 切出完整对象字面量 ----
function skipQuoted(text, i, quote) {
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}

function skipTemplate(text, i) {
  i++; // 跳过起始反引号
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\u0060') { i++; break; }
    if (c === '$' && text[i + 1] === '{') {
      i += 2;
      let ed = 1;
      while (i < text.length && ed > 0) {
        const e = text[i];
        if (e === '"' || e === "'") { i = skipQuoted(text, i, e); continue; }
        if (e === '\u0060') { i = skipTemplate(text, i); continue; }
        if (e === '{') ed++;
        else if (e === '}') ed--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

function extractLiteral(text, startIdx) {
  let depth = 0;
  let i = startIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { i = skipQuoted(text, i, ch); continue; }
    if (ch === '\u0060') { i = skipTemplate(text, i); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
    i++;
  }
  return null;
}

function extractEnDictFromChunk(src) {
  const keyIdx = src.indexOf('{lang:"en"');
  if (keyIdx === -1) return null;
  const lit = extractLiteral(src, keyIdx);
  if (!lit) return null;
  try {
    const dict = new Function('return (' + lit + ');')();
    if (dict && dict.lang === 'en' && dict.general && dict.menubar && dict.tier) return dict;
  } catch (e) { /* 字面量切错则忽略 */ }
  return null;
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
console.log('[1/4] 抓取首页并收集 chunk 列表…');
const html = await fetchText('https://novelai.net/');
const chunkUrls = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"\s]+\.js/g)].map(m => m[0]))];
if (!chunkUrls.length) throw new Error('首页 HTML 中未找到任何 chunk');
console.log('      共', chunkUrls.length, '个 chunk');

let dict = null;
let hitUrl = '';
for (const u of chunkUrls) {
  const url = 'https://novelai.net' + u;
  const src = await fetchText(url);
  dict = extractEnDictFromChunk(src);
  if (dict) { hitUrl = url; break; }
}
if (!dict) throw new Error('在所有 chunk 中都未找到 en 字典模块');
console.log('[2/4] 找到字典:', hitUrl);

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
