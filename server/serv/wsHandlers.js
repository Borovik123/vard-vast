import {
  chooseVectorToAdd,
  chooseVectorToDelete } from "./vector.js";
import settings from "./settings.js";
import {
  syncPlayerVisibility,
  sendPositionsToViewers,
  sendVectorsToViewers,
  sendToViewers,
  sendToViewersIncludingSelf,
  notifyDisconnect,
  notifyCellSubscribers,
  setupJoinVisibility,
  processRegen,
  processHunger,
  processAttacks,
  applyAttackHits,
  tryHoldItem,
  beginEatHeldItem,
  finishEatHeldItem,
  cancelEatHeldItem,
  clearPlayerHold,
  syncPlayerHoldFromInventory,
  broadcastSaplingUpdate,
  updatePlayerTemperature,
  sendTemperature,
  processEnergy,
  sendEnergy,
  } from "./playerSync.js";
import { ChatHistory,
  sendChatHistory,
  broadcastChatMessage } from "./chat.js";
import { getNatureClientManifest,
  getNatureClientCatalog } from "./natureObjects.js";
import { getSaplingClientManifest,
  getSaplingKindFromSeed,
  isCellAdjacentToPlayer,
  processSaplings,
  getSaplingDef } from "./saplings.js";
import {
  getItemClientManifest,
  getToolClientCatalog,
  sanitizeInventory,
  addItemToInventory,
  moveInventorySlot,
  splitInventoryStack,
  takeInventorySlot,
  removeItemFromInventory,
  countItemInInventory,
  removeAmountFromSlot,
  getItemDef,
  getFreeSpaceForItem,
  getToolProfile
} from "./items.js";
import {
  stampGroundItemsForNetwork,
  findNearestGroundItem,
  clearGroundItem,
  findDropPlacement,
  placeItemOnGround,
  serializeGroundItems
} from "./groundItems.js";
import { broadcastLeaderboard, getLeaderboardEntries, sendScoreUpdate } from "./leaderboard.js";
import { getDayNightState } from "./dayNight.js";
import { getCraftClientCatalog, CRAFTBOX_LAYOUT, getCraftRecipe, isRecipeForStation } from "./crafts.js";
import { queueCraft, cancelAllCrafts, cancelCraftAt } from "./craftQueue.js";
import { placeCampfire } from "./campfire.js";
import { createBuildingSystem } from "./buildingSystem.js";
import { runInventoryTransaction } from "./inventoryTransaction.js";

export function createWsHandlers({ application, wsHub, spearSystem, deathSystem, clanSystem }) {
  const buildingSystem = createBuildingSystem({ cellsList: application.cellsList, players: application.playersList.list, clanSystem });


  function broadcastCampfireState(wsHub, players, cell) {
    const data = { indexX: cell.indexX, indexY: cell.indexY, campfire: cell.campfire ? cell.campfire.serialize() : null };
    for (const player of players) {
      if (!player.inGame) continue;
      const dist = Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y);
      if (dist < settings.CAMPFIRE_NORMAL.radius + settings.CELL_SIDE_LENGTH_PIXEL * 2) wsHub.sendToClientId(player.id, "campfireState", data);
    }
  }

  function broadcastWorkbenchState(wsHub, players, cell) {
    const data = { indexX: cell.indexX, indexY: cell.indexY, workbench: cell.workbench ? cell.workbench.serialize() : null };
    for (const player of players) {
      if (!player.inGame) continue;
      const dist = Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y);
      if (dist < (settings.WORKBENCH?.radius ?? 200) + settings.CELL_SIDE_LENGTH_PIXEL * 2) wsHub.sendToClientId(player.id, "workbenchState", data);
    }
  }

function findPlayer(clientId) {
  return application.playersList.findById(clientId);
}

function normalizeNick(rawName) {
  return (rawName || "").trim().slice(0, settings.NICK_MAX_LENGTH);
}

