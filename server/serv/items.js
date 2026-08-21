import settings from "./settings.js";

export const ITEMS = {
  wood: {
    id: "wood",
    label: "Wood",
    stackMax: 512,
    inventoryImage: "tree.png",
    groundImage: "tree-ground.png",
    groundSpawnPercent: 0.5,
    harvestFromNature: "tree",
  },
  stone: {
    id: "stone",
    label: "Stone",
    stackMax: 512,
    inventoryImage: "stone.png",
    groundImage: "stone-ground.png",
    groundSpawnPercent: 0.5,
    harvestFromNature: "stone",
  },
  blueberry: {
    id: "blueberry",
    label: "Blueberry",
    stackMax: 64,
    inventoryImage: "blueberry0.png",
    groundImage: "blueberry-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: "blueberry",
    harvestAmount: 1,
    edible: true,
    satietyRestore: 20,
    seedItemId: "blueberrySeed",
    seedDropChance: 0.1,
  },
  wildberry: {
    id: "wildberry",
    label: "Wildberry",
    stackMax: 64,
    inventoryImage: "wildberry0.png",
    groundImage: "wildberry-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: "wildberry",
    harvestAmount: 1,
    edible: true,
    satietyRestore: 20,
    seedItemId: "wildberrySeed",
    seedDropChance: 0.1,
  },
  blueberrySeed: {
    id: "blueberrySeed",
    label: "Blueberry seed",
    stackMax: 64,
    inventoryImage: "blueberry-seed.png",
    groundImage: "blueberry-seed.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    harvestAmount: 1,
    canHold: false,
    canBuild: true,
  },
  wildberrySeed: {
    id: "wildberrySeed",
    label: "Wildberry seed",
    stackMax: 64,
    inventoryImage: "wildberry-seed.png",
    groundImage: "wildberry-seed.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    harvestAmount: 1,
    canHold: false,
    canBuild: true,
  },
  
  spear: {
    id: "spear",
    label: "Wood Spear",
    stackMax: 1, // Нестакающийся элемент
    inventoryImage: "wood-spear.png",
    groundImage: "wood-spear-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
  },

  campfire: {
    id: "campfire",
    label: "Campfire",
    stackMax: 16,
    inventoryImage: "campfire-normal.png",
    groundImage: "campfire-normal-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canBuild: true,
    canHold: false,
  },
  campfire_max: {
    id: "campfire_max",
    label: "Improved Campfire",
    stackMax: 16,
    inventoryImage: "campfire-max.png",
    groundImage: "campfire-max-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canBuild: true,
    canHold: false,
  },
  workbench: {
    id: "workbench",
    label: "Workbench",
    stackMax: 16,
    inventoryImage: "workbench.png",
    groundImage: "workbench-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canBuild: true,
    canHold: false,
  },
  wood_wall: { id:"wood_wall", label:"Wood Wall", stackMax:512, inventoryImage:"wood-wall.png", groundImage:"wood-wall-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  wood_door: { id:"wood_door", label:"Wood Door", stackMax:512, inventoryImage:"wood-door.png", groundImage:"wood-door-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  stone_wall: { id:"stone_wall", label:"Stone Wall", stackMax:512, inventoryImage:"stone-wall.png", groundImage:"stone-wall-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  stone_door: { id:"stone_door", label:"Stone Door", stackMax:512, inventoryImage:"stone-door.png", groundImage:"stone-door-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  metal_wall: { id:"metal_wall", label:"Metal Wall", stackMax:512, inventoryImage:"metal-wall.png", groundImage:"metal-wall-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  metal_door: { id:"metal_door", label:"Metal Door", stackMax:512, inventoryImage:"metal-door.png", groundImage:"metal-door-ground.png", groundSpawnPercent:0, canBuild:true, canHold:true },
  hatchet: {
    id: "hatchet",
    label: "Stone Hatchet",
    stackMax: 1,
    inventoryImage: "hatchet.png",
    groundImage: "hatchet-ground.png",
    handImage: "hatchet-hand.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canHold: true,
    toolType: "hatchet",
    tool: { damage: 10, energy: 7, durationMs: 400, equipMs: 500, zoneDistance: 110, zoneRadius: 60, harvest: { tree: { min: 3, max: 4 }, stone: { min: 1, max: 2 } } },
  },
  hammer: {
    id: "hammer",
    label: "Hammer",
    stackMax: 1,
    inventoryImage: "hammer.png",
    groundImage: "hammer-ground.png",
    handImage: "hammer-hand.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canHold: true,
    toolType: "hammer",
    tool: { damage: 150, energy: 5, durationMs: 1000, equipMs: 1500, zoneDistance: settings.PICKAXE_STONE_ATTACK_ZONE_DISTANCE, zoneRadius: settings.PICKAXE_STONE_ATTACK_ZONE_RADIUS },
  },
  pickaxe_stone: {
    id: "pickaxe_stone",
    label: "Stone Pickaxe",
    stackMax: 1,
    inventoryImage: "pickaxe-stone.png",
    groundImage: "pickaxe-stone-ground.png",
    handImage: "pickaxe-stone-hand.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
    canHold: true,
    toolType: "pickaxe_stone",
    tool: { damage: 25, energy: 15, durationMs: 700, equipMs: 1000, zoneDistance: 130, zoneRadius: 65, harvest: { stone: { min: 3, max: 4 }, ironOre: { itemId: "ironOre", min: 1, max: 1, chance: 0.2, fallback: { itemId: "stone", min: 3, max: 4 } } } },
  },
  ironOre: {
    id: "ironOre",
    label: "Iron Ore",
    stackMax: 512,
    inventoryImage: "Iron-Ore0.png",
    groundImage: "Iron-Ore-ground",
    groundSpawnPercent: 0,
    harvestFromNature: null,
  },
  metal: {
    id: "metal",
    label: "Metal",
    stackMax: 512,
    inventoryImage: "metal.png",
    groundImage: "metal-ground.png",
    groundSpawnPercent: 0,
    harvestFromNature: null,
  },
};

export function getItemDef(itemId) {
  return ITEMS[itemId] ?? null;
}

function getToolSettings(toolType) {
  if (toolType === "hatchet") {
    return {
      damage: settings.HATCHET_ATTACK_DAMAGE,
      energy: settings.HATCHET_ATTACK_ENERGY,
      durationMs: settings.HATCHET_ATTACK_DURATION_MS,
      equipMs: settings.HATCHET_EQUIP_MS,
      zoneDistance: settings.HATCHET_ATTACK_ZONE_DISTANCE,
      zoneRadius: settings.HATCHET_ATTACK_ZONE_RADIUS,
    };
  }
  if (toolType === "hammer") {
    return {
      damage: settings.HAMMER_ATTACK_DAMAGE,
      energy: settings.HAMMER_ATTACK_ENERGY,
      durationMs: settings.HAMMER_ATTACK_DURATION_MS,
      equipMs: settings.HAMMER_EQUIP_MS,
      zoneDistance: settings.HAMMER_ATTACK_ZONE_DISTANCE,
      zoneRadius: settings.HAMMER_ATTACK_ZONE_RADIUS,
    };
  }
  if (toolType === "pickaxe_stone") {
    return {
      damage: settings.PICKAXE_STONE_ATTACK_DAMAGE,
      energy: settings.PICKAXE_STONE_ATTACK_ENERGY,
      durationMs: settings.PICKAXE_STONE_ATTACK_DURATION_MS,
      equipMs: settings.PICKAXE_STONE_EQUIP_MS,
      zoneDistance: settings.PICKAXE_STONE_ATTACK_ZONE_DISTANCE,
      zoneRadius: settings.PICKAXE_STONE_ATTACK_ZONE_RADIUS,
    };
  }
  return null;
}

export function getToolProfile(toolType) {
  if (!toolType) {
    return {
      damage: settings.HAND_ATTACK_DAMAGE ?? settings.ATTACK_DAMAGE,
      energy: settings.HAND_ATTACK_ENERGY ?? 3,
      durationMs: settings.ATTACK_DURATION_MS,
      zoneDistance: settings.ATTACK_ZONE_DISTANCE,
      zoneRadius: settings.ATTACK_ZONE_RADIUS,
      harvest: {},
    };
  }
  const item = Object.values(ITEMS).find((entry) => entry.toolType === toolType);
  if (!item?.tool) return null;
  return { ...item.tool, ...(getToolSettings(toolType) ?? {}), harvest: { ...(item.tool.harvest ?? {}) } };
}

export function getToolClientCatalog() {
  const catalog = {};
  for (const item of Object.values(ITEMS)) {
    if (!item.toolType || !item.tool) continue;
    const profile = getToolProfile(item.toolType);
    catalog[item.toolType] = { ...profile, harvest: { ...(profile.harvest ?? {}) } };
  }
  return catalog;
}

export function getAllItems() {
  return Object.values(ITEMS);
}

export function getItemClientManifest() {
  const manifest = {
    invEmpty: "inv-empty.png",
    lootHint: "loot.png",
  };
  for (const item of getAllItems()) {
    manifest[`${item.id}Inv`] = item.inventoryImage;
    manifest[`${item.id}Ground`] = item.groundImage;
  }
  // Building installation/damage sprites are separate from inventory/ground sprites.
  for (const id of ["wood_wall","wood_door","stone_wall","stone_door","metal_wall","metal_door"]) {
    const base = id.replace("_","-");
    manifest[`${id}Build`] = `${base}.png`;
    manifest[`${id}Broke1`] = `${base}-broke1.png`;
    manifest[`${id}Broke2`] = `${base}-broke2.png`;
  }
  return manifest;
}

export function createEmptyInventory() {
  return Array.from({ length: settings.INVENTORY_SLOTS }, () => null);
}

export function sanitizeInventory(inventory) {
  return (inventory ?? createEmptyInventory()).map((slot) =>
    slot ? { itemId: slot.itemId, amount: slot.amount } : null
  );
}

export function getFreeSpaceForItem(inventory, itemId) {
  const def = getItemDef(itemId);
  if (!def) return 0;

  let free = 0;
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (!slot) {
      free += def.stackMax;
    } else if (slot.itemId === itemId) {
      free += Math.max(0, def.stackMax - slot.amount);
    }
  }
  return free;
}

export function addItemToInventory(inventory, itemId, amount) {
  const def = getItemDef(itemId);
  if (!def || amount <= 0) return 0;

  let remaining = amount;

  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    const slot = inventory[i];
    if (slot && slot.itemId === itemId && slot.amount < def.stackMax) {
      const space = def.stackMax - slot.amount;
      const add = Math.min(space, remaining);
      slot.amount += add;
      remaining -= add;
    }
  }

  for (let i = 0; i < inventory.length && remaining > 0; i++) {
    if (inventory[i] == null) {
      const add = Math.min(def.stackMax, remaining);
      inventory[i] = { itemId, amount: add };
      remaining -= add;
    }
  }

  return amount - remaining;
}

export function removeItemFromInventory(inventory, itemId, amount) {
  if (!itemId || amount <= 0) return 0;
  let need = amount;

  for (let i = 0; i < inventory.length && need > 0; i++) {
    const slot = inventory[i];
    if (!slot || slot.itemId !== itemId) continue;
    const take = Math.min(slot.amount, need);
    slot.amount -= take;
    need -= take;
    if (slot.amount <= 0) inventory[i] = null;
  }

  return amount - need;
}

export function countItemInInventory(inventory, itemId) {
  let total = 0;
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];
    if (slot?.itemId === itemId) total += slot.amount;
  }
  return total;
}

