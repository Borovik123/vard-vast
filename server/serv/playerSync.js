import settings from "./settings.js";
import {
  resolveAttackHit,
  resolveNatureAttackHit,
  resolveSaplingAttackTargets,
  getAttackSnapshot
} from "./combat.js";
import { sanitizePlayer, getActivePlayers } from "./players.js";
import {
  isPlayerVisibleTo,
  buildPlayerSpatialIndex,
  getNearbyPlayerCandidates,
} from "./visibility.js";
import {
  rollHarvestDropForNature,
  rollHarvestAmount,
  addItemToInventory,
  sanitizeInventory,
  removeAmountFromSlot,
  removeItemFromInventory,
  countItemInInventory,
  getItemDef,
  getToolProfile,
  getFreeSpaceForItem
} from "./items.js";
import { placeItemOnGround, serializeGroundItems } from "./groundItems.js";
import { getBuildingDef } from "./buildings.js";
import { scoreForHarvest, addPlayerScore, addHarvestScore, resetPlayerScore, broadcastLeaderboard, awardKillScore } from "./leaderboard.js";
import {
  isSaplingFullyGrown,
  damageSapling,
  resetSaplingGrowth,
  getSaplingDef,
  serializeSapling,
  clearSapling,
} from "./saplings.js";
import { getDayNightState } from "./dayNight.js";
import { getCampfireOnCell, removeCampfire } from "./campfire.js";
import { removeWorkbench } from "./workbench.js";

// ---- ЭНЕРГИЯ ----
export function sendEnergy(wsHub, player) {
  if (!player) return;
  const maxEnergy = player.maxEnergy ?? settings.MAX_ENERGY ?? 300;
  const value = Math.max(0, Math.min(maxEnergy, Number(player.energy ?? maxEnergy)));
  player.energy = value;
  player.maxEnergy = maxEnergy;
  wsHub.sendToClientId(player.id, "energyUpdate", { energy: value, maxEnergy, sprinting: !!player.sprinting });
}

export function processEnergy(wsHub, players, deltaTime) {
  const now = performance.now();
  const dtSec = Math.max(0, Number(deltaTime) || 0);
  const maxEnergy = settings.MAX_ENERGY ?? 300;
  const regenPerSec = settings.ENERGY_REGEN_PER_SEC ?? 20;

  for (const player of players ?? []) {
    if (!player.inGame) continue;
    player.maxEnergy = maxEnergy;
    if (player.energy == null) player.energy = maxEnergy;
    if (player.energyRegenReadyAt == null) player.energyRegenReadyAt = 0;

    if (player._energyDirty) {
      const shouldSend =
        !player._lastEnergySentAt ||
        now - player._lastEnergySentAt >= 100 ||
        !player.sprinting ||
        player.energy <= 0;
      if (shouldSend) {
        player._energyDirty = false;
        player._lastEnergySentAt = now;
        sendEnergy(wsHub, player);
      }
    }

    if (player.energy <= 0 && player.sprinting) {
      player.sprinting = false;
      player._energyDirty = true;
    }

    if (player.energy < maxEnergy && now >= player.energyRegenReadyAt) {
      const old = player.energy;
      player.energy = Math.min(maxEnergy, player.energy + regenPerSec * dtSec);
      if (Math.abs(player.energy - old) > 0.001 && (!player._lastEnergySentAt || now - player._lastEnergySentAt >= 100)) {
        player._lastEnergySentAt = now;
        sendEnergy(wsHub, player);
      }
    }
  }
}

// ---- ТЕМПЕРАТУРА ----
export function updatePlayerTemperature(player, cellsList, now, wsHub, players, onDeath = null) {
  const state = getDayNightState();
  const isNight = state.isNight;
  const delta = 0.1;
  let tempChange = 0;
  if (isNight) {
    tempChange = -settings.TEMPERATURE_DROP_NIGHT * delta;
  } else {
    tempChange = settings.TEMPERATURE_GAIN_DAY * delta;
  }

  const heatRadius = settings.CAMPFIRE_NORMAL.heatRadius ?? 300;
  const nearbyCells = cellsList.getNearbyCells(player.x, player.y, heatRadius);
  let heatBonus = 0;
  for (const cell of nearbyCells) {
    const cf = cell.campfire;
    if (!cf || !cf.isBurning) continue;

    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    if (Math.hypot(player.x - cx, player.y - cy) > heatRadius) continue;

    const def = cf.type === 'max' ? settings.CAMPFIRE_MAX : settings.CAMPFIRE_NORMAL;
    heatBonus += def.heatBonus;
  }
  tempChange += heatBonus * delta;

  const currentTemperature = player.temperature ?? settings.TEMPERATURE_MAX;
  player.temperature = Math.max(0, Math.min(
    settings.TEMPERATURE_MAX,
    currentTemperature + tempChange
  ));

  if (player.temperature <= 0) {
    const oldHp = player.hp;
    player.hp = Math.max(0, player.hp - settings.TEMPERATURE_DAMAGE_PER_SEC * delta);
    player.lastDamageTime = now;

    if (player.hp !== oldHp) {
      sendToViewersIncludingSelf(wsHub, players, player, 'playerHpUpdate', {
        id: player.id,
        hp: Math.round(player.hp),
        x: player.x,
        y: player.y,
      });
    }

    if (player.hp <= 0) {
      onDeath?.(player, null);
    }
  }
}

