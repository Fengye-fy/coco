import { useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, CircleAlert, FileText, Globe, LoaderCircle, RefreshCw, Search, Smartphone, SquareMousePointer } from 'lucide-react';
import { api, unwrap } from '../api';
import type { AppEntry, DesktopWindow, FolderFile, OpenTarget } from '../types';

type Mode = 'web' | 'app' | 'android' | 'window' | 'file';
const MODES: { id: Mode; name: string; icon: typeof Globe }[] = [
  { id: 'web', name: '网页', icon: Globe }, { id: 'app', name: '应用', icon: AppWindow },
  { id: 'android', name: '安卓', icon: Smartphone }, { id: 'window', name: '窗口', icon: SquareMousePointer },
  { id: 'file', name: '文件', icon: FileText },
];
const extension = (name: string) => (name.match(/\.([^.]+)$/)?.[1] || '·').slice(0, 4).toUpperCase();
const SITES = [{ name: '必应', url: 'https://www.bing.com' }, { name: '哔哩哔哩', url: 'https://www.bilibili.com' }, { name: '知乎', url: 'https://www.zhihu.com' }, { name: 'GitHub', url: 'https://github.com' }];

let catalog: Promise<AppEntry[]> | null = null;
function loadApps() {
  catalog ??= unwrap(api().apps()).catch(error => { catalog = null; throw error; });
  return catalog;
}

export function Launcher({ wsId, folder, onOpen, error }: { wsId: string; folder: string | null; onOpen(target: OpenTarget): Promise<void>; error?: string }) {
  const [mode, setMode] = useState<Mode>('web');
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [windows, setWindows] = useState<DesktopWindow[] | null>(null);
  const [files, setFiles] = useState<FolderFile[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProblem('');
    if ((mode === 'app' || mode === 'android') && !apps) loadApps().then(setApps).catch(e => setProblem((e as Error).message));
    if (mode === 'window') refreshWindows();
    inputRef.current?.focus();
  }, [mode]);
  useEffect(() => { if (!folder && mode === 'file') setMode('web'); }, [folder, mode]);
  useEffect(() => {
    if (mode !== 'file' || !folder) return;
    const timer = setTimeout(() => unwrap(api().folderFiles(wsId, query.trim())).then(setFiles).catch(e => setProblem((e as Error).message)), 150);
    return () => clearTimeout(timer);
  }, [mode, folder, query, wsId]);

  function refreshWindows() {
    setWindows(null);
    unwrap(api().windows()).then(setWindows).catch(e => setProblem((e as Error).message));
  }
  async function open(target: OpenTarget) {
    if (busy) return;
    setBusy(true);
    try { await onOpen(target); } finally { setBusy(false); }
  }
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    if (mode === 'file') return files || [];
    if (mode === 'window') return (windows || []).filter(w => !q || `${w.title} ${w.process}`.toLowerCase().includes(q));
    return (apps || []).filter(a => a.android === (mode === 'android') && (!q || a.name.toLowerCase().includes(q))).slice(0, 80);
  }, [mode, apps, windows, files, q]);
  const loading = mode === 'file' ? !files && !problem : mode === 'window' ? !windows && !problem : mode !== 'web' && !apps && !problem;

  return <div className="launcher">
    <div className="launcher-inner">
      <div className="seg" role="tablist">{MODES.filter(m => m.id !== 'file' || folder).map(m => <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}><m.icon size={13} />{m.name}</button>)}</div>
      {error && <div className="banner error"><CircleAlert size={14} /><span>{error}</span></div>}
      <label className="search">
        {busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} spellCheck={false}
          placeholder={mode === 'web' ? '输入网址或搜索词，回车打开' : mode === 'window' ? '筛选已打开的窗口' : mode === 'file' ? '搜索文件夹里的文件' : '搜索应用'}
          aria-label={mode === 'web' ? '网址' : '搜索'}
          onKeyDown={e => {
            if (e.key !== 'Enter' || !q) return;
            if (mode === 'web') void open({ kind: 'web', url: query.trim() });
            else if (list.length === 1 || (list[0] && mode !== 'window')) {
              const first = list[0];
              void open('hwnd' in first ? { kind: 'window', hwnd: first.hwnd } : 'id' in first ? { kind: 'app', id: first.id, name: first.name, android: first.android } : { kind: 'file', path: first.path });
            }
          }} />
        {mode === 'window' && <button className="icon-btn small" title="刷新" onClick={refreshWindows}><RefreshCw size={13} /></button>}
      </label>
      {mode === 'web' && <div className="sites">{SITES.map(site => <button key={site.url} className="site" onClick={() => open({ kind: 'web', url: site.url })}><span className="avatar">{site.name[0]}</span>{site.name}</button>)}</div>}
      {problem && <div className="banner error"><CircleAlert size={14} /><span>{problem}</span></div>}
      {loading && <div className="launcher-note"><LoaderCircle size={15} className="spin" />{mode === 'window' ? '正在读取窗口…' : '正在读取开始菜单里的应用…'}</div>}
      {mode !== 'web' && !loading && !problem && <div className="list">
        {list.map(item => 'hwnd' in item
          ? <button key={item.hwnd} className="row" disabled={busy} onClick={() => open({ kind: 'window', hwnd: item.hwnd })}><span className="avatar">{item.process[0]?.toUpperCase() || '·'}</span><span className="row-text"><span>{item.title}</span><small>{item.process}</small></span></button>
          : !('id' in item)
            ? <button key={item.path} className="row" disabled={busy} onClick={() => open({ kind: 'file', path: item.path })}><span className="avatar ext">{extension(item.name)}</span><span className="row-text"><span>{item.name}</span><small>{item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '根目录'}</small></span></button>
          : <button key={`${item.id}-${item.name}`} className="row" disabled={busy} onClick={() => open({ kind: 'app', id: item.id, name: item.name, android: item.android })}><span className="avatar">{item.name[0]}</span><span className="row-text"><span>{item.name}</span></span></button>)}
        {!list.length && <div className="launcher-note">{mode === 'android' ? (q ? '没有匹配的安卓应用' : '没有找到 WSA 安卓应用') : mode === 'window' ? '没有可以接入的窗口' : mode === 'file' ? (q ? '没有匹配的文件' : '文件夹是空的') : '没有匹配的应用'}</div>}
      </div>}
      {mode === 'window' && <p className="launcher-hint">接入后窗口会移进这个拼贴；关闭 coco 时会还给桌面。</p>}
      {mode === 'android' && <p className="launcher-hint">安卓应用由 WSA 运行，首次启动可能需要一分钟。</p>}
      {mode === 'file' && <p className="launcher-hint">PDF、图片、网页和纯文本直接在拼贴里显示，文档用默认应用打开；程序和脚本不能打开。</p>}
    </div>
  </div>;
}