function deliverChatHistory(clientId) {
  sendChatHistory(wsHub, clientId, application.chatHistory);
}

function sendInventory(clientId, player) {
  wsHub.sendToClientId(clientId, "inventoryUpdate", {
    inventory: sanitizeInventory(player.inventory),
  });
}

function sendSatiety(clientId, player) {
  wsHub.sendToClientId(clientId, "playerSatietyUpdate", {
    satiety: Math.round(player.satiety ?? settings.MAX_SATIETY),
    maxSatiety: player.maxSatiety ?? settings.MAX_SATIETY,
  });
}

function sendScore(clientId, player) {
  sendScoreUpdate(wsHub, player);
}

function sendLeaderboard(clientId) {
  wsHub.sendToClientId(clientId, "leaderboardUpdate", {
    entries: getLeaderboardEntries(application.playersList.list),
  });
}

function broadcastGroundItem(cell) {
  const items = serializeGroundItems(cell);
  notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
    groundItems: items,
    groundItem: items[0] ?? null,
  });
}

function isPlayerLootBusy(player) {
  return performance.now() < (player.lootBusyUntil ?? 0);
}

function deliverStationItemOrDrop({ player, stationCell, itemId, amount }) {
  if (!player || !stationCell || !itemId || !Number.isFinite(amount) || amount <= 0) return 0;

  const total = Math.max(0, Math.floor(amount));
  if (total <= 0) return 0;

  const added = addItemToInventory(player.inventory, itemId, total);
  const remaining = total - added;

  if (remaining > 0) {
    const cx = stationCell.x + stationCell.w / 2;
    const cy = stationCell.y + stationCell.h / 2;
    const radius = Math.max(90, settings.CELL_SIDE_LENGTH_PIXEL * 0.7);
    const attempts = 32;
    let placed = 0;

    for (let i = 0; i < attempts && placed < remaining; i++) {
      const angle = (Math.PI * 2 * i) / attempts;
      const jitter = 1 + ((i % 3) - 1) * 0.12;
      const x = cx + Math.cos(angle) * radius * jitter;
      const y = cy + Math.sin(angle) * radius * jitter;
      const targetCell = application.cellsList.getCellAtWorld(x, y);
      if (!targetCell) continue;

      // Never put the dropped result back inside the station's own cell.
      if (targetCell.indexX === stationCell.indexX && targetCell.indexY === stationCell.indexY) continue;

      const placedLoot = placeItemOnGround(targetCell, itemId, remaining - placed, {
        allowStack: true,
        x,
        y,
        pickableDelayMs: 0,
      });
      if (!placedLoot) continue;

      placed = remaining;
      broadcastGroundItem(targetCell);
    }

    // Extremely unusual fallback: place in the nearest valid ground cell.
    if (placed < remaining) {
      const fallback = application.cellsList.getCellAtWorld(
        stationCell.x - settings.CELL_SIDE_LENGTH_PIXEL * 0.75,
        stationCell.y - settings.CELL_SIDE_LENGTH_PIXEL * 0.75
      );
      if (fallback && fallback !== stationCell) {
        const loot = placeItemOnGround(fallback, itemId, remaining - placed, {
          allowStack: true,
          x: fallback.x + fallback.w / 2,
          y: fallback.y + fallback.h / 2,
          pickableDelayMs: 0,
        });
        if (loot) {
          placed = remaining;
          broadcastGroundItem(fallback);
        }
      }
    }
  }

  return added;
}

function lockPlayerPickup(player) {
  const until = performance.now() + (settings.PICKUP_COOLDOWN_MS ?? 50);
  if (until > (player.lootBusyUntil ?? 0)) {
    player.lootBusyUntil = until;
  }
}

