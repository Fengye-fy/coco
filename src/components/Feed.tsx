import { useEffect, useState } from 'react';
import { AppWindow, Check, Circle, CircleAlert, CircleHelp, Copy, Eye, FileText, FolderOpen, Globe, Keyboard, LayoutGrid, ListChecks, LoaderCircle, MousePointer2, MoveVertical, Timer, Wifi } from 'lucide-react';
import { isLive } from '../api';
import type { Task, TaskEvent } from '../types';

function stepIcon(title: string) {
  if (/计划/.test(title)) return ListChecks;
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
    case 'connection': return <div className="step"><Wifi size={13} /><span>{event.detail}</span></div>;
    case 'waiting': return <div className="step"><Timer size={13} /><span>{event.detail}</span></div>;
    default: return null;
  }
}

function Plan({ task }: { task: Task }) {
  if (!task.plan?.length) return null;
  const completed = task.plan.filter(step => step.status === 'completed').length;
  return <section className="task-plan" aria-label="任务计划">
    <div className="plan-head"><ListChecks size={15} /><strong>任务计划</strong><span>{completed} / {task.plan.length}</span></div>
    <div className="plan-progress" role="progressbar" aria-label="计划完成进度" aria-valuemin={0} aria-valuemax={task.plan.length} aria-valuenow={completed}><i style={{ width: `${completed / task.plan.length * 100}%` }} /></div>
    <ol>{task.plan.map((step, index) => {
      const current = step.status === 'in_progress';
      const Icon = step.status === 'completed' ? Check : current ? LoaderCircle : Circle;
      return <li key={index} className={step.status} aria-current={current ? 'step' : undefined}><Icon size={13} className={current && task.status === 'running' ? 'spin' : ''} /><span>{step.title}</span><small>{step.status === 'completed' ? '已完成' : current ? '进行中' : '待进行'}</small></li>;
    })}</ol>
    {task.planNote && <p>{task.planNote}</p>}
  </section>;
}

function Activity({ task }: { task: Task }) {
  const [now, setNow] = useState(Date.now);
  const activity = task.activity;
  useEffect(() => {
    setNow(Date.now());
    if (!activity?.until || task.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity?.until, task.status]);
  if (!activity) return null;
  const paused = task.status === 'paused';
  const seconds = Math.max(0, Math.ceil(((activity.until || now) - now) / 1000));
  const Icon = activity.kind === 'waiting' ? Timer : Wifi;
  return <div className={`task-activity ${activity.kind}`} role="status">
    <Icon size={17} />
    <div><strong>{activity.title}</strong><p>{activity.exhausted ? '进度已保留，点击“继续”重新连接。' : paused ? '已暂停，继续后恢复倒计时。' : activity.kind === 'waiting' ? '本地等待中，期间不调用模型。' : `第 ${activity.attempt} / ${activity.total} 次重试，保留当前任务。`}</p>
      {activity.detail && <small title={activity.detail}>{activity.detail}</small>}
    </div>
    {!paused && activity.until && <time>{seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : activity.kind === 'waiting' ? '观察中' : '连接中'}</time>}
  </div>;
}

export function TaskView({ task, onCopy }: { task: Task; onCopy?(text: string): void }) {
  const live = isLive(task);
  const last = task.events.at(-1);
  return <div className="turn">
    <div className="bubble">{task.prompt}</div>
    <Plan task={task} />
    {task.events.map(event => <EventView key={event.id} event={event} onCopy={onCopy} />)}
    {live && <Activity task={task} />}
    {live && !task.activity && (last?.kind === 'thinking' || last?.kind === 'tool') && <div className="thinking" aria-label="coco 正在工作"><i /><i /><i /></div>}
    {task.status === 'interrupted' && <div className="sys">{task.error || '已中断'}</div>}
  </div>;
}
