import settings from "./settings.js";

export function getPlayerCell(x, y) {
  const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
  return {
    x: Math.ceil(x / cellSize),
    y: Math.ceil(y / cellSize),
  };
}

export function isPlayerVisibleTo(observer, target) {
  if (target?.id && observer?.id === target.id) return true;
  const observerCell = getPlayerCell(observer.x, observer.y);
  const targetCell = getPlayerCell(target.x, target.y);
  return Math.abs(targetCell.x - observerCell.x) <= settings.VISIBLE_CELLS_X &&
    Math.abs(targetCell.y - observerCell.y) <= settings.VISIBLE_CELLS_Y;
}

export function buildPlayerSpatialIndex(players) {
  const index = new Map();
  for (const player of players ?? []) {
    if (!player?.inGame || !player?.isAlive) continue;
    const cell = getPlayerCell(player.x, player.y);
    const key = `${cell.x}:${cell.y}`;
    let bucket = index.get(key);
    if (!bucket) index.set(key, bucket = []);
    bucket.push(player);
  }
  return index;
}

export function getNearbyPlayerCandidates(observer, spatialIndex) {
  const center = getPlayerCell(observer.x, observer.y);
  const candidates = [];
  for (let dx = -settings.VISIBLE_CELLS_X; dx <= settings.VISIBLE_CELLS_X; dx++) {
    for (let dy = -settings.VISIBLE_CELLS_Y; dy <= settings.VISIBLE_CELLS_Y; dy++) {
      const bucket = spatialIndex.get(`${center.x + dx}:${center.y + dy}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates;
}

export function getVisiblePlayers(observer, players) {
  return players.filter((player) => isPlayerVisibleTo(observer, player));
}