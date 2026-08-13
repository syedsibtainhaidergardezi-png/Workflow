/** Data shared between the main process, the preloads and the sticky renderer. */

/** What the WhatsApp preload manages to scrape off a single message bubble. */
export interface MessageCapture {
  /** WhatsApp's own `data-id`, e.g. `false_9230012345@c.us_3EB0C767D82B`. */
  messageId: string | null;
  /** Chat JID pulled out of the `data-id`, when it parses. */
  chatId: string | null;
  /** Chat title as shown in the header ("Ali Raza", "Cricket Sunday"). */
  chatName: string;
  /** Who wrote it. For your own messages this is "You". */
  sender: string;
  /** Message body, or a `[photo]`-style placeholder for media without a caption. */
  text: string;
  /** Parsed send time in ms, or null when WhatsApp's locale string defeats us. */
  sentAt: number | null;
  /** The raw `[10:34 PM, 8/13/2026] Ali Raza: ` prefix, kept for display fallback. */
  rawPrefix: string | null;
}

export interface Task {
  id: string;
  messageId: string | null;
  chatId: string | null;
  chatName: string;
  sender: string;
  /** Message excerpt as captured. Never rewritten. */
  text: string;
  /** Your own annotation — what actually needs doing. */
  note: string;
  sentAt: number | null;
  createdAt: number;
  dueAt: number | null;
  done: boolean;
  doneAt: number | null;
  pinned: boolean;
}

export type TaskPatch = Partial<
  Pick<Task, 'note' | 'dueAt' | 'done' | 'pinned' | 'text'>
>;

export interface Settings {
  alwaysOnTop: boolean;
  stickyVisible: boolean;
  /** 0.4–1. Applied to the sticky window as a whole. */
  opacity: number;
  stickyBounds: { x: number; y: number; width: number; height: number } | null;
  mainBounds: { x: number; y: number; width: number; height: number } | null;
  /** Done tasks are swept from the board after this many days. 0 disables. */
  keepDoneDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: true,
  stickyVisible: true,
  opacity: 1,
  stickyBounds: null,
  mainBounds: null,
  keepDoneDays: 7,
};

/** Renderer -> main, and main -> renderer channel names. */
export const CH = {
  capture: 'workflow:capture',
  captureAck: 'workflow:capture-ack',
  tasksChanged: 'workflow:tasks-changed',
  listTasks: 'workflow:list-tasks',
  updateTask: 'workflow:update-task',
  deleteTask: 'workflow:delete-task',
  clearDone: 'workflow:clear-done',
  focusMessage: 'workflow:focus-message',
  revealMessage: 'workflow:reveal-message',
  getSettings: 'workflow:get-settings',
  setSettings: 'workflow:set-settings',
  settingsChanged: 'workflow:settings-changed',
  hideSticky: 'workflow:hide-sticky',
  openWhatsApp: 'workflow:open-whatsapp',
} as const;
