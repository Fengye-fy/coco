export type SplitDir = 'right' | 'down' | 'auto';
export type TileKind = 'empty' | 'web' | 'app' | 'android';
export type TileStatus = 'idle' | 'loading' | 'launching' | 'ready' | 'error';
export interface TileState {
  id: string;
  label: string;
  kind: TileKind;
  title: string;
  url: string;
  status: TileStatus;
  error: string;
  canBack: boolean;
  canForward: boolean;
  hint?: { near?: string | null; dir: SplitDir };
}
export interface WorkspaceState { id: string; name: string; folder: string | null; tiles: TileState[] }
export interface FolderFile { name: string; path: string }
export interface Settings { baseUrl: string; model: string; maxSteps: number; requestTimeout: number; hasApiKey: boolean; encryptionAvailable: boolean }
export interface SettingsInput extends Settings { apiKey?: string; clearApiKey?: boolean }
export type TaskStatus = 'running' | 'paused' | 'waiting_input' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'limited' | 'interrupted';
export interface TaskEvent { id: string; at: string; kind: string; title: string; detail: string; image?: string }
export interface Task {
  id: string;
  workspaceId: string;
  workspace: string;
  prompt: string;
  status: TaskStatus;
  model: string;
  steps: number;
  toolCalls: number;
  createdAt: string;
  finishedAt?: string;
  question?: string;
  events: TaskEvent[];
  result: string;
  error: string;
}
export interface AppEntry { name: string; id: string; android: boolean }
export interface DesktopWindow { hwnd: string; title: string; process: string }
export interface Rect { x: number; y: number; width: number; height: number }
export type OpenTarget = { kind: 'web'; url: string } | { kind: 'app'; id: string; name: string; android: boolean } | { kind: 'window'; hwnd: string } | { kind: 'file'; path: string };
export interface Bootstrap { settings: Settings; version: string; workspaces: WorkspaceState[]; activeId: string; sessions: Record<string, Task[]> }
export interface ConnectionResult { message: string; latency: number; vision: boolean }
export type CocoEvent =
  | { type: 'workspaces'; workspaces: WorkspaceState[] }
  | { type: 'task'; wsId: string; task: Task; event?: TaskEvent }
  | { type: 'reveal'; wsId: string; tileId: string }
  | { type: 'focus'; wsId: string; tileId: string }
  | { type: 'notice'; message: string; error?: boolean };
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface CocoAPI {
  bootstrap(): Promise<Result<Bootstrap>>;
  saveSettings(input: SettingsInput): Promise<Result<Settings>>;
  testConnection(input: SettingsInput, vision: boolean): Promise<Result<ConnectionResult>>;
  historyList(): Promise<Result<Task[]>>;
  historyGet(id: string): Promise<Result<Task | null>>;
  createWorkspace(): Promise<Result<string>>;
  closeWorkspace(id: string): Promise<Result<string>>;
  renameWorkspace(id: string, name: string): Promise<Result<void>>;
  activateWorkspace(id: string): Promise<Result<void>>;
  layout(wsId: string, rects: Record<string, Rect | null>): void;
  addTile(wsId: string, hint?: { near?: string | null; dir?: SplitDir }): Promise<Result<string>>;
  openTile(wsId: string, tileId: string, target: OpenTarget): Promise<Result<void>>;
  closeTile(wsId: string, tileId: string): Promise<Result<void>>;
  navTile(wsId: string, tileId: string, action: 'back' | 'forward' | 'reload' | 'url', url?: string): Promise<Result<void>>;
  focusTile(wsId: string, tileId: string): Promise<Result<void>>;
  chooseFolder(wsId: string): Promise<Result<string | null>>;
  clearFolder(wsId: string): Promise<Result<void>>;
  folderFiles(wsId: string, query?: string): Promise<Result<FolderFile[]>>;
  revealFolder(wsId: string): Promise<Result<void>>;
  apps(refresh?: boolean): Promise<Result<AppEntry[]>>;
  windows(): Promise<Result<DesktopWindow[]>>;
  send(wsId: string, text: string): Promise<Result<Task>>;
  pause(wsId: string): Promise<Result<Task>>;
  resume(wsId: string): Promise<Result<Task>>;
  stop(wsId: string): Promise<Result<Task>>;
  answer(wsId: string, text: string): Promise<Result<Task>>;
  reset(wsId: string): Promise<Result<void>>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<Result<void>>;
  onEvent(callback: (event: CocoEvent) => void): () => void;
}
declare global { interface Window { coco?: CocoAPI } }
