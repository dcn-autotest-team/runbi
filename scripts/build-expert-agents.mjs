/**
 * @file scripts/build-expert-agents.mjs
 * Build shared/data/expert-agents.json from an agency-agents-zh checkout (MIT).
 * Usage: node scripts/build-expert-agents.mjs <path-to-agency-agents-zh-checkout>
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORY_LABELS = {
  academic: '学术', company: '公司治理', design: '设计', engineering: '工程', finance: '金融财务',
  'game-development': '游戏开发', gis: '地理信息', hr: '人力资源', integrations: '集成开发',
  legal: '法务', marketing: '市场营销', 'paid-media': '付费媒体', product: '产品',
  'project-management': '项目管理', sales: '销售', security: '安全', 'spatial-computing': '空间计算',
  specialized: '专项领域', strategy: '战略', 'supply-chain': '供应链', support: '客户支持', testing: '测试',
};

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** Minimal frontmatter parse: first occurrence of name/description/emoji, single-line values. */
function parseFrontmatter(text) {
  const t = stripBom(text);
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(t);
  if (!m) return null;
  const pick = (key) => {
    const v = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(m[1]);
    if (!v) return '';
    const s = v[1].trim();
    return /^(".*"|'.*')$/.test(s) ? s.slice(1, -1) : s;
  };
  return { name: pick('name'), description: pick('description'), emoji: pick('emoji'), body: t.slice(m.index + m[0].length).trim() };
}

function main() {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    console.error('Usage: node scripts/build-expert-agents.mjs <path-to-agency-agents-zh-checkout>');
    process.exit(1);
  }

  const agents = [];
  const perCategory = {};
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const dir = join(root, category);
    if (!existsSync(dir)) continue;
    const files = [];
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) files.push(p);
      }
    })(dir);
    let count = 0;
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(f, 'utf8'));
      if (!fm || !fm.name || !fm.body) continue; // skip non-agent docs (READMEs, playbooks)
      agents.push({
        id: `${category}/${basename(f, '.md')}`,
        name: fm.name,
        emoji: fm.emoji,
        description: fm.description,
        category,
        body: fm.body,
      });
      count++;
    }
    perCategory[category] = count;
  }

  const data = {
    source: 'https://github.com/jnMetaCode/agency-agents-zh (MIT)',
    categories: CATEGORY_LABELS,
    agents,
  };

  const outDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'shared', 'data');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'expert-agents.json'), JSON.stringify(data));

  for (const [c, n] of Object.entries(perCategory)) console.log(`${c}: ${n}`);
  console.log(`total: ${agents.length}`);
}

main();