export function sendTemperature(wsHub, player) {
  wsHub.sendToClientId(player.id, "temperatureUpdate", {
    temperature: Math.round(player.temperature ?? settings.TEMPERATURE_MAX),
    maxTemperature: settings.TEMPERATURE_MAX,
  });
}

// ---- СЫТОСТЬ ----
function sendSatiety(wsHub, player) {
  wsHub.sendToClientId(player.id, "playerSatietyUpdate", {
    satiety: Math.round(player.satiety ?? 0),
    maxSatiety: player.maxSatiety ?? settings.MAX_SATIETY,
  });
}

// ---- УДЕРЖИВАНИЕ ПРЕДМЕТОВ ----
function broadcastHoldState(wsHub, players, player) {
  sendToViewersIncludingSelf(wsHub, players, player, "playerHoldUpdate", {
    id: player.id,
    heldItemId: player.heldItemId ?? null,
    heldSlotIndex: player.heldSlotIndex ?? -1,
  });
}

export function clearPlayerHold(wsHub, players, player, sync = true) {
  if (!player) return;
  player.heldItemId = null;
  player.heldSlotIndex = -1;
  player.eatingFood = null;
  if (sync) broadcastHoldState(wsHub, players, player);
}

export function syncPlayerHoldFromInventory(wsHub, players, player) {
  if (!player?.heldItemId) return;
  const slot = player.inventory[player.heldSlotIndex];
  if (slot?.itemId === player.heldItemId && slot.amount > 0) return;

  const next = player.inventory.findIndex(
    (s) => s?.itemId === player.heldItemId && s.amount > 0
  );
  if (next !== -1) {
    player.heldSlotIndex = next;
    broadcastHoldState(wsHub, players, player);
    return;
  }

  clearPlayerHold(wsHub, players, player);
}

export function tryHoldItem(wsHub, players, player, slotIndex) {
  if (!player?.isAlive || !player.inGame) return false;
  if (!Number.isInteger(slotIndex)) return false;
  const slot = player.inventory[slotIndex];
  if (!slot) return false;
  const def = getItemDef(slot.itemId);
  if (!def?.edible && !def?.canBuild && !def?.canHold && def?.id !== 'spear') return false;

  player.heldItemId = slot.itemId;
  player.heldSlotIndex = slotIndex;
  broadcastHoldState(wsHub, players, player);
  return true;
}

// ---- ЕДА ----
export function beginEatHeldItem(wsHub, players, player) {
  if (!player?.isAlive || !player.inGame || !player.heldItemId) return false;
  if (player.eatingFood) return false;

  const def = getItemDef(player.heldItemId);
  if (!def?.edible) return false;

  const slot = player.inventory[player.heldSlotIndex];
  const hasInHeldSlot = slot?.itemId === player.heldItemId && slot.amount > 0;
  const hasAny = countItemInInventory(player.inventory, player.heldItemId) > 0;
  if (!hasInHeldSlot && !hasAny) {
    clearPlayerHold(wsHub, players, player);
    return false;
  }

  const durationMs = settings.EAT_FOOD_MS ?? 500;
  player.eatingFood = {
    itemId: player.heldItemId,
    startedAt: performance.now(),
    durationMs,
  };

  sendToViewersIncludingSelf(wsHub, players, player, "playerFoodEat", {
    id: player.id,
    itemId: def.id,
    durationMs,
  });
  return true;
}