function tryPickupGroundItem(player) {
  if (isPlayerLootBusy(player)) return;

  const found = findNearestGroundItem(application.cellsList, player.x, player.y, player.interactionRadius ?? settings.INTERACTION_RADIUS);
  if (!found?.loot?.itemId) return;

  const { cell, loot } = found;
  const itemId = loot.itemId;
  const amount = loot.amount || 1;
  const free = getFreeSpaceForItem(player.inventory, itemId);
  if (free <= 0) return;

  const added = addItemToInventory(player.inventory, itemId, amount);
  if (added <= 0) return;

  const fromX = loot.x ?? cell.x + cell.w / 2;
  const fromY = loot.y ?? cell.y + cell.h / 2;

  if (added >= amount) {
    clearGroundItem(cell, loot.id);
  } else {
    loot.amount = amount - added;
  }
  broadcastGroundItem(cell);
  lockPlayerPickup(player);

  sendToViewersIncludingSelf(wsHub, application.playersList.list, player, "resourceCollect", {
    itemId,
    amount: added,
    fromX,
    fromY,
    playerId: player.id,
  });
  sendInventory(player.id, player);
}

function tryDropInventorySlot(player, slotIndex, dirX, dirY) {
  const taken = takeInventorySlot(player.inventory, slotIndex);
  if (!taken) return false;

  if (taken.itemId === 'spear' && player.heldItemId === 'spear' && player.heldSlotIndex === slotIndex) {
    spearSystem.onInventoryDrop(player);
  }

  const radius = player.interactionRadius ?? settings.INTERACTION_RADIUS ?? 200;
  const placement = findDropPlacement(application.cellsList, player.x, player.y, dirX, dirY, radius);
  const placed = placement && placeItemOnGround(placement.cell, taken.itemId, taken.amount, {
    allowStack: false,
    x: placement.x,
    y: placement.y,
    pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
  });
  if (!placement || !placed) {
    player.inventory[slotIndex] = taken;
    return false;
  }

  broadcastGroundItem(placement.cell);
  sendInventory(player.id, player);

  sendToViewersIncludingSelf(wsHub, application.playersList.list, player, "resourceDrop", {
    itemId: taken.itemId,
    amount: taken.amount,
    fromX: player.x,
    fromY: player.y,
    toX: placement.x,
    toY: placement.y,
    indexX: placement.cell.indexX,
    indexY: placement.cell.indexY,
    lootId: placed.id,
    playerId: player.id,
  });
  return true;
}


function getBuildCell(player, data) {
  const indexX = Number(data.indexX);
  const indexY = Number(data.indexY);
  if (!Number.isInteger(indexX) || !Number.isInteger(indexY)) return null;
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell) return null;

  const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
  const playerXCell = Math.floor(player.x / cellSize) + 1;
  const playerYCell = Math.floor(player.y / cellSize) + 1;
  if (!isCellAdjacentToPlayer(cell, playerXCell, playerYCell)) return null;
  return cell;
}

function hasHeldBuildItem(player, itemId) {
  const slot = player.inventory[player.heldSlotIndex];
  if (slot?.itemId === itemId && slot.amount > 0) return true;
  return countItemInInventory(player.inventory, itemId) > 0;
}

function consumeHeldBuildItem(player, itemId) {
  const slot = player.inventory[player.heldSlotIndex];
  if (slot?.itemId === itemId && slot.amount > 0) {
    return removeAmountFromSlot(player.inventory, player.heldSlotIndex, 1) > 0;
  }
  return removeItemFromInventory(player.inventory, itemId, 1) > 0;
}

function handleBuildRequest(player, data) {
  const result = buildingSystem.place(player, data);
  if (!result.ok) return false;

  syncPlayerHoldFromInventory(wsHub, application.playersList.list, player);
  sendInventory(player.id, player);

  if (result.kind === "campfire") {
    broadcastCampfireState(wsHub, application.playersList.list, result.cell);
  } else if (result.kind === "workbench") {
    broadcastWorkbenchState(wsHub, application.playersList.list, result.cell);
  } else if (result.kind === "sapling") {
    broadcastSaplingUpdate(wsHub, result.cell);
  } else if (result.kind === "building") {
    notifyCellSubscribers(wsHub, result.cell, "buildingState", { indexX:result.cell.indexX, indexY:result.cell.indexY, building:result.object.serialize() });
  }
  return true;
}