export function removeAmountFromSlot(inventory, slotIndex, amount) {
  if (
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex >= inventory.length ||
    amount <= 0
  ) {
    return 0;
  }
  const slot = inventory[slotIndex];
  if (!slot) return 0;
  const take = Math.min(slot.amount, amount);
  slot.amount -= take;
  if (slot.amount <= 0) inventory[slotIndex] = null;
  return take;
}

export function moveInventorySlot(inventory, fromIndex, toIndex) {
  const slots = inventory.length;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= slots ||
    toIndex >= slots
  ) {
    return false;
  }

  const from = inventory[fromIndex];
  if (!from) return false;

  const to = inventory[toIndex];
  if (!to) {
    inventory[toIndex] = from;
    inventory[fromIndex] = null;
    return true;
  }

  if (to.itemId === from.itemId) {
    const def = getItemDef(from.itemId);
    if (!def) return false;
    const space = def.stackMax - to.amount;
    if (space <= 0) {
      inventory[fromIndex] = to;
      inventory[toIndex] = from;
      return true;
    }
    const moved = Math.min(space, from.amount);
    to.amount += moved;
    from.amount -= moved;
    if (from.amount <= 0) inventory[fromIndex] = null;
    return true;
  }

  inventory[fromIndex] = to;
  inventory[toIndex] = from;
  return true;
}

