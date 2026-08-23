import settings from "./settings.js";
import { getItemDef, removeAmountFromSlot, removeItemFromInventory } from "./items.js";
import { getSaplingKindFromSeed, plantSapling, canPlantOnCell, isCellAdjacentToPlayer } from "./saplings.js";
import { placeCampfire } from "./campfire.js";
import { placeWorkbench } from "./workbench.js";
import { normalizeRotation } from "./entityTypes.js";
import { runInventoryTransaction } from "./inventoryTransaction.js";
import { Building, getBuildingDef, isBuildingItem, getDoorTargetCell, getDoorTransformAtProgress, DOOR_ANIM_MS, DEFAULT_DOOR_OPEN_DIRECTION, normalizeDoorOpenDirection } from "./buildings.js";
import { gameObjectManager } from "./gameObjects.js";

export function createBuildingSystem({ cellsList, players = [], clanSystem = null }) {
  const builders = new Map([
    ["campfire", ({ cell, player, rotation }) => placeCampfire(cell, "normal", player.x, player.y, player.id, rotation) ? { kind:"campfire", object:cell.campfire } : null],
    ["campfire_max", ({ cell, player, rotation }) => placeCampfire(cell, "max", player.x, player.y, player.id, rotation) ? { kind:"campfire", object:cell.campfire } : null],
    ["workbench", ({ cell, player, rotation }) => placeWorkbench(cell, player.x, player.y, player.id, rotation) ? { kind:"workbench", object:cell.workbench } : null],
  ]);

  const getPlayerCell = (player) => ({
    indexX: Math.floor(player.x / settings.CELL_SIDE_LENGTH_PIXEL) + 1,
    indexY: Math.floor(player.y / settings.CELL_SIDE_LENGTH_PIXEL) + 1,
  });

  function getCell(player, data) {
    const indexX = Number(data?.indexX), indexY = Number(data?.indexY);
    if (!Number.isInteger(indexX) || !Number.isInteger(indexY)) return null;
    const cell = cellsList.grid[indexX]?.[indexY];
    if (!cell) return null;
    const { indexX: px, indexY: py } = getPlayerCell(player);
    return isCellAdjacentToPlayer(cell, px, py) ? cell : null;
  }

  function occupied(cell) {
    return !!(
      cell.building ||
      cell.campfire ||
      cell.workbench ||
      cell.sapling ||
      (cell.natureType && cell.natureType !== "empty" && cell.hp > 0)
    );
  }

  function hasItem(player, itemId) {
    const slot = player.inventory[player.heldSlotIndex];
    return !!(slot?.itemId === itemId && slot.amount > 0) ||
      player.inventory.some((s) => s?.itemId === itemId && s.amount > 0);
  }

  function consume(player, itemId) {
    const slot = player.inventory[player.heldSlotIndex];
    if (slot?.itemId === itemId && slot.amount > 0) {
      return removeAmountFromSlot(player.inventory, player.heldSlotIndex, 1) > 0;
    }
    return removeItemFromInventory(player.inventory, itemId, 1) > 0;
  }

  function place(player, data = {}) {
    if (!player?.isAlive || !player.inGame) return { ok:false, reason:"inactive" };
    const itemId = player.heldItemId;
    const def = getItemDef(itemId);
    if (!itemId || !def?.canBuild) return { ok:false, reason:"not-buildable" };

    const cell = getCell(player, data);
    if (!cell || occupied(cell)) return { ok:false, reason:"occupied" };

    // An open door reserves its destination cell as well as its source cell.
    for (const entry of gameObjectManager.get("building")) {
      const c = entry.cell;
      const b = entry.object;
      if (!b || b.kind !== "door" || String(b.state).toUpperCase() !== "OPEN") continue;
      const target = getDoorTargetCell(c.indexX, c.indexY, b.rotation, b.openDirection);
      if (target.indexX === cell.indexX && target.indexY === cell.indexY) return { ok:false, reason:"occupied" };
    }

    if (!hasItem(player, itemId)) return { ok:false, reason:"missing-item" };
    const rotation = normalizeRotation(data.rotation);

    const tx = runInventoryTransaction(player.inventory, () => {
      if (!consume(player, itemId)) return false;

      if (isBuildingItem(itemId)) {
        const b = new Building(itemId, cell.x + cell.w / 2, cell.y + cell.h / 2, player.id, rotation);
        if (b.kind === "door") {
          b.playerCollisionCells = [{ indexX: cell.indexX, indexY: cell.indexY }];
          b.reservationCells = [{ indexX: cell.indexX, indexY: cell.indexY }];
        }
        cell.building = b;
        gameObjectManager.register("building", cell, b);
        return { kind:"building", cell, object:b };
      }

      const builder = builders.get(itemId);
      if (builder) {
        const result = builder({ player, cell, rotation, itemId });
        if (!result) return false;
        result.object.rotation = rotation;
        return result;
      }

      const kind = getSaplingKindFromSeed(itemId);
      if (!kind || !canPlantOnCell(cell)) return false;
      const planted = plantSapling(cell, kind, performance.now(), player.id, rotation);
      if (!planted) return false;
      return { kind:"sapling", cell, object:cell.sapling };
    });

    if (!tx.ok) return { ok:false, reason:"placement-failed" };
    return { ok:true, itemId, cell, ...tx.result };
  }

  function hasOtherPlayerInCell(indexX, indexY, selfId = null) {
    for (const p of players) {
      if (!p?.inGame || !p?.isAlive || p.id === selfId) continue;
      const pCell = getPlayerCell(p);
      if (pCell.indexX === indexX && pCell.indexY === indexY) return true;
    }
    return false;
  }

  function getDoorProgressValue(b) {
    const state = String(b?.state ?? "CLOSED").toUpperCase();
    let progress = Number(b?.doorProgress);
    if (!Number.isFinite(progress)) progress = state === "OPEN" ? 1 : 0;
    return Math.max(0, Math.min(1, progress));
  }

  function getDoorInteractionCenter(cell, b) {
    const progress = getDoorProgressValue(b);
    const transform = getDoorTransformAtProgress(cell, b, progress, cellsList.grid);
    return { x:transform.x, y:transform.y };
  }

  function cellBlocksDoorTarget(targetCell, playerId) {
    if (!targetCell) return true;
    if (targetCell.building || targetCell.campfire || targetCell.workbench || targetCell.sapling) return true;
    if (targetCell.natureType && targetCell.natureType !== "empty" && targetCell.hp > 0) return true;
    if (targetCell.groundItems?.length || targetCell.groundItem?.itemId) return true;
    return hasOtherPlayerInCell(targetCell.indexX, targetCell.indexY, playerId);
  }

  function getFixedDoorOpenDirection() {
    return normalizeDoorOpenDirection(DEFAULT_DOOR_OPEN_DIRECTION);
  }

  function canOpenDoor(cell, playerId = null) {
    const b = cell?.building;
    if (!b || b.kind !== "door" || String(b.state).toUpperCase() !== "CLOSED") return false;
    const direction = getFixedDoorOpenDirection();
    const target = getDoorTargetCell(cell.indexX, cell.indexY, cell.building.rotation, direction);
    const targetCell = cellsList.grid[target.indexX]?.[target.indexY];
    return !!targetCell && !cellBlocksDoorTarget(targetCell, playerId);
  }

  function setDoorState(cell, state, openDirection = null) {
    const b = cell?.building;
    if (!b || b.kind !== "door") return false;
    const normalized = String(state).toUpperCase();
    if (normalized === "OPENING" && String(b.state).toUpperCase() !== "CLOSED") return false;
    if (normalized === "CLOSING" && String(b.state).toUpperCase() !== "OPEN") return false;

    if (openDirection != null) b.openDirection = normalizeDoorOpenDirection(openDirection);
    b.state = normalized;
    b.doorStartedAt = performance.now();
    b.doorProgress = normalized === "OPENING" ? 0 : 1;
    b.playerCollisionCells = [];

    const target = getDoorTargetCell(cell.indexX, cell.indexY, b.rotation, b.openDirection);
    b.reservationCells = [
      { indexX: cell.indexX, indexY: cell.indexY },
      { indexX: target.indexX, indexY: target.indexY },
    ];
    return true;
  }

  function toggleDoor(player, data = {}) {
    const ix = Number(data.indexX), iy = Number(data.indexY);
    const cell = cellsList.grid[ix]?.[iy];
    if (!cell?.building || cell.building.kind !== "door") return { ok:false };

    const b = cell.building;
    if (b.ownerId !== player.id && !clanSystem?.sameClan(player, players.find(p=>p.id===b.ownerId))) return { ok:false, reason:"not-owner" };
    const state = String(b.state ?? "CLOSED").toUpperCase();
    const interaction = getDoorInteractionCenter(cell, b);
    const maxDistance = Math.max(300, settings.INTERACTION_RADIUS ?? 200);
    if (Math.hypot(interaction.x - player.x, interaction.y - player.y) > maxDistance) return { ok:false, reason:"out-of-range" };
    if (state === "OPENING" || state === "CLOSING") return { ok:false, reason:"animating" };

    if (state === "CLOSED") {
      const direction = getFixedDoorOpenDirection();
      const target = getDoorTargetCell(ix, iy, b.rotation, direction);
      const targetCell = cellsList.grid[target.indexX]?.[target.indexY];
      if (!targetCell || cellBlocksDoorTarget(targetCell, player.id)) return { ok:false, reason:"blocked" };
      setDoorState(cell, "OPENING", direction);
      return { ok:true, state:"OPENING", cell, openDirection:direction };
    }

    if (state === "OPEN") {
      const target = getDoorTargetCell(ix, iy, b.rotation, b.openDirection);
      const targetCell = cellsList.grid[target.indexX]?.[target.indexY];
      if (!targetCell || cellBlocksDoorTarget(targetCell, player.id) || hasOtherPlayerInCell(ix, iy, player.id)) return { ok:false, reason:"blocked" };
      setDoorState(cell, "CLOSING", b.openDirection);
      return { ok:true, state:"CLOSING", cell, openDirection:b.openDirection };
    }

    return { ok:false, reason:"unknown" };
  }

  function processObject(b, cell, now) {
    if (!b || b.kind !== "door") return null;
    const state = String(b.state ?? "CLOSED").toUpperCase();
    if (state !== "OPENING" && state !== "CLOSING") return null;

    const t = Math.min(1, Math.max(0, (now - b.doorStartedAt) / DOOR_ANIM_MS));
    b.doorProgress = state === "OPENING" ? t : 1 - t;
    if (t < 1) return null;

    if (state === "OPENING") {
      b.state = "OPEN";
      b.doorProgress = 1;
      const target = getDoorTargetCell(cell.indexX, cell.indexY, b.rotation, b.openDirection);
      b.playerCollisionCells = [{ indexX: target.indexX, indexY: target.indexY }];
    } else {
      b.state = "CLOSED";
      b.doorProgress = 0;
      b.playerCollisionCells = [{ indexX: cell.indexX, indexY: cell.indexY }];
    }
    return true;
  }

  function process(now) {
    const changed = [];
    for (const entry of gameObjectManager.get("building")) {
      if (processObject(entry.object, entry.cell, now)) changed.push(entry.cell);
    }
    return changed;
  }

  return { place, toggleDoor, canOpenDoor, process, processObject };
}