import type { Result, Task, TaskStatus } from './types';

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export function api() {
  if (!window.coco) throw new Error('请通过 coco 客户端打开。');
  return window.coco;
}
export const isLive = (task?: Task | null) => Boolean(task && ['running', 'paused', 'waiting_input', 'stopping'].includes(task.status));
export const statusText: Record<TaskStatus, string> = { running: '工作中', paused: '已暂停', waiting_input: '等你回答', stopping: '正在停止', completed: '已完成', failed: '出错了', stopped: '已停止', limited: '达到上限', interrupted: '已中断' };
export const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
export const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(`coco.${key}`); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
}
export function save(key: string, value: unknown) {
  try { localStorage.setItem(`coco.${key}`, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}
