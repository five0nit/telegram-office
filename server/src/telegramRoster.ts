import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentStateStore } from './agentStateStore.js';
import { LAYOUT_FILE_DIR } from './constants.js';
import type { AgentState } from './types.js';

export interface TelegramRosterEntry {
  key: string;
  label: string;
  telegramBot: string;
  kind?: string;
  enabled?: boolean;
  notes?: string;
  /** Hermes profile name whose gateway.log should be monitored (e.g. default, generalist1) */
  profile?: string;
  /** Explicit gateway log path when profile-derived resolution is not enough */
  logPath?: string;
}

interface TelegramRosterFile {
  agents?: TelegramRosterEntry[];
}

export function getTelegramRosterPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, 'telegram-roster.json');
}

export function loadTelegramRoster(): TelegramRosterEntry[] {
  const rosterPath = getTelegramRosterPath();
  try {
    if (!fs.existsSync(rosterPath)) return [];
    const raw = fs.readFileSync(rosterPath, 'utf-8');
    const parsed = JSON.parse(raw) as TelegramRosterFile;
    const seen = new Set<string>();
    const entries: TelegramRosterEntry[] = [];
    for (const entry of parsed.agents ?? []) {
      const key = typeof entry.key === 'string' ? entry.key.trim() : '';
      const telegramBot = typeof entry.telegramBot === 'string' ? entry.telegramBot.trim() : '';
      if (!key || !telegramBot || seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : key,
        telegramBot,
        kind: typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : 'bot',
        enabled: entry.enabled !== false,
        notes: typeof entry.notes === 'string' ? entry.notes : undefined,
        profile: typeof entry.profile === 'string' && entry.profile.trim() ? entry.profile.trim() : undefined,
        logPath: typeof entry.logPath === 'string' && entry.logPath.trim() ? entry.logPath.trim() : undefined,
      });
    }
    return entries;
  } catch (err) {
    console.error('[Pixel Agents] Failed to load telegram roster:', err);
    return [];
  }
}

export function seedTelegramRosterAgents(store: AgentStateStore, projectDir: string): number {
  const roster = loadTelegramRoster().filter((entry) => entry.enabled !== false);
  const rosterKeys = new Set(roster.map((entry) => entry.key));

  let changed = false;
  for (const [id, agent] of store) {
    if (agent.sourceKind === 'telegram-roster' && agent.rosterKey && !rosterKeys.has(agent.rosterKey)) {
      store.delete(id);
      changed = true;
    }
  }

  if (roster.length === 0) {
    if (changed) store.persist();
    return 0;
  }

  let added = 0;
  for (const entry of roster) {
    let alreadyExists = false;
    for (const [, agent] of store) {
      if (agent.rosterKey === entry.key) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) continue;

    const id = store.nextAgentId.current++;
    const agent: AgentState = {
      id,
      sessionId: `telegram-roster:${entry.key}`,
      terminalRef: undefined,
      isExternal: true,
      projectDir,
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      folderName: entry.telegramBot,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      hookDelivered: false,
      hooksOnly: true,
      providerId: 'telegram',
      inputTokens: 0,
      outputTokens: 0,
      teamName: 'Telegram',
      agentName: entry.label,
      rosterKey: entry.key,
      telegramBot: entry.telegramBot,
      sourceKind: 'telegram-roster',
    };
    store.set(id, agent);
    added++;
    changed = true;
  }

  if (changed) {
    store.persist();
  }
  return added;
}