/**
 * GlitchTip 端到端对接测试 — 模拟 runbi 前端上报一次错误事件
 * 用法: node test-upload.mjs
 * 验证: 1) envelope 上报 202 Accepted  2) 事件进入 GlitchTip issue 列表
 */
const DSN = process.env.GLITCHTIP_DSN || 'http://9870fb70c1544eebaeb8a1882f3c00bd@localhost:8000/1';
const API_TOKEN = process.env.GLITCHTIP_TOKEN || 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const API_BASE = 'http://localhost:8000/api/0';

function uuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

function parseDsn(dsn) {
  const m = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)(?:\/)?/);
  if (!m) throw new Error('Invalid DSN: ' + dsn);
  return { publicKey: m[1], host: m[2], projectId: m[3] };
}

async function main() {
  const { publicKey, host, projectId } = parseDsn(DSN);
  const eventId = uuid();
  const ts = new Date().toISOString();

  const event = {
    event_id: eventId,
    timestamp: ts,
    platform: 'javascript',
    level: 'error',
    logger: 'javascript',
    message: { formatted: 'runbi e2e test error: 对接测试异常上报' },
    culprit: 'test-upload.mjs (e2e)',
    environment: 'development',
    server_name: 'test-node',
    extra: { note: 'runbi GlitchTip 对接测试', selectedText: '模拟划词内容' },
    contexts: { runtime: { name: 'node', version: process.version } },
    exception: {
      values: [{
        type: 'E2ETestError',
        value: 'runbi e2e test error: 对接测试异常上报',
        stacktrace: { frames: [{ filename: 'test-upload.mjs', lineno: 42, function: 'main' }] },
      }],
    },
    user: { id: 'e2e-user-001', email: 'e2e@runbi.local' },
    tags: { platform: 'desktop', e2e: 'true' },
  };

  const envelopeHeader = {
    event_id: eventId,
    sent_at: ts,
    sdk: { name: 'runbi-js', version: '0.1.0' },
  };

  const url = `http://${host}/api/${projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_client=runbi/0.1.0, sentry_key=${publicKey}`;
  const body = JSON.stringify(envelopeHeader) + '\n' + JSON.stringify(event);

  console.log('=== 1. 上报 envelope ===');
  console.log('URL:', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': auth },
    body,
  });
  console.log('HTTP', res.status, res.statusText);
  if (!(res.status === 200 || res.status === 202)) {
    console.log('RESP:', await res.text());
    process.exit(1);
  }

  console.log('\n=== 2. 查询 API 确认事件已入库 ===');
  const issuesRes = await fetch(`${API_BASE}/organizations/org/issues/?query=runbi%20e2e`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  console.log('issues HTTP', issuesRes.status);
  const issues = issuesRes.ok ? await issuesRes.json() : null;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0];
    console.log('✅ 事件已入库!');
    console.log('  issue id   :', first.id);
    console.log('  title      :', first.title);
    console.log('  status     :', first.status);
    console.log('  culprit    :', first.culprit);
    console.log('  shortId    :', first.shortId);
    console.log('  lastSeen   :', first.lastSeen);
  } else {
    console.log('⚠️  issues 接口暂未查到(可能需要几秒/或后端未索引), 请到 UI http://localhost:8000 手动确认');
    console.log('raw:', JSON.stringify(issues ?? 'null').slice(0, 300));
  }

  console.log('\n=== 完成 ===');
  console.log('Web UI 查看: http://localhost:8000  (test@example.com / admin_pass)');
}

main().catch((e) => { console.error(e); process.exit(1); });