wsHub.onConnection((ws, type, data) => {
  if (type === "connect") {
    wsHub.send(ws, "sendSettings", {
      settings,
      natureImages: { ...getNatureClientManifest(), ...getSaplingClientManifest() },
      natureCatalog: getNatureClientCatalog(),
      itemImages: getItemClientManifest(),
      toolCatalog: getToolClientCatalog(),
      dayNight: getDayNightState(),
      crafts: getCraftClientCatalog(),
      clan: { maxClans: 9, maxMembers: 9 },
      craftLayout: CRAFTBOX_LAYOUT,
    });
    console.log(ws.clientId + " Успешно подключился");
    return;
  }

  if (type === "disconnect") {
    console.log(ws.clientId + " Успешно отключился");
    const disconnectedId = ws.clientId;
    const disconnectedPlayer = findPlayer(disconnectedId);
    if (disconnectedPlayer && clanSystem) clanSystem.onOwnerGone(disconnectedPlayer);
    if (disconnectedPlayer) application.cellsList.unsubscribePlayer?.(disconnectedId, disconnectedPlayer.visibleCells);
    notifyDisconnect(wsHub, application.playersList.list, disconnectedId);
    const index = application.playersList.list.findIndex((player) => player.id === disconnectedId);
    if (index !== -1) {
      application.playersList.list.splice(index, 1);
    }
    broadcastLeaderboard(wsHub, application.playersList.list);
    return;
  }

  if (type === "tryConnectGame") {
    const name = normalizeNick(data.name);
    const existing = findPlayer(ws.clientId);

    if (existing && existing.isAlive && existing.inGame) {
      wsHub.send(ws, "successToConnectGame", {});
      deliverChatHistory(ws.clientId);
      sendInventory(ws.clientId, existing);
      sendSatiety(ws.clientId, existing);
      sendTemperature(wsHub, existing);
      sendEnergy(wsHub, existing);
      sendScore(ws.clientId, existing);
      sendLeaderboard(ws.clientId);
      clanSystem?.sendState(existing);
      wsHub.send(ws, "dayNightUpdate", getDayNightState());
      return;
    }

    if (existing) {
      existing.name = name;
      existing.respawn(application.cellsList);
      wsHub.send(ws, "successToConnectGame", {});
      deliverChatHistory(ws.clientId);
      const visibleCells = stampGroundItemsForNetwork(application.cellsList.getVisibleCells(existing.x, existing.y, ws.clientId, application.playersList));
      setupJoinVisibility(wsHub, application.playersList.list, existing, visibleCells);
      sendInventory(ws.clientId, existing);
      sendSatiety(ws.clientId, existing);
      sendTemperature(wsHub, existing);
      sendEnergy(wsHub, existing);
      sendScore(ws.clientId, existing);
      sendLeaderboard(ws.clientId);
      clanSystem?.sendState(existing);
      wsHub.send(ws, "dayNightUpdate", getDayNightState());
      return;
    }

    wsHub.send(ws, "successToConnectGame", {});
    application.playersList.addPlayer(name, ws.clientId, application.cellsList);
    deliverChatHistory(ws.clientId);
    const joiningPlayer = findPlayer(ws.clientId);
    if (!joiningPlayer) return;
    const visibleCells = stampGroundItemsForNetwork(application.cellsList.getVisibleCells(joiningPlayer.x, joiningPlayer.y, ws.clientId, application.playersList));
    setupJoinVisibility(wsHub, application.playersList.list, joiningPlayer, visibleCells);
    sendInventory(ws.clientId, joiningPlayer);
    sendSatiety(ws.clientId, joiningPlayer);
    sendTemperature(wsHub, joiningPlayer);
    sendEnergy(wsHub, joiningPlayer);
    sendScore(ws.clientId, joiningPlayer);
    sendLeaderboard(ws.clientId);
    clanSystem?.sendState(joiningPlayer);
    wsHub.send(ws, "dayNightUpdate", getDayNightState());
    return;
  }

  if (type === "clanCreate") { const p=findPlayer(ws.clientId); if(p&&p.inGame&&p.isAlive) clanSystem?.create(p,data.name); return; }
  if (type === "clanRequest") { const p=findPlayer(ws.clientId); if(p&&p.inGame&&p.isAlive) clanSystem?.request(p,data.clanId); return; }
  if (type === "clanLeave" || type === "clanDelete") { const p=findPlayer(ws.clientId); if(p&&p.inGame&&p.isAlive) clanSystem?.leave(p); return; }
  if (type === "clanKick") { const p=findPlayer(ws.clientId); if(p&&p.inGame&&p.isAlive) clanSystem?.kick(p,data.memberId); return; }
  if (type === "clanAccept" || type === "clanReject") { const p=findPlayer(ws.clientId); if(p&&p.inGame&&p.isAlive) clanSystem?.decide(p,type==="clanAccept"); return; }

  if (type === "sendMovement") {
    const sourcePlayer = findPlayer(ws.clientId);
    if (!sourcePlayer || !sourcePlayer.isAlive || !sourcePlayer.inGame) return;
    chooseVectorToAdd(data.movement, ws.clientId, application);
    sendVectorsToViewers(wsHub, application.playersList.list, sourcePlayer);
    return;
  }

  if (type === "deleteMovement") {
    const sourcePlayer = findPlayer(ws.clientId);
    if (!sourcePlayer || !sourcePlayer.isAlive || !sourcePlayer.inGame) return;
    chooseVectorToDelete(data.movement, ws.clientId, application);
    sendVectorsToViewers(wsHub, application.playersList.list, sourcePlayer);
    return;
  }

  if (type === "getVisibleCells") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const visibleCells = stampGroundItemsForNetwork(application.cellsList.getVisibleCells(player.x, player.y, ws.clientId, application.playersList));
    wsHub.send(ws, "sendVisibleCells", {
      visibleCells,
      indexPlayerXCell: application.playersList.getIndexPlayerXCell(ws.clientId),
      indexPlayerYCell: application.playersList.getIndexPlayerYCell(ws.clientId),
      id: ws.clientId,
    });
    return;
  }

  if (type === "sendAngle") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    player.angle = data.angle;
    sendToViewers(wsHub, application.playersList.list, player, "sendMouseCoordinatesToClient", { angle: data.angle, id: ws.clientId });
    return;
  }

  if (type === "startAttack") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    if (player.heldItemId) {
      const heldDef = getItemDef(player.heldItemId);
      if (heldDef?.canBuild) return;
      if (heldDef?.edible) { beginEatHeldItem(wsHub, application.playersList.list, player); return; }
    }
    const now = performance.now();
    if (player.isAttacking && now - player.attackStartTime < (player.attackDurationMs ?? settings.ATTACK_DURATION_MS)) return;
    const heldDef = getItemDef(player.heldItemId);
    const tool = heldDef?.toolType || "hand";
    const profile = getToolProfile(tool);
    const energyCost = profile?.energy ?? settings.HAND_ATTACK_ENERGY;
    if ((player.energy ?? settings.MAX_ENERGY) < energyCost) return;
    player.energy = Math.max(0, (player.energy ?? settings.MAX_ENERGY) - energyCost);
    player.energyRegenReadyAt = now + (settings.ENERGY_REGEN_DELAY_MS ?? 7000);
    player.attackDurationMs = profile?.durationMs ?? settings.ATTACK_DURATION_MS;
    player.attackTool = tool;
    player.isAttacking = true;
    player.attackStartTime = now;
    player.attackX = player.x;
    player.attackY = player.y;
    player.attackAngle = player.angle;
    player.attackHitResolved = true;
    {
      applyAttackHits(wsHub, application.playersList.list, application.cellsList, player, deathSystem.handlePlayerDeath);
    }
    sendEnergy(wsHub, player);
    sendToViewersIncludingSelf(wsHub, application.playersList.list, player, "playerAttack", { id: ws.clientId, startedAt: player.attackStartTime, tool, durationMs: player.attackDurationMs });
    return;
  }

  if (type === "toggleDoor") {
    const player=findPlayer(ws.clientId); if(!player||!player.inGame||!player.isAlive)return;
    const result=buildingSystem.toggleDoor(player,data);
    if(result.ok) notifyCellSubscribers(wsHub,result.cell,"buildingState",{indexX:result.cell.indexX,indexY:result.cell.indexY,building:result.cell.building.serialize()});
    return;
  }

  if (type === "placeBuildable") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    handleBuildRequest(player, data);
    return;
  }

  if (type === "holdItem") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const slotIndex = Number(data.slotIndex);
    const held = tryHoldItem(wsHub, application.playersList.list, player, slotIndex);
    if (held && player.heldItemId === 'spear') spearSystem.onHoldItem(player);
    return;
  }

  if (type === "clearHold") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    cancelEatHeldItem(wsHub, application.playersList.list, player);
    spearSystem.onClearHold(player);
    clearPlayerHold(wsHub, application.playersList.list, player);
    return;
  }

  if (type === "finishEat") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    finishEatHeldItem(wsHub, application.playersList.list, player);
    return;
  }

  if (type === "cancelEat") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    cancelEatHeldItem(wsHub, application.playersList.list, player);
    return;
  }

  if (type === "start_spear_windup") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    spearSystem.startWindup(player);
    return;
  }

  if (type === "cancel_spear_windup") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    spearSystem.cancelWindup(player);
    return;
  }

  if (type === "throw_spear") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    spearSystem.throw(player, data);
    return;
  }

  if (type === "pickupItem") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    // A station panel locks interaction with ground loot until the panel is closed.
    if (player._activeCampfire || player._activeWorkbench) return;
    tryPickupGroundItem(player);
    return;
  }

  if (type === "inventoryMove") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const from = Number(data.from);
    const to = Number(data.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    if (moveInventorySlot(player.inventory, from, to)) {
      if (player.heldSlotIndex === from) player.heldSlotIndex = to;
      else if (player.heldSlotIndex === to) player.heldSlotIndex = from;
      syncPlayerHoldFromInventory(wsHub, application.playersList.list, player);
      sendInventory(player.id, player);
    }
    return;
  }

  if (type === "inventorySplit") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const slotIndex = Number(data.slotIndex);
    if (!Number.isInteger(slotIndex)) return;
    if (splitInventoryStack(player.inventory, slotIndex)) {
      syncPlayerHoldFromInventory(wsHub, application.playersList.list, player);
      sendInventory(player.id, player);
    }
    return;
  }

  if (type === "inventoryDrop") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const slotIndex = Number(data.slotIndex);
    if (!Number.isInteger(slotIndex)) return;
    tryDropInventorySlot(player, slotIndex, data.dirX, data.dirY);
    syncPlayerHoldFromInventory(wsHub, application.playersList.list, player);
    return;
  }

  if (type === "craftItem") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    queueCraft(wsHub, player, data.recipeId);
    return;
  }

  if (type === "cancelCraft") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    if (data.index != null) {
      cancelCraftAt(wsHub, player, Number(data.index), application.cellsList);
    } else {
      cancelAllCrafts(wsHub, player, application.cellsList);
    }
    return;
  }

  if (type === "sendChat") {
    const player = findPlayer(ws.clientId);
    if (!player || !player.inGame || !player.isAlive) return;
    const text = (data.text || "").trim().slice(0, settings.CHAT_MESSAGE_MAX_LENGTH);
    if (!text) return;
    const message = application.chatHistory.add(player.name, text, player.id);
    broadcastChatMessage(wsHub, application.playersList.list, message);
    return;
  }

