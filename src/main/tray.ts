import { Menu, Tray, app } from 'electron';
import { store } from './store';
import { trayIcon } from './icon';
import { applyAlwaysOnTop, getStickyWindow, showWhatsApp, toggleSticky } from './windows';

let tray: Tray | null = null;

export function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('Workflow');
  refreshTrayMenu();
  // Windows/Linux: a plain click on the icon is the fastest way to the board.
  tray.on('click', () => toggleSticky());
}

export function refreshTrayMenu(): void {
  if (!tray) return;

  const settings = store.getSettings();
  const open = store.getTasks().filter((t) => !t.done).length;
  const sticky = getStickyWindow();

  tray.setToolTip(open ? `Workflow — ${open} open` : 'Workflow — all clear');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: open ? `${open} open task${open === 1 ? '' : 's'}` : 'All clear', enabled: false },
      { type: 'separator' },
      {
        label: sticky?.isVisible() ? 'Hide sticky board' : 'Show sticky board',
        click: () => toggleSticky(),
      },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => {
          store.patchSettings({ alwaysOnTop: item.checked });
          applyAlwaysOnTop(item.checked);
          refreshTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Open WhatsApp', click: () => showWhatsApp() },
      { type: 'separator' },
      { label: 'Quit Workflow', click: () => app.quit() },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
