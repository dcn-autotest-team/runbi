/**
 * @file shared/core/localModels.ts
 * 本地大模型零配置探测（缺陷7）：静默探测 Ollama / LM Studio 的常见本地端口，
 * 命中即返回可用端点与已装模型清单，供设置页亮绿灯与一键直连。
 * ponytail: 只探测两个约定端口，不做网段扫描；失败一律静默返回空数组。
 */

export interface LocalModelProbeResult {
  /** 对应 PROVIDER_PRESETS 的 provider id；LM Studio 复用 'custom'（仅自动填 baseUrl/model）。 */
  providerId: 'ollama' | 'custom';
  label: string;
  baseUrl: string;
  models: string[];
}

interface ProbeTarget {
  providerId: 'ollama' | 'custom';
  label: string;
  baseUrl: string;
  listUrl: string;
  /** 从响应 JSON 提取模型 id 列表。 */
  parse: (json: unknown) => string[];
}

function parseNameList(json: unknown, key: string, idField: string): string[] {
  const bucket = (json as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(bucket)) return [];
  return bucket
    .map((m) => String((m as Record<string, unknown> | null)?.[idField] ?? '').trim())
    .filter(Boolean);
}

export const LOCAL_PROBE_TARGETS: ProbeTarget[] = [
  {
    providerId: 'ollama',
    label: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    listUrl: 'http://localhost:11434/api/tags',
    parse: (json) => parseNameList(json, 'models', 'name'),
  },
  {
    providerId: 'custom',
    label: 'LM Studio (本地)',
    baseUrl: 'http://localhost:1234/v1',
    listUrl: 'http://localhost:1234/v1/models',
    parse: (json) => parseNameList(json, 'data', 'id'),
  },
];

/**
 * 并发探测所有本地端点；单点超时/失败不影响其他端点，全部失败返回 []。
 * fetchImpl 参数供测试注入，不传则用宿主 fetch（与 LLM 调用同源策略一致）。
 */
export async function probeLocalModels(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  timeoutMs = 1200
): Promise<LocalModelProbeResult[]> {
  const probes = LOCAL_PROBE_TARGETS.map(async (target): Promise<LocalModelProbeResult | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(target.listUrl, { signal: controller.signal });
      if (!res.ok) return null;
      const models = target.parse(await res.json());
      return models.length ? { providerId: target.providerId, label: target.label, baseUrl: target.baseUrl, models } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  const results = await Promise.all(probes);
  return results.filter((r): r is LocalModelProbeResult => r !== null);
}