export function finishEatHeldItem(wsHub, players, player) {
  if (!player?.isAlive || !player.inGame || !player.eatingFood) return false;

  const itemId = player.eatingFood.itemId;
  const def = getItemDef(itemId);
  player.eatingFood = null;
  if (!def?.edible) return false;

  let removed = 0;
  if (player.heldItemId === itemId) {
    const slot = player.inventory[player.heldSlotIndex];
    if (slot?.itemId === itemId) {
      removed = removeAmountFromSlot(player.inventory, player.heldSlotIndex, 1);
    }
  }
  if (removed <= 0) {
    removed = removeItemFromInventory(player.inventory, itemId, 1);
  }
  if (removed <= 0) {
    syncPlayerHoldFromInventory(wsHub, players, player);
    return false;
  }

  const restore = def.satietyRestore ?? settings.BERRY_SATIETY_RESTORE ?? 20;
  player.satiety = Math.min(
    player.maxSatiety ?? settings.MAX_SATIETY,
    (player.satiety ?? 0) + restore
  );

  const energyRestore = def.energyRestore ?? settings.FOOD_ENERGY_RESTORE ?? 20;
  player.energy = Math.min(
    player.maxEnergy ?? settings.MAX_ENERGY ?? 300,
    (player.energy ?? settings.MAX_ENERGY ?? 300) + energyRestore
  );
  player.energyRegenReadyAt = performance.now();
  sendEnergy(wsHub, player);

  syncPlayerHoldFromInventory(wsHub, players, player);
  sendSatiety(wsHub, player);
  wsHub.sendToClientId(player.id, "inventoryUpdate", {
    inventory: sanitizeInventory(player.inventory),
  });
  return true;
}

export function cancelEatHeldItem(wsHub, players, player) {
  if (!player?.eatingFood) return false;
  player.eatingFood = null;
  sendToViewersIncludingSelf(wsHub, players, player, "playerFoodEatCancel", {
    id: player.id,
  });
  return true;
}

// ---- ГОЛОД ----
export function processHunger(wsHub, players, deltaTime, onDeath = null) {
  const now = performance.now();
  const drain = settings.SATIETY_DRAIN_PER_SEC ?? 1;
  const starveDmg = settings.STARVE_HP_PER_SEC ?? 5;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player.isAlive || !player.inGame) continue;

    player.satiety = Math.max(0, (player.satiety ?? 0) - drain * deltaTime);

    if (player.satiety <= 0) {
      const oldHp = player.hp;
      player.hp = Math.max(0, player.hp - starveDmg * deltaTime);
      player.lastDamageTime = now;

      if (player.hp !== oldHp) {
        sendToViewersIncludingSelf(wsHub, players, player, "playerHpUpdate", {
          id: player.id,
          hp: Math.round(player.hp),
        });
      }

      if (player.hp <= 0) {
        onDeath?.(player, null);
        continue;
      }
    }

    if (!player._lastSatietySentAt || now - player._lastSatietySentAt >= 250) {
      player._lastSatietySentAt = now;
      sendSatiety(wsHub, player);
    }
  }
}

// ---- ВИДИМОСТЬ ----
export function syncPlayerVisibility(wsHub, players, cellsList = null) {
  const activePlayers = getActivePlayers(players);
  const spatialIndex = buildPlayerSpatialIndex(activePlayers);

  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame || !observer.isAlive) continue;

    const candidates = spatialIndex ? getNearbyPlayerCandidates(observer, spatialIndex) : activePlayers;
    for (let j = 0; j < candidates.length; j++) {
      const target = candidates[j];
      if (observer.id === target.id) continue;

      const isVisible = isPlayerVisibleTo(observer, target);
      const wasKnown = observer.knownPlayers.has(target.id);

      if (isVisible && !wasKnown) {
        observer.knownPlayers.add(target.id);
        wsHub.sendToClientId(observer.id, "sendPlayers", {
          player: sanitizePlayer(target),
        });
      }

      if (!isVisible && wasKnown) {
        observer.knownPlayers.delete(target.id);
        wsHub.sendToClientId(observer.id, "deletePlayer", {
          id: target.id,
        });
      }
    }
  }
}

export function sendPositionsToViewers(wsHub, players, payloadById, cellsList = null) {
  const spatialIndex = buildPlayerSpatialIndex(players);
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame || !observer.isAlive) continue;

    const visiblePositions = [];

    const candidates = getNearbyPlayerCandidates(observer, spatialIndex);
    for (let j = 0; j < candidates.length; j++) {
      const target = candidates[j];
      if (!target.isAlive || !target.inGame) continue;
      if (!isPlayerVisibleTo(observer, target)) continue;

      const position = payloadById.get(target.id);
      if (position) visiblePositions.push(position);
    }

    if (visiblePositions.length > 0) {
      wsHub.sendToClientId(observer.id, "sendPositions", {
        players: visiblePositions,
      });
    }
  }
}

export function sendVectorsToViewers(wsHub, players, sourcePlayer) {
  if (!sourcePlayer.isAlive || !sourcePlayer.inGame) return;

  const spatialIndex = buildPlayerSpatialIndex(players);
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame || !observer.isAlive) continue;
    if (!isPlayerVisibleTo(observer, sourcePlayer)) continue;

    const visiblePlayers = getNearbyPlayerCandidates(observer, spatialIndex)
      .filter((target) => isPlayerVisibleTo(observer, target))
      .map(sanitizePlayer);

    wsHub.sendToClientId(observer.id, "sendVectors", { players: visiblePlayers });
  }
}

export function sendToViewers(wsHub, players, sourcePlayer, type, data, skipObserverId = null) {
  if (!sourcePlayer.isAlive || !sourcePlayer.inGame) return;

  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (skipObserverId && observer.id === skipObserverId) continue;
    if (!observer.inGame || !observer.isAlive) continue;
    if (!isPlayerVisibleTo(observer, sourcePlayer)) continue;
    wsHub.sendToClientId(observer.id, type, data);
  }
}

export function sendToViewersIncludingSelf(
  wsHub,
  players,
  sourcePlayer,
  type,
  data
) {
  wsHub.sendToClientId(sourcePlayer.id, type, data);
  sendToViewers(wsHub, players, sourcePlayer, type, data, sourcePlayer.id);
}

export function broadcastPlayerVisual(wsHub, players, sourcePlayer, type, data) {
  if (!sourcePlayer.inGame || !sourcePlayer.isAlive) return;

  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame) continue;
    if (
      observer.id === sourcePlayer.id ||
      (observer.isAlive && isPlayerVisibleTo(observer, sourcePlayer))
    ) {
      wsHub.sendToClientId(observer.id, type, data);
    }
  }
}

// ---- АЛЕРТЫ ----
function getAlertTier(hp) {
  if (hp <= 70) return 2;
  if (hp <= 150) return 1;
  if (hp <= 230) return 0;
  return -1;
}

export function broadcastAlertIfNeeded(wsHub, players, player, oldHp) {
  const oldTier = getAlertTier(oldHp);
  const newTier = getAlertTier(player.hp);
  if (newTier > oldTier && newTier >= 0) {
    broadcastPlayerVisual(wsHub, players, player, "playerAlert", {
      id: player.id,
      tier: newTier,
    });
  }
}

// ---- УВЕДОМЛЕНИЕ КЛЕТОК ----
export function notifyCellSubscribers(wsHub, cell, type, data) {
  const payload = {
    indexX: cell.indexX,
    indexY: cell.indexY,
    ...data,
  };

  for (let i = 0; i < cell.subscribers.length; i++) {
    wsHub.sendToClientId(cell.subscribers[i], type, payload);
  }
}

// ---- ОТКЛЮЧЕНИЕ ----
export function notifyDisconnect(wsHub, players, disconnectedId) {
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (observer.knownPlayers.has(disconnectedId)) {
      observer.knownPlayers.delete(disconnectedId);
      wsHub.sendToClientId(observer.id, "deletePlayer", { id: disconnectedId });
    }
  }
}

export function removePlayerFromWorld(wsHub, players, deadPlayer) {
  deadPlayer.inGame = false;
  deadPlayer.isAlive = false;
  deadPlayer.vector = [];

  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (observer.knownPlayers.has(deadPlayer.id)) {
      observer.knownPlayers.delete(deadPlayer.id);
      wsHub.sendToClientId(observer.id, "deletePlayer", { id: deadPlayer.id });
    }
  }
}

// ---- ПРИСОЕДИНЕНИЕ ----
export function setupJoinVisibility(
  wsHub,
  players,
  joiningPlayer,
  visibleCells
) {
  joiningPlayer.knownPlayers = new Set([joiningPlayer.id]);

  wsHub.sendToClientId(joiningPlayer.id, "sendPlayers", {
    visibleCells,
    player: sanitizePlayer(joiningPlayer),
  });

  const activePlayers = getActivePlayers(players);

  for (let i = 0; i < activePlayers.length; i++) {
    const other = activePlayers[i];
    if (other.id === joiningPlayer.id) continue;

    if (isPlayerVisibleTo(joiningPlayer, other)) {
      joiningPlayer.knownPlayers.add(other.id);
      wsHub.sendToClientId(joiningPlayer.id, "sendPlayers", {
        player: sanitizePlayer(other),
      });
    }

    if (isPlayerVisibleTo(other, joiningPlayer)) {
      other.knownPlayers.add(joiningPlayer.id);
      wsHub.sendToClientId(other.id, "sendPlayers", {
        player: sanitizePlayer(joiningPlayer),
      });
    }
  }
}

// ---- ТРУПЫ ----
export function broadcastCorpse(wsHub, players, corpse) {
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame) continue;

    const corpsePoint = { x: corpse.x, y: corpse.y };
    if (isPlayerVisibleTo(observer, corpsePoint)) {
      wsHub.sendToClientId(observer.id, "spawnCorpse", {
        id: corpse.id,
        x: corpse.x,
        y: corpse.y,
        angle: corpse.angle,
      });
    }
  }
}

export function broadcastCorpseRemoved(wsHub, players, corpseId) {
  for (let i = 0; i < players.length; i++) {
    const observer = players[i];
    if (!observer.inGame) continue;
    wsHub.sendToClientId(observer.id, "removeCorpse", { id: corpseId });
  }
}

// ---- РЕГЕНЕРАЦИЯ ----
export function processRegen(wsHub, players, deltaTime) {
  const now = performance.now();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player.isAlive || !player.inGame || player.hp >= settings.MAX_HP) {
      continue;
    }

    if (now - player.lastDamageTime < settings.REGEN_DELAY_MS) {
      continue;
    }

    player.hp = Math.min(
      settings.MAX_HP,
      player.hp + settings.REGEN_HP_PER_SEC * deltaTime
    );

    if (now - player.lastRegenVisualTime >= settings.REGEN_VISUAL_INTERVAL_MS) {
      player.lastRegenVisualTime = now;
      broadcastPlayerVisual(wsHub, players, player, "playerHealVisual", {
        id: player.id,
      });
    }

    wsHub.sendToClientId(player.id, "playerHpUpdate", {
      id: player.id,
      hp: Math.round(player.hp),
    });
  }
}

// ---- АТАКИ ----
export function applyAttackHits(wsHub, players, cellsList, attacker, onDeath = null) {
  const hits = resolveAttackHit(attacker, players, cellsList);
  const natureHits = resolveNatureAttackHit(attacker, cellsList, players);
  const saplingCells = resolveSaplingAttackTargets(attacker, cellsList);

  for (let j = 0; j < hits.length; j++) {
    const { victim, oldHp, died } = hits[j];

    broadcastAlertIfNeeded(wsHub, players, victim, oldHp);
    broadcastPlayerVisual(wsHub, players, victim, "playerHurt", {
      id: victim.id,
    });

    sendToViewers(wsHub, players, victim, "playerHpUpdate", {
      id: victim.id,
      hp: victim.hp,
      x: victim.x,
      y: victim.y,
    });

    if (died) {
      onDeath?.(victim, attacker);
    }
  }

  for (let j = 0; j < natureHits.length; j++) {
    const {
      cell,
      destroyed,
      knockDx,
      knockDy,
      natureTypeBefore,
      campfireType,
      destroyedCampfire,
    } = natureHits[j];

    if (natureTypeBefore === "building") {
      notifyCellSubscribers(wsHub, cell, "buildingState", {
        indexX:cell.indexX,
        indexY:cell.indexY,
        building:destroyed ? null : cell.building?.serialize(),
        knockDx:natureHits[j].knockDx,
        knockDy:natureHits[j].knockDy,
        worldX:natureHits[j].hitX,
        worldY:natureHits[j].hitY,
        material:natureHits[j].buildingId?.startsWith("metal") ? "steel" : natureHits[j].buildingId?.startsWith("stone") ? "stone" : "tree",
        destroyed,
      });
      if (destroyed && natureHits[j].destroyedBuilding) {
        const def=getBuildingDef(natureHits[j].buildingId);
        if (def) {
          let dropCell=cell;
          if (natureHits[j].destroyedBuilding.kind === "door" && natureHits[j].destroyedBuilding.state === "open") {
            const dirs=[[-1,1],[-1,-1],[1,-1],[1,1]], d=dirs[natureHits[j].destroyedBuilding.rotation%4];
            dropCell=cellsList.grid[cell.indexX+d[0]]?.[cell.indexY+d[1]] ?? cell;
          }
          const x=dropCell.x+dropCell.w/2,y=dropCell.y+dropCell.h/2;
          const placed=placeItemOnGround(dropCell,def.drop.itemId,def.drop.amount,{x,y,allowStack:true,pickableDelayMs:settings.RESOURCE_DROP_ANIM_MS??640});
          if (placed) notifyCellSubscribers(wsHub,dropCell,"groundItemUpdate",{indexX:dropCell.indexX,indexY:dropCell.indexY,groundItems:serializeGroundItems(dropCell),groundItem:serializeGroundItems(dropCell)[0]??null});
        }
      }
      continue;
    }

    if (natureTypeBefore === "workbench") {
      notifyCellSubscribers(wsHub, cell, "workbenchHit", {
        indexX: cell.indexX,
        indexY: cell.indexY,
        hp: cell.workbench?.hp ?? 0,
        knockDx,
        knockDy,
        destroyed,
      });
      if (destroyed && natureHits[j].destroyedWorkbench) {
        dropWorkbenchDestructionLoot(wsHub, players, cell, attacker, natureHits[j].destroyedWorkbench);
      }
      continue;
    }

    notifyCellSubscribers(wsHub, cell, "natureObjectHit", {
      hp: cell.hp,
      knockDx,
      knockDy,
      destroyed,
      natureType: natureTypeBefore,
      campfireType: campfireType ?? null,
    });

    if (natureTypeBefore === "campfire") {
      if (destroyed && destroyedCampfire) dropCampfireDestructionLoot(wsHub, players, cell, attacker, destroyedCampfire);
      continue;
    }

    tryHarvestFromNatureHit(wsHub, players, attacker, cell, natureTypeBefore);
  }

  for (let j = 0; j < saplingCells.length; j++) {
    handleSaplingAttack(wsHub, players, cellsList, attacker, saplingCells[j]);
  }
}

// ---- САЖЕНЦЫ ----
export function broadcastSaplingUpdate(wsHub, cell) {
  notifyCellSubscribers(wsHub, cell, "saplingUpdate", {
    indexX: cell.indexX,
    indexY: cell.indexY,
    sapling: serializeSapling(cell),
  });
}

function giveBerriesFromSapling(wsHub, players, attacker, cell, berryItemId, amount) {
  const fromX = cell.x + cell.w / 2;
  const fromY = cell.y + cell.h / 2;
  const free = getFreeSpaceForItem(attacker.inventory, berryItemId);
  const toInv = Math.min(amount, Math.max(0, free));
  const toGround = amount - toInv;

  if (toInv > 0) {
    const added = addItemToInventory(attacker.inventory, berryItemId, toInv);
    if (added > 0) {
      addHarvestScore(attacker, berryItemId, added, wsHub);
      for (let i = 0; i < added; i++) {
        sendToViewersIncludingSelf(wsHub, players, attacker, "resourceCollect", {
          itemId: berryItemId,
          amount: 1,
          fromX,
          fromY,
          playerId: attacker.id,
          oneByOne: true,
        });
      }
      wsHub.sendToClientId(attacker.id, "inventoryUpdate", {
        inventory: sanitizeInventory(attacker.inventory),
      });
    }
  }

  if (toGround > 0) {
    placeItemOnGround(cell, berryItemId, toGround, {
      allowStack: true,
      x: fromX + (Math.random() - 0.5) * 40,
      y: fromY + (Math.random() - 0.5) * 40,
    });
    const items = serializeGroundItems(cell);
    notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
      indexX: cell.indexX,
      indexY: cell.indexY,
      groundItems: items,
      groundItem: items[0] ?? null,
    });
  }

  return { toInv, toGround };
}

function handleSaplingAttack(wsHub, players, cellsList, attacker, cell) {
  const sapling = cell.sapling;
  if (!sapling) return;
  const def = getSaplingDef(sapling.kind);
  if (!def) return;

  const source = getAttackSnapshot(attacker);

  if (isSaplingFullyGrown(sapling)) {
    const harvest = settings.SAPLING_HARVEST_AMOUNT ?? 3;
    giveBerriesFromSapling(
      wsHub,
      players,
      attacker,
      cell,
      def.berryItemId,
      harvest
    );
    resetSaplingGrowth(cell);
    broadcastSaplingUpdate(wsHub, cell);
    notifyCellSubscribers(wsHub, cell, "saplingHit", {
      indexX: cell.indexX,
      indexY: cell.indexY,
      knockDx: 0,
      knockDy: 0,
      destroyed: false,
      kind: sapling.kind,
      stage: 0,
      harvested: true,
    });
    return;
  }

  const result = damageSapling(
    cell,
    source.x,
    source.y,
    settings.ATTACK_DAMAGE
  );
  if (!result) return;

  notifyCellSubscribers(wsHub, cell, "saplingHit", {
    indexX: cell.indexX,
    indexY: cell.indexY,
    knockDx: result.knockDx,
    knockDy: result.knockDy,
    destroyed: result.destroyed,
    kind: result.kind,
    stage: cell.sapling?.stage ?? 0,
    harvested: false,
  });

  if (result.destroyed) {
    const fromX = cell.x + cell.w / 2;
    const fromY = cell.y + cell.h / 2;
    const dropX = fromX + (Math.random() - 0.5) * 55;
    const dropY = fromY + (Math.random() - 0.5) * 55;
    const placed = placeItemOnGround(cell, def.berryItemId, 1, {
      allowStack: false,
      x: dropX,
      y: dropY,
      pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
    });
    const items = serializeGroundItems(cell);
    notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
      indexX: cell.indexX,
      indexY: cell.indexY,
      groundItems: items,
      groundItem: items[0] ?? null,
    });
    if (placed) {
      sendToViewersIncludingSelf(wsHub, players, attacker, "resourceDrop", {
        itemId: def.berryItemId,
        amount: 1,
        fromX,
        fromY,
        toX: dropX,
        toY: dropY,
        indexX: cell.indexX,
        indexY: cell.indexY,
        lootId: placed.id,
        playerId: attacker.id,
      });
    }
  }

  broadcastSaplingUpdate(wsHub, cell);
}

function dropCampfireDestructionLoot(wsHub, players, cell, attacker, campfire) {
  const drops = campfire.getDestructionDrops?.() ?? [];
  if (!drops.length) return;

  const fromX = cell.x + cell.w / 2;
  const fromY = cell.y + cell.h / 2;
  const count = drops.length;

  for (let i = 0; i < count; i++) {
    const drop = drops[i];
    const angle = (Math.PI * 2 * i) / Math.max(1, count) + (Math.random() - 0.5) * 0.5;
    const distance = 35 + Math.random() * 30;
    const toX = fromX + Math.cos(angle) * distance;
    const toY = fromY + Math.sin(angle) * distance;
    const destinationCell = cell;
    const placed = placeItemOnGround(destinationCell, drop.itemId, drop.amount, {
      allowStack: true,
      x: toX,
      y: toY,
      pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
    });
    if (!placed) continue;

    const items = serializeGroundItems(destinationCell);
    notifyCellSubscribers(wsHub, destinationCell, "groundItemUpdate", {
      indexX: destinationCell.indexX,
      indexY: destinationCell.indexY,
      groundItems: items,
      groundItem: items[0] ?? null,
    });

    sendToViewersIncludingSelf(wsHub, players, attacker, "resourceDrop", {
      itemId: drop.itemId,
      amount: drop.amount,
      fromX,
      fromY,
      toX,
      toY,
      indexX: destinationCell.indexX,
      indexY: destinationCell.indexY,
      lootId: placed.id,
      playerId: attacker.id,
    });
  }
}

function dropWorkbenchDestructionLoot(wsHub, players, cell, attacker, workbench) {
  const drops = workbench?.getDestructionDrops?.() ?? [];
  const fromX = cell.x + cell.w / 2, fromY = cell.y + cell.h / 2;
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i];
    const angle = (Math.PI * 2 * i) / Math.max(1, drops.length) + (Math.random() - 0.5) * 0.5;
    const distance = 35 + Math.random() * 30;
    const toX = fromX + Math.cos(angle) * distance, toY = fromY + Math.sin(angle) * distance;
    const placed = placeItemOnGround(cell, drop.itemId, drop.amount, { x: toX, y: toY, allowStack: true, pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640 });
    if (!placed) continue;
    const items = serializeGroundItems(cell);
    notifyCellSubscribers(wsHub, cell, "groundItemUpdate", { indexX: cell.indexX, indexY: cell.indexY, groundItems: items, groundItem: items[0] ?? null });
    sendToViewersIncludingSelf(wsHub, players, attacker, "resourceDrop", { itemId: drop.itemId, amount: drop.amount, fromX, fromY, toX, toY, indexX: cell.indexX, indexY: cell.indexY, lootId: placed.id, playerId: attacker.id });
  }
}

function tryHarvestFromNatureHit(wsHub, players, attacker, cell, natureType) {
  const tool = attacker.attackTool || "hand";
  let itemId = null;
  let amountMin = 1;
  let amountMax = 1;

  const profile = getToolProfile(tool);
  const rule = profile?.harvest?.[natureType];
  if (rule) {
    if (rule.chance != null && Math.random() >= Number(rule.chance)) {
      const fallback = rule.fallback;
      if (fallback) {
        itemId = fallback.itemId;
        amountMin = fallback.min;
        amountMax = fallback.max;
      }
    } else {
      itemId = rule.itemId ?? (natureType === "tree" ? "wood" : natureType === "stone" ? "stone" : null);
      amountMin = rule.min ?? 1;
      amountMax = rule.max ?? amountMin;
    }
  } else if (natureType === "tree" && tool === "hand") {
    itemId = "wood";
    amountMin = 1;
    amountMax = 2;
  } else if ((natureType === "blueberry" || natureType === "wildberry") && tool === "hand") {
    itemId = rollHarvestDropForNature(natureType);
    const berryDef = getItemDef(itemId);
    const berryAmount = Number.isFinite(berryDef?.harvestAmount) ? Math.max(1, Math.floor(berryDef.harvestAmount)) : 1;
    amountMin = berryAmount;
    amountMax = berryAmount;
  }
  if (!itemId) return;

  const wanted = amountMin + Math.floor(Math.random() * (amountMax - amountMin + 1));

  const free = Math.max(0, getFreeSpaceForItem(attacker.inventory, itemId));
  const toInventory = Math.min(wanted, free);
  const toGround = wanted - toInventory;

  const fromX = cell.x + cell.w / 2;
  const fromY = cell.y + cell.h / 2;

  if (toInventory > 0) {
    const added = addItemToInventory(attacker.inventory, itemId, toInventory);
    if (added > 0) {
      addHarvestScore(attacker, itemId, added, wsHub);

      sendToViewersIncludingSelf(wsHub, players, attacker, "resourceCollect", {
        itemId,
        amount: added,
        fromX,
        fromY,
        playerId: attacker.id,
      });

      wsHub.sendToClientId(attacker.id, "inventoryUpdate", {
        inventory: sanitizeInventory(attacker.inventory),
      });
    }
  }

  if (toGround > 0) {
    const dropX = fromX + (Math.random() - 0.5) * 55;
    const dropY = fromY + (Math.random() - 0.5) * 55;
    const placed = placeItemOnGround(cell, itemId, toGround, {
      allowStack: true,
      x: dropX,
      y: dropY,
      pickableDelayMs: settings.RESOURCE_DROP_ANIM_MS ?? 640,
    });

    if (placed) {
      const items = serializeGroundItems(cell);
      notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
        indexX: cell.indexX,
        indexY: cell.indexY,
        groundItems: items,
        groundItem: items[0] ?? null,
      });

      sendToViewersIncludingSelf(wsHub, players, attacker, "resourceDrop", {
        itemId,
        amount: toGround,
        fromX,
        fromY,
        toX: dropX,
        toY: dropY,
        indexX: cell.indexX,
        indexY: cell.indexY,
        lootId: placed.id,
        playerId: attacker.id,
      });
    }
  }
}
export function processAttacks(wsHub, players, cellsList = null, onDeath = null) {
  const now = performance.now();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player.isAttacking || !player.inGame || !player.isAlive) continue;

    const duration = player.attackDurationMs ?? settings.ATTACK_DURATION_MS;
    if (now - player.attackStartTime >= duration) {
      // Hit is resolved immediately on startAttack, like other tools.
      player.isAttacking = false;
    }
  }
}

// ---- КОСТРЫ (НОВОЕ) ----
export function broadcastCampfireState(wsHub, players, cell) {
  const data = {
    indexX: cell.indexX,
    indexY: cell.indexY,
    campfire: cell.campfire ? cell.campfire.serialize() : null,
  };
  for (const player of players) {
    if (!player.inGame) continue;
    const dist = Math.hypot(cell.x + cell.w/2 - player.x, cell.y + cell.h/2 - player.y);
    if (dist < settings.CAMPFIRE_NORMAL.radius + settings.CELL_SIDE_LENGTH_PIXEL * 2) {
      wsHub.sendToClientId(player.id, "campfireState", data);
    }
  }
}