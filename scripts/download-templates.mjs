/**
 * 模板本地化下载脚本（一次性，非应用代码）。
 *
 * 从模板数据源 https://d2n.moe/petpet 下载全部 petpet 模板
 * + 2 个字体到 public/data/templates/ 与 public/data/fonts/，并重建
 * public/data/templates/index.json。
 *
 * 特性：
 *   - 并发 8 下载（可调 CONCURRENCY）
 *   - 断点续传：已存在且大小匹配的文件跳过（重跑安全）
 *   - 失败重试 3 次
 *   - 单模板失败不中断，最后汇总报告
 *   - 进度显示
 *
 * 运行：node scripts/download-templates.mjs
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const templatesDir = resolve(root, "public/data/templates");
const fontsDir = resolve(root, "public/data/fonts");

const REMOTE = "https://d2n.moe/petpet";
const DATA_PATH = "data/xmmt.dituon.petpet";
const CONCURRENCY = 8;
const MAX_RETRY = 3;

// 2 个模板字体（来自远程 index.json 的 fontList）
const FONTS = ["Aller-Bold.ttf", "MiSans-Bold.ttf"];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** 下载单个文件到本地，断点续传：已存在且大小匹配则跳过。返回 true=实际下载，false=跳过。 */
async function downloadFile(url, dest, retry = 0) {
  // 断点续传检查
  if (existsSync(dest)) {
    try {
      const localSize = statSync(dest).size;
      const headRes = await fetch(url, { method: "HEAD" });
      if (headRes.ok) {
        const remoteSize = Number(headRes.headers.get("content-length"));
        if (remoteSize && localSize === remoteSize) return false; // 完整，跳过
      }
    } catch {
      // HEAD 失败则继续完整下载
    }
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    return true;
  } catch (e) {
    if (retry < MAX_RETRY - 1) {
      await new Promise((r) => setTimeout(r, 500 * (retry + 1)));
      return downloadFile(url, dest, retry + 1);
    }
    throw e;
  }
}

/** 下载一个模板的 data.json + 所有背景帧。返回 { key, length, downloaded, skipped } */
async function downloadTemplate(key, length) {
  const tmplDir = resolve(templatesDir, key);
  const dataJsonPath = resolve(tmplDir, "data.json");

  // 下载 data.json
  await downloadFile(`${REMOTE}/${DATA_PATH}/${key}/data.json`, dataJsonPath);

  // 背景帧：0..length-1（length=0 的特效模板无帧）
  let downloaded = 0;
  let skipped = 0;
  for (let i = 0; i < length; i++) {
    const dest = resolve(tmplDir, `${i}.png`);
    const did = await downloadFile(`${REMOTE}/${DATA_PATH}/${key}/${i}.png`, dest);
    if (did) downloaded++;
    else skipped++;
  }
  return { key, length, downloaded, skipped };
}

function readTemplateData(key) {
  const dataJsonPath = resolve(templatesDir, key, "data.json");
  try {
    return JSON.parse(readFileSync(dataJsonPath, "utf-8"));
  } catch {
    return {};
  }
}

/** 并发池：逐个跑 thunk，最多 concurrency 个同时。 */
async function pool(items, concurrency, worker) {
  const results = [];
  let index = 0;
  let done = 0;
  const total = items.length;
  async function runner() {
    while (index < total) {
      const cur = index++;
      try {
        results[cur] = await worker(items[cur], cur);
      } catch (e) {
        results[cur] = { error: e.message, item: items[cur] };
      }
      done++;
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  进度: ${done}/${total} (${pct}%) `);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  process.stdout.write("\n");
  return results;
}

async function main() {
  console.log("=== 模板本地化下载 ===");
  console.log(`远程: ${REMOTE}`);
  console.log(`本地: ${templatesDir}`);
  console.log();

  // 1. 读远程索引
  console.log("拉取远程索引...");
  const [index, indexMap] = await Promise.all([
    fetchJson(`${REMOTE}/index.json`),
    fetchJson(`${REMOTE}/index.map.json`),
  ]);
  const dataList = index.dataList;
  const lengthMap = indexMap.length || {};
  const typeMap = indexMap.type || {};
  const aliasMap = indexMap.alias || {};
  console.log(
    `共 ${dataList.length} 个模板，${Object.values(lengthMap).reduce((a, b) => a + b, 0)} 帧背景图`,
  );
  console.log();

  // 2. 下载模板
  console.log("下载模板...");
  const tmplResults = await pool(dataList, CONCURRENCY, (key) =>
    downloadTemplate(key, lengthMap[key] || 0),
  );

  const failed = tmplResults.filter((r) => r?.error);
  if (failed.length) {
    console.log(`\n⚠ ${failed.length} 个模板下载失败:`);
    for (const f of failed) console.log(`  - ${f.item}: ${f.error}`);
  }

  const totalDownloaded = tmplResults.reduce((a, r) => a + (r.downloaded || 0), 0);
  const totalSkipped = tmplResults.reduce((a, r) => a + (r.skipped || 0), 0);
  console.log(`模板帧：下载 ${totalDownloaded}，跳过(已存在) ${totalSkipped}`);
  console.log();

  // 3. 下载字体
  console.log("下载字体...");
  mkdirSync(fontsDir, { recursive: true });
  for (const font of FONTS) {
    const dest = resolve(fontsDir, font);
    const did = await downloadFile(`${REMOTE}/${DATA_PATH}/fonts/${font}`, dest);
    console.log(`  ${font}: ${did ? "已下载" : "已存在(跳过)"}`);
  }
  console.log();

  // 4. 重建 index.json
  console.log("重建 index.json...");
  const templates = [];
  let hiddenCount = 0;
  for (const key of dataList) {
    const template = readTemplateData(key);
    if (template.hidden === true) {
      hiddenCount++;
      continue;
    }

    const alias = aliasMap[key] || [];
    const length = lengthMap[key] || 0;
    templates.push({
      key,
      type: typeMap[key] === "GIF" ? "GIF" : "IMG",
      length,
      alias,
      // 描述优先使用第一个中文别名；没有别名时使用模板键名。
      description: alias.find((a) => /[一-鿿]/.test(a)) || alias[0] || key,
    });
  }

  const localIndex = {
    version: "1.0.0",
    templates,
  };
  writeFileSync(resolve(templatesDir, "index.json"), `${JSON.stringify(localIndex, null, 2)}\n`);
  console.log(`已写入 ${localIndex.templates.length} 个模板到 index.json`);
  if (hiddenCount) console.log(`已跳过 ${hiddenCount} 个隐藏模板`);

  console.log();
  console.log("=== 完成 ===");
  if (failed.length) {
    console.log(`⚠ ${failed.length} 个失败，可重跑脚本（断点续传）`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n致命错误:", e);
  process.exit(1);
});
