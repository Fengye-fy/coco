import { useEffect, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Eye, EyeOff, LoaderCircle, Search, Zap } from 'lucide-react';
import { api, date, statusText, unwrap } from '../api';
import type { ConnectionResult, Settings, SettingsInput, Task } from '../types';
import { TaskView } from './Feed';

function PanelHead({ title, onBack }: { title: string; onBack(): void }) {
  return <header className="panel-head">
    <div className="panel-title"><button className="icon-btn" title="返回" aria-label="返回" onClick={onBack}><ArrowLeft size={16} /></button><strong>{title}</strong></div>
  </header>;
}

export function SettingsPanel({ settings, busy, onSave, onBack, notify }: { settings: Settings; busy: boolean; onSave(input: SettingsInput): Promise<void>; onBack(): void; notify(message: string, error?: boolean): void }) {
  const [form, setForm] = useState<SettingsInput>({ ...settings, apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'text' | 'vision' | null>(null);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => { setForm({ ...settings, apiKey: '' }); }, [settings]);
  function update<K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) { setForm(prev => ({ ...prev, [key]: value })); setResult(null); setFailure(''); }
  async function save() {
    setSaving(true);
    try { await onSave(form); notify('设置已保存'); } catch (error) { notify((error as Error).message, true); } finally { setSaving(false); }
  }
  async function test(vision: boolean) {
    setTesting(vision ? 'vision' : 'text'); setResult(null); setFailure('');
    try { setResult(await unwrap(api().testConnection(form, vision))); } catch (error) { setFailure((error as Error).message); } finally { setTesting(null); }
  }
  const locked = busy || saving || Boolean(testing);
  return <section className="side-page">
    <PanelHead title="设置" onBack={onBack} />
    <div className="form">
      <p className="form-intro">coco 通过支持 Responses API 的模型工作。模型需要支持图片输入和工具调用。</p>
      <label className="field"><span>API 地址</span><input value={form.baseUrl} disabled={locked} onChange={e => update('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} /></label>
      <label className="field"><span>API Key{settings.hasApiKey && <em>已加密保存</em>}</span>
        <span className="with-btn">
          <input type={showKey ? 'text' : 'password'} value={form.apiKey || ''} disabled={locked} autoComplete="off" placeholder={settings.hasApiKey ? '留空表示保持不变' : '粘贴你的 API Key'} onChange={e => { update('apiKey', e.target.value); update('clearApiKey', false); }} />
          <button type="button" className="icon-btn small" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </span>
      </label>
      {settings.hasApiKey && <label className="check"><input type="checkbox" checked={Boolean(form.clearApiKey)} disabled={locked} onChange={e => update('clearApiKey', e.target.checked)} />保存时移除已保存的密钥</label>}
      <label className="field"><span>模型</span><input value={form.model} disabled={locked} onChange={e => update('model', e.target.value)} spellCheck={false} /></label>
      <div className="row2">
        <label className="field"><span>每个任务最多轮次</span><input type="number" min={1} max={500} value={form.maxSteps} disabled={locked} onChange={e => update('maxSteps', Number(e.target.value))} /></label>
        <label className="field"><span>请求超时（秒）</span><input type="number" min={10} max={600} value={form.requestTimeout} disabled={locked} onChange={e => update('requestTimeout', Number(e.target.value))} /></label>
      </div>
      <div className="actions">
        <button className="ghost" disabled={locked} onClick={() => test(false)}>{testing === 'text' ? <LoaderCircle size={13} className="spin" /> : <Zap size={13} />}测试连接</button>
        <button className="ghost" disabled={locked} onClick={() => test(true)}>{testing === 'vision' ? <LoaderCircle size={13} className="spin" /> : <Eye size={13} />}测试视觉</button>
      </div>
      {result && <div className="result"><Check size={14} /><div><strong>{result.vision ? '视觉可用' : '连接成功'} · {(result.latency / 1000).toFixed(1)} s</strong><p>{result.message}</p></div></div>}
      {failure && <div className="result error"><CircleAlert size={14} /><p>{failure}</p></div>}
      <p className="hint">密钥用 Windows 系统加密保存。截图只包含工作区里的拼贴，会和任务一起发送给你配置的模型服务；视觉测试只截取 coco 自己的窗口。</p>
    </div>
    <footer className="side-foot">
      <span>{busy ? 'coco 工作时不能修改' : ''}</span>
      <button className="primary" disabled={locked} onClick={save}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}保存</button>
    </footer>
  </section>;
}

export function HistoryPanel({ onBack, notify }: { onBack(): void; notify(message: string, error?: boolean): void }) {
  const [items, setItems] = useState<Task[] | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => { unwrap(api().historyList()).then(setItems).catch(error => notify((error as Error).message, true)); }, []);
  async function toggle(id: string) {
    if (open?.id === id) { setOpen(null); return; }
    try { setOpen(await unwrap(api().historyGet(id))); } catch (error) { notify((error as Error).message, true); }
  }
  const filtered = (items || []).filter(task => task.prompt.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="side-page">
    <PanelHead title="历史" onBack={onBack} />
    <label className="search slim"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务" aria-label="搜索任务" /></label>
    <div className="history">
      {!items && <div className="launcher-note"><LoaderCircle size={15} className="spin" />读取中…</div>}
      {items && !filtered.length && <div className="launcher-note">{search ? '没有匹配的任务' : '还没有任务记录'}</div>}
      {filtered.map(task => <div key={task.id} className={`h-item${open?.id === task.id ? ' open' : ''}`}>
        <button className="h-head" onClick={() => toggle(task.id)}>
          <strong>{task.prompt}</strong>
          <small>{task.workspace} · {date(task.createdAt)} · <span className={`state ${task.status}`}>{statusText[task.status]}</span></small>
        </button>
        {open?.id === task.id && <div className="h-detail feed"><TaskView task={open} /></div>}
      </div>)}
    </div>
  </section>;
}