// === НОВЫЕ ОБРАБОТЧИКИ ДЛЯ КОСТРОВ ===
if (type === "openCampfire") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX);
  const indexY = Number(data.indexY);
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell || !cell.campfire) return;
  const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
  const dist = Math.hypot(cx - player.x, cy - player.y);
  if (dist > settings.CAMPFIRE_NORMAL.radius) return;
  wsHub.sendToClientId(player.id, "campfireState", {
    indexX, indexY,
    campfire: cell.campfire.serialize(),
  });
  player._activeCampfire = { cell, indexX, indexY };
  return;
}

if (type === "closeCampfire") {
  const player = findPlayer(ws.clientId);
  if (player) player._activeCampfire = null;
  return;
}

if (type === "closeWorkbench") {
  const player = findPlayer(ws.clientId);
  if (player) player._activeWorkbench = null;
  return;
}

if (type === "openWorkbench") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX), indexY = Number(data.indexY);
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell?.workbench) return;
  const dist = Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y);
  if (dist > (settings.WORKBENCH?.radius ?? 200)) return;
  wsHub.sendToClientId(player.id, "workbenchState", { indexX, indexY, workbench: cell.workbench.serialize() });
  player._activeWorkbench = { cell, indexX, indexY };
  return;
}

if (type === "workbenchCraft") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX), indexY = Number(data.indexY), recipeId = data.recipeId;
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell?.workbench) return;
  if (Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y) > (settings.WORKBENCH?.radius ?? 200)) return;
  const recipe = getCraftRecipe(recipeId);
  if (!recipe || !isRecipeForStation(recipe, "workbench")) return;
  const wb = cell.workbench;
  if (wb.craftQueue.length >= (settings.WORKBENCH?.craftQueueMax ?? 4)) return;
  const tx = runInventoryTransaction(player.inventory, () => {
    for (const ing of recipe.ingredients) if (countItemInInventory(player.inventory, ing.itemId) < ing.amount) return false;
    for (const ing of recipe.ingredients) if (removeItemFromInventory(player.inventory, ing.itemId, ing.amount) !== ing.amount) return false;
    if (!wb.enqueueCraft(recipeId, performance.now())) return false;
    return true;
  });
  if (!tx.ok) return;
  broadcastWorkbenchState(wsHub, application.playersList.list, cell);
  wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
  return;
}

