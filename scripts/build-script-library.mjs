/**
 * @file scripts/build-script-library.mjs
 * Build shared/data/script-templates.json from a customer-service-scripts checkout (MIT).
 * Usage: node scripts/build-script-library.mjs <path-to-csx-scripts-checkout>
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_LABELS = {
  aliexpress: '速卖通', amazon: '亚马逊', ebay: 'eBay', jd: '京东', lazada: 'Lazada',
  shopee: 'Shopee', shopify: 'Shopify', taobao: '淘宝', temu: 'Temu',
  'tiktok-shop': 'TikTok Shop', wish: 'Wish', general: '通用',
};
const SCENES = { presales: '售前咨询', sales: '售中转化', aftersales: '售后保障' };
const FILE_PHASES = { presales: 'presales', sales: 'sales', aftersales: 'aftersales' };

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/**
 * Parse one script md file into template items.
 * Tolerates: BOM, CRLF, items as numbered `## N.` or `### N.` headings,
 * phase sections as H2 containing 售前/售后/售中/销售, scenario line `**适用场景：** ...`.
 */
function parseScriptFile(text, filePhaseFallback) {
  const lines = stripBom(text).split(/\r?\n/);
  const h1 = /^#\s+(.+)$/.exec(lines[0] || '');
  const title = h1 ? h1[1].trim() : '';
  const items = [];
  let phase = null; // set by nearest preceding phase H2
  let count = 0;
  let cur = null; // { index, sectionTitle, scenario, template: string[] | null, fenceOpen }
  const close = () => {
    if (cur && cur.template !== null) {
      items.push({ index: cur.index, sectionTitle: cur.sectionTitle, scenario: cur.scenario, template: cur.template.join('\n').trim(), phase: cur.phase });
    }
    cur = null;
  };
  for (const line of lines.slice(1)) {
    const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (cur && cur.fenceOpen) {
      if (line.startsWith('```')) cur.fenceOpen = false;
      else if (cur.template !== null) cur.template.push(line);
      continue;
    }
    if (heading) {
      close();
      const [, hashes, text0] = heading;
      if (/^\d+\s*[.、．)]/.test(text0)) {
        cur = { index: ++count, sectionTitle: text0.replace(/^\d+\s*[.、．)]\s*/, ''), scenario: '', template: null, fenceOpen: false, phase: phase ?? filePhaseFallback ?? 'sales' };
      } else if (hashes.length === 2) {
        if (/售前/.test(text0)) phase = 'presales';
        else if (/售后/.test(text0)) phase = 'aftersales';
        else if (/售中|销售/.test(text0)) phase = 'sales';
        // 使用说明/使用技巧 etc. → not a phase, keep current
      }
      continue;
    }
    if (!cur) continue;
    if (cur.template === null) {
      if (line.startsWith('```')) { cur.template = []; cur.fenceOpen = true; continue; }
      if (!cur.scenario) {
        const m = /适用场景\*?\*?\s*[：:]\**\*?\s*(.*)$/.exec(line);
        if (m) cur.scenario = m[1].trim();
      }
    }
  }
  close();
  return { title, items };
}

function main() {
  const root = process.argv[2];
  if (!root || !existsSync(join(root, 'industries'))) {
    console.error('Usage: node scripts/build-script-library.mjs <path-to-csx-scripts-checkout>');
    process.exit(1);
  }

  const industries = { general: '通用' };
  const items = [];
  const counts = { general: 0, industry: 0, platform: 0 };

  const push = (sourcePath, meta, parsed) => {
    for (const it of parsed.items) {
      items.push({
        id: `${sourcePath}#${it.index}`,
        sectionTitle: it.sectionTitle,
        scenario: it.scenario,
        phase: it.phase,
        template: it.template,
        variables: [...new Set([...it.template.matchAll(/\[([^\[\]]+)\]/g)].map((m) => m[1]))],
        ...meta,
      });
    }
    counts[meta.group] += parsed.items.length;
  };

  for (const f of readdirSync(join(root, 'general'))) {
    if (!f.endsWith('.md')) continue;
    const parsed = parseScriptFile(readFileSync(join(root, 'general', f), 'utf8'), FILE_PHASES[f.replace(/\.md$/, '')] ?? 'sales');
    push(`general/${f}`, { group: 'general', platform: 'general', industry: 'general' }, parsed);
  }
  for (const f of readdirSync(join(root, 'industries'))) {
    if (!f.endsWith('.md')) continue;
    const slug = f.replace(/\.md$/, '');
    const parsed = parseScriptFile(readFileSync(join(root, 'industries', f), 'utf8'), 'sales');
    industries[slug] = parsed.title.replace(/客服话术$/, '').trim() || slug;
    push(`industries/${f}`, { group: 'industry', platform: 'general', industry: slug }, parsed);
  }
  for (const d of readdirSync(join(root, 'platforms'))) {
    for (const f of readdirSync(join(root, 'platforms', d))) {
      if (!f.endsWith('.md')) continue;
      const parsed = parseScriptFile(readFileSync(join(root, 'platforms', d, f), 'utf8'), FILE_PHASES[f.replace(/\.md$/, '')] ?? 'sales');
      push(`platforms/${d}/${f}`, { group: 'platform', platform: d, industry: 'general' }, parsed);
    }
  }

  const data = {
    source: 'https://github.com/akakooluo-ai/customer-service-scripts (MIT)',
    industries,
    platforms: PLATFORM_LABELS,
    scenes: SCENES,
    items,
  };

  const outDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'shared', 'data');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'script-templates.json'), JSON.stringify(data));

  console.log(`general: ${counts.general}, industry: ${counts.industry}, platform: ${counts.platform}, total: ${items.length}`);

  // Cross-check against upstream prebuilt data if present.
  const prebuilt = join(root, 'docs', 'data', 'templates.json');
  if (existsSync(prebuilt)) {
    const ref = JSON.parse(readFileSync(prebuilt, 'utf8'));
    const refTotal = (ref.items ?? ref).length;
    const off = Math.abs(items.length - refTotal) / refTotal;
    console.log(`cross-check: upstream=${refTotal}, parsed=${items.length}, diff=${(off * 100).toFixed(1)}%${off > 0.05 ? ' — WARN: >5% off, check parser' : ' (within 5%)'}`);
  }
}

main();
