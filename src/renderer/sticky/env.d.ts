import type { Settings, Task, TaskPatch } from '../../shared/types';

/**
 * Ambient-only declarations. Keeping these out of `sticky.ts` as globals means
 * that file has no imports, so tsc emits it as a plain script the renderer can
 * load under a `script-src 'self'` CSP — no module loader in the page.
 */
declare global {
  type WfTask = Task;
  type WfPatch = TaskPatch;
  type WfSettings = Settings;

  interface Window {
    workflow: {
      list(): Promise<Task[]>;
      update(id: string, patch: TaskPatch): Promise<Task[]>;
      remove(id: string): Promise<Task[]>;
      clearDone(): Promise<Task[]>;
      reveal(id: string): void;
      openWhatsApp(): void;
      hide(): void;
      getSettings(): Promise<Settings>;
      setSettings(patch: Partial<Settings>): Promise<Settings>;
      onTasks(fn: (tasks: Task[], highlightId?: string) => void): void;
    };
  }
}

export {};
