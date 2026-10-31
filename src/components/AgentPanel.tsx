import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, FolderOpen, FolderPlus, LoaderCircle, Pause, Play, Square, SquarePen, X } from 'lucide-react';
import { api, isLive, statusText, unwrap } from '../api';
import type { AgentState, Settings, Task, WorkspaceState } from '../types';
import { TaskView } from './Feed';

const IDEAS = ['打开 bing.com，搜索今天的科技新闻，挑三条告诉我', '打开记事本，写下今天的三件待办', '打开安卓版微信，看看有没有未读消息'];
const FOLDER_IDEAS = ['看看文件夹里有什么，按里面的说明一步步操作', '把文件夹里的文档打开放进拼贴，告诉我写了什么', '把 A 里看到的要点整理成一个新文件，存进文件夹'];
const baseName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).pop() || folder;
const drafts = new Map<string, string>();

interface Props { ws: WorkspaceState; agent: AgentState; focused: boolean; workspaceBusy: boolean; controls: ReactNode; tasks: Task[]; settings: Settings; onSettings(): void; notify(message: string, error?: boolean): void }

export function AgentPanel({ ws, agent, focused, workspaceBusy, controls, tasks, settings, onSettings, notify }: Props) {
  const [text, setText] = useState(() => drafts.get(agent.id) || '');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const task = tasks.at(-1);
  const live = isLive(task);
  const waiting = task?.status === 'waiting_input';
  const eventCount = tasks.reduce((n, t) => n + t.events.length, 0);

  useEffect(() => { drafts.set(agent.id, text); }, [agent.id, text]);
  useEffect(() => { if (follow.current) feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }); }, [eventCount, tasks.length]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);
  useEffect(() => {
    if (!focused) return;
    const focus = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, [focused]);

  async function run<T>(work: () => Promise<T>) {
    try { return await work(); } catch (error) { notify((error as Error).message, true); }
  }
  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    if (!settings.hasApiKey) { onSettings(); notify('先填写 API Key，coco 才能开始工作。'); return; }
    setBusy(true);
    follow.current = true;
    const done = await run(async () => { await unwrap(waiting ? api().answer(ws.id, value, agent.id) : api().send(ws.id, value, agent.id)); return true; });
    if (done) setText('');
    setBusy(false);
  }

  const chooseFolder = () => run(async () => { const root = await unwrap(api().chooseFolder(ws.id)); if (root) notify(`已绑定 ${baseName(root)}`); });

  return <section className="agent" aria-label={`${ws.name} 的 ${agent.name}`}>
    <header className="panel-head">
      <div className="panel-title" title={`${ws.name} · ${agent.name}`}><strong>{agent.name}</strong>{task && <span className={`state ${task.status}`}>{statusText[task.status]}</span>}</div>
      <div className="agent-actions">
        {tasks.length > 0 && !live && <button className="tile-btn" title="新对话" aria-label="新对话" onClick={() => run(() => unwrap(api().reset(ws.id, agent.id)))}><SquarePen size={14} /></button>}
        {controls}
      </div>
    </header>
    {ws.folder
      ? <div className="folder-bar">
          <FolderOpen size={14} />
          <button className="folder-name" title={`${ws.folder}\n点击在资源管理器中打开`} onClick={() => run(() => unwrap(api().revealFolder(ws.id)))}>{baseName(ws.folder)}</button>
          <span className="grow" />
          <button className="folder-action" disabled={workspaceBusy} onClick={chooseFolder}>更换</button>
          <button className="icon-btn small" title="解除绑定" aria-label="解除绑定文件夹" disabled={workspaceBusy} onClick={() => run(() => unwrap(api().clearFolder(ws.id)))}><X size={13} /></button>
        </div>
      : <button className="folder-bar empty" disabled={workspaceBusy} onClick={chooseFolder}>
          <FolderPlus size={14} /><span>绑定本地文件夹</span><small>coco 会按里面的内容操作窗口</small>
        </button>}
    <div className="feed" ref={feedRef} onScroll={() => { const el = feedRef.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {tasks.length ? tasks.map(item => <TaskView key={item.id} task={item} onCopy={async value => { try { await navigator.clipboard.writeText(value); notify('已复制'); } catch { notify('复制失败', true); } }} />) : <div className="welcome">
        <span className="mark lg" />
        <h2>在右边的工作区里，我替你动手。</h2>
        <p>{ws.folder
          ? <>我会先读「{baseName(ws.folder)}」里的文件，再按内容操作右边的拼贴。文件夹外的东西我碰不到，里面已有的文件我只读不改。</>
          : '打开网页、桌面应用或安卓应用，然后告诉我要做什么。我只看得到、也只会操作这个工作区里的拼贴。'}</p>
        <div className="ideas">{(ws.folder ? FOLDER_IDEAS : IDEAS).map(idea => <button key={idea} onClick={() => { setText(idea); inputRef.current?.focus(); }}>{idea}</button>)}</div>
      </div>}
    </div>
    <div className="composer">
      {waiting && task?.question && <div className="composer-q">{task.question}</div>}
      <textarea ref={inputRef} rows={1} value={text} maxLength={20000} aria-label="给 coco 的消息"
        placeholder={waiting ? '回答 coco…' : live ? 'coco 正在工作…' : '让 coco 做点什么…'}
        disabled={live && !waiting}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="composer-row">
        <button className="model" onClick={onSettings} title="模型设置">{settings.hasApiKey ? settings.model : '未设置 API Key'}</button>
        <span className="grow" />
        {live && task && <>
          {task.status === 'paused'
            ? <button className="ghost" onClick={() => run(() => unwrap(api().resume(ws.id, agent.id)))}><Play size={13} />继续</button>
            : !waiting && <button className="ghost" disabled={task.status !== 'running'} onClick={() => run(() => unwrap(api().pause(ws.id, agent.id)))}><Pause size={13} />暂停</button>}
          <button className="ghost danger" disabled={task.status === 'stopping'} onClick={() => run(() => unwrap(api().stop(ws.id, agent.id)))}><Square size={11} />停止</button>
        </>}
        {(!live || waiting) && <button className="send" aria-label={waiting ? '回答' : '发送'} disabled={!text.trim() || busy} onClick={submit}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={16} />}</button>}
      </div>
    </div>
  </section>;
}
