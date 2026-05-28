import type { AgentStateStore } from './agentStateStore.js';

export const TELEGRAM_EVENT_TYPES = [
  'message_received',
  'message_sent',
  'thinking',
  'waiting',
  'idle',
] as const;

export type TelegramOfficeEventType = (typeof TELEGRAM_EVENT_TYPES)[number];

export interface TelegramOfficeEvent {
  rosterKey: string;
  eventType: TelegramOfficeEventType;
  chatLabel?: string;
  preview?: string;
  at: number;
}

export function normalizeTelegramOfficeEvent(
  payload: Record<string, unknown>,
): TelegramOfficeEvent | null {
  const rosterKey = typeof payload.rosterKey === 'string' ? payload.rosterKey.trim() : '';
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';
  if (!rosterKey || !isTelegramEventType(eventType)) {
    return null;
  }

  return {
    rosterKey,
    eventType,
    chatLabel:
      typeof payload.chatLabel === 'string' && payload.chatLabel.trim()
        ? payload.chatLabel.trim()
        : undefined,
    preview:
      typeof payload.preview === 'string' && payload.preview.trim()
        ? payload.preview.trim().slice(0, 140)
        : undefined,
    at: typeof payload.at === 'number' && Number.isFinite(payload.at) ? payload.at : Date.now(),
  };
}

export function applyTelegramOfficeEvent(
  store: AgentStateStore,
  event: TelegramOfficeEvent,
): { ok: true; agentId: number } | { ok: false; reason: string } {
  for (const [id, agent] of store) {
    if (agent.rosterKey !== event.rosterKey) continue;

    agent.lastDataAt = event.at;
    const status =
      event.eventType === 'waiting' ? 'waiting' : event.eventType === 'idle' ? 'idle' : 'active';

    store.broadcast({
      type: 'agentStatus',
      id,
      status,
    });
    store.broadcast({
      type: 'telegramOfficeEvent',
      id,
      rosterKey: event.rosterKey,
      eventType: event.eventType,
      chatLabel: event.chatLabel,
      preview: event.preview,
      at: event.at,
    });

    return { ok: true, agentId: id };
  }

  return { ok: false, reason: `No roster-backed agent found for key '${event.rosterKey}'` };
}

function isTelegramEventType(value: string): value is TelegramOfficeEventType {
  return (TELEGRAM_EVENT_TYPES as readonly string[]).includes(value);
}
