import crypto from "crypto";
import { getCraftRecipe } from "./crafts.js";

/** Generic queue used by world crafting stations. */
export class StationCraftQueue {
  constructor({ max = 4, durationMultiplier = 1, canStart = () => true } = {}) {
    this.max = max;
    this.durationMultiplier = durationMultiplier;
    this.canStart = canStart;
    this.jobs = [];
  }

  get length() { return this.jobs.length; }
  get raw() { return this.jobs; }

  enqueue(recipeId, now = performance.now(), durationOverride = null) {
    const recipe = getCraftRecipe(recipeId);
    if (!recipe || this.jobs.length >= this.max || !this.canStart(recipe)) return false;
    const durationMs = Math.max(1, Math.round(
      durationOverride ?? (recipe.durationMs ?? 3000) * this.durationMultiplier
    ));
    this.jobs.push({
      id: crypto.randomUUID(),
      recipeId,
      startedAt: this.jobs.length ? null : now,
      durationMs,
      elapsed: 0,
      status: "queued",
      ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })),
      result: null,
    });
    return true;
  }

  tick(now, deltaSeconds = 0, { advance = true } = {}) {
    const job = this.jobs.find((candidate) => candidate.status !== "ready");
    if (!job || !advance) return;
    if (job.startedAt == null) job.startedAt = now;
    job.status = "active";
    job.elapsed = Math.min(job.durationMs, (job.elapsed || 0) + Math.max(0, deltaSeconds) * 1000);
    if (job.elapsed + 0.001 >= job.durationMs) {
      job.elapsed = job.durationMs;
      job.status = "ready";
      const recipe = getCraftRecipe(job.recipeId);
      job.result = recipe ? { ...recipe.result } : null;
    }
  }

  cancel(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.jobs.length) return null;
    const job = this.jobs[index];
    if (!job || job.status === "ready") return null;
    this.jobs.splice(index, 1);
    if (this.jobs[0]) this.jobs[0].startedAt = performance.now();
    return job;
  }

  takeReady(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.jobs.length) return null;
    const job = this.jobs[index];
    if (!job || job.status !== "ready" || !job.result) return null;
    this.jobs.splice(index, 1);
    if (this.jobs[0]) this.jobs[0].startedAt = performance.now();
    return job.result;
  }

  destructionDrops({ includeFinished = true, includeUnfinishedIngredients = true } = {}) {
    const drops = new Map();
    const add = (itemId, amount) => {
      const n = Math.floor(Number(amount) || 0);
      if (itemId && n > 0) drops.set(itemId, (drops.get(itemId) || 0) + n);
    };
    for (const job of this.jobs) {
      if (job.status === "ready" && includeFinished && job.result) {
        add(job.result.itemId, job.result.amount);
      } else if (job.status !== "ready" && includeUnfinishedIngredients) {
        for (const ing of job.ingredients ?? []) add(ing.itemId, ing.amount);
      }
    }
    return [...drops].map(([itemId, amount]) => ({ itemId, amount }));
  }

  serialize() {
    return this.jobs.map((job) => ({
      id: job.id,
      recipeId: job.recipeId,
      durationMs: job.durationMs,
      elapsed: job.elapsed || 0,
      remainingMs: Math.max(0, job.durationMs - (job.elapsed || 0)),
      status: job.status || "queued",
      result: job.result ? { ...job.result } : null,
    }));
  }
}