import { useState } from 'react';
import { AppWindow, CircleAlert, CircleHelp, Copy, Eye, FileText, FolderOpen, Globe, Keyboard, LayoutGrid, MousePointer2, MoveVertical, Timer } from 'lucide-react';
import { isLive } from '../api';
import type { Task, TaskEvent } from '../types';

function stepIcon(title: string) {
  if (/文件夹|查找文件/.test(title)) return FolderOpen;
  if (/文件/.test(title)) return FileText;
  if (/点击|双击|右键|拖动|移动/.test(title)) return MousePointer2;
  if (/输入|按键|填写/.test(title)) return Keyboard;
  if (/滚动/.test(title)) return MoveVertical;
  if (/观察|读取/.test(title)) return Eye;
  if (/网页|前往|后退|前进|刷新/.test(title)) return Globe;
  if (/应用/.test(title)) return AppWindow;
  if (/等待/.test(title)) return Timer;
  return LayoutGrid;
}

function Step({ event }: { event: TaskEvent }) {
  const [open, setOpen] = useState(false);
  const Icon = stepIcon(event.title);
  return <div className="step-wrap">
    <button className="step" onClick={() => setOpen(!open)} title="查看参数"><Icon size={13} /><span>{event.title}</span></button>
    {open && <pre className="step-detail">{event.detail}</pre>}
  </div>;
}

function Final({ text, onCopy }: { text: string; onCopy?(text: string): void }) {
  return <div className="say final">{text}{onCopy && <button className="copy" title="复制" onClick={() => onCopy(text)}><Copy size={13} /></button>}</div>;
}

function EventView({ event, onCopy }: { event: TaskEvent; onCopy?(text: string): void }) {
  switch (event.kind) {
    case 'message': return <p className="say">{event.detail}</p>;
    case 'success': return <Final text={event.detail} onCopy={onCopy} />;
    case 'question': return <div className="ask"><CircleHelp size={15} /><span>{event.detail}</span></div>;
    case 'user': return <div className="bubble small">{event.detail}</div>;
    case 'tool': return <Step event={event} />;
    case 'observation': return event.image ? <img className="shot" src={event.image} alt="coco 看到的画面" /> : null;
    case 'error': return <div className="step error"><CircleAlert size={13} /><span>{event.title}{event.detail && event.detail !== event.title ? `：${event.detail}` : ''}</span></div>;
    case 'system': return event.title === '开始' ? null : <div className="sys">{event.title}</div>;
    default: return null;
  }
}

export function TaskView({ task, onCopy }: { task: Task; onCopy?(text: string): void }) {
  const live = isLive(task);
  const last = task.events.at(-1);
  return <div className="turn">
    <div className="bubble">{task.prompt}</div>
    {task.events.map(event => <EventView key={event.id} event={event} onCopy={onCopy} />)}
    {live && (last?.kind === 'thinking' || last?.kind === 'tool') && <div className="thinking" aria-label="coco 正在工作"><i /><i /><i /></div>}
    {task.status === 'interrupted' && <div className="sys">{task.error || '已中断'}</div>}
  </div>;
}
