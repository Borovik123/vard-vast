import settings from "./settings.js";
import { move } from "./move.js";
import {
  syncPlayerVisibility,
  sendPositionsToViewers,
  processRegen,
  processHunger,
  processAttacks,
  broadcastSaplingUpdate,
  updatePlayerTemperature,
  sendTemperature,
  processEnergy,
  notifyCellSubscribers,
} from "./playerSync.js";
import { serializeGroundItems, spawnGroundItemsOnMap, expireGroundItemsOnMap } from "./groundItems.js";
import { processCraftQueues } from "./craftQueue.js";
import { processCampfires } from "./campfire.js";
import { processWorkbenches } from "./workbench.js";
import { processSaplings } from "./saplings.js";
import { createBuildingSystem } from "./buildingSystem.js";

export function createGameLoop({ application, wsHub, deathSystem, spearSystem }) {
  let tick = 0;
  let lastLoopTime = performance.now();
  const buildingSystem = createBuildingSystem({ cellsList: application.cellsList, players: application.playersList.list });

  function broadcastCampfireState(cell) {
    const data = { indexX: cell.indexX, indexY: cell.indexY, campfire: cell.campfire ? cell.campfire.serialize() : null };
    for (const player of application.playersList.list) {
      if (!player.inGame) continue;
      const dist = Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y);
      if (dist < settings.CAMPFIRE_NORMAL.radius + settings.CELL_SIDE_LENGTH_PIXEL * 2) wsHub.sendToClientId(player.id, "campfireState", data);
    }
  }

  function broadcastWorkbenchState(cell) {
    const data = { indexX: cell.indexX, indexY: cell.indexY, workbench: cell.workbench ? cell.workbench.serialize() : null };
    for (const player of application.playersList.list) {
      if (!player.inGame) continue;
      const dist = Math.hypot(cell.x + cell.w / 2 - player.x, cell.y + cell.h / 2 - player.y);
      if (dist < (settings.WORKBENCH?.radius ?? 200) + settings.CELL_SIDE_LENGTH_PIXEL * 2) wsHub.sendToClientId(player.id, "workbenchState", data);
    }
  }

  function broadcastGroundItem(cell) {
    const items = serializeGroundItems(cell);
    notifyCellSubscribers(wsHub, cell, "groundItemUpdate", { groundItems: items, groundItem: items[0] ?? null });
  }

  function update() {
    const now = performance.now();
    const deltaTime = Math.max(0, Math.min(0.25, (now - lastLoopTime) / 1000));
    lastLoopTime = now;

    move(application, deltaTime * 1000);
    processAttacks(wsHub, application.playersList.list, application.cellsList, deathSystem.handlePlayerDeath);
    processRegen(wsHub, application.playersList.list, deltaTime);
    processEnergy(wsHub, application.playersList.list, deltaTime);
    processHunger(wsHub, application.playersList.list, deltaTime, deathSystem.handlePlayerDeath);
    deathSystem.processCorpses();
    processCraftQueues(wsHub, application.playersList.list, application.cellsList);
    spearSystem.update(now, deltaTime);
    processCampfires(application.cellsList.list, now, deltaTime);
    processWorkbenches(application.cellsList.list, now, deltaTime);
    for (const cell of buildingSystem.process(now)) notifyCellSubscribers(wsHub, cell, "buildingState", { indexX:cell.indexX,indexY:cell.indexY,building:cell.building?.serialize() ?? null });

    for (const cell of application.cellsList.list) if (cell.campfire?.burningStateChanged) broadcastCampfireState(cell);

    if (tick % 6 === 0) {
      for (const cell of application.cellsList.list) {
        if (cell.campfire && (cell.campfire.isBurning || cell.campfire.craftQueue.length > 0)) broadcastCampfireState(cell);
        if (cell.workbench && cell.workbench.craftQueue.length > 0) broadcastWorkbenchState(cell);
      }
    }

    for (const player of application.playersList.list) {
      if (!player.isAlive || !player.inGame) continue;
      updatePlayerTemperature(player, application.cellsList, now, wsHub, application.playersList.list, deathSystem.handlePlayerDeath);
      if (tick % 10 === 0) sendTemperature(wsHub, player);
    }

    if (tick % 30 === 0) {
      for (const ev of processSaplings(application.cellsList.list)) {
        broadcastSaplingUpdate(wsHub, ev.cell);
        if (ev.event === "expired") notifyCellSubscribers(wsHub, ev.cell, "saplingHit", { knockDx: 0, knockDy: 0, destroyed: true, kind: ev.kind, stage: 0, harvested: false, expired: true });
      }
    }

    tick++;
    const players = application.playersList.list;
    if (!players.length) return;
    if (tick % 6 === 0) syncPlayerVisibility(wsHub, players, application.cellsList);
    const payloadById = new Map();
    let anyMoving = false;
    for (const player of players) {
      if (!player.isAlive || !player.inGame) continue;
      if (player.vector.length > 0) anyMoving = true;
      payloadById.set(player.id, { id: player.id, x: Math.round(player.x * 10) / 10, y: Math.round(player.y * 10) / 10, hp: Math.round(player.hp) });
    }
    if (anyMoving || tick % 20 === 0) sendPositionsToViewers(wsHub, players, payloadById, application.cellsList);
  }

  function start() {
    const interval = setInterval(update, 1000 / 60);
    return () => clearInterval(interval);
  }

  function startGroundTimers() {
    setInterval(() => {
      for (const cell of spawnGroundItemsOnMap(application.cellsList.list)) broadcastGroundItem(cell);
    }, settings.GROUND_SPAWN_INTERVAL_MS);
    setInterval(() => {
      for (const cell of expireGroundItemsOnMap(application.cellsList.list)) broadcastGroundItem(cell);
    }, 250);
  }

  return { update, start, startGroundTimers };
}