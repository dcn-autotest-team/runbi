/**
 * @file desktop/src/components/AdvancedSettings.tsx
 * 高级设置：个人词库（缺陷5）+ 文风标杆样本（缺陷5）+ 本地模型零配置探测（缺陷7）。
 * 自包含受控组件：主线程挂载时传 settings + onPatch 即可，持久化由主线程负责。
 * 挂载示例：<AdvancedSettings settings={settings} onPatch={patchSettings} />
 */
import React, { useEffect, useState } from 'react';
import type { AppSettings, GlossaryRule } from '@runbi/shared/types';
import { probeLocalModels, type LocalModelProbeResult } from '@runbi/shared/core';
import { RefreshCw } from './Icons';

export interface AdvancedSettingsProps {
  settings: AppSettings;
  /** 局部更新设置（主线程负责持久化） */
  onPatch: (patch: Partial<AppSettings>) => void;
}

const GLOSSARY_KINDS: Array<{ value: GlossaryRule['kind']; label: string; hint: string }> = [
  { value: 'replace', label: '术语映射', hint: '输出中该词一律替换为目标词' },
  { value: 'keep', label: '受保护词', hint: '该词保持原样，禁止翻译改写（如缩写、代号）' },
  { value: 'ban', label: '禁忌词', hint: '输出中不得出现该词' },
];

const MAX_SAMPLES = 3;

