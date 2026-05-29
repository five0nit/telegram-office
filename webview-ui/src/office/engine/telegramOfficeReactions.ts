import {
  TELEGRAM_ZONE_DISPATCH_ACCENT,
  TELEGRAM_ZONE_DISPATCH_FILL,
  TELEGRAM_ZONE_HUDDLE_ACCENT,
  TELEGRAM_ZONE_HUDDLE_FILL,
  TELEGRAM_ZONE_INBOX_ACCENT,
  TELEGRAM_ZONE_INBOX_FILL,
  TELEGRAM_ZONE_QUEUE_ACCENT,
  TELEGRAM_ZONE_QUEUE_FILL,
} from '../../constants.js';

export type TelegramOfficeReactionEventType =
  | 'message_received'
  | 'message_sent'
  | 'thinking'
  | 'waiting'
  | 'idle';

export type TelegramOfficeZoneId = 'inbox' | 'dispatch' | 'huddle' | 'queue';

export interface TileCoord {
  col: number;
  row: number;
}

export interface TelegramOfficeZoneSpec {
  id: TelegramOfficeZoneId;
  label: string;
  shortLabel: string;
  anchor: TileCoord;
  bounds: {
    colMin: number;
    colMax: number;
    rowMin: number;
    rowMax: number;
  };
  accent: string;
  fill: string;
}

interface ReactionZone extends TelegramOfficeZoneSpec {
  match: (tile: TileCoord) => boolean;
}

export interface SelectTelegramReactionDestinationOptions {
  agentId: number;
  eventType: TelegramOfficeReactionEventType;
  layoutCols: number;
  layoutRows: number;
  walkableTiles: TileCoord[];
  occupiedTiles?: Set<string>;
  currentTile?: TileCoord;
  preferredSeatTile?: TileCoord | null;
}

function clampCoord(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function clampBounds(
  colMin: number,
  colMax: number,
  rowMin: number,
  rowMax: number,
  cols: number,
  rows: number,
): TelegramOfficeZoneSpec['bounds'] {
  return {
    colMin: clampCoord(Math.min(colMin, colMax), cols),
    colMax: clampCoord(Math.max(colMin, colMax), cols),
    rowMin: clampCoord(Math.min(rowMin, rowMax), rows),
    rowMax: clampCoord(Math.max(rowMin, rowMax), rows),
  };
}

function clampAnchor(col: number, row: number, cols: number, rows: number): TileCoord {
  return {
    col: clampCoord(col, cols),
    row: clampCoord(row, rows),
  };
}

function buildZone(
  id: TelegramOfficeZoneId,
  label: string,
  shortLabel: string,
  anchor: TileCoord,
  bounds: TelegramOfficeZoneSpec['bounds'],
  accent: string,
  fill: string,
): ReactionZone {
  return {
    id,
    label,
    shortLabel,
    anchor,
    bounds,
    accent,
    fill,
    match: (tile) =>
      tile.col >= bounds.colMin &&
      tile.col <= bounds.colMax &&
      tile.row >= bounds.rowMin &&
      tile.row <= bounds.rowMax,
  };
}

export function getTelegramOfficeZoneSpecs(
  cols: number,
  rows: number,
): Record<TelegramOfficeZoneId, TelegramOfficeZoneSpec> {
  const leftEdge = Math.max(1, Math.floor(cols * 0.3));
  const rightEdge = Math.max(leftEdge + 2, Math.floor(cols * 0.68));
  const upperBand = Math.max(2, Math.floor(rows * 0.34));
  const middleBand = Math.max(upperBand + 2, Math.floor(rows * 0.52));
  const lowerBand = Math.max(middleBand + 2, Math.floor(rows * 0.68));

  const inboxBounds = clampBounds(1, leftEdge, 1, upperBand, cols, rows);
  const dispatchBounds = clampBounds(rightEdge, cols - 2, 1, upperBand, cols, rows);
  const huddleBounds = clampBounds(leftEdge + 1, rightEdge - 1, upperBand, middleBand, cols, rows);
  const queueBounds = clampBounds(1, leftEdge + 1, lowerBand, rows - 2, cols, rows);

  return {
    inbox: buildZone(
      'inbox',
      'Inbox',
      'INBOX',
      clampAnchor(Math.floor(cols * 0.18), Math.floor(rows * 0.2), cols, rows),
      inboxBounds,
      TELEGRAM_ZONE_INBOX_ACCENT,
      TELEGRAM_ZONE_INBOX_FILL,
    ),
    dispatch: buildZone(
      'dispatch',
      'Dispatch',
      'SEND',
      clampAnchor(Math.floor(cols * 0.82), Math.floor(rows * 0.2), cols, rows),
      dispatchBounds,
      TELEGRAM_ZONE_DISPATCH_ACCENT,
      TELEGRAM_ZONE_DISPATCH_FILL,
    ),
    huddle: buildZone(
      'huddle',
      'War Room',
      'HUDDLE',
      clampAnchor(Math.floor(cols * 0.5), Math.floor(rows * 0.38), cols, rows),
      huddleBounds,
      TELEGRAM_ZONE_HUDDLE_ACCENT,
      TELEGRAM_ZONE_HUDDLE_FILL,
    ),
    queue: buildZone(
      'queue',
      'Waiting Bay',
      'QUEUE',
      clampAnchor(Math.floor(cols * 0.2), Math.floor(rows * 0.82), cols, rows),
      queueBounds,
      TELEGRAM_ZONE_QUEUE_ACCENT,
      TELEGRAM_ZONE_QUEUE_FILL,
    ),
  };
}

export function getTelegramOfficeZoneForEvent(
  eventType: Exclude<TelegramOfficeReactionEventType, 'idle'>,
  cols: number,
  rows: number,
): TelegramOfficeZoneSpec {
  const zones = getTelegramOfficeZoneSpecs(cols, rows);
  switch (eventType) {
    case 'message_received':
      return zones.inbox;
    case 'message_sent':
      return zones.dispatch;
    case 'thinking':
      return zones.huddle;
    case 'waiting':
      return zones.queue;
  }
}

function getReactionZone(
  eventType: Exclude<TelegramOfficeReactionEventType, 'idle'>,
  cols: number,
  rows: number,
): ReactionZone {
  return getTelegramOfficeZoneForEvent(eventType, cols, rows) as ReactionZone;
}

function distance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

export function selectTelegramReactionDestination(
  options: SelectTelegramReactionDestinationOptions,
): TileCoord | null {
  const {
    eventType,
    layoutCols,
    layoutRows,
    walkableTiles,
    occupiedTiles,
    currentTile,
    preferredSeatTile,
    agentId,
  } = options;

  if (walkableTiles.length === 0) return null;
  if (eventType === 'idle') return preferredSeatTile ?? null;

  const zone = getReactionZone(eventType, layoutCols, layoutRows);
  const seatKey = preferredSeatTile ? `${preferredSeatTile.col},${preferredSeatTile.row}` : null;

  const usableTiles = walkableTiles.filter((tile) => {
    const key = `${tile.col},${tile.row}`;
    if (!occupiedTiles?.has(key)) return true;
    return seatKey !== null && key === seatKey;
  });
  const candidates = usableTiles.filter(zone.match);
  const pool = candidates.length > 0 ? candidates : usableTiles;
  if (pool.length === 0) return preferredSeatTile ?? null;

  const anchor = zone.anchor;
  const current = currentTile ?? preferredSeatTile ?? anchor;

  const ranked = [...pool].sort((a, b) => {
    const seatPenaltyA = seatKey !== null && `${a.col},${a.row}` === seatKey ? 6 : 0;
    const seatPenaltyB = seatKey !== null && `${b.col},${b.row}` === seatKey ? 6 : 0;
    const scoreA = distance(a, anchor) * 3 + distance(a, current) + seatPenaltyA;
    const scoreB = distance(b, anchor) * 3 + distance(b, current) + seatPenaltyB;
    if (scoreA !== scoreB) return scoreA - scoreB;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const shortlistSize = Math.min(4, ranked.length);
  return ranked[agentId % shortlistSize] ?? ranked[0] ?? preferredSeatTile ?? null;
}
