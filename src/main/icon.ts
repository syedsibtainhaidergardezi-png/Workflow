import { nativeImage, type NativeImage } from 'electron';

/**
 * 32x32 sticky-note glyph, inlined so the repo carries no binary assets and
 * the tray works straight from a `git clone` with no build step for icons.
 */
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAa0lEQVR4nO3SwQ3AIAxDUZbpaizcMTpE' +
  'mCAiBFtB1JY4/yegNU1z9rzdkKc0voRgxcMIAQQ4EmBmX+bcAyh/AgHK/wAKMI0znyAUZwHCcQZgKe4B' +
  'aB+OCUjFPQD92pGArfguAhLPIqBx7VcbxqssehsSBzAAAAAASUVORK5CYII=';

export function appIcon(): NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`);
}

/** macOS wants a template image so the tray glyph follows the menu bar theme. */
export function trayIcon(): NativeImage {
  const image = appIcon();
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
