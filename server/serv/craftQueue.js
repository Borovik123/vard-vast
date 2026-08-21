import settings from "./settings.js";
import { getCraftRecipe, isRecipeForStation } from "./crafts.js";
import {
  countItemInInventory,
  removeItemFromInventory,
  addItemToInventory,
  getFreeSpaceForItem,
  sanitizeInventory,
} from "./items.js";
import { findDropPlacement, placeItemOnGround, serializeGroundItems } from "./groundItems.js";

function queueMax() { return settings.CRAFT_QUEUE_MAX ?? 4; }
function defaultDuration(recipe) { return recipe.durationMs ?? settings.CRAFT_DURATION_MS ?? 3000; }

export function ensureCraftQueue(player) {
  if (!Array.isArray(player.craftQueue)) player.craftQueue = [];
  return player.craftQueue;
}
export function isPlayerCrafting(player) { return ensureCraftQueue(player).length > 0; }

export function serializeCraftQueue(player) {
  const queue = ensureCraftQueue(player);
  const now = performance.now();
  return {
    queue: queue.map((job, index) => ({
      recipeId: job.recipeId,
      durationMs: job.durationMs,
      remainingMs: index === 0 && job.startedAt != null ? Math.max(0, Math.ceil(job.durationMs - (now - job.startedAt))) : job.durationMs,
      active: index === 0,
    })),
    max: queueMax(),
  };
}
function sendCraftState(wsHub, player) { wsHub.sendToClientId(player.id, "craftQueueUpdate", serializeCraftQueue(player)); }
function sendInventory(wsHub, player) { wsHub.sendToClientId(player.id, "inventoryUpdate", { inventory: sanitizeInventory(player.inventory) }); }

function refundToInventoryOrGround(player, ingredient, cellsList) {
  const added = addItemToInventory(player.inventory, ingredient.itemId, ingredient.amount);
  const remaining = ingredient.amount - added;
  if (remaining <= 0 || !cellsList) return;
  const placement = findDropPlacement(cellsList, player.x, player.y, Math.random() * 2 - 1, Math.random() * 2 - 1, player.interactionRadius ?? settings.INTERACTION_RADIUS);
  if (!placement) return;
  placeItemOnGround(placement.cell, ingredient.itemId, remaining, { x: placement.x, y: placement.y, pickableDelayMs: 0 });
  const items = serializeGroundItems(placement.cell);
  notifyCellSubscribersLocal(wsHubForCells(player, cellsList), placement.cell, "groundItemUpdate", { groundItems: items, groundItem: items[0] ?? null });
}

// Kept intentionally tiny: player objects can carry their active ws hub while
// a transaction is being refunded. Normal callers pass through process/cancel.
function notifyCellSubscribersLocal(wsHub, cell, type, data) {
  if (!wsHub || !cell) return;
  const payload = { indexX: cell.indexX, indexY: cell.indexY, ...data };
  for (const id of cell.subscribers ?? []) wsHub.sendToClientId(id, type, payload);
}

function wsHubForCells(player, cellsList) { return player._wsHubForCraft ?? null; }

export function queueCraft(wsHub, player, recipeId) {
  if (!player?.isAlive || !player.inGame) return { ok: false, reason: "dead" };
  const recipe = getCraftRecipe(recipeId);
  if (!recipe || !isRecipeForStation(recipe, "normal")) return { ok: false, reason: "recipe" };
  const queue = ensureCraftQueue(player);
  if (queue.length >= queueMax()) return { ok: false, reason: "full" };

  for (const ing of recipe.ingredients) if (countItemInInventory(player.inventory, ing.itemId) < ing.amount) return { ok: false, reason: "ingredients" };

  for (const ing of recipe.ingredients) removeItemFromInventory(player.inventory, ing.itemId, ing.amount);
  queue.push({
    recipeId: recipe.id,
    durationMs: defaultDuration(recipe),
    startedAt: queue.length === 0 ? performance.now() : null,
    ingredients: recipe.ingredients.map((i) => ({ ...i })),
    result: { ...recipe.result },
  });
  sendInventory(wsHub, player);
  sendCraftState(wsHub, player);
  return { ok: true };
}

export function cancelCraftAt(wsHub, player, index, cellsList = null) {
  const queue = ensureCraftQueue(player);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= queue.length) return false;
  const [job] = queue.splice(i, 1);
  player._wsHubForCraft = wsHub;
  for (const ing of job.ingredients) refundToInventoryOrGround(player, ing, cellsList);
  delete player._wsHubForCraft;
  if (i === 0 && queue.length > 0) queue[0].startedAt = performance.now();
  sendInventory(wsHub, player);
  sendCraftState(wsHub, player);
  return true;
}

export function cancelAllCrafts(wsHub, player, cellsList = null) {
  const queue = ensureCraftQueue(player);
  if (!queue.length) return false;
  player._wsHubForCraft = wsHub;
  for (const job of queue) for (const ing of job.ingredients) refundToInventoryOrGround(player, ing, cellsList);
  delete player._wsHubForCraft;
  player.craftQueue = [];
  sendInventory(wsHub, player);
  sendCraftState(wsHub, player);
  return true;
}

export function processCraftQueues(wsHub, players, cellsList = null) {
  const now = performance.now();
  for (const player of players) {
    if (!player?.isAlive || !player.inGame) continue;
    const queue = ensureCraftQueue(player);
    if (!queue.length) continue;
    const job = queue[0];
    if (job.startedAt == null) job.startedAt = now;
    if (now - job.startedAt < job.durationMs) continue;

    const added = addItemToInventory(player.inventory, job.result.itemId, job.result.amount);
    const remainder = job.result.amount - added;
    if (remainder > 0 && cellsList) {
      const placement = findDropPlacement(cellsList, player.x, player.y, 0, 0, player.interactionRadius ?? settings.INTERACTION_RADIUS);
      if (placement) {
        const loot = placeItemOnGround(placement.cell, job.result.itemId, remainder, { x: placement.x, y: placement.y, pickableDelayMs: 0 });
        if (loot) {
          const items = serializeGroundItems(placement.cell);
          notifyCellSubscribersLocal(wsHub, placement.cell, "groundItemUpdate", { groundItems: items, groundItem: items[0] ?? null });
          wsHub.sendToClientId(player.id, "resourceDrop", { itemId: job.result.itemId, amount: remainder, fromX: player.x, fromY: player.y, toX: placement.x, toY: placement.y, indexX: placement.cell.indexX, indexY: placement.cell.indexY, lootId: loot.id, playerId: player.id });
        }
      }
    }
    queue.shift();
    if (queue.length) queue[0].startedAt = now;
    sendInventory(wsHub, player);
    sendCraftState(wsHub, player);
  }
}

export function takeCraftReservations(player) {
  const queue = ensureCraftQueue(player);
  const reservations = [];
  for (const job of queue) {
    for (const ingredient of job.ingredients ?? []) {
      if (ingredient.itemId && ingredient.amount > 0) reservations.push({ itemId: ingredient.itemId, amount: ingredient.amount });
    }
  }
  player.craftQueue = [];
  return reservations;
}