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
import { processSaplingObject } from "./saplings.js";
import { gameObjectManager } from "./gameObjects.js";
import { createBuildingSystem } from "./buildingSystem.js";

const VISIBILITY_TICKS = 6;       // 10 Hz
const POSITION_TICKS = 3;         // 20 Hz while moving
const POSITION_HEARTBEAT_TICKS = 20; // 3 Hz while idle
const STATION_BROADCAST_TICKS = 6;   // 10 Hz
const SAPLING_BROADCAST_TICKS = 30;  // 2 Hz

export function createGameLoop({ application, wsHub, deathSystem, spearSystem }) {
  let tick = 0;
  let lastLoopTime = performance.now();
  const buildingSystem = createBuildingSystem({
    cellsList: application.cellsList,
    players: application.playersList.list,
  });

  // Every dynamic object type gets one processor registered here. The loop
  // itself never scans the whole map for a specific object type again.
  gameObjectManager.registerProcessor("campfire", (campfire, cell, now, dt) => {
    campfire.tick(now, dt);
    return campfire.burningStateChanged ? { burningStateChanged: true } : null;
  });
  gameObjectManager.registerProcessor("workbench", (workbench, cell, now, dt) => {
    workbench.tick(now, dt);
    return null;
  });
  gameObjectManager.registerProcessor("sapling", (sapling, cell, now) => processSaplingObject(sapling, cell, now));
  gameObjectManager.registerProcessor("building", (building, cell, now) => buildingSystem.processObject(building, cell, now));

  function broadcastCampfireState(cell) {
    const data = {
      indexX: cell.indexX,
      indexY: cell.indexY,
      campfire: cell.campfire ? cell.campfire.serialize() : null,
    };
    for (const player of application.playersList.list) {
      if (!player.inGame) continue;
      const dx = cell.x + cell.w / 2 - player.x;
      const dy = cell.y + cell.h / 2 - player.y;
      const radius = settings.CAMPFIRE_NORMAL.radius + settings.CELL_SIDE_LENGTH_PIXEL * 2;
      if (dx * dx + dy * dy < radius * radius) {
        wsHub.sendToClientId(player.id, "campfireState", data);
      }
    }
  }

  function broadcastWorkbenchState(cell) {
    const data = {
      indexX: cell.indexX,
      indexY: cell.indexY,
      workbench: cell.workbench ? cell.workbench.serialize() : null,
    };
    for (const player of application.playersList.list) {
      if (!player.inGame) continue;
      const dx = cell.x + cell.w / 2 - player.x;
      const dy = cell.y + cell.h / 2 - player.y;
      const radius = (settings.WORKBENCH?.radius ?? 200) + settings.CELL_SIDE_LENGTH_PIXEL * 2;
      if (dx * dx + dy * dy < radius * radius) {
        wsHub.sendToClientId(player.id, "workbenchState", data);
      }
    }
  }

  function broadcastGroundItem(cell) {
    const items = serializeGroundItems(cell);
    notifyCellSubscribers(wsHub, cell, "groundItemUpdate", {
      groundItems: items,
      groundItem: items[0] ?? null,
    });
  }

  function update() {
    const now = performance.now();
    const deltaTime = Math.max(0, Math.min(0.25, (now - lastLoopTime) / 1000));
    lastLoopTime = now;

    const players = application.playersList.list;
    const cells = application.cellsList;

    move(application, deltaTime * 1000);
    processAttacks(wsHub, players, cells, deathSystem.handlePlayerDeath);
    processRegen(wsHub, players, deltaTime);
    processEnergy(wsHub, players, deltaTime);
    processHunger(wsHub, players, deltaTime, deathSystem.handlePlayerDeath);
    deathSystem.processCorpses();
    processCraftQueues(wsHub, players, cells);
    spearSystem.update(now, deltaTime);

    // Unified dynamic-object processing. Only currently active objects are
    // visited: no 10,000-cell scans for campfires/workbenches/saplings/doors.
    const objectChanges = gameObjectManager.process(now, deltaTime);

    for (const change of objectChanges) {
      const { type, entry, result } = change;
      const cell = entry.cell;
      if (type === "building" && result) {
        notifyCellSubscribers(wsHub, cell, "buildingState", {
          indexX: cell.indexX,
          indexY: cell.indexY,
          building: cell.building?.serialize?.() ?? null,
        });
      } else if (type === "sapling" && result) {
        broadcastSaplingUpdate(wsHub, cell);
        if (result.event === "expired") {
          notifyCellSubscribers(wsHub, cell, "saplingHit", {
            knockDx: 0,
            knockDy: 0,
            destroyed: true,
            kind: result.kind,
            stage: 0,
            harvested: false,
            expired: true,
          });
        }
      } else if (type === "campfire" && result?.burningStateChanged) {
        broadcastCampfireState(cell);
      }
    }

    if (tick % STATION_BROADCAST_TICKS === 0) {
      for (const entry of gameObjectManager.get("campfire")) {
        const cell = entry.cell;
        const campfire = entry.object;
        if (campfire.isBurning || campfire.craftQueue.length > 0) broadcastCampfireState(cell);
      }
      for (const entry of gameObjectManager.get("workbench")) {
        const cell = entry.cell;
        const workbench = entry.object;
        if (workbench.craftQueue.length > 0) broadcastWorkbenchState(cell);
      }
    }

    for (const player of players) {
      if (!player.isAlive || !player.inGame) continue;
      updatePlayerTemperature(player, cells, now, wsHub, players, deathSystem.handlePlayerDeath);
      if (tick % 10 === 0) sendTemperature(wsHub, player);
    }

    tick++;
    if (!players.length) return;

    if (tick % VISIBILITY_TICKS === 0) {
      syncPlayerVisibility(wsHub, players, cells);
    }

    const payloadById = new Map();
    let anyMoving = false;
    for (const player of players) {
      if (!player.isAlive || !player.inGame) continue;
      if (player.vector.length > 0) anyMoving = true;
      payloadById.set(player.id, {
        id: player.id,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        hp: Math.round(player.hp),
      });
    }

    if ((anyMoving && tick % POSITION_TICKS === 0) || tick % POSITION_HEARTBEAT_TICKS === 0) {
      sendPositionsToViewers(wsHub, players, payloadById, cells);
    }
  }

  function start() {
    const interval = setInterval(update, 1000 / 60);
    return () => clearInterval(interval);
  }

  function startGroundTimers() {
    setInterval(() => {
      for (const cell of spawnGroundItemsOnMap(application.cellsList.list)) broadcastGroundItem(cell);
    }, settings.GROUND_SPAWN_INTERVAL_MS);

    // Expiration now iterates the active ground-item registry rather than all
    // map cells. The 250 ms cadence is kept for gameplay timing compatibility.
    setInterval(() => {
      for (const cell of expireGroundItemsOnMap(application.cellsList.list)) broadcastGroundItem(cell);
    }, 250);
  }

  return { update, start, startGroundTimers };
}