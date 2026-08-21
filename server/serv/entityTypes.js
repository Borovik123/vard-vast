export const ENTITY_TYPES = Object.freeze({
  PLAYER: "player",
  CELL: "cell",
  SAPLING: "sapling",
  CAMPFIRE: "campfire",
  WORKBENCH: "workbench",
  NATURE: "nature",
  GROUND_ITEM: "ground_item",
  PROJECTILE: "projectile",
  BUILDING: "building",
  CORPSE: "corpse",
});

export const BUILDABLE_ITEM_TYPES = Object.freeze([
  "campfire",
  "campfire_max",
  "workbench",
  "blueberrySeed",
  "wildberrySeed",
"wood_wall", "wood_door", "stone_wall", "stone_door", "metal_wall", "metal_door",
]);

export function normalizeRotation(rotation) {
  return ((Number(rotation) || 0) % 4 + 4) % 4;
}