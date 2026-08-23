import settings from "./settings.js";

/**
 * Catalog of all nature / world objects that can occupy a map cell.
 *
 * To add a new object:
 * 1. Add an entry here (id key, spawnChancePercent, hp, hitbox, images).
 * 2. Put PNG files in client/public/.
 * 3. Restart the server — client loads image keys/files from this catalog via settings.
 *
 * spawnChancePercent — share of ALL map cells that should get this object
 *   (e.g. 15 → roughly 15% of cells are trees). Counts are rounded; empty cells
 *   fill the rest. Rare types are placed first so they are not crowded out.
 */

/** @typedef {{ key: string, file: string }} NatureImageVariant */

/**
 * @typedef {Object} NatureObjectDef
 * @property {string} id
 * @property {string} label
 * @property {"resource"|"plant"|"animal"|"ore"} category
 * @property {number} spawnChancePercent  percent of total map cells
 * @property {number} hp
 * @property {number} hitboxRadius
 * @property {boolean} blocksMovement
 * @property {boolean} destructible
 * @property {number} drawLayer  lower = behind (bushes < rocks < player < trees)
 * @property {NatureImageVariant[]} images  random pick on spawn (natureImage = key)
 */

/**
 * Draw layers (keep gaps for future types):
 *  10  blueberry / wildberry bushes
 *  20  stone / ore / gold
 *  30  players (client-side)
 *  40  trees
 */
export const DRAW_LAYER = {
  BUSH: 10,
  ROCK: 20,
  PLAYER: 30,
  TREE: 40,
};

/** @type {Record<string, NatureObjectDef>} */
export const NATURE_OBJECTS = {
  tree: {
    id: "tree",
    label: "Tree",
    category: "plant",
    spawnChancePercent: 10,
    hp: 150,
    hitboxRadius: 90,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.TREE,
    images: [
      { key: "tree0", file: "tree0.png" },
      { key: "tree1", file: "tree1.png" },
    ],
  },

  stone: {
    id: "stone",
    label: "Stone",
    category: "resource",
    spawnChancePercent: 5,
    hp: 1000,
    hitboxRadius: 100,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.ROCK,
    images: [
      { key: "stone0", file: "day-stone0.png" },
      { key: "stone1", file: "day-stone1.png" },
      { key: "stone2", file: "day-stone2.png" },
    ],
  },

  ironOre: {
    id: "ironOre",
    label: "Iron ore",
    category: "ore",
    spawnChancePercent: 1,
    hp: 1000,
    hitboxRadius: 90,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.ROCK,
    images: [{ key: "ironOre0", file: "Iron-Ore0.png" }],
  },

  blueberry: {
    id: "blueberry",
    label: "Blueberry bush",
    category: "plant",
    spawnChancePercent: 0.5,
    hp: 200,
    hitboxRadius: 66,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.BUSH,
    images: [{ key: "blueberryTree", file: "blueberry-tree.png" }],
  },

  sulfur: {
    id: "sulfur",
    label: "Sulfur",
    category: "ore",
    spawnChancePercent: 0.2,
    hp: 200,
    hitboxRadius: 63,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.ROCK,
    images: [{ key: "sulfur0", file: "day-sulfur0.png" }],
  },

  wildberry: {
    id: "wildberry",
    label: "Wildberry bush",
    category: "plant",
    spawnChancePercent: 0.5,
    hp: 100,
    hitboxRadius: 50,
    blocksMovement: true,
    destructible: true,
    drawLayer: DRAW_LAYER.BUSH,
    images: [{ key: "wildberryTree", file: "wildberry-tree.png" }],
  },
};

export function getNatureDef(natureType) {
  if (!natureType || natureType === "empty") return null;
  return NATURE_OBJECTS[natureType] ?? null;
}

export function getAllNatureDefs() {
  return Object.values(NATURE_OBJECTS);
}