if (type === "cancelWorkbenchCraft" || type === "takeWorkbenchItem") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX), indexY = Number(data.indexY), index = Number(data.index);
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell?.workbench || !Number.isInteger(index)) return;
  if (Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y) > (settings.WORKBENCH?.radius ?? 200)) return;
  const wb = cell.workbench;
  if (type === "cancelWorkbenchCraft") {
    const job = wb.cancelCraft(index);
    if (!job) return;
    const recipe = getCraftRecipe(job.recipeId);
    if (recipe) {
      for (const ing of recipe.ingredients) {
        const added = addItemToInventory(player.inventory, ing.itemId, ing.amount);
        if (added < ing.amount) {
          placeItemOnGround(cell, ing.itemId, ing.amount - added, { x: cell.x + cell.w/2, y: cell.y + cell.h/2, pickableDelayMs: 0 });
        }
      }
      broadcastGroundItem(cell);
    }
  } else {
    const item = wb.takeCraftResult(index);
    if (!item) return;

    // A finished build/door is a normal workbench result. Never delete it when
    // the player's inventory is full: the unavailable remainder is materialized
    // on the ground in the workbench cell.
    deliverStationItemOrDrop({
      player,
      stationCell: cell,
      itemId: item.itemId,
      amount: item.amount,
    });
  }
  broadcastWorkbenchState(wsHub, application.playersList.list, cell);
  wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
  return;
}

