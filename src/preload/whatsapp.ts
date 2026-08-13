import { ipcRenderer } from 'electron';
import { CH, type MessageCapture } from '../shared/types';

/**
 * Runs inside the WhatsApp Web page (isolated world, no page JS access).
 *
 * WhatsApp ships obfuscated, frequently-rotated class names, so everything
 * here is written to degrade rather than throw: every selector has fallbacks,
 * every extraction is wrapped, and if the pin buttons ever stop appearing the
 * right-click "Save selection to Workflow" path in the main process still works.
 *
 * Selectors last verified against WhatsApp Web, late 2025.
 */

const PIN_FLAG = 'wfPinned';
const ROW_SELECTOR = 'div[data-id]';
const CONVERSATION = '#main';

// ---------------------------------------------------------------- extraction

/**
 * Reads visible text out of a node, keeping emoji (which WhatsApp renders as
 * <img alt="😀">) and line breaks that `textContent` would silently drop.
 */
function readText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'IMG') return node.getAttribute('alt') ?? '';
  if (node.tagName === 'BR') return '\n';
  return Array.from(node.childNodes).map(readText).join('');
}

/** `[3:45 PM, 8/13/2026] Ali Raza: ` -> sender plus a best-effort timestamp. */
function parsePrefix(prefix: string | null): { sender: string | null; sentAt: number | null } {
  if (!prefix) return { sender: null, sentAt: null };

  const match = /^\[(.+?),\s*(.+?)\]\s*(.*?):\s*$/.exec(prefix);
  if (!match) return { sender: null, sentAt: null };

  const [, time, date, sender] = match;
  // Locale ordering (D/M vs M/D) is genuinely ambiguous here; if the direct
  // parse fails we try the other ordering, and otherwise give up gracefully.
  let stamp = Date.parse(`${date} ${time}`);
  if (Number.isNaN(stamp)) {
    const swapped = date.replace(/^(\d+)([/.-])(\d+)/, '$3$2$1');
    stamp = Date.parse(`${swapped} ${time}`);
  }

  return {
    sender: sender.trim() || null,
    sentAt: Number.isNaN(stamp) ? null : stamp,
  };
}

/** Describes attachment-only messages, which carry no selectable text. */
function describeMedia(row: HTMLElement): string | null {
  const probes: Array<[string, string]> = [
    ['[data-icon="audio-play"], [data-icon="ptt-status"], audio', '[voice message]'],
    ['video, [data-icon="media-play"]', '[video]'],
    ['[data-icon="document"], [data-icon="doc-generic"]', '[document]'],
    ['[data-icon="sticker"]', '[sticker]'],
    ['img[src^="blob:"], img[src^="data:image"]', '[photo]'],
  ];
  for (const [selector, label] of probes) {
    if (row.querySelector(selector)) return label;
  }
  return null;
}

function chatTitle(): string {
  const header = document.querySelector(`${CONVERSATION} header`);
  const titled = header?.querySelector('span[title]')?.getAttribute('title');
  if (titled) return titled.trim();
  const fallback = header ? readText(header).trim().split('\n')[0] : '';
  return fallback || 'WhatsApp';
}

function extract(row: HTMLElement): MessageCapture {
  const messageId = row.getAttribute('data-id');
  // data-id looks like `false_923001234567@c.us_3EB0C767D82B`.
  const chatId = messageId?.split('_')[1] ?? null;

  const prefixEl = row.querySelector('[data-pre-plain-text]');
  const rawPrefix = prefixEl?.getAttribute('data-pre-plain-text') ?? null;
  const { sender, sentAt } = parsePrefix(rawPrefix);

  const outgoing = !!row.closest('.message-out') || row.classList.contains('message-out');

  const bodyEl = row.querySelector('.copyable-text .selectable-text, span.selectable-text');
  const body = bodyEl ? readText(bodyEl).trim() : '';
  const text = body || describeMedia(row) || '[message]';

  return {
    messageId,
    chatId,
    chatName: chatTitle(),
    sender: sender ?? (outgoing ? 'You' : chatTitle()),
    text: text.length > 600 ? `${text.slice(0, 600)}…` : text,
    sentAt,
    rawPrefix,
  };
}

// ------------------------------------------------------------------ pinning

function pinButton(row: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'wf-pin';
  button.type = 'button';
  button.title = 'Save to Workflow (Ctrl+Shift+W shows the board)';
  button.setAttribute('aria-label', 'Save this message to Workflow');
  button.textContent = '📌';

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      ipcRenderer.send(CH.capture, extract(row));
      button.classList.add('wf-pin--saved');
      setTimeout(() => button.classList.remove('wf-pin--saved'), 1200);
    } catch (err) {
      console.error('[workflow] capture failed', err);
      toast('Could not read that message');
    }
  });

  return button;
}

function decorate(row: HTMLElement): void {
  if (row.dataset[PIN_FLAG]) return;
  // Rows without a body are date separators, system notices and the like.
  if (!row.querySelector('.copyable-text') && !row.querySelector('.selectable-text')) return;

  row.dataset[PIN_FLAG] = '1';

  const outgoing = !!row.closest('.message-out') || row.classList.contains('message-out');
  row.classList.add('wf-row', outgoing ? 'wf-row--out' : 'wf-row--in');

  // Anchor the button to the row without disturbing WhatsApp's own layout.
  if (getComputedStyle(row).position === 'static') row.style.position = 'relative';

  row.appendChild(pinButton(row));
}

function scan(): void {
  const main = document.querySelector(CONVERSATION);
  if (!main) return;
  main.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach(decorate);
}

// ------------------------------------------------------------- reveal a task

function flash(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('wf-flash');
  setTimeout(() => el.classList.remove('wf-flash'), 2400);
}

function findMessage(messageId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`div[data-id="${CSS.escape(messageId)}"]`);
}

/** Clicks the chat with this title in the sidebar, if it's in the list. */
function openChat(chatName: string): boolean {
  const side = document.querySelector('#pane-side');
  if (!side) return false;

  const match = Array.from(side.querySelectorAll<HTMLElement>('span[title]')).find(
    (el) => el.getAttribute('title') === chatName,
  );
  if (!match) return false;

  const target = match.closest<HTMLElement>('[role="listitem"], [role="row"]') ?? match;
  target.click();
  return true;
}

/**
 * Best effort: WhatsApp Web has no "jump to message id" API, and older
 * messages are virtualised out of the DOM. We open the right chat and scroll
 * to the message when it happens to be loaded, and say so plainly when not.
 */
async function reveal(messageId: string | null, chatName: string): Promise<void> {
  if (messageId) {
    const present = findMessage(messageId);
    if (present) {
      flash(present);
      return;
    }
  }

  if (chatTitle() !== chatName && !openChat(chatName)) {
    toast(`Open "${chatName}" to see this message`);
    return;
  }

  if (!messageId) return;

  // Give the conversation a moment to render, then look again.
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const el = findMessage(messageId);
    if (el) {
      flash(el);
      return;
    }
  }

  toast('Opened the chat — scroll up to find the original message');
}

// ---------------------------------------------------------------- page chrome

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(message: string): void {
  let el = document.querySelector<HTMLElement>('.wf-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'wf-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('wf-toast--on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el?.classList.remove('wf-toast--on'), 2600);
}

const STYLES = `
.wf-pin {
  position: absolute;
  top: 2px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(32, 44, 51, 0.92);
  color: #e9edef;
  font-size: 13px;
  line-height: 26px;
  text-align: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
  z-index: 20;
}
.wf-row--in  .wf-pin { right: -32px; }
.wf-row--out .wf-pin { left: -32px; }
.wf-row:hover .wf-pin,
.wf-pin:focus-visible { opacity: 1; transform: scale(1); }
.wf-pin:hover { background: #25d366; }
.wf-pin--saved { opacity: 1 !important; background: #25d366; transform: scale(1.12); }

.wf-flash {
  animation: wf-flash-kf 2.4s ease-out;
  border-radius: 8px;
}
@keyframes wf-flash-kf {
  0%, 60% { background: rgba(37, 211, 102, 0.28); }
  100%    { background: transparent; }
}

.wf-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translate(-50%, 12px);
  max-width: 70vw;
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(32, 44, 51, 0.96);
  color: #e9edef;
  font-size: 13.5px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
  z-index: 10000;
}
.wf-toast--on { opacity: 1; transform: translate(-50%, 0); }
`;

function injectStyles(): void {
  if (document.getElementById('wf-styles')) return;
  const style = document.createElement('style');
  style.id = 'wf-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// -------------------------------------------------------------------- wiring

function boot(): void {
  injectStyles();
  scan();

  // WhatsApp virtualises the message list, so rows stream in and out
  // constantly. Coalesce the churn into one scan per frame-ish.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      scan();
    }, 120);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

ipcRenderer.on(CH.revealMessage, (_event, payload: { messageId: string | null; chatName: string }) => {
  reveal(payload.messageId, payload.chatName).catch((err) =>
    console.error('[workflow] reveal failed', err),
  );
});

ipcRenderer.on(CH.captureAck, (_event, payload: { duplicate: boolean }) => {
  toast(payload.duplicate ? 'Already on your board — moved back to the top' : 'Saved to Workflow');
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
