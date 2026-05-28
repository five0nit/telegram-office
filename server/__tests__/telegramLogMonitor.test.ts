import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  buildTelegramLogMonitorConfigs,
  parseTelegramGatewayLogLine,
  TelegramLogMonitor,
} from '../src/telegramLogMonitor.js';
import type { TelegramRosterEntry } from '../src/telegramRoster.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('telegramLogMonitor', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const filePath of cleanupPaths.splice(0)) {
      try {
        fs.rmSync(filePath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('parses inbound Telegram gateway lines', () => {
    const parsed = parseTelegramGatewayLogLine(
      "2026-05-28 15:00:42,455 INFO gateway.run: inbound message: platform=telegram user=Notblue.eth chat=1378707550 msg='hello office'",
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        eventType: 'message_received',
        chatLabel: 'Notblue.eth',
        preview: 'hello office',
      }),
    );
  });

  it('builds configs from explicit logPath and profile entries', () => {
    const roster: TelegramRosterEntry[] = [
      {
        key: 'pb1',
        label: 'Backup',
        telegramBot: '@Backupmik3bot',
        profile: 'default',
      },
      {
        key: 'pb2',
        label: 'Hermes2',
        telegramBot: '@Hermes2bitbot',
        logPath: '~/custom/gateway.log',
      },
      {
        key: 'remote',
        label: 'Remote',
        telegramBot: '@remote',
      },
    ];

    const configs = buildTelegramLogMonitorConfigs(roster);

    expect(configs).toEqual([
      {
        rosterKey: 'pb1',
        label: 'Backup',
        logPath: path.join(os.homedir(), '.hermes', 'logs', 'gateway.log'),
      },
      {
        rosterKey: 'pb2',
        label: 'Hermes2',
        logPath: path.join(os.homedir(), 'custom', 'gateway.log'),
      },
    ]);
  });

  it('tails a gateway log and emits office broadcasts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-log-monitor-'));
    cleanupPaths.push(tmpDir);
    const logPath = path.join(tmpDir, 'gateway.log');
    fs.writeFileSync(logPath, '');

    const store = new AgentStateStore();
    store.set(1, {
      id: 1,
      sessionId: 'telegram-roster:pb1',
      isExternal: true,
      projectDir: tmpDir,
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
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      hookDelivered: false,
      inputTokens: 0,
      outputTokens: 0,
      rosterKey: 'pb1',
      telegramBot: '@Backupmik3bot',
      sourceKind: 'telegram-roster',
    });

    const broadcasts: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => broadcasts.push(message));

    const monitor = new TelegramLogMonitor(
      store,
      [{ rosterKey: 'pb1', label: 'Backup', logPath }],
      { pollIntervalMs: 20, thinkingDelayMs: 10, idleDelayMs: 20 },
    );
    monitor.start();

    fs.appendFileSync(
      logPath,
      "2026-05-28 15:00:42,455 INFO gateway.run: inbound message: platform=telegram user=Notblue.eth chat=1378707550 msg='hello office'\n",
    );
    await wait(80);
    fs.appendFileSync(
      logPath,
      '2026-05-28 15:01:32,548 INFO gateway.run: response ready: platform=telegram chat=1378707550 time=50.1s api_calls=2 response=3246 chars\n',
    );
    await wait(120);
    monitor.dispose();

    expect(broadcasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'telegramOfficeEvent', id: 1, eventType: 'message_received' }),
        expect.objectContaining({ type: 'telegramOfficeEvent', id: 1, eventType: 'thinking' }),
        expect.objectContaining({ type: 'telegramOfficeEvent', id: 1, eventType: 'message_sent' }),
        expect.objectContaining({ type: 'telegramOfficeEvent', id: 1, eventType: 'idle' }),
      ]),
    );
  });
});
