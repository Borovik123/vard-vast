import settings from "./settings.js";
import { getDoorProgress, getDoorTransformAtProgress } from "./buildings.js";
import { findFirstObstacleOnSegment } from "./collision.js";
import {
  removeAmountFromSlot,
  sanitizeInventory
} from "./items.js";
import {
  placeItemOnGround,
  serializeGroundItems
} from "./groundItems.js";
import {
  sendToViewersIncludingSelf,
  notifyCellSubscribers,
} from "./playerSync.js";
import { removeWorkbench } from "./workbench.js";
import { ENTITY_TYPES } from "./entityTypes.js";

function makeProjectileBuildingObstacle(cell, object, cellsGrid, now) {
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  if (object.kind === "door") {
    const progress = getDoorProgress(object, now);
    const transform = getDoorTransformAtProgress(cell, object, progress, cellsGrid);
    return {
      shape: "rect",
      cx: transform.x,
      cy: transform.y,
      width: object.hitboxWidth ?? settings.CELL_SIDE_LENGTH_PIXEL,
      height: object.hitboxHeight ?? settings.CELL_SIDE_LENGTH_PIXEL,
      rotation: transform.angle,
    };
  }
  return {
    shape: "rect",
    cx,
    cy,
    width: object.hitboxWidth ?? settings.CELL_SIDE_LENGTH_PIXEL,
    height: object.hitboxHeight ?? settings.CELL_SIDE_LENGTH_PIXEL,
    rotation: Number.isFinite(Number(object.hitboxRotation))
      ? Number(object.hitboxRotation) * Math.PI / 2
      : Number(object.rotation ?? 0) * Math.PI / 2,
  };
}

function findFirstProjectileBlocker({ application, startX, startY, endX, endY, radius, now }) {
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const halfLength = Math.hypot(endX - startX, endY - startY) / 2;
  const searchRadius = halfLength + radius + settings.CELL_SIDE_LENGTH_PIXEL * 1.5;
  const cells = application.cellsList.getNearbyAttackableCells(midX, midY, searchRadius);
  const candidates = [];
  for (const cell of cells ?? []) {
    const object = cell?.building;
    if (!object?.projectileBlocks || Number(object.hp) <= 0) continue;
    candidates.push({
      ...makeProjectileBuildingObstacle(cell, object, application.cellsList.grid, now),
      cell,
      object,
    });
  }
  const hit = findFirstObstacleOnSegment(startX, startY, endX, endY, radius, candidates);
  return hit ? { t: hit.t, cell: hit.obstacle.cell, object: hit.obstacle.object, obstacle: hit.obstacle } : null;
}

/** Server-authoritative spear state and projectile simulation. */
export function createSpearSystem({ application, wsHub, onPlayerDeath = null }) {
  const activeSpears = new Map();
  let nextId = 1;

  function sendState(player, state, extra = {}) {
    if (!player) return;
    sendToViewersIncludingSelf(
      wsHub,
      application.playersList.list,
      player,
      "spear_state",
      {
        id: player.id,
        spearState: state,
        x: Number.isFinite(extra.x) ? extra.x : player.x,
        y: Number.isFinite(extra.y) ? extra.y : player.y,
        dirX: Number.isFinite(extra.dirX) ? extra.dirX : (player.throwDirection?.x ?? 0),
        dirY: Number.isFinite(extra.dirY) ? extra.dirY : (player.throwDirection?.y ?? 0),
      }
    );
  }

  function rejectThrow(player, reason) {
    if (!player) return;
    wsHub.sendToClientId(player.id, "spear_throw_rejected", { reason });
  }

  function getHeldSpearSlot(player) {
    const index = Number(player?.heldSlotIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const slot = player.inventory?.[index];
    if (!slot || slot.itemId !== "spear" || Number(slot.amount) <= 0) return null;
    return { index, slot };
  }

  function onHoldItem(player) {
    if (!player || !player.inGame || !player.isAlive) return false;
    if (player.heldItemId !== "spear" || player.spearProjectileId) return false;
    if (!getHeldSpearSlot(player)) return false;

    player.spearState = "idle_hand";
    player.spearTimer = 0;
    player.spearWindupStartedAt = 0;
    player.throwDirection = { x: 0, y: 0 };
    sendState(player, "idle_hand");
    return true;
  }

  function startWindup(player) {
    if (!player || !player.inGame || !player.isAlive) return false;
    if (player.spearProjectileId || player.heldItemId !== "spear") return false;
    if (!getHeldSpearSlot(player)) return false;
    if (player.spearState !== "idle_hand") return false;

    player.spearState = "windup";
    player.spearTimer = 0;
    player.spearWindupStartedAt = performance.now();
    sendState(player, "windup");
    return true;
  }

  function cancelWindup(player) {
    if (!player || !player.inGame || !player.isAlive) return false;
    if (player.spearState !== "windup") return false;
    if (!getHeldSpearSlot(player)) return false;

    player.spearState = "idle_hand";
    player.spearTimer = 0;
    player.spearWindupStartedAt = 0;
    sendState(player, "idle_hand");
    return true;
  }

  function onClearHold(player) {
    if (!player || player.spearProjectileId) return;
    if (player.spearState !== "none") {
      player.spearState = "none";
      player.spearTimer = 0;
      player.spearWindupStartedAt = 0;
      player.throwDirection = { x: 0, y: 0 };
      sendState(player, "none");
    }
  }

  function onInventoryDrop(player) {
    if (!player) return;
    if (player.spearProjectileId) activeSpears.delete(player.spearProjectileId);
    player.spearProjectileId = null;
    player.spearState = "none";
    player.spearTimer = 0;
    player.spearWindupStartedAt = 0;
    player.throwDirection = { x: 0, y: 0 };
    player.heldItemId = null;
    player.heldSlotIndex = -1;
    sendState(player, "none");
  }

  function throwSpear(player, data = {}) {
    if (!player || !player.inGame || !player.isAlive) return false;
    if (player.spearProjectileId) {
      rejectThrow(player, "already_flying");
      return false;
    }

    // The client owns the animation clock, but the server still verifies that
    // the wind-up was actually started and lasted the configured duration.
    // This also tolerates one late/out-of-order state update without leaving
    // the projectile permanently stuck in the player's hands.
    const now = performance.now();
    const windupStartedAt = Number(player.spearWindupStartedAt) || 0;
    const windupReady =
      player.spearState === "windup" &&
      windupStartedAt > 0 &&
      now - windupStartedAt >= (settings.SPEAR_WINDUP_MS ?? 500) - 50;
    if (!windupReady) {
      rejectThrow(player, "windup_not_ready");
      return false;
    }

    const held = getHeldSpearSlot(player);
    if (player.heldItemId !== "spear" || !held) {
      rejectThrow(player, "spear_not_held");
      onClearHold(player);
      return false;
    }

    const energyCost = settings.SPEAR_ENERGY_COST ?? 30;
    if ((player.energy ?? settings.MAX_ENERGY ?? 300) < energyCost) {
      rejectThrow(player, "not_enough_energy");
      cancelWindup(player);
      return false;
    }

    const dx = Number(data.dirX);
    const dy = Number(data.dirY);
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.1) return false;
    const dirX = dx / len;
    const dirY = dy / len;

    const originDistance = Math.hypot(
      (Number(data.originX) || player.x) - player.x,
      (Number(data.originY) || player.y) - player.y
    );
    if (originDistance > 160) return false;

    if (removeAmountFromSlot(player.inventory, held.index, 1) !== 1) return false;

    player.energy = Math.max(0, (player.energy ?? settings.MAX_ENERGY ?? 300) - energyCost);
    player.energyRegenReadyAt = performance.now() + (settings.ENERGY_REGEN_DELAY_MS ?? 7000);

    const spearOriginX = Number.isFinite(Number(data.originX)) ? Number(data.originX) : player.x;
    const spearOriginY = Number.isFinite(Number(data.originY)) ? Number(data.originY) : player.y;
    const id = `spear_${player.id}_${Date.now()}_${nextId++}`;
    activeSpears.set(id, {
      id,
      ownerId: player.id,
      startX: spearOriginX,
      startY: spearOriginY,
      dirX,
      dirY,
      distance: 0,
      timer: 0,
    });

    player.heldItemId = null;
    player.heldSlotIndex = -1;
    player.spearProjectileId = id;
    player.spearState = "flying";
    player.spearTimer = 0;
    player.spearWindupStartedAt = 0;
    player.throwDirection = { x: dirX, y: dirY };

    wsHub.sendToClientId(player.id, "inventoryUpdate", {
      inventory: sanitizeInventory(player.inventory),
    });
    sendState(player, "flying", {
      x: spearOriginX,
      y: spearOriginY,
      dirX,
      dirY,
    });
    return true;
  }

  function land(spear, x, y, boundaryHit = false) {
    const owner = application.playersList.list.find((p) => p.id === spear.ownerId);
    const worldW = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
    const worldH = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
    const safeX = Math.max(1, Math.min(worldW - 1, x));
    const safeY = Math.max(1, Math.min(worldH - 1, y));
    const cell = application.cellsList.getCellAtWorld(safeX, safeY);

    if (cell) {
      placeItemOnGround(cell, "spear", 1, {
        x: safeX,
        y: safeY,
        // A spear that reaches the world boundary is intentionally not pickable.
        // Its local landed visual remains until another spear is picked up.
        pickableDelayMs: 0,
        allowStack: false,
      });
      const items = serializeGroundItems(cell);
      notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
        groundItems: items,
        groundItem: items[0] ?? null,
      });
    }

    if (owner) {
      owner.spearProjectileId = null;
      owner.spearState = "landed";
      owner.spearTimer = 0;
      owner.spearWindupStartedAt = 0;
      sendState(owner, "landed", {
        x: safeX,
        y: safeY,
        dirX: spear.dirX,
        dirY: spear.dirY,
      });
      sendToViewersIncludingSelf(
        wsHub,
        application.playersList.list,
        owner,
        "spear_landed",
        { id: owner.id, x: safeX, y: safeY }
      );
    }
  }

  function update(now, deltaTime) {
    if (!activeSpears.size) return;
    const players = application.playersList.list;
    const ms = Math.max(0, Math.min(100, Number(deltaTime) * 1000 || 0));
    // Spears now stay in flight twice as long, so they travel the same maximum
    // distance at half the previous speed. Keep this local to the spear system
    // so no unrelated movement/projectile timings are changed.
    const flightMs = (settings.SPEAR_FLIGHT_MS ?? 700) * 2;
    const speed = settings.SPEAR_MAX_DISTANCE / flightMs;

    for (const [id, spear] of activeSpears) {
      spear.timer += ms;
      const previousDistance = spear.distance;
      spear.distance = Math.min(settings.SPEAR_MAX_DISTANCE, spear.distance + speed * ms);

      let x = spear.startX + spear.dirX * spear.distance;
      let y = spear.startY + spear.dirY * spear.distance;

      // Never allow a projectile to leave the playable world. The map is a
      // MAP_SIDE_LENGTH x MAP_SIDE_LENGTH grid of CELL_SIDE_LENGTH_PIXEL cells.
      // Clamp the first point outside the rectangle to its boundary, so the
      // spear visually stops exactly at the world edge.
      const worldW = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
      const worldH = settings.MAP_SIDE_LENGTH * settings.CELL_SIDE_LENGTH_PIXEL;
      const boundaryHit = x < 0 || x > worldW || y < 0 || y > worldH;
      if (boundaryHit) {
        x = Math.max(0, Math.min(worldW, x));
        y = Math.max(0, Math.min(worldH, y));
      }

      let hit = boundaryHit;

      // Projectile blockers are resolved as a swept segment, not only at the
      // final projectile point. This prevents tunnelling through a wall/door
      // between server ticks and gives future projectile weapons the same API.
      const blockHit = findFirstProjectileBlocker({
        application,
        startX: spear.startX + spear.dirX * previousDistance,
        startY: spear.startY + spear.dirY * previousDistance,
        endX: x,
        endY: y,
        radius: settings.SPEAR_HITBOX_RADIUS,
        now,
      });
      if (blockHit) {
        const impactX = (spear.startX + spear.dirX * previousDistance) +
          (x - (spear.startX + spear.dirX * previousDistance)) * blockHit.t;
        const impactY = (spear.startY + spear.dirY * previousDistance) +
          (y - (spear.startY + spear.dirY * previousDistance)) * blockHit.t;
        x = impactX;
        y = impactY;
        hit = true;

        const object = blockHit.object;
        const cell = blockHit.cell;
        object.hp = Math.max(0, object.hp - settings.SPEAR_DAMAGE);
        const destroyed = object.hp <= 0;
        const isWorkbench = cell.workbench === object;
        if (destroyed && isWorkbench) {
          const destroyedWorkbench = removeWorkbench(cell);
          const drops = destroyedWorkbench?.getDestructionDrops?.() ?? [];
          for (let i = 0; i < drops.length; i++) {
            const d = drops[i], a = (Math.PI * 2 * i) / Math.max(1, drops.length);
            const toX = cell.x + cell.w / 2 + Math.cos(a) * 40;
            const toY = cell.y + cell.h / 2 + Math.sin(a) * 40;
            const placed = placeItemOnGround(cell, d.itemId, d.amount, {
              x: toX, y: toY, allowStack: true,
              pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
            });
            if (placed) notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
              groundItems: serializeGroundItems(cell),
              groundItem: serializeGroundItems(cell)[0] ?? null,
            });
          }
        }
        const ox = blockHit.obstacle.cx, oy = blockHit.obstacle.cy;
        const ddx = ox - x, ddy = oy - y, dist = Math.hypot(ddx, ddy) || 1;
        const knockDx = (ddx / dist) * (settings.NATURE_HIT_KNOCKBACK ?? 15);
        const knockDy = (ddy / dist) * (settings.NATURE_HIT_KNOCKBACK ?? 15);
        if (isWorkbench) {
          notifyCellSubscribers(wsHub, cell, "workbenchHit", {
            hp: object.hp, destroyed, indexX: cell.indexX, indexY: cell.indexY,
            knockDx, knockDy, worldX: x, worldY: y,
          });
        } else {
          const material = object.buildingId?.startsWith("metal") ? "steel" : object.buildingId?.startsWith("stone") ? "stone" : "tree";
          notifyCellSubscribers(wsHub, cell, "buildingState", {
            indexX: cell.indexX, indexY: cell.indexY,
            building: destroyed ? null : object.serialize(),
            knockDx, knockDy, worldX: x, worldY: y, material, destroyed,
          });
        }
      }

      if (!hit) {
        const natureCells = application.cellsList.getNearbyNatureCells(
          x,
          y,
          settings.SPEAR_HITBOX_RADIUS + 20
        );
        for (const cell of natureCells) {
          if (cell.hp <= 0 || cell.hitboxRadius <= 0) continue;
          const cx = cell.x + cell.w / 2;
          const cy = cell.y + cell.h / 2;
          if (Math.hypot(x - cx, y - cy) <= settings.SPEAR_HITBOX_RADIUS + cell.hitboxRadius) {
            hit = true;
            const natureType = cell.natureType;
            cell.hp = Math.max(0, cell.hp - settings.SPEAR_DAMAGE);
            if (cell.hp <= 0) cell.natureType = "empty";
            notifyCellSubscribers(wsHub, cell, "natureObjectHit", {
              hp: cell.hp,
              knockDx: spear.dirX * settings.NATURE_HIT_KNOCKBACK,
              knockDy: spear.dirY * settings.NATURE_HIT_KNOCKBACK,
              destroyed: cell.hp <= 0,
              natureType,
              worldX: x,
              worldY: y,
            });
            break;
          }
        }
      }

      if (!hit) {
        for (const target of players) {
          if (!target.isAlive || !target.inGame || target.id === spear.ownerId) continue;
          const radius = target.hitboxRadius ?? settings.PLAYER_HITBOX_RADIUS;
          if (Math.hypot(x - target.x, y - target.y) <= settings.SPEAR_HITBOX_RADIUS + radius) {
            hit = true;
            target.hp = Math.max(0, target.hp - settings.SPEAR_DAMAGE);
            target.lastDamageTime = now;
            const knock = settings.KNOCKBACK_DISTANCE ?? 25;
            target.x += spear.dirX * knock;
            target.y += spear.dirY * knock;
            sendToViewersIncludingSelf(wsHub, players, target, "playerHpUpdate", {
              id: target.id,
              hp: Math.round(target.hp),
              x: target.x,
              y: target.y,
            });
            sendToViewersIncludingSelf(wsHub, players, target, "playerHurt", { id: target.id });
            if (target.hp <= 0) {
              onPlayerDeath?.(
                target,
                players.find((p) => p.id === spear.ownerId) || null
              );
            }
            break;
          }
        }
      }

      // If the projectile was moved across a collision point in one server
      // tick, the current point is still checked. Server tick is short enough
      // for the 20px projectile hitbox to provide continuous-looking travel.
      const finished =
        hit ||
        spear.distance >= settings.SPEAR_MAX_DISTANCE ||
        spear.timer >= flightMs;

      if (finished) {
        land(spear, x, y, boundaryHit);
        activeSpears.delete(id);
      } else {
        const owner = players.find((p) => p.id === spear.ownerId);
        if (owner) {
          sendToViewersIncludingSelf(
            wsHub,
            application.playersList.list,
            owner,
            "spear_state",
            {
              id: owner.id,
              spearState: "flying",
              x,
              y,
              dirX: spear.dirX,
              dirY: spear.dirY,
            }
          );
        }
      }
    }
  }

  function resetPlayer(player) {
    if (!player) return;
    if (player.spearProjectileId) activeSpears.delete(player.spearProjectileId);
    player.spearProjectileId = null;
    player.spearState = "none";
    player.spearTimer = 0;
    player.spearWindupStartedAt = 0;
    player.throwDirection = { x: 0, y: 0 };
  }

  return {
    activeSpears,
    onHoldItem,
    onClearHold,
    startWindup,
    cancelWindup,
    throw: throwSpear,
    onInventoryDrop,
    resetPlayer,
    update,
  };
}













