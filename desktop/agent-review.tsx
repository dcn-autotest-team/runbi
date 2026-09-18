import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { AgentPanel } from './src/components/AgentPanel';
import './src/styles/glass.css';
document.documentElement.classList.add('dark');
let approve: (value: boolean) => void;
mockIPC(async (command, args: any) => {
  if (command === 'approve_agent_tool') { approve(args.approved); return; }
  if (command === 'start_agent_task') {
    const send = (type: string, payload: any) => args.channel.onmessage({ type, payload });
    send('ThinkingChunk', { delta: '先阅读项目文档和目录结构，再提炼用途、启动步骤与注意事项。保留现有文件，只新增一份概要。' });
    send('ToolProposed', { call_id: 'read', name: 'run_cli', command: 'Get-Content README.md', requires_approval: false });
    send('ToolExecuted', { call_id: 'read', exit_code: 0, output: '# Runbi\n桌面 AI 助手，支持文本润色、翻译与智能体任务。' });
    send('ContentChunk', { delta: '已经梳理好项目的主要功能。\n\n### 项目概览\n\n润笔是一款桌面 AI 助手，提供文本润色、翻译和可审核的任务执行能力。\n\n- **界面**：React 与 TypeScript\n- **桌面端**：Tauri 与 Rust\n- **下一步**：将概要保存为项目文档\n' });
    send('Status', { message: '等待批准 · 保存项目概要' });
    send('ToolProposed', { call_id: 'save', name: 'run_cli', command: 'Set-Content -LiteralPath ./项目概要.md -Value "项目概览…"', requires_approval: true });
    const accepted = await new Promise<boolean>((resolve) => { approve = resolve; });
    send('ToolExecuted', { call_id: 'save', exit_code: accepted ? 0 : 1, output: accepted ? '已保存项目概要.md（模拟数据）' : '用户拒绝了操作' });
    send('Done', { success: true });
  }
});
function Preview() {
  const [model, setModel] = React.useState('Qwen3.8-27B');
  const [light, setLight] = React.useState(false);
  return <div className="runbi-window" style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <div style={{display:'flex',justifyContent:'space-between',padding:'10px 24px',fontSize:11,color:'var(--runbi-text-secondary)'}}><span>界面预览 · 模拟数据，不执行命令</span><button onClick={() => { document.documentElement.dataset.theme = light ? 'dark' : 'light'; document.documentElement.classList.toggle('dark', light); setLight(!light); }}>切换主题</button></div>
    <AgentPanel endpoint="http://localhost/mock" apiKey="" model={model} onModelChange={setModel} modelList={['Qwen3.8-27B', 'deepseek-chat']} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