export function getNatureHitboxRadius(natureType) {
  const def = getNatureDef(natureType);
  if (!def) return settings.DEFAULT_OBJECT_RADIUS;
  return def.hitboxRadius ?? settings.DEFAULT_OBJECT_RADIUS;
}

export function getNatureHp(natureType) {
  const def = getNatureDef(natureType);
  return def?.hp ?? settings.NATURE_OBJECT_HP;
}

export function pickRandomImageKey(def) {
  if (!def?.images?.length) return undefined;
  const index = Math.floor(Math.random() * def.images.length);
  return def.images[index].key;
}

export function clearNatureFromCell(cell) {
  cell.natureType = "empty";
  cell.natureImage = undefined;
  cell.hitboxRadius = 0;
  cell.hp = 0;
  cell.maxHp = 0;
}

/**
 * Applies a catalog definition onto a cell (random image variant).
 * @param {object} cell
 * @param {string} natureType
 * @returns {boolean}
 */
export function applyNatureToCell(cell, natureType) {
  const def = getNatureDef(natureType);
  if (!def) {
    clearNatureFromCell(cell);
    return false;
  }

  cell.natureType = def.id;
  cell.natureImage = pickRandomImageKey(def);
  cell.hitboxRadius = def.blocksMovement ? def.hitboxRadius : 0;
  cell.hp = def.hp;
  cell.maxHp = def.hp;
  return true;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Place nature objects so each type occupies ~spawnChancePercent of all cells.
 * Exact counts = round(totalCells * percent / 100). Rare types placed first.
 * @param {object[]} cells
 * @returns {Record<string, number>} counts per type (including empty)
 */
export function spawnNatureOnCells(cells) {
  const total = cells.length;
  const counts = { empty: total };

  for (let i = 0; i < cells.length; i++) {
    clearNatureFromCell(cells[i]);
  }

  const defs = getAllNatureDefs()
    .filter((d) => d.spawnChancePercent > 0 && d.images?.length > 0)
    .slice()
    .sort((a, b) => a.spawnChancePercent - b.spawnChancePercent);

  /** @type {string[]} */
  const assignments = [];
  for (const def of defs) {
    const count = Math.round((total * def.spawnChancePercent) / 100);
    counts[def.id] = 0;
    for (let i = 0; i < count; i++) {
      assignments.push(def.id);
    }
  }

  if (assignments.length > total) {
    assignments.length = total;
  }

  shuffleInPlace(assignments);
  // Prefer empty cells without player-planted saplings.
  const cellOrder = shuffleInPlace(
    cells.filter((c) => !c.sapling).slice()
  );
  if (cellOrder.length < assignments.length) {
    assignments.length = cellOrder.length;
  }

  for (let i = 0; i < assignments.length; i++) {
    const typeId = assignments[i];
    applyNatureToCell(cellOrder[i], typeId);
    counts[typeId] = (counts[typeId] ?? 0) + 1;
    counts.empty -= 1;
  }

  return counts;
}

/**
 * Flat map of imageKey → filename for the client to load.
 * @returns {Record<string, string>}
 */
export function getNatureClientManifest() {
  /** @type {Record<string, string>} */
  const manifest = {};
  for (const def of getAllNatureDefs()) {
    for (const img of def.images) {
      manifest[img.key] = img.file;
    }
  }
  return manifest;
}

/**
 * Lightweight defs for the client (debug / future UI). No server-only fields needed yet.
 */
export function getNatureClientCatalog() {
  return getAllNatureDefs().map((def) => ({
    id: def.id,
    label: def.label,
    category: def.category,
    spawnChancePercent: def.spawnChancePercent,
    hp: def.hp,
    hitboxRadius: def.hitboxRadius,
    blocksMovement: def.blocksMovement,
    destructible: def.destructible,
    drawLayer: def.drawLayer ?? DRAW_LAYER.ROCK,
    images: def.images.map((img) => img.key),
  }));
}


