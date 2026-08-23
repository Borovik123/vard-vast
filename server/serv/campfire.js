import settings from "./settings.js";
import { gameObjectManager } from "./gameObjects.js";
import crypto from "crypto";
import { getCraftRecipe, isRecipeForStation } from "./crafts.js";
import { StationCraftQueue } from "./craftQueueCore.js";
import { ENTITY_TYPES, normalizeRotation } from "./entityTypes.js";

export class Campfire {
  constructor(type, x, y, ownerId = null) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.entityType = ENTITY_TYPES.CAMPFIRE;
    this.x = x;
    this.y = y;
    this.ownerId = ownerId ?? null;
    this.projectileBlocks = false;
    this.hitboxRadius = settings.CAMPFIRE_HITBOX_RADIUS ?? 90;
    const def = this.getDef();
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.fuel = 0;
    this.fuelMax = def.fuelMax;
    this.lastTickTime = performance.now();
    this.isBurning = false;
    this.burningStateChanged = false;
    this.craftQueueStore = new StationCraftQueue({
      max: settings.CAMPFIRE_CRAFT_QUEUE_MAX ?? 4,
      canStart: (recipe) => this.isRecipeAllowed(recipe.id),
    });
  }

  get craftQueue() { return this.craftQueueStore.raw; }
  getDef() { return this.type === "max" ? settings.CAMPFIRE_MAX : settings.CAMPFIRE_NORMAL; }

  addFuel(amount) {
    const added = Math.min(Math.max(0, amount), this.fuelMax - this.fuel);
    this.fuel += added;
    this.updateBurningState();
    return added;
  }

  removeFuel(amount) {
    const removed = Math.min(Math.max(0, amount), this.fuel);
    this.fuel -= removed;
    this.updateBurningState();
    return removed;
  }

  updateBurningState() {
    const next = this.fuel > 0;
    this.burningStateChanged = next !== this.isBurning;
    this.isBurning = next;
  }

  tick(now, deltaSeconds = 1 / 60) {
    this.burningStateChanged = false;
    if (this.isBurning) {
      const consume = this.getDef().fuelConsumePerSec * Math.max(0, deltaSeconds);
      this.fuel = Math.max(0, this.fuel - consume);
      if (this.fuel <= 1e-9) {
        this.fuel = 0;
        this.isBurning = false;
        this.burningStateChanged = true;
      }
    }

    // When a campfire is out, its active craft pauses; it never reverses progress.
    this.craftQueueStore.tick(now, deltaSeconds, { advance: this.isBurning });
    for (const job of this.craftQueue) {
      if (job.status === "paused") job.status = "queued";
    }
  }

  getDestructionDrops() {
    const drops = this.craftQueueStore.destructionDrops({
      includeFinished: true,
      includeUnfinishedIngredients: this.type === "max",
    });
    const fuelToDrop = this.type === "max" ? Math.floor(this.fuel) : Math.floor(this.fuel / 2);
    if (fuelToDrop > 0) drops.push({ itemId: "wood", amount: fuelToDrop });
    return drops;
  }

  enqueueCraft(recipeId, now = performance.now()) {
    if (!this.isBurning) return false;
    return this.craftQueueStore.enqueue(recipeId, now, this.getCraftDuration(recipeId));
  }

  cancelCraft(index) { return this.craftQueueStore.cancel(index); }
  takeCraftResult(index) { return this.craftQueueStore.takeReady(index); }
  takeReadyItem(index) { return Number.isInteger(index) ? this.takeCraftResult(index) : null; }

  isRecipeAllowed(recipeId) {
    return isRecipeForStation(getCraftRecipe(recipeId), this.type === "max" ? "campfire_max" : "campfire");
  }

  getCraftDuration(recipeId) {
    const recipe = getCraftRecipe(recipeId);
    const def = this.getDef();
    return Math.max(1, Math.round((recipe?.durationMs ?? def.craftDurationMs ?? settings.CRAFT_DURATION_MS) * def.craftSpeedMultiplier));
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      entityType: this.entityType,
      ownerId: this.ownerId,
      hp: this.hp,
      maxHp: this.maxHp,
      fuel: this.fuel,
      fuelMax: this.fuelMax,
      isBurning: this.isBurning,
      craftQueue: this.craftQueueStore.serialize(),
      readyItems: [],
    };
  }
}

export function getCampfireOnCell(cell) { return cell?.campfire || null; }

export function placeCampfire(cell, type, playerX, playerY, ownerId = null, rotation = 0) {
  if (cell.campfire) return false;
  const campfire = new Campfire(type, playerX, playerY, ownerId);
  campfire.rotation = normalizeRotation(rotation);
  cell.campfire = campfire;
  gameObjectManager.register("campfire", cell, campfire);
  return true;
}

export function removeCampfire(cell) {
  const campfire = cell?.campfire;
  if (!campfire) return null;
  cell.campfire = null;
  gameObjectManager.unregister("campfire", cell, campfire);
  return campfire;
}

export function processCampfires(cells, now, deltaSeconds = 1 / 60) {
  // Backwards-compatible wrapper. New code uses GameObjectManager.
  for (const cell of cells ?? []) if (cell.campfire) cell.campfire.tick(now, deltaSeconds);
}