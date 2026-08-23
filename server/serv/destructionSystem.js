import { removeCampfire } from "./campfire.js";
import { removeWorkbench } from "./workbench.js";
import { ENTITY_TYPES } from "./entityTypes.js";
import { getSaplingDef } from "./saplings.js";
import { gameObjectManager } from "./gameObjects.js";

/** Single authoritative removal path for player-built structures. */
export function destroyOwnedStructures({ player, cellsList }) {
  const destroyed = [];

  for (const cell of cellsList?.list ?? []) {
    const building = cell?.building;
    const campfire = cell?.campfire;
    const workbench = cell?.workbench;
    const sapling = cell?.sapling;

    // A workbench is also mirrored through cell.building for collision/
    // rendering compatibility. Therefore station-specific entities MUST be
    // checked before the generic building reference, otherwise removing the
    // generic reference leaves the real workbench alive after death.
    let target = null;
    let entityType = null;

    if (workbench?.ownerId === player.id) {
      target = workbench;
      entityType = ENTITY_TYPES.WORKBENCH;
    } else if (campfire?.ownerId === player.id) {
      target = campfire;
      entityType = ENTITY_TYPES.CAMPFIRE;
    } else if (sapling?.ownerId === player.id) {
      target = sapling;
      entityType = ENTITY_TYPES.SAPLING;
    } else if (building?.ownerId === player.id) {
      target = building;
      entityType = ENTITY_TYPES.BUILDING;
    }
    if (!target) continue;

    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    let removed = null;

    if (entityType === ENTITY_TYPES.WORKBENCH) {
      removed = removeWorkbench(cell);
    } else if (entityType === ENTITY_TYPES.CAMPFIRE) {
      removed = removeCampfire(cell);
    } else if (entityType === ENTITY_TYPES.SAPLING) {
      removed = cell.sapling;
      cell.sapling = null;
      if (removed) gameObjectManager.unregister("sapling", cell, removed);
    } else if (entityType === ENTITY_TYPES.BUILDING) {
      removed = cell.building;
      cell.building = null;
      if (removed) gameObjectManager.unregister("building", cell, removed);
    }

    if (!removed) continue;

    const drops = removed.getDestructionDrops?.() ?? [];
    if (entityType === ENTITY_TYPES.SAPLING) {
      const def = getSaplingDef(removed.kind);
      if (def?.berryItemId) drops.push({ itemId: def.berryItemId, amount: 1 });
    }

    destroyed.push({
      cell,
      object: removed,
      entityType,
      x: cx,
      y: cy,
      drops,
    });
  }

  return destroyed;
}