if (type === "addFuel") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX);
  const indexY = Number(data.indexY);
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell || !cell.campfire) return;
  const cf = cell.campfire;
  const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
  const dist = Math.hypot(cx - player.x, cy - player.y);
  if (dist > settings.CAMPFIRE_NORMAL.radius) return;

  const capacity = Math.max(0, cf.fuelMax - cf.fuel);
  const amount = Math.min(10, countItemInInventory(player.inventory, "wood"), capacity);
  if (amount <= 0) return;
  const removed = removeItemFromInventory(player.inventory, "wood", amount);
  if (removed === 0) return;
  cf.addFuel(removed);
  broadcastCampfireState(wsHub, application.playersList.list, cell);
  wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
  return;
}

if (type === "campfireCraft") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX);
  const indexY = Number(data.indexY);
  const recipeId = data.recipeId;
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell || !cell.campfire) return;
  const cf = cell.campfire;
  const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
  const dist = Math.hypot(cx - player.x, cy - player.y);
  if (dist > settings.CAMPFIRE_NORMAL.radius) return;

  const recipe = getCraftRecipe(recipeId);
  if (!recipe || !cf.isRecipeAllowed(recipeId)) return;
  if (cf.craftQueue.length >= settings.CAMPFIRE_CRAFT_QUEUE_MAX) return;
  if (!cf.isBurning) return;
  const tx = runInventoryTransaction(player.inventory, () => {
    for (const ing of recipe.ingredients) if (countItemInInventory(player.inventory, ing.itemId) < ing.amount) return false;
    for (const ing of recipe.ingredients) if (removeItemFromInventory(player.inventory, ing.itemId, ing.amount) !== ing.amount) return false;
    if (!cf.enqueueCraft(recipeId, performance.now())) return false;
    return true;
  });
  if (!tx.ok) return;
  broadcastCampfireState(wsHub, application.playersList.list, cell);
  wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
  return;
}

if (type === "cancelCampfireCraft" || type === "takeCampfireItem") {
  const player = findPlayer(ws.clientId);
  if (!player || !player.inGame || !player.isAlive) return;
  const indexX = Number(data.indexX);
  const indexY = Number(data.indexY);
  const index = Number(data.index);
  const cell = application.cellsList.grid[indexX]?.[indexY];
  if (!cell || !cell.campfire || !Number.isInteger(index)) return;
  const cf = cell.campfire;
  const cx = cell.x + cell.w/2, cy = cell.y + cell.h/2;
  const dist = Math.hypot(cx - player.x, cy - player.y);
  if (dist > settings.CAMPFIRE_NORMAL.radius) return;

  if (type === "cancelCampfireCraft") {
    const job = cf.cancelCraft(index);
    if (!job) return;
    const recipe = getCraftRecipe(job.recipeId);
    if (recipe) {
      for (const ing of recipe.ingredients) {
        const added = addItemToInventory(player.inventory, ing.itemId, ing.amount);
        if (added < ing.amount) {
          const dropX = cx + (Math.random() - 0.5) * 60;
          const dropY = cy + (Math.random() - 0.5) * 60;
          const targetCell = application.cellsList.getCellAtWorld(dropX, dropY);
          if (targetCell) {
            placeItemOnGround(targetCell, ing.itemId, ing.amount - added, { x: dropX, y: dropY, pickableDelayMs: 0 });
            const items = serializeGroundItems(targetCell);
            notifyCellSubscribers(wsHub, targetCell, "groundItemUpdate", {
              indexX: targetCell.indexX,
              indexY: targetCell.indexY,
              groundItems: items,
              groundItem: items[0] ?? null,
            });
          }
        }
      }
    }
    broadcastCampfireState(wsHub, application.playersList.list, cell);
    wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
    return;
  }

  const item = cf.takeCraftResult(index);
  if (!item) return;
  deliverStationItemOrDrop({
    player,
    stationCell: cell,
    itemId: item.itemId,
    amount: item.amount,
  });
  broadcastCampfireState(wsHub, application.playersList.list, cell);
  wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) });
  return;
}
});


}