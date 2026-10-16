/**
 * 指示・資料パッケージの静的検査
 * Node.js標準機能のみ。読み取り専用。アプリの動作や要件への適合を検証するものではない
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];
const warnings = [];
const indexPath = path.join(root, '.agents', 'file-index.json');
let index;
try {
  index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!Array.isArray(index.files)) throw new Error('files配列がない');
} catch (error) {
  console.error(`ERROR: file-index.jsonを読めない: ${error.message}`);
  process.exit(1);
}
const insideRoot = (candidate) => {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};
const exists = (candidate) => fs.existsSync(candidate);
for (const relative of index.files) {
  const filename = path.resolve(root, relative);
  if (!insideRoot(filename)) { errors.push(`プロジェクト外の参照: ${relative}`); continue; }
  if (!exists(filename)) { errors.push(`必要ファイルなし: ${relative}`); continue; }
  if (!relative.endsWith('.md') || relative === 'docs/requirements.md') continue;
  const content = fs.readFileSync(filename, 'utf8');
  if ((content.match(/```/g) ?? []).length % 2 !== 0) errors.push(`コードブロック未閉鎖: ${relative}`);
  for (const match of content.matchAll(/\[([^\]\n]+)\]\(([^)]+)\)/g)) {
    const url = match[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue;
    let decoded;
    try { decoded = decodeURIComponent(url.split('#')[0]); }
    catch { errors.push(`リンクの文字コード異常: ${relative}: ${url}`); continue; }
    const target = path.resolve(path.dirname(filename), decoded);
    if (!insideRoot(target) || !exists(target)) errors.push(`参照先なし: ${relative}: ${url}`);
  }
}
const sourcePath = path.join(root, 'docs', 'requirements.md');
if (exists(sourcePath)) {
  const content = fs.readFileSync(sourcePath, 'utf8');
  const patterns = {
    FR: /^\| (P[1-6]-[A-Z]+-\d{3}) \|/gm,
    P1: /^\| (P1-[A-Z]+-\d{3}) \|/gm,
    SCREEN: /^\| ([GFAIP]-\d{3}) \|/gm,
    CON: /^\| (CON-\d{3}) \|/gm,
    NFR: /^\| (NFR-\d{3}) \|/gm,
    Q: /^\| (Q-\d{3}) \|/gm,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const ids = [...content.matchAll(pattern)].map((m) => m[1]);
    const expected = index.expectedSourceCounts[key];
    console.log(`${key}: ${ids.length} / ${expected}`);
    if (ids.length !== expected) errors.push(`原文${key}の件数変更。対応表・期待件数をレビューする`);
    if (new Set(ids).size !== ids.length) errors.push(`原文${key}にID重複`);
    const mapPath = path.join(root, 'docs', key === 'SCREEN' ? 'screen-map.md' : 'requirements-coverage.md');
    if (exists(mapPath)) {
      const mapped = fs.readFileSync(mapPath, 'utf8');
      for (const id of ids) if (!mapped.includes(id)) errors.push(`対応表にIDなし: ${id}`);
    }
    if (key === 'FR') {
      const testPath = path.join(root, 'docs', 'testing', 'acceptance-cases.md');
      if (exists(testPath)) {
        const tests = fs.readFileSync(testPath, 'utf8');
        for (const id of ids) if (!tests.includes(`AT-${id}`)) errors.push(`受入確認表にIDなし: ${id}`);
      }
    }
  }
}
let largest = 0;
const agents = index.files.filter((p) => path.basename(p) === 'AGENTS.md');
for (const rel of agents) {
  let dir = path.dirname(path.join(root, rel));
  let bytes = 0;
  while (insideRoot(dir)) {
    const ordinary = path.join(dir, 'AGENTS.md');
    const override = path.join(dir, 'AGENTS.override.md');
    const candidate = exists(override) && fs.statSync(override).size > 0 ? override : ordinary;
    if (exists(override)) warnings.push(`${path.relative(root, override)}がある。実際の指示優先関係を確認`);
    if (exists(candidate)) bytes += fs.statSync(candidate).size + 2;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  largest = Math.max(largest, bytes);
  if (bytes >= 32768) errors.push(`指示チェーンが32KiB以上: ${rel}: ${bytes} bytes`);
}
console.log(`AGENTS.md: ${agents.length} files`);
console.log(`最大プロジェクト指示チェーン: ${largest} bytes（グローバル指示は含まない）`);
for (const warning of new Set(warnings)) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
console.log('この検査は参照切れ・件数・容量の静的検査のみ。全チャット照合/アプリ試験/実機確認ではない');
if (errors.length === 0) console.log('PASS: パッケージの静的検査');
process.exitCode = errors.length === 0 ? 0 : 1;
