import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentStateStore } from './agentStateStore.js';
import { applyTelegramOfficeEvent } from './telegramEvents.js';
import type { TelegramRosterEntry } from './telegramRoster.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_IDLE_DELAY_MS = 6000;
const DEFAULT_THINKING_DELAY_MS = 400;
const MAX_READ_BYTES = 256 * 1024;

export interface TelegramLogMonitorConfig {
  rosterKey: string;
  label: string;
  logPath: string;
}

interface MonitorState {
  config: TelegramLogMonitorConfig;
  offset: number;
  lineBuffer: string;
}

interface ParsedGatewayEvent {
  eventType: 'message_received' | 'message_sent';
  chatLabel?: string;
  preview?: string;
  at: number;
}

export interface TelegramLogMonitorOptions {
  pollIntervalMs?: number;
  idleDelayMs?: number;
  thinkingDelayMs?: number;
}

export class TelegramLogMonitor {
  private readonly monitors = new Map<string, MonitorState>();
  private readonly intervalMs: number;
  private readonly idleDelayMs: number;
  private readonly thinkingDelayMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();
  private readonly thinkingTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastChatLabels = new Map<string, string>();

  constructor(
    private readonly store: AgentStateStore,
    configs: TelegramLogMonitorConfig[],
    options: TelegramLogMonitorOptions = {},
  ) {
    this.intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.thinkingDelayMs = options.thinkingDelayMs ?? DEFAULT_THINKING_DELAY_MS;

    for (const config of configs) {
      this.monitors.set(config.rosterKey, {
        config,
        offset: getInitialOffset(config.logPath),
        lineBuffer: '',
      });
    }
  }

  start(): void {
    if (this.pollTimer || this.monitors.size === 0) return;
    this.pollTimer = setInterval(() => this.pollAll(), this.intervalMs);
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    for (const timer of this.thinkingTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.thinkingTimers.clear();
  }

  getMonitorCount(): number {
    return this.monitors.size;
  }

  private pollAll(): void {
    for (const state of this.monitors.values()) {
      this.pollOne(state);
    }
  }

  private pollOne(state: MonitorState): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(state.config.logPath);
    } catch {
      return;
    }

    if (stat.size < state.offset) {
      state.offset = 0;
      state.lineBuffer = '';
    }
    if (stat.size === state.offset) return;

    const bytesToRead = Math.min(stat.size - state.offset, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(state.config.logPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, bytesToRead, state.offset);
    } finally {
      fs.closeSync(fd);
    }
    state.offset += bytesToRead;

    const chunk = state.lineBuffer + buffer.toString('utf8');
    const lines = chunk.split(/\r?\n/);
    state.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      this.handleLine(state.config.rosterKey, line);
    }
  }

  private handleLine(rosterKey: string, line: string): void {
    const parsed = parseTelegramGatewayLogLine(line);
    if (!parsed) return;

    if (parsed.chatLabel) {
      this.lastChatLabels.set(rosterKey, parsed.chatLabel);
    }

    if (parsed.eventType === 'message_received') {
      this.clearIdle(rosterKey);
      applyTelegramOfficeEvent(this.store, { rosterKey, ...parsed });
      this.scheduleThinking(rosterKey, parsed.at, parsed.chatLabel, parsed.preview);
      return;
    }

    this.clearThinking(rosterKey);
    applyTelegramOfficeEvent(this.store, {
      rosterKey,
      eventType: 'message_sent',
      chatLabel: parsed.chatLabel ?? this.lastChatLabels.get(rosterKey),
      preview: parsed.preview,
      at: parsed.at,
    });
    this.scheduleIdle(rosterKey, parsed.at);
  }

  private scheduleThinking(
    rosterKey: string,
    at: number,
    chatLabel?: string,
    preview?: string,
  ): void {
    this.clearThinking(rosterKey);
    const timer = setTimeout(() => {
      this.thinkingTimers.delete(rosterKey);
      applyTelegramOfficeEvent(this.store, {
        rosterKey,
        eventType: 'thinking',
        chatLabel: chatLabel ?? this.lastChatLabels.get(rosterKey),
        preview,
        at: Math.max(Date.now(), at + this.thinkingDelayMs),
      });
    }, this.thinkingDelayMs);
    this.thinkingTimers.set(rosterKey, timer);
  }

  private scheduleIdle(rosterKey: string, at: number): void {
    this.clearIdle(rosterKey);
    const timer = setTimeout(() => {
      this.idleTimers.delete(rosterKey);
      applyTelegramOfficeEvent(this.store, {
        rosterKey,
        eventType: 'idle',
        chatLabel: this.lastChatLabels.get(rosterKey),
        at: Math.max(Date.now(), at + this.idleDelayMs),
      });
    }, this.idleDelayMs);
    this.idleTimers.set(rosterKey, timer);
  }

  private clearIdle(rosterKey: string): void {
    const timer = this.idleTimers.get(rosterKey);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(rosterKey);
    }
  }

  private clearThinking(rosterKey: string): void {
    const timer = this.thinkingTimers.get(rosterKey);
    if (timer) {
      clearTimeout(timer);
      this.thinkingTimers.delete(rosterKey);
    }
  }
}

export function buildTelegramLogMonitorConfigs(
  roster: TelegramRosterEntry[],
): TelegramLogMonitorConfig[] {
  const configs: TelegramLogMonitorConfig[] = [];
  const seen = new Set<string>();

  for (const entry of roster) {
    if (entry.enabled === false || seen.has(entry.key)) continue;
    const logPath = resolveTelegramLogPath(entry);
    if (!logPath) continue;
    seen.add(entry.key);
    configs.push({
      rosterKey: entry.key,
      label: entry.label,
      logPath,
    });
  }

  return configs;
}

export function resolveTelegramLogPath(entry: TelegramRosterEntry): string | null {
  const explicit = expandHome(entry.logPath);
  if (explicit) return explicit;

  const profile = typeof entry.profile === 'string' ? entry.profile.trim() : '';
  if (!profile) return null;

  if (profile === 'default') {
    return path.join(os.homedir(), '.hermes', 'logs', 'gateway.log');
  }

  return path.join(os.homedir(), '.hermes', 'profiles', profile, 'logs', 'gateway.log');
}

export function parseTelegramGatewayLogLine(line: string): ParsedGatewayEvent | null {
  const at = parseLogTimestamp(line);
  if (line.includes('gateway.run: inbound message: platform=telegram')) {
    const userMatch = /user=(.+?) chat=/.exec(line);
    const msgMatch = /msg=(.+)$/.exec(line);
    return {
      eventType: 'message_received',
      chatLabel: userMatch?.[1]?.trim() || 'Telegram',
      preview: normalizePreview(msgMatch?.[1]),
      at,
    };
  }

  if (line.includes('gateway.run: response ready: platform=telegram')) {
    const charsMatch = /response=(\d+) chars/.exec(line);
    const chatMatch = /chat=([^\s]+)/.exec(line);
    const lengthText = charsMatch?.[1] ? `${charsMatch[1]} chars sent` : 'Reply sent';
    return {
      eventType: 'message_sent',
      chatLabel: chatMatch?.[1]?.trim(),
      preview: lengthText,
      at,
    };
  }

  return null;
}

function getInitialOffset(logPath: string): number {
  try {
    return fs.statSync(logPath).size;
  } catch {
    return 0;
  }
}

function expandHome(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function normalizePreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const unquoted =
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.slice(0, 140);
}

function parseLogTimestamp(line: string): number {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d{3}/.exec(line);
  if (!match) return Date.now();
  const iso = match[1].replace(' ', 'T');
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
