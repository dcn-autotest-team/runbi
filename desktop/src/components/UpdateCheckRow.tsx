import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Check, RefreshCw, RunbiLogo } from './Icons';

export function formatUpdateError(error: unknown): string {
  const message = String(error).replace(/\s+/g, ' ').trim();
  const lower = message.toLowerCase();
  if (lower.includes('404') || lower.includes('not found')) {
    return '升级源不可访问（404）。请确认已发布 latest.json，且下载地址允许匿名访问。';
  }
  if (lower.includes('signature') || lower.includes('签名')) {
    return '升级包签名校验失败，请使用最新的完整安装包。';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return '检查更新超时，请检查网络后重试。';
  }
  return `检查失败：${message.slice(0, 90)}`;
}

export function formatUpdateDate(date?: string): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parsed);
}

interface UpdateCheckRowProps {
  autoCheck?: boolean;
  prominent?: boolean;
  onUpdateFound?: () => void;
  onOpenReleaseHistory?: () => void;
}

export function UpdateCheckRow({
  autoCheck = false,
  prominent = false,
  onUpdateFound,
  onOpenReleaseHistory,
}: UpdateCheckRowProps) {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'downloading' | 'done'>('idle');
  const [note, setNote] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    let mounted = true;
    getVersion()
      .then((version) => {
        if (mounted && version) setCurrentVersion(version);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const onCheck = useCallback(async () => {
    setPhase('checking');
    setNote('');
    try {
      const u = await check({ timeout: 15_000 });
      if (u) {
        setUpdate(u);
        setPhase('done');
        setNote(`发现新版本 ${u.version}，可立即安装`);
        onUpdateFound?.();
      } else {
        setUpdate(null);
        setPhase('done');
        setNote('当前已是最新版本');
      }
    } catch (e) {
      setPhase('done');
      setNote(formatUpdateError(e));
    }
  }, [onUpdateFound]);

  useEffect(() => {
    if (autoCheck) void onCheck();
  }, [autoCheck, onCheck]);

  const onInstall = async () => {
    if (!update) return;
    setPhase('downloading');
    setNote('正在安全下载并验证更新…');
    try {
      await update.downloadAndInstall();
      setNote('安装完成，正在重启…');
      setTimeout(() => {
        relaunch();
      }, 800);
    } catch (e) {
      setPhase('done');
      setNote(formatUpdateError(e).replace(/^检查失败：/, '安装失败：'));
    }
  };

  const busy = phase === 'checking' || phase === 'downloading';
  const installedVersion = currentVersion || update?.currentVersion || '读取中…';
  const releaseDate = formatUpdateDate(update?.date);

  if (prominent) {
    if (!update) return null;
    return (
      <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="runbi-update-title"
          className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl"
        >
          <div className="border-b border-white/10 bg-gradient-to-br from-teal-400/10 via-transparent to-transparent p-5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-teal-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-teal-300/20 bg-teal-300/10">
                <RunbiLogo className="h-3.5 w-3.5" />
              </span>
              软件更新 · v{installedVersion} → v{update.version}
            </div>
            <h2 id="runbi-update-title" className="mt-3 text-lg font-semibold text-white">
              Runbi {update.version} 可以更新
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {releaseDate ? `${releaseDate} 发布 · ` : ''}稳定版本
            </p>
          </div>

          <div className="p-5">
            {update.body ? (
              <div>
                <p className="text-[11px] font-medium text-slate-300">本次更新</p>
                <div className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.035] p-3 text-[11px] leading-5 text-slate-300">
                  {update.body}
                </div>
              </div>
            ) : (
              <p className="text-xs leading-5 text-slate-400">包含最新功能、体验改进和问题修复。</p>
            )}
            {note && phase === 'downloading' && (
              <p role="status" className="mt-3 text-[11px] text-teal-300">{note}</p>
            )}
            {note.startsWith('安装失败') && (
              <p role="alert" className="mt-3 text-[11px] text-rose-300">{note}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUpdate(null)}
                disabled={busy}
                className="runbi-focus-ring rounded-lg px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                稍后提醒
              </button>
              <button
                type="button"
                onClick={onInstall}
                disabled={busy}
                className="runbi-primary-button runbi-focus-ring px-4 text-xs"
              >
                {phase === 'downloading' && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {phase === 'downloading' ? '正在更新…' : '更新并重启'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="runbi-version-title" className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-br from-teal-400/[0.08] via-transparent to-transparent p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-100 shadow-sm">
            <RunbiLogo className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 id="runbi-version-title" className="text-sm font-semibold text-white">Runbi Desktop</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-slate-300">
                当前版本 v{installedVersion}
              </span>
              <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-2 py-0.5 text-teal-300">
                稳定版
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={update && phase === 'done' ? onInstall : onCheck}
          disabled={busy}
          className={`${update && phase === 'done' ? 'runbi-primary-button' : 'runbi-secondary-button'} runbi-focus-ring shrink-0 px-3 text-[11px]`}
        >
          {busy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          {phase === 'checking'
            ? '正在检查…'
            : phase === 'downloading'
              ? '正在更新…'
              : update
                ? `更新到 v${update.version}`
                : '检查更新'}
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-400">
          {phase === 'done' && !update && !note.startsWith('检查失败') ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
          ) : (
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
          )}
          <span role={note.startsWith('检查失败') ? 'alert' : 'status'}>
            {note || '点击检查更新，获取最新稳定版本和完整更新说明。'}
          </span>
        </div>

        {update && (
          <div className="rounded-xl border border-teal-300/20 bg-teal-300/[0.05] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold text-white">v{update.version}</p>
              {releaseDate && <time className="text-[10px] text-slate-500">{releaseDate}</time>}
            </div>
            <p className="mt-0.5 text-[10px] text-teal-300">可用的新版本</p>
            {update.body && (
              <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-t border-white/10 pt-2 text-[11px] leading-5 text-slate-300">
                {update.body}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3 text-[10px] text-slate-500">
          <span>更新包会在安装前验证数字签名</span>
          {onOpenReleaseHistory && (
            <button
              type="button"
              onClick={onOpenReleaseHistory}
              className="runbi-focus-ring shrink-0 rounded px-1.5 py-1 font-medium text-teal-400 transition-colors hover:bg-teal-400/10 hover:text-teal-300"
            >
              查看发布记录
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
