import { ipcMain } from 'electron';
import {
  CH,
  type MessageCapture,
  type Settings,
  type TaskPatch,
} from '../shared/types';
import { store } from './store';
import { refreshTrayMenu } from './tray';
import {
  applyAlwaysOnTop,
  applyOpacity,
  broadcastTasks,
  getStickyWindow,
  getWhatsAppWindow,
  revealMessage,
  showWhatsApp,
  toggleSticky,
} from './windows';

export function handleCapture(cap: MessageCapture): void {
  const { task, duplicate } = store.capture(cap);

  // Tell the page so it can flash a toast next to the message.
  getWhatsAppWindow()?.webContents.send(CH.captureAck, {
    messageId: cap.messageId,
    duplicate,
  });

  // A capture is the one moment the board must be visible.
  toggleSticky(true);
  getStickyWindow()?.webContents.send(CH.tasksChanged, store.getTasks(), task.id);
}

export function registerIpc(): void {
  ipcMain.on(CH.capture, (_event, cap: MessageCapture) => handleCapture(cap));

  ipcMain.handle(CH.listTasks, () => store.getTasks());

  ipcMain.handle(CH.updateTask, (_event, id: string, patch: TaskPatch) => {
    store.update(id, patch);
    return store.getTasks();
  });

  ipcMain.handle(CH.deleteTask, (_event, id: string) => {
    store.delete(id);
    return store.getTasks();
  });

  ipcMain.handle(CH.clearDone, () => {
    store.clearDone();
    return store.getTasks();
  });

  ipcMain.on(CH.focusMessage, (_event, id: string) => {
    const task = store.find(id);
    if (!task) return;
    revealMessage({ messageId: task.messageId, chatName: task.chatName });
  });

  ipcMain.handle(CH.getSettings, () => store.getSettings());

  ipcMain.handle(CH.setSettings, (_event, patch: Partial<Settings>) => {
    const next = store.patchSettings(patch);
    if (patch.alwaysOnTop !== undefined) applyAlwaysOnTop(next.alwaysOnTop);
    if (patch.opacity !== undefined) applyOpacity(next.opacity);
    refreshTrayMenu();
    return next;
  });

  ipcMain.on(CH.hideSticky, () => toggleSticky(false));

  ipcMain.on(CH.openWhatsApp, () => showWhatsApp());

  // Any mutation refreshes the tray badge and repaints the board.
  store.onChange(() => {
    refreshTrayMenu();
    broadcastTasks();
  });
}
