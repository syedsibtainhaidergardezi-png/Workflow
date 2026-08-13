import { BrowserWindow, app, globalShortcut } from 'electron';
import { store } from './store';
import { handleCapture, registerIpc } from './ipc';
import { createTray, destroyTray, refreshTrayMenu } from './tray';
import { createStickyWindow, createWhatsAppWindow, showWhatsApp, toggleSticky } from './windows';
import { appIcon } from './icon';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// One WhatsApp session per machine — a second instance would fight over the
// same linked-device slot, so hand focus back to the window already running.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWhatsApp();
    toggleSticky(true);
  });

  app.whenReady().then(start);
}

function start(): void {
  store.load();
  registerIpc();

  createWhatsAppWindow(handleCapture);
  createStickyWindow();
  createTray();

  if (process.platform === 'darwin') app.dock?.setIcon(appIcon());

  globalShortcut.register('CommandOrControl+Shift+W', () => toggleSticky());

  // Housekeeping: retire long-completed tasks while the app is left running.
  setInterval(() => store.sweepDone(), SWEEP_INTERVAL_MS);

  refreshTrayMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWhatsAppWindow(handleCapture);
      createStickyWindow();
    }
  });
}

// The sticky board and tray are the product; closing the WhatsApp window
// should not take the reminders down with it.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  store.flush();
  globalShortcut.unregisterAll();
  destroyTray();
});
