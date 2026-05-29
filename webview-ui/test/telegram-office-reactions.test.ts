import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getTelegramOfficeZoneForEvent,
  selectTelegramReactionDestination,
} from '../src/office/engine/telegramOfficeReactions.ts';

const walkableTiles = Array.from({ length: 10 }, (_, row) =>
  Array.from({ length: 10 }, (_, col) => ({ col, row })),
).flat();

test('message_received prefers the upper-left inbox zone', () => {
  const destination = selectTelegramReactionDestination({
    agentId: 1,
    eventType: 'message_received',
    layoutCols: 10,
    layoutRows: 10,
    walkableTiles,
    currentTile: { col: 5, row: 5 },
    preferredSeatTile: { col: 5, row: 5 },
  });

  assert.ok(destination);
  assert.ok(destination.col <= 3, `expected inbox-zone col <= 3, got ${destination.col}`);
  assert.ok(destination.row <= 4, `expected inbox-zone row <= 4, got ${destination.row}`);
});

test('message_sent prefers the upper-right dispatch zone', () => {
  const destination = selectTelegramReactionDestination({
    agentId: 2,
    eventType: 'message_sent',
    layoutCols: 10,
    layoutRows: 10,
    walkableTiles,
    currentTile: { col: 5, row: 5 },
    preferredSeatTile: { col: 5, row: 5 },
  });

  assert.ok(destination);
  assert.ok(destination.col >= 6, `expected dispatch-zone col >= 6, got ${destination.col}`);
  assert.ok(destination.row <= 4, `expected dispatch-zone row <= 4, got ${destination.row}`);
});

test('waiting prefers the lower-left approval zone', () => {
  const destination = selectTelegramReactionDestination({
    agentId: 3,
    eventType: 'waiting',
    layoutCols: 10,
    layoutRows: 10,
    walkableTiles,
    currentTile: { col: 5, row: 5 },
    preferredSeatTile: { col: 5, row: 5 },
  });

  assert.ok(destination);
  assert.ok(destination.col <= 4, `expected approval-zone col <= 4, got ${destination.col}`);
  assert.ok(destination.row >= 6, `expected approval-zone row >= 6, got ${destination.row}`);
});

test('thinking prefers the central huddle zone', () => {
  const destination = selectTelegramReactionDestination({
    agentId: 0,
    eventType: 'thinking',
    layoutCols: 10,
    layoutRows: 10,
    walkableTiles,
    currentTile: { col: 2, row: 8 },
    preferredSeatTile: { col: 7, row: 8 },
  });

  assert.ok(destination);
  assert.ok(
    destination.col >= 4 && destination.col <= 5,
    `expected huddle-zone center col, got ${destination.col}`,
  );
  assert.ok(
    destination.row >= 3 && destination.row <= 5,
    `expected huddle-zone row 3-5, got ${destination.row}`,
  );
});

test('occupied tiles are avoided when selecting a reaction destination', () => {
  const occupiedTiles = new Set(['1,2', '2,2', '1,3', '2,3']);
  const destination = selectTelegramReactionDestination({
    agentId: 0,
    eventType: 'message_received',
    layoutCols: 10,
    layoutRows: 10,
    walkableTiles,
    occupiedTiles,
    currentTile: { col: 5, row: 5 },
    preferredSeatTile: { col: 5, row: 5 },
  });

  assert.ok(destination);
  assert.ok(!occupiedTiles.has(`${destination.col},${destination.row}`));
});

test('idle falls back to the preferred seat tile', () => {
  const preferredSeatTile = { col: 7, row: 8 };

  assert.deepEqual(
    selectTelegramReactionDestination({
      agentId: 0,
      eventType: 'idle',
      layoutCols: 10,
      layoutRows: 10,
      walkableTiles,
      preferredSeatTile,
    }),
    preferredSeatTile,
  );
});

test('event-zone metadata exposes readable themed areas', () => {
  assert.equal(getTelegramOfficeZoneForEvent('message_received', 21, 22).shortLabel, 'INBOX');
  assert.equal(getTelegramOfficeZoneForEvent('message_sent', 21, 22).shortLabel, 'SEND');
  assert.equal(getTelegramOfficeZoneForEvent('thinking', 21, 22).shortLabel, 'HUDDLE');
  assert.equal(getTelegramOfficeZoneForEvent('waiting', 21, 22).shortLabel, 'QUEUE');
});
