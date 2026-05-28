export type TelegramOfficeReactionEventType =
  | 'message_received'
  | 'message_sent'
  | 'thinking'
  | 'waiting'
  | 'idle';

export interface TileCoord {
  col: number;
  row: number;
}

interface ReactionZone {
  anchor: TileCoord;
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

function clampAnchor(col: number, row: number, cols: number, rows: number): TileCoord {
  return {
    col: Math.max(0, Math.min(cols - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

function getReactionZone(
  eventType: Exclude<TelegramOfficeReactionEventType, 'thinking' | 'idle'>,
  cols: number,
  rows: number,
): ReactionZone {
  const leftCutoff = Math.max(1, Math.floor(cols * 0.36));
  const rightCutoff = Math.max(leftCutoff + 1, Math.floor(cols * 0.62));
  const topCutoff = Math.max(1, Math.floor(rows * 0.44));
  const bottomCutoff = Math.max(topCutoff + 1, Math.floor(rows * 0.6));

  switch (eventType) {
    case 'message_received':
      return {
        anchor: clampAnchor(Math.floor(cols * 0.18), Math.floor(rows * 0.24), cols, rows),
        match: (tile) => tile.col <= leftCutoff && tile.row <= topCutoff,
      };
    case 'message_sent':
      return {
        anchor: clampAnchor(Math.floor(cols * 0.82), Math.floor(rows * 0.24), cols, rows),
        match: (tile) => tile.col >= rightCutoff && tile.row <= topCutoff,
      };
    case 'waiting':
      return {
        anchor: clampAnchor(Math.floor(cols * 0.2), Math.floor(rows * 0.8), cols, rows),
        match: (tile) => tile.col <= leftCutoff && tile.row >= bottomCutoff,
      };
  }
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
  if (eventType === 'thinking' || eventType === 'idle') return preferredSeatTile ?? null;

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
