import settings from "./settings.js";
import {
  awardKillScore,
  resetPlayerScore,
  broadcastLeaderboard } from "./leaderboard.js";
import { placeItemOnGround, serializeGroundItems } from "./groundItems.js";

import { destroyOwnedStructures } from "./destructionSystem.js";
import { isPlayerVisibleTo } from "./visibility.js";
import { takeCraftReservations } from "./craftQueue.js";

/**
 * Authoritative player death lifecycle.
 *
 * This module owns the order of death side effects. Gameplay systems only
 * report that a player died; they do not know how inventory, structures,
 * corpses or network state are cleaned up.
 */
export function createDeathSystem({ wsHub, players, cellsList, corpseList, clanSystem = null }) {
  function notifyCell(cell, type, data = {}) {
    if (!cell) return;
    const payload = { indexX: cell.indexX, indexY: cell.indexY, ...data };
    for (const id of cell.subscribers ?? []) wsHub.sendToClientId(id, type, payload);
  }

  function sendToVisible(player, type, data) {
    if (!player) return;
    wsHub.sendToClientId(player.id, type, data);
    for (const observer of players) {
      if (!observer.inGame || !observer.isAlive || observer.id === player.id) continue;
      if (isPlayerVisibleTo(observer, player)) wsHub.sendToClientId(observer.id, type, data);
    }
  }

  function dropItem(player, itemId, amount, index, total, originX = player.x, originY = player.y) {
    if (!itemId || amount <= 0) return;
    const angle = (Math.PI * 2 * index) / Math.max(1, total) + (Math.random() - 0.5) * 0.5;
    const distance = 30 + Math.random() * 90;
    const toX = originX + Math.cos(angle) * distance;
    const toY = originY + Math.sin(angle) * distance;
    const cell = cellsList?.getCellAtWorld?.(toX, toY);
    if (!cell) return;

    const placed = placeItemOnGround(cell, itemId, amount, {
      x: toX,
      y: toY,
      allowStack: false,
      pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
    });
    if (!placed) return;

    const items = serializeGroundItems(cell);
    notifyCell(cell, "groundItemUpdate", {
      groundItems: items,
      groundItem: items[0] ?? null,
    });
    sendToVisible(player, "resourceDrop", {
      itemId,
      amount,
      fromX: originX,
      fromY: originY,
      toX,
      toY,
      indexX: cell.indexX,
      indexY: cell.indexY,
      lootId: placed.id,
      playerId: player.id,
    });
  }

  function destroyStructures(player) {
    const destroyed = destroyOwnedStructures({ player, cellsList });
    for (const event of destroyed) {
      if (event.entityType === "building") {
        const b = event.object;
        const material = b?.buildingId?.startsWith("metal") ? "steel" : b?.buildingId?.startsWith("stone") ? "stone" : "tree";
        notifyCell(event.cell, "buildingState", {
          hp: 0,
          destroyed: true,
          indexX: event.cell.indexX,
          indexY: event.cell.indexY,
          building: null,
          knockDx: 0,
          knockDy: 0,
          material,
        });
      } else if (event.entityType === "workbench") {
        notifyCell(event.cell, "workbenchHit", { hp: 0, destroyed: true, indexX: event.cell.indexX, indexY: event.cell.indexY });
      } else if (event.entityType === "campfire") {
        notifyCell(event.cell, "natureObjectHit", { hp: 0, knockDx: 0, knockDy: 0, destroyed: true, natureType: "campfire", campfireType: event.object?.type ?? "normal" });
      } else if (event.entityType === "sapling") {
        notifyCell(event.cell, "saplingHit", { knockDx: 0, knockDy: 0, destroyed: true, kind: event.object?.kind, stage: event.object?.stage ?? 0, harvested: false });
      }
      for (let i = 0; i < event.drops.length; i++) {
        const drop = event.drops[i];
        dropItem(player, drop.itemId, drop.amount, i, event.drops.length, event.x, event.y);
      }
    }
  }

  function dropInventoryAndCraftReservations(player) {
    const drops = [];
    for (const slot of player.inventory ?? []) {
      if (slot?.itemId && slot.amount > 0) drops.push({ itemId: slot.itemId, amount: slot.amount });
    }

    // Craft jobs own their ingredient reservation. Those resources are not in
    // the inventory anymore, so they must be returned to the world on death.
    drops.push(...takeCraftReservations(player));

    drops.forEach((drop, i) => dropItem(player, drop.itemId, drop.amount, i, drops.length));
    player.inventory = [];
  }

  function removePlayerFromWorld(player) {
    cellsList?.unsubscribePlayer?.(player.id, player.visibleCells);
    player.visibleCells = [];
    player.subscribedCells?.clear?.();
    player.inGame = false;
    player.isAlive = false;
    player.vector = [];
    player.sprinting = false;
    player.isAttacking = false;

    for (const observer of players) {
      if (observer.knownPlayers?.has(player.id)) {
        observer.knownPlayers.delete(player.id);
        wsHub.sendToClientId(observer.id, "deletePlayer", { id: player.id });
      }
    }
  }

  function broadcastCorpse(corpse) {
    for (const observer of players) {
      if (!observer.inGame) continue;
      if (isPlayerVisibleTo(observer, { x: corpse.x, y: corpse.y })) {
        wsHub.sendToClientId(observer.id, "spawnCorpse", {
          id: corpse.id,
          x: corpse.x,
          y: corpse.y,
          angle: corpse.angle,
        });
      }
    }
  }

  function handlePlayerDeath(deadPlayer, killer = null) {
    if (!deadPlayer || deadPlayer._deathHandled) return false;
    deadPlayer._deathHandled = true;
    clanSystem?.onOwnerGone(deadPlayer);

    if (killer?.isAlive && killer.inGame) {
      awardKillScore(killer, deadPlayer, wsHub);
    }

    // The state transition happens only after all world drops are spawned,
    // because resourceDrop events need the dead player as their source.
    destroyStructures(deadPlayer);
    dropInventoryAndCraftReservations(deadPlayer);
    resetPlayerScore(deadPlayer, wsHub);

    const corpse = corpseList.add(deadPlayer.x, deadPlayer.y, deadPlayer.angle);
    removePlayerFromWorld(deadPlayer);
    broadcastCorpse(corpse);

    wsHub.sendToClientId(deadPlayer.id, "playerDied", { hp: 0 });
    wsHub.sendToClientId(deadPlayer.id, "inventoryUpdate", { inventory: [] });
    wsHub.sendToClientId(deadPlayer.id, "craftQueueUpdate", {
      queue: [],
      max: settings.CRAFT_QUEUE_MAX ?? 4,
    });
    broadcastLeaderboard(wsHub, players);

    return true;
  }

  function processCorpses() {
    const removed = corpseList.removeExpired();
    for (const corpse of removed) {
      for (const observer of players) {
        if (observer.inGame) wsHub.sendToClientId(observer.id, "removeCorpse", { id: corpse.id });
      }
    }
  }

  return { handlePlayerDeath, processCorpses };
}