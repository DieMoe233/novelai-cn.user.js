# novelai-cn.user.js

基于油猴的 NovelAI 界面中文化脚本。

## 说明

- `novelai-cn.user.js` —— 油猴脚本本体。通过 webpack 反射动态定位站点运行时 en 语言字典并改写为中文（不依赖构建产物中的模块 ID）。
- `dict/en.json` —— 站点当前构建的原始英文词典参照（展平的点分键路径，数组值保持数组），由维护工具自动生成。
- `tools/extract-en-dict.mjs` —— 维护工具：从 novelai.net 当前构建重新提取 en 词典、更新 `dict/en.json`，并输出差异报告。

## 站点更新后维护

站点更新导致汉化失效或出现英文时，运行：

```bash
node tools/extract-en-dict.mjs
```

工具会输出：

1. **en 词典变化**（相对 `dict/en.json` 上一版）：新增 / 移除 / 内容变化的键；
2. **未翻译的新键**（en 有、`ZH_DICT` 没有且非空）；
3. **en 内容已变化、翻译可能过时的键**（键名没变但英文原文变了）。

按报告更新 `novelai-cn.user.js` 里的 `ZH_DICT` 并提升 `@version` 即可。注意：词典中的数组值（如文件名模板帮助的 `tokens`/`filters`/`characterFilters` 二维数组）必须整体替换为翻译后的数组，不能替换成字符串，否则界面代码会报错。
