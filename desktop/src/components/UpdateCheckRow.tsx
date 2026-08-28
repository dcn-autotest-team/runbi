import { useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { RefreshCw } from './Icons';

/**
 * Settings row: check GitHub Releases for app updates via tauri-plugin-updater.
 * Fails gracefully (inline note) when offline / endpoint not published yet.
 */
export function UpdateCheckRow() {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'downloading' | 'done'>('idle');
  const [note, setNote] = useState('');
  const [update, setUpdate] = useState<Update | null>(null);

  const onCheck = async () => {
    setPhase('checking');
    setNote('');
    try {
      const u = await check();
      if (u) {
        setUpdate(u);
        setPhase('done');
        setNote(`发现新版本 ${u.version}，可立即安装`);
      } else {
        setUpdate(null);
        setPhase('done');
        setNote('已是最新版本');
      }
    } catch (e) {
      setPhase('done');
      setNote(`检查失败：${String(e).slice(0, 90)}`);
    }
  };

  const onInstall = async () => {
    if (!update) return;
    setPhase('downloading');
    setNote('下载中…');
    try {
      await update.downloadAndInstall();
      setNote('安装完成，正在重启…');
      setTimeout(() => {
        relaunch();
      }, 800);
    } catch (e) {
      setPhase('done');
      setNote(`安装失败：${String(e).slice(0, 90)}`);
    }
  };

  const busy = phase === 'checking' || phase === 'downloading';

  return (
    <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-white">软件更新</p>
          <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
            通过 GitHub Releases 检查新版本并自动安装。
          </p>
        </div>
        {update && phase === 'done' ? (
          <button
            type="button"
            onClick={onInstall}
            className="runbi-focus-ring shrink-0 rounded-lg bg-[#00BFA5] px-3 py-1.5 text-[11px] font-medium text-black transition-opacity hover:opacity-90"
          >
            安装 {update.version}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheck}
            disabled={busy}
            className="runbi-focus-ring flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            {busy && <RefreshCw className="h-3 w-3 animate-spin" />}
            {phase === 'checking' ? '检查中…' : phase === 'downloading' ? '下载中…' : '检查更新'}
          </button>
        )}
      </div>
      {note && <p className="mt-1.5 text-[10px] leading-4 text-slate-400">{note}</p>}
    </div>
  );
}
