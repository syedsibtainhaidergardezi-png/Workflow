import { BrowserWindow, Menu, shell, type ContextMenuParams } from 'electron';
import path from 'node:path';
import { CH, type MessageCapture } from '../shared/types';
import { store } from './store';

const WHATSAPP_URL = 'https://web.whatsapp.com/';

/**
 * WhatsApp Web refuses to load for clients it reads as unsupported, and
 * Electron's default UA advertises Electron. Pin a plain Chrome UA instead.
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let whatsappWindow: BrowserWindow | null = null;
let stickyWindow: BrowserWindow | null = null;
/** Kept so the window can be rebuilt after the user closes it. */
let captureHandler: ((cap: MessageCapture) => void) | null = null;

export function getWhatsAppWindow(): BrowserWindow | null {
  return whatsappWindow;
}

export function getStickyWindow(): BrowserWindow | null {
  return stickyWindow;
}

export function createWhatsAppWindow(onCapture: (cap: MessageCapture) => void): BrowserWindow {
  captureHandler = onCapture;
  const saved = store.getSettings().mainBounds;

  whatsappWindow = new BrowserWindow({
    width: saved?.width ?? 1180,
    height: saved?.height ?? 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 760,
    minHeight: 560,
    title: 'Workflow',
    backgroundColor: '#111b21',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/whatsapp.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  whatsappWindow.loadURL(WHATSAPP_URL, { userAgent: CHROME_UA });

  whatsappWindow.once('ready-to-show', () => whatsappWindow?.show());

  // Links to anywhere other than WhatsApp itself belong in the real browser.
  whatsappWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  whatsappWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(WHATSAPP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Selection-based capture. This is the resilient path: it keeps working
  // even when a WhatsApp redesign breaks the pin buttons.
  whatsappWindow.webContents.on('context-menu', (_event, params) => {
    buildContextMenu(params, onCapture).popup({ window: whatsappWindow ?? undefined });
  });

  whatsappWindow.on('close', () => saveBounds(whatsappWindow, 'mainBounds'));
  whatsappWindow.on('closed', () => {
    whatsappWindow = null;
  });

  return whatsappWindow;
}

function buildContextMenu(
  params: ContextMenuParams,
  onCapture: (cap: MessageCapture) => void,
): Menu {
  const selection = params.selectionText.trim();
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (selection) {
    template.push(
      {
        label: 'Save selection to Workflow',
        click: () =>
          onCapture({
            messageId: null,
            chatId: null,
            chatName: 'Selection',
            sender: 'Selected text',
            text: selection,
            sentAt: Date.now(),
            rawPrefix: null,
          }),
      },
      { type: 'separator' },
      { role: 'copy' },
    );
  }

  if (params.isEditable) {
    template.push({ role: 'cut' }, { role: 'paste' }, { role: 'selectAll' });
  }

  if (!template.length) template.push({ role: 'reload' });
  return Menu.buildFromTemplate(template);
}

export function createStickyWindow(): BrowserWindow {
  const settings = store.getSettings();
  const saved = settings.stickyBounds;

  stickyWindow = new BrowserWindow({
    width: saved?.width ?? 330,
    height: saved?.height ?? 460,
    x: saved?.x,
    y: saved?.y,
    minWidth: 260,
    minHeight: 200,
    // A sticky note, not an app window: no chrome, no taskbar entry, floats.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    fullscreenable: false,
    maximizable: false,
    title: 'Workflow',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/sticky.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  stickyWindow.loadFile(path.join(__dirname, '../renderer/sticky/index.html'));
  stickyWindow.setOpacity(settings.opacity);

  // `screen-saver` keeps it above full-screen apps too, which is the whole
  // point of a sticky note you're supposed to notice.
  if (settings.alwaysOnTop) {
    stickyWindow.setAlwaysOnTop(true, 'screen-saver');
    stickyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  stickyWindow.once('ready-to-show', () => {
    if (store.getSettings().stickyVisible) stickyWindow?.showInactive();
  });

  const remember = () => saveBounds(stickyWindow, 'stickyBounds');
  stickyWindow.on('moved', remember);
  stickyWindow.on('resized', remember);
  stickyWindow.on('close', remember);
  stickyWindow.on('closed', () => {
    stickyWindow = null;
  });

  return stickyWindow;
}

export function toggleSticky(force?: boolean): void {
  if (!stickyWindow) {
    createStickyWindow();
    store.patchSettings({ stickyVisible: true });
    return;
  }
  const show = force ?? !stickyWindow.isVisible();
  if (show) stickyWindow.showInactive();
  else stickyWindow.hide();
  store.patchSettings({ stickyVisible: show });
}

export function applyAlwaysOnTop(enabled: boolean): void {
  if (!stickyWindow) return;
  stickyWindow.setAlwaysOnTop(enabled, enabled ? 'screen-saver' : 'normal');
  stickyWindow.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: enabled });
}

export function applyOpacity(value: number): void {
  stickyWindow?.setOpacity(Math.min(1, Math.max(0.4, value)));
}

/**
 * Brings WhatsApp forward, rebuilding the window if it was closed. Returns
 * false when there is nothing to show (only before the first create).
 */
export function showWhatsApp(): boolean {
  if (!whatsappWindow || whatsappWindow.isDestroyed()) {
    if (!captureHandler) return false;
    createWhatsAppWindow(captureHandler);
    return false;
  }
  if (whatsappWindow.isMinimized()) whatsappWindow.restore();
  whatsappWindow.show();
  whatsappWindow.focus();
  return true;
}

/** Brings WhatsApp forward and asks the page to scroll to a given message. */
export function revealMessage(payload: {
  messageId: string | null;
  chatName: string;
}): void {
  const wasOpen = showWhatsApp();
  const win = whatsappWindow;
  if (!win) return;

  if (wasOpen) {
    win.webContents.send(CH.revealMessage, payload);
    return;
  }

  // Freshly recreated: wait for the page, then give WhatsApp a moment to
  // render the chat list before asking it to find anything.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send(CH.revealMessage, payload);
    }, 2500);
  });
}

export function broadcastTasks(): void {
  stickyWindow?.webContents.send(CH.tasksChanged, store.getTasks());
}

function saveBounds(win: BrowserWindow | null, key: 'stickyBounds' | 'mainBounds'): void {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  store.patchSettings({ [key]: win.getBounds() } as never);
}
