import { nativeImage, type NativeImage } from 'electron';

/**
 * 32x32 sticky-note glyph, inlined so the tray works straight from a bare
 * `git clone` without a separate asset step — and, more importantly, so it
 * still resolves once the app is packed inside app.asar.
 *
 * Regenerate with `npm run icons`, which prints this string.
 */
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA60lEQVR42mNgGAVoQPVyWoHq5bT7' +
  'qpfT/lMZg8wsIGR5Pw0sRsf9uCxXoIPlMKyAK+jp5YACbA5ooKMDGkYdQJQD1r4/9p8S8OTXm/8O' +
  'NyvJd8DHP1//Uwpi7vWQ74DMh9P+n/xyk2w86eXm0URImQNA8QcKRnJxy7OVlDlgwBMhKCFRAkAe' +
  'oCgbjiZCWEIkhHEEM+UOICUNgAotqjuAlFyAp9TDwMqnk4lzgN/tZqLzvPG1AqIsl9sd819oktfA' +
  'JEKo5QPjACTL6e8ANMtBuIBujVIsls+nW7OcaMtp0TEh2XJqds3ItnxEAgBVSaZDUCfh3gAAAABJ' +
  'RU5ErkJggg==';

export function appIcon(): NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`);
}

/** macOS wants a template image so the tray glyph follows the menu bar theme. */
export function trayIcon(): NativeImage {
  const image = appIcon();
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
