import settings from "./settings.js";

/** Drawn first (behind bushes / rocks / players / trees). */
export const SAPLING_DRAW_LAYER = 5;

export const SAPLING_KINDS = {
  blueberry: {
    kind: "blueberry",
    seedItemId: "blueberrySeed",
    berryItemId: "blueberry",
    images: ["blueberryPlant0", "blueberryPlant1", "blueberryPlant2"],
    imageFiles: [
      "blueberry-plant0.png",
      "blueberry-plant1.png",
      "blueberry-plant2.png",
    ],
  },
  wildberry: {
    kind: "wildberry",
    seedItemId: "wildberrySeed",
    berryItemId: "wildberry",
    images: ["wildberryPlant0", "wildberryPlant1", "wildberryPlant2"],
    imageFiles: [
      "wildberry-plant0.png",
      "wildberry-plant1.png",
      "wildberry-plant2.png",
    ],
  },
};

export function getSaplingKindFromSeed(itemId) {
  for (const def of Object.values(SAPLING_KINDS)) {
    if (def.seedItemId === itemId) return def.kind;
  }
  return null;
}

export function getSaplingDef(kind) {
  return SAPLING_KINDS[kind] ?? null;
}

export function getSaplingClientManifest() {
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const def of Object.values(SAPLING_KINDS)) {
    for (let i = 0; i < def.images.length; i++) {
      manifest[def.images[i]] = def.imageFiles[i];
    }
  }
  return manifest;
}

function saplingHp() {
  return settings.SAPLING_HP ?? 200;
}

function stageMs() {
  return settings.SAPLING_STAGE_MS ?? 120_000;
}

function lifetimeMs() {
  return settings.SAPLING_LIFETIME_MS ?? 600_000;
}

function hitboxRadius() {
  return settings.SAPLING_HITBOX_RADIUS ?? 48;
}

export function hasSapling(cell) {
  return !!(cell?.sapling?.kind && cell.sapling.hp > 0);
}

export function clearSapling(cell) {
  if (!cell) return;
  cell.sapling = null;
}

export function canPlantOnCell(cell) {
  if (!cell) return false;
  if (hasSapling(cell)) return false;
  if (cell.natureType && cell.natureType !== "empty" && cell.hp > 0) {
    return false;
  }
  return true;
}

/**
 * @returns {object|null} sapling state
 */
export function plantSapling(cell, kind, now = performance.now(), ownerId = null, rotation = 0) {
  const def = getSaplingDef(kind);
  if (!def || !canPlantOnCell(cell)) return null;

  cell.sapling = {
    kind,
    stage: 0,
    hp: saplingHp(),
    maxHp: saplingHp(),
    plantedAt: now,
    stageAt: now,
    hitboxRadius: hitboxRadius(),
    // Attack hitbox is kept above; movement collision is intentionally disabled.
    movementHitboxRadius: 0,
    ownerId: ownerId ?? null,
    rotation: ((Number(rotation) || 0) % 4 + 4) % 4,
  };
  return cell.sapling;
}

export function getSaplingImageKey(sapling) {
  const def = getSaplingDef(sapling?.kind);
  if (!def) return null;
  const stage = Math.max(0, Math.min(2, sapling.stage | 0));
  return def.images[stage];
}

export function serializeSapling(cell) {
  const s = cell?.sapling;
  if (!s?.kind || s.hp <= 0) return null;
  return {
    kind: s.kind,
    stage: s.stage,
    hp: s.hp,
    maxHp: s.maxHp,
    hitboxRadius: s.hitboxRadius,
    natureImage: getSaplingImageKey(s),
    plantedAtAgeMs: Math.max(0, Math.floor(performance.now() - s.plantedAt)),
    ownerId: s.ownerId ?? null,
    rotation: s.rotation ?? 0,
  };
}

/**
 * Advance growth / expire. Returns list of { cell, event }.
 * event: "stage" | "expired"
 */
export function processSaplings(cells, now = performance.now()) {
  const changed = [];
  const life = lifetimeMs();
  const stageDur = stageMs();

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const s = cell.sapling;
    if (!s?.kind || s.hp <= 0) continue;

    if (now - s.plantedAt >= life) {
      clearSapling(cell);
      changed.push({ cell, event: "expired", kind: s.kind });
      continue;
    }

    if (s.stage < 2 && now - s.stageAt >= stageDur) {
      s.stage += 1;
      s.stageAt = now;
      changed.push({ cell, event: "stage", kind: s.kind, stage: s.stage });
    }
  }

  return changed;
}

export function isSaplingFullyGrown(sapling) {
  return !!sapling && sapling.stage >= 2 && sapling.hp > 0;
}

/**
 * Damage immature sapling. Returns { destroyed, knockDx, knockDy, kind }.
 */
export function damageSapling(cell, attackerX, attackerY, damage) {
  const s = cell?.sapling;
  if (!s || s.hp <= 0) return null;

  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const dx = cx - attackerX;
  const dy = cy - attackerY;
  const dist = Math.hypot(dx, dy) || 1;
  const knockDx = (dx / dist) * (settings.NATURE_HIT_KNOCKBACK ?? 15);
  const knockDy = (dy / dist) * (settings.NATURE_HIT_KNOCKBACK ?? 15);

  s.hp = Math.max(0, s.hp - damage);
  const destroyed = s.hp <= 0;
  const kind = s.kind;
  if (destroyed) clearSapling(cell);

  return { destroyed, knockDx, knockDy, kind };
}

/** Reset growth cycle after harvest; keeps plantedAt (lifetime). */
export function resetSaplingGrowth(cell, now = performance.now()) {
  const s = cell?.sapling;
  if (!s) return false;
  s.stage = 0;
  s.stageAt = now;
  s.hp = saplingHp();
  s.maxHp = saplingHp();
  return true;
}

/** 8 neighbors of player cell (not including self). */
export function getPlantNeighborCells(cellsList, playerXCell, playerYCell) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const ix = playerXCell + dx;
      const iy = playerYCell + dy;
      const cell = cellsList.grid?.[ix]?.[iy];
      if (cell) out.push(cell);
    }
  }
  return out;
}

export function isCellAdjacentToPlayer(cell, playerXCell, playerYCell) {
  if (!cell) return false;
  const dx = Math.abs(cell.indexX - playerXCell);
  const dy = Math.abs(cell.indexY - playerYCell);
  return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
}