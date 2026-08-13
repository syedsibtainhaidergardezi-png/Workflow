import { contextBridge, ipcRenderer } from 'electron';
import { CH, type Settings, type Task, type TaskPatch } from '../shared/types';

/** The only surface the sticky renderer gets. No node, no raw ipcRenderer. */
const api = {
  list: (): Promise<Task[]> => ipcRenderer.invoke(CH.listTasks),
  update: (id: string, patch: TaskPatch): Promise<Task[]> =>
    ipcRenderer.invoke(CH.updateTask, id, patch),
  remove: (id: string): Promise<Task[]> => ipcRenderer.invoke(CH.deleteTask, id),
  clearDone: (): Promise<Task[]> => ipcRenderer.invoke(CH.clearDone),
  reveal: (id: string): void => ipcRenderer.send(CH.focusMessage, id),
  openWhatsApp: (): void => ipcRenderer.send(CH.openWhatsApp),
  hide: (): void => ipcRenderer.send(CH.hideSticky),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(CH.getSettings),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(CH.setSettings, patch),
  onTasks: (fn: (tasks: Task[], highlightId?: string) => void): void => {
    ipcRenderer.on(CH.tasksChanged, (_event, tasks: Task[], highlightId?: string) =>
      fn(tasks, highlightId),
    );
  },
};

export type WorkflowApi = typeof api;

contextBridge.exposeInMainWorld('workflow', api);