export function splitInventoryStack(inventory, slotIndex) {
  if (slotIndex < 0 || slotIndex >= inventory.length) return false;
  const slot = inventory[slotIndex];
  if (!slot || slot.amount < 2) return false;

  const emptyIndex = inventory.findIndex((s) => s == null);
  if (emptyIndex === -1) return false;

  const half = Math.floor(slot.amount / 2);
  if (half <= 0) return false;

  slot.amount -= half;
  inventory[emptyIndex] = { itemId: slot.itemId, amount: half };
  return true;
}

export function takeInventorySlot(inventory, slotIndex) {
  if (slotIndex < 0 || slotIndex >= inventory.length) return null;
  const slot = inventory[slotIndex];
  if (!slot) return null;
  inventory[slotIndex] = null;
  return { itemId: slot.itemId, amount: slot.amount };
}

export function getHarvestItemIdForNature(natureType) {
  for (const item of getAllItems()) {
    if (item.harvestFromNature === natureType) return item.id;
  }
  return null;
}

export function rollHarvestDropForNature(natureType) {
  const itemId = getHarvestItemIdForNature(natureType);
  if (!itemId) return null;
  const def = getItemDef(itemId);
  const seedId = def?.seedItemId;
  const chance = def?.seedDropChance ?? 0;
  if (seedId && getItemDef(seedId) && Math.random() < chance) {
    return seedId;
  }
  return itemId;
}

export function rollHarvestAmount(itemId) {
  const def = itemId ? getItemDef(itemId) : null;
  if (def && Number.isFinite(def.harvestAmount)) {
    return Math.max(1, Math.floor(def.harvestAmount));
  }
  const options = settings.HARVEST_AMOUNTS;
  return options[Math.floor(Math.random() * options.length)];
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