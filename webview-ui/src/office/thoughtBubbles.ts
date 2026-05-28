import type { Character } from './types.js';

export type ThoughtBubbleKind =
  | 'permission'
  | 'waiting'
  | 'thinking'
  | 'tool'
  | 'incoming'
  | 'sent';

export function getThoughtBubbleKind(
  ch: Pick<Character, 'bubbleType' | 'currentTool' | 'isActive' | 'telegramEventType'>,
): ThoughtBubbleKind | null {
  if (ch.bubbleType === 'permission') return 'permission';
  if (ch.bubbleType === 'waiting' || ch.telegramEventType === 'waiting') return 'waiting';
  if (ch.telegramEventType === 'thinking') return 'thinking';
  if (ch.telegramEventType === 'message_received') return 'incoming';
  if (ch.telegramEventType === 'message_sent') return 'sent';
  if (ch.isActive && ch.currentTool) return 'tool';
  return null;
}
