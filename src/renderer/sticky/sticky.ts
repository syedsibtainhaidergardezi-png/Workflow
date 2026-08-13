/**
 * The sticky board renderer.
 *
 * Deliberately framework-free and DOM-built rather than templated: message
 * text comes from other people, so it only ever reaches the page through
 * `textContent`, never `innerHTML`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

let tasks: WfTask[] = [];
let showDone = false;
let editingId: string | null = null;
let dueOpenId: string | null = null;

const listEl = document.getElementById('list') as HTMLElement;
const countEl = document.getElementById('count') as HTMLElement;
const footEl = document.querySelector('.foot') as HTMLElement;
const toggleDoneEl = document.getElementById('toggle-done') as HTMLButtonElement;
const clearDoneEl = document.getElementById('clear-done') as HTMLButtonElement;
const pinEl = document.getElementById('pin') as HTMLButtonElement;

// ------------------------------------------------------------------ helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Days from today: 0 = today, -1 = yesterday, 2 = day after tomorrow. */
function dayOffset(ms: number): number {
  return Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY_MS);
}

function dueLabel(dueAt: number): string {
  const offset = dayOffset(dueAt);
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  if (offset === -1) return 'yesterday';
  if (offset < 0) return `${-offset}d overdue`;
  if (offset < 7) return new Date(dueAt).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function capturedLabel(task: WfTask): string {
  const ms = task.sentAt ?? task.createdAt;
  const offset = dayOffset(ms);
  if (offset === 0) return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (offset === -1) return 'yesterday';
  if (offset > -7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function atHour(base: Date, hour: number): number {
  base.setHours(hour, 0, 0, 0);
  return base.getTime();
}

function apply(promise: Promise<WfTask[]>): void {
  promise.then(paint).catch((err) => console.error('[workflow]', err));
}

// ------------------------------------------------------------------- render

function paint(next: WfTask[], highlightId?: string): void {
  tasks = next;

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  countEl.textContent = open.length ? String(open.length) : '';
  toggleDoneEl.textContent = done.length
    ? `${showDone ? 'Hide' : 'Show'} ${done.length} done`
    : '';
  footEl.classList.toggle('foot--has-done', done.length > 0 && showDone);

  listEl.replaceChildren();

  const visible = showDone ? [...open, ...done] : open;

  if (!visible.length) {
    listEl.appendChild(emptyState(done.length > 0));
    return;
  }

  for (const task of visible) listEl.appendChild(card(task));

  if (highlightId) {
    const node = listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(highlightId)}"]`);
    if (node) {
      node.classList.add('task--flash');
      node.scrollIntoView({ block: 'nearest' });
    }
  }
}

function emptyState(hasDone: boolean): HTMLElement {
  const wrap = el('div', 'empty');
  wrap.append(
    document.createTextNode(hasDone ? 'Nothing left to do.' : 'Nothing pinned yet.'),
    el('br'),
    document.createTextNode('Hover any WhatsApp message and hit '),
    el('b', undefined, '📌'),
    document.createTextNode('.'),
  );
  return wrap;
}

function card(task: WfTask): HTMLElement {
  const wrap = el('article', 'task');
  wrap.dataset.id = task.id;
  if (task.done) wrap.classList.add('task--done');
  if (task.pinned) wrap.classList.add('task--pinned');
  if (editingId === task.id) wrap.classList.add('task--editing');

  const check = el('input', 'check') as HTMLInputElement;
  check.type = 'checkbox';
  check.checked = task.done;
  check.title = task.done ? 'Reopen' : 'Mark done';
  check.addEventListener('change', () =>
    apply(window.workflow.update(task.id, { done: check.checked })),
  );

  const body = el('div', 'task__body');

  // The note is what you meant to do; the message is the evidence. When a
  // note exists it leads and the message drops back to a quote.
  const headline = el('div', 'task__text', task.note || task.text);
  headline.title = 'Click to open this message in WhatsApp';
  headline.addEventListener('click', () => window.workflow.reveal(task.id));
  body.appendChild(headline);

  if (task.note && task.text) body.appendChild(el('div', 'task__quote', task.text));

  body.appendChild(meta(task));

  if (editingId === task.id) body.appendChild(noteEditor(task));
  if (dueOpenId === task.id) body.appendChild(dueBar(task));

  body.appendChild(tools(task));

  wrap.append(check, body);
  return wrap;
}

function meta(task: WfTask): HTMLElement {
  const row = el('div', 'task__meta');

  const who =
    task.sender && task.sender !== task.chatName
      ? `${task.sender} · ${task.chatName}`
      : task.chatName;
  row.appendChild(el('span', 'task__who', who));
  row.appendChild(el('span', undefined, capturedLabel(task)));

  if (task.dueAt !== null) {
    const offset = dayOffset(task.dueAt);
    const badge = el('span', 'due', dueLabel(task.dueAt));
    if (!task.done && offset < 0) badge.classList.add('due--over');
    else if (!task.done && offset === 0) badge.classList.add('due--today');
    row.appendChild(badge);
  }

  return row;
}

function tools(task: WfTask): HTMLElement {
  const row = el('div', 'task__tools');

  const button = (label: string, title: string, onClick: () => void, danger = false) => {
    const b = el('button', danger ? 'tool tool--danger' : 'tool', label);
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };

  // Labels are kept to one short word each: five buttons wrapping onto a
  // second row would reserve that height on every card, hovered or not.
  // The longer explanation lives in the tooltip.
  row.append(
    button(editingId === task.id ? 'Close' : 'Note', 'Add your own note', () => {
      editingId = editingId === task.id ? null : task.id;
      paint(tasks);
    }),
    button('Due', 'Set a due date', () => {
      dueOpenId = dueOpenId === task.id ? null : task.id;
      paint(tasks);
    }),
    button(task.pinned ? 'Unpin' : 'Pin', 'Keep at the top of the board', () =>
      apply(window.workflow.update(task.id, { pinned: !task.pinned })),
    ),
    button('Jump', 'Open this message in WhatsApp', () => window.workflow.reveal(task.id)),
    button('Delete', 'Remove from the board', () => apply(window.workflow.remove(task.id)), true),
  );

  return row;
}

function noteEditor(task: WfTask): HTMLElement {
  const input = el('textarea', 'note-input') as HTMLTextAreaElement;
  input.value = task.note;
  input.placeholder = 'What actually needs doing?';

  const commit = () => {
    if (input.value !== task.note) apply(window.workflow.update(task.id, { note: input.value.trim() }));
    else paint(tasks);
  };

  input.addEventListener('blur', () => {
    editingId = null;
    commit();
  });

  input.addEventListener('keydown', (event) => {
    // Enter saves, Shift+Enter makes a new line, Escape abandons the edit.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = task.note;
      input.blur();
    }
  });

  // Focus after the node is in the document.
  setTimeout(() => input.focus(), 0);
  return input;
}

function dueBar(task: WfTask): HTMLElement {
  const bar = el('div', 'duebar');

  const set = (value: number | null) => {
    dueOpenId = null;
    apply(window.workflow.update(task.id, { dueAt: value }));
  };

  const preset = (label: string, value: () => number) => {
    const b = el('button', 'tool', label);
    b.addEventListener('click', () => set(value()));
    return b;
  };

  bar.append(
    preset('Today', () => atHour(new Date(), 18)),
    preset('Tomorrow', () => atHour(new Date(Date.now() + DAY_MS), 9)),
    preset('Next week', () => atHour(new Date(Date.now() + 7 * DAY_MS), 9)),
  );

  const date = el('input') as HTMLInputElement;
  date.type = 'date';
  if (task.dueAt) date.value = new Date(task.dueAt).toISOString().slice(0, 10);
  date.addEventListener('change', () => {
    if (!date.value) return;
    const [y, m, d] = date.value.split('-').map(Number);
    set(atHour(new Date(y, m - 1, d), 9));
  });
  bar.appendChild(date);

  if (task.dueAt !== null) {
    const clear = el('button', 'tool tool--danger', 'Clear');
    clear.addEventListener('click', () => set(null));
    bar.appendChild(clear);
  }

  return bar;
}

// -------------------------------------------------------------------- chrome

toggleDoneEl.addEventListener('click', () => {
  showDone = !showDone;
  paint(tasks);
});

clearDoneEl.addEventListener('click', () => apply(window.workflow.clearDone()));

document.getElementById('hide')?.addEventListener('click', () => window.workflow.hide());
document.getElementById('whatsapp')?.addEventListener('click', () => window.workflow.openWhatsApp());

pinEl.addEventListener('click', () => {
  const next = pinEl.getAttribute('aria-pressed') !== 'true';
  pinEl.setAttribute('aria-pressed', String(next));
  window.workflow.setSettings({ alwaysOnTop: next }).catch(() => undefined);
});

// ---------------------------------------------------------------------- boot

window.workflow.onTasks((next, highlightId) => paint(next, highlightId));

window.workflow.getSettings().then((settings) => {
  pinEl.setAttribute('aria-pressed', String(settings.alwaysOnTop));
});

window.workflow.list().then((next) => paint(next));

// Due badges are relative ("today", "2d overdue"), so repaint across midnight.
setInterval(() => paint(tasks), 5 * 60 * 1000);