/** 与 App.tsx customActions 同款 id 生成（Date.now+随机，避免快速连点撞车）。 */
const newRuleId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ settings, onPatch }) => {
  // 词库草稿：一次性从 settings 初始化，之后以草稿为编辑真相，避免受控回写吞掉正在输入的
  // 半填残项（与 App.tsx customActions 惯例一致：残项留在界面标黄，回传前过滤）。
  const [rules, setRules] = useState<GlossaryRule[]>(() => settings.glossary ?? []);
  // 文风样本草稿：默认显示 1 个空段，最多 3 个。
  const [samples, setSamples] = useState<string[]>(() =>
    settings.styleSamples?.length ? settings.styleSamples : ['']
  );
  // 本地模型探测结果：null = 尚未完成首次探测。
  const [probes, setProbes] = useState<LocalModelProbeResult[] | null>(null);
  const [probing, setProbing] = useState<boolean>(false);
  // 每个端点的模型下拉选中值（key = baseUrl）。
  const [pickedModel, setPickedModel] = useState<Record<string, string>>({});

  const runProbe = () => {
    setProbing(true);
    // 探测自带 1.2s 超时且失败静默返回 []，无需在卸载时取消。
    probeLocalModels()
      .then((results) => setProbes(results))
      .finally(() => setProbing(false));
  };

  useEffect(runProbe, []);

  /** 编辑一条词库规则；from 为空的残项不回传（prompt 编译端也会兜底过滤）。 */
  const editRule = (index: number, patch: Partial<GlossaryRule>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setRules(next);
    onPatch({ glossary: next.filter((r) => r.from.trim()) });
  };

  const addRule = () =>
    setRules((prev) => [...prev, { id: newRuleId(), kind: 'replace', from: '', to: '' }]);

  const removeRule = (index: number) => {
    const next = rules.filter((_, i) => i !== index);
    setRules(next);
    onPatch({ glossary: next.filter((r) => r.from.trim()) });
  };

  const editSample = (index: number, value: string) => {
    const next = samples.map((s, i) => (i === index ? value : s));
    setSamples(next);
    onPatch({ styleSamples: next.map((s) => s.trim()).filter(Boolean) });
  };

  const activeRuleCount = rules.filter((r) => r.from.trim()).length;
  const activeSampleCount = samples.filter((s) => s.trim()).length;

  return (
    <div className="space-y-2.5">
      {/* ── 区块 1：个人词库（Glossary & Rulebook） ── */}
      <section className="runbi-settings-card space-y-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-300">个人词库（术语 / 保护 / 禁忌）</span>
          <span className="text-[10px] text-slate-500">
            {activeRuleCount > 0 ? `已生效 ${activeRuleCount} 条` : '未设置'}
          </span>
        </div>

        {rules.map((rule, i) => {
          const kindMeta = GLOSSARY_KINDS.find((k) => k.value === rule.kind) ?? GLOSSARY_KINDS[0];
          const incomplete = !rule.from.trim();
          return (
            <div key={rule.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <select
                  aria-label={`规则类型 ${i + 1}`}
                  value={rule.kind}
                  onChange={(e) => editRule(i, { kind: e.target.value as GlossaryRule['kind'] })}
                  className="runbi-form-control w-24 shrink-0 cursor-pointer text-xs"
                >
                  {GLOSSARY_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  value={rule.from}
                  onChange={(e) => editRule(i, { from: e.target.value })}
                  placeholder={rule.kind === 'replace' ? '原词，如：DCN' : '该词，如：DCN'}
                  title={incomplete ? '原词填写后才会生效（空行不会被保存）' : undefined}
                  className={`runbi-form-control min-w-0 flex-1 text-xs ${incomplete ? 'border-amber-500/60' : ''}`}
                />
                {rule.kind === 'replace' && (
                  <>
                    <span aria-hidden="true" className="shrink-0 text-[11px] text-slate-500">
                      →
                    </span>
                    <input
                      value={rule.to ?? ''}
                      onChange={(e) => editRule(i, { to: e.target.value })}
                      placeholder="目标词，如：数据中心网络"
                      className="runbi-form-control min-w-0 flex-1 text-xs"
                    />
                  </>
                )}
                <button
                  type="button"
                  aria-label={`删除规则 ${rule.from || i + 1}`}
                  onClick={() => removeRule(i)}
                  className="h-6 w-6 shrink-0 rounded text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  ×
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500">{kindMeta.hint}</p>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRule}
          className="rounded-lg border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-slate-400 hover:border-teal-500/60 hover:text-teal-400 transition-colors cursor-pointer"
        >
          + 添加规则
        </button>
        <p className="text-[10px] leading-relaxed text-slate-500">
          词库在润色时作为最高优先级硬约束注入提示词，优先级高于风格与行业规则。
        </p>
      </section>

      {/* ── 区块 2：我的文风标杆（Few-Shot 样本学风） ── */}
      <section className="runbi-settings-card space-y-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-300">我的文风标杆（最多 {MAX_SAMPLES} 段）</span>
          <span className="text-[10px] text-slate-500">
            {activeSampleCount > 0 ? `已添加 ${activeSampleCount} 段` : '未添加'}
          </span>
        </div>

        {samples.map((sample, i) => (
          <div key={i} className="space-y-0.5">
            <textarea
              rows={3}
              value={sample}
              onChange={(e) => editSample(i, e.target.value)}
              placeholder={`样本 ${i + 1}：粘贴一段你本人写的、最满意的微信消息或邮件`}
              className="runbi-form-control resize-none font-sans text-xs"
            />
            <p className="text-[10px] leading-relaxed text-slate-500">
              仅保存在本机，随提示词发送给所选模型，让润色结果模仿你的笔触。
            </p>
          </div>
        ))}

        {samples.length < MAX_SAMPLES && (
          <button
            type="button"
            onClick={() => setSamples((prev) => [...prev, ''])}
            className="rounded-lg border border-dashed border-white/20 px-2.5 py-1 text-[11px] text-slate-400 hover:border-teal-500/60 hover:text-teal-400 transition-colors cursor-pointer"
          >
            + 添加样本
          </button>
        )}
      </section>

      {/* ── 区块 3：本地模型 · 零配置探测 ── */}
      <section className="runbi-settings-card space-y-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[11px] font-medium text-slate-300">本地模型（Ollama / LM Studio）</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
              自动探测本机已运行的推理服务，数据 100% 离线。
            </span>
          </span>
          <button
            type="button"
            onClick={runProbe}
            disabled={probing}
            className="runbi-secondary-button runbi-focus-ring shrink-0 cursor-pointer px-2.5 py-1 text-[11px]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
            {probing ? '探测中' : '重新探测'}
          </button>
        </div>

        {probes && probes.length > 0 ? (
          probes.map((result) => {
            const model = pickedModel[result.baseUrl] ?? result.models[0];
            return (
              <div
                key={result.baseUrl}
                className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <p className="text-[11px] font-medium text-emerald-300">
                  🟢 {result.label} 已就绪 · {result.models.length} 个模型
                </p>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`${result.label} 模型选择`}
                    value={model}
                    onChange={(e) =>
                      setPickedModel((prev) => ({ ...prev, [result.baseUrl]: e.target.value }))
                    }
                    className="runbi-form-control min-w-0 flex-1 cursor-pointer font-mono text-[11px]"
                  >
                    {result.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      onPatch({
                        provider: result.providerId === 'ollama' ? 'ollama' : 'custom',
                        baseUrl: result.baseUrl,
                        model,
                      })
                    }
                    className="runbi-focus-ring shrink-0 rounded-lg border border-teal-500/40 bg-teal-500/20 px-2.5 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500/25 transition-colors cursor-pointer"
                  >
                    一键使用
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-[10px] leading-relaxed text-slate-500">
            {probes === null
              ? '正在探测本地模型服务（Ollama / LM Studio）…'
              : '未发现本地模型（Ollama / LM Studio 未运行）；安装并启动后点“重新探测”即可自动连上，数据 100% 离线。'}
          </p>
        )}
      </section>
    </div>
  );
};
