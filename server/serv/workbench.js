import settings from "./settings.js";
import crypto from "crypto";
import { getCraftRecipe, isRecipeForStation } from "./crafts.js";
import { StationCraftQueue } from "./craftQueueCore.js";
import { ENTITY_TYPES, normalizeRotation } from "./entityTypes.js";
import { gameObjectManager } from "./gameObjects.js";

export class Workbench {
  constructor(x, y, ownerId = null) {
    this.id = crypto.randomUUID();
    this.entityType = ENTITY_TYPES.WORKBENCH;
    this.type = ENTITY_TYPES.WORKBENCH;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId ?? null;
    this.hp = settings.WORKBENCH.hp;
    this.maxHp = settings.WORKBENCH.hp;
    this.hitboxWidth = Math.round(settings.WORKBENCH.hitboxWidth ?? (settings.CELL_SIDE_LENGTH_PIXEL ?? 200) * 0.82);
    this.hitboxHeight = Math.round(settings.WORKBENCH.hitboxHeight ?? (settings.CELL_SIDE_LENGTH_PIXEL ?? 200) * 0.58);
    this.projectileBlocks = true;
    this.rotation = 0;
    this.hitboxRotation = 1;
    this.craftQueueStore = new StationCraftQueue({
      max: settings.WORKBENCH.craftQueueMax ?? settings.CRAFT_QUEUE_MAX ?? 4,
      durationMultiplier: settings.WORKBENCH.craftSpeedMultiplier ?? 0.5,
      canStart: (recipe) => this.isRecipeAllowed(recipe.id),
    });
  }

  get craftQueue() { return this.craftQueueStore.raw; }
  isRecipeAllowed(recipeId) { return isRecipeForStation(getCraftRecipe(recipeId), "workbench"); }

  enqueueCraft(recipeId, now = performance.now()) { const recipe=getCraftRecipe(recipeId); return this.craftQueueStore.enqueue(recipeId, now, recipe?.workbenchDurationMs ?? null); }
  tick(now, deltaSeconds) { this.craftQueueStore.tick(now, deltaSeconds); }
  cancelCraft(index) { return this.craftQueueStore.cancel(index); }
  takeCraftResult(index) { return this.craftQueueStore.takeReady(index); }
  getDestructionDrops() { return this.craftQueueStore.destructionDrops({ includeFinished: true, includeUnfinishedIngredients: true }); }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      entityType: this.entityType,
      ownerId: this.ownerId,
      hp: this.hp,
      maxHp: this.maxHp,
      rotation: this.rotation,
      hitboxRotation: this.hitboxRotation,
      hitboxWidth: this.hitboxWidth,
      hitboxHeight: this.hitboxHeight,
      craftQueue: this.craftQueueStore.serialize(),
    };
  }
}

export function getWorkbenchOnCell(cell) { return cell?.workbench || null; }
export function placeWorkbench(cell, x, y, ownerId = null, rotation = 0) {
  if (cell.workbench || cell.campfire || cell.sapling || (cell.natureType && cell.natureType !== "empty" && cell.hp > 0)) return false;
  const wb = new Workbench(x, y, ownerId);
  wb.rotation = normalizeRotation(rotation);
  wb.hitboxRotation = normalizeRotation(wb.rotation + 1);
  cell.workbench = wb;
  cell.building = wb;
  gameObjectManager.register("workbench", cell, wb);
  return true;
}
export function removeWorkbench(cell) {
  const wb = cell?.workbench;
  if (!wb) return null;
  cell.workbench = null;
  if (cell.building === wb) cell.building = null;
  gameObjectManager.unregister("workbench", cell, wb);
  return wb;
}
export function processWorkbenches(cells, now, deltaSeconds) {
  for (const cell of cells) if (cell.workbench) cell.workbench.tick(now, deltaSeconds);
}