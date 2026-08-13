import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  type MessageCapture,
  type Settings,
  type Task,
  type TaskPatch,
} from '../shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Flat-file store for tasks and settings. Everything lives in the user's
 * Electron userData dir and never leaves the machine.
 */
class Store {
  private dir = app.getPath('userData');
  private tasksFile = path.join(this.dir, 'tasks.json');
  private settingsFile = path.join(this.dir, 'settings.json');

  private tasks: Task[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<() => void>();
  private flushTimer: NodeJS.Timeout | null = null;

  load(): void {
    this.tasks = this.readJson(this.tasksFile, [] as Task[]).filter(isTask);
    this.settings = { ...DEFAULT_SETTINGS, ...this.readJson(this.settingsFile, {}) };
    this.sweepDone();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  getTasks(): Task[] {
    return sortTasks(this.tasks);
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  /**
   * Turns a scraped message into a task. Capturing the same message twice
   * bumps the existing task back to the top instead of duplicating it.
   */
  capture(cap: MessageCapture): { task: Task; duplicate: boolean } {
    const existing = cap.messageId
      ? this.tasks.find((t) => t.messageId === cap.messageId)
      : undefined;

    if (existing) {
      existing.done = false;
      existing.doneAt = null;
      existing.createdAt = Date.now();
      this.persistTasks();
      return { task: existing, duplicate: true };
    }

    const task: Task = {
      id: randomUUID(),
      messageId: cap.messageId,
      chatId: cap.chatId,
      chatName: cap.chatName || 'WhatsApp',
      sender: cap.sender || 'Unknown',
      text: cap.text || '(no text)',
      note: '',
      sentAt: cap.sentAt,
      createdAt: Date.now(),
      dueAt: null,
      done: false,
      doneAt: null,
      pinned: false,
    };
    this.tasks.push(task);
    this.persistTasks();
    return { task, duplicate: false };
  }

  update(id: string, patch: TaskPatch): Task | null {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return null;

    if (patch.note !== undefined) task.note = patch.note;
    if (patch.text !== undefined) task.text = patch.text;
    if (patch.dueAt !== undefined) task.dueAt = patch.dueAt;
    if (patch.pinned !== undefined) task.pinned = patch.pinned;
    if (patch.done !== undefined && patch.done !== task.done) {
      task.done = patch.done;
      task.doneAt = patch.done ? Date.now() : null;
    }

    this.persistTasks();
    return task;
  }

  delete(id: string): void {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.tasks.length !== before) this.persistTasks();
  }

  clearDone(): void {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !t.done);
    if (this.tasks.length !== before) this.persistTasks();
  }

  find(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    this.writeJson(this.settingsFile, this.settings);
    return this.getSettings();
  }

  /** Drops tasks that were completed longer than `keepDoneDays` ago. */
  sweepDone(): void {
    const days = this.settings.keepDoneDays;
    if (!days) return;
    const cutoff = Date.now() - days * DAY_MS;
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !t.done || !t.doneAt || t.doneAt > cutoff);
    if (this.tasks.length !== before) this.persistTasks();
  }

  /** Writes to disk on a short debounce, then wakes anyone listening. */
  private persistTasks(): void {
    this.listeners.forEach((fn) => fn());
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.writeJson(this.tasksFile, this.tasks);
    }, 250);
  }

  /** Called on quit so a debounced write is never lost. */
  flush(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.writeJson(this.tasksFile, this.tasks);
  }

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Write to a temp file first so a crash mid-write can't shred the store. */
  private writeJson(file: string, value: unknown): void {
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[workflow] failed writing', file, err);
    }
  }
}

function isTask(value: unknown): value is Task {
  return !!value && typeof value === 'object' && typeof (value as Task).id === 'string';
}

/** Pinned first, then soonest due (undated last), then most recently captured. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return b.createdAt - a.createdAt;
  });
}

export const store = new Store();
