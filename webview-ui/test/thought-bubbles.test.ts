import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getThoughtBubbleKind } from '../src/office/thoughtBubbles.ts';

test('permission bubble wins over all other activity', () => {
  assert.equal(
    getThoughtBubbleKind({
      bubbleType: 'permission',
      currentTool: 'Bash',
      isActive: true,
      telegramEventType: 'thinking',
    }),
    'permission',
  );
});

test('thinking bubble is shown for telegram thinking state', () => {
  assert.equal(
    getThoughtBubbleKind({
      bubbleType: null,
      currentTool: 'TelegramReply',
      isActive: true,
      telegramEventType: 'thinking',
    }),
    'thinking',
  );
});

test('tool bubble is shown for active non-telegram tool work', () => {
  assert.equal(
    getThoughtBubbleKind({
      bubbleType: null,
      currentTool: 'Bash',
      isActive: true,
      telegramEventType: null,
    }),
    'tool',
  );
});

test('incoming telegram message gets an incoming bubble before idle', () => {
  assert.equal(
    getThoughtBubbleKind({
      bubbleType: null,
      currentTool: 'TelegramRead',
      isActive: true,
      telegramEventType: 'message_received',
    }),
    'incoming',
  );
});

test('inactive idle agents show no thought bubble', () => {
  assert.equal(
    getThoughtBubbleKind({
      bubbleType: null,
      currentTool: null,
      isActive: false,
      telegramEventType: null,
    }),
    null,
  );
});
