import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectTelegramReactionDestination } from '../src/office/engine/telegramOfficeReactions.ts';

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
  assert.ok(destination.col <= 3, `expected approval-zone col <= 3, got ${destination.col}`);
  assert.ok(destination.row >= 6, `expected approval-zone row >= 6, got ${destination.row}`);
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

test('thinking and idle fall back to the preferred seat tile', () => {
  const preferredSeatTile = { col: 7, row: 8 };

  assert.deepEqual(
    selectTelegramReactionDestination({
      agentId: 0,
      eventType: 'thinking',
      layoutCols: 10,
      layoutRows: 10,
      walkableTiles,
      preferredSeatTile,
    }),
    preferredSeatTile,
  );

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
