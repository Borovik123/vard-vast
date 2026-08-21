import crypto from "crypto";
import settings from "./settings.js";

export class CorpsesList {
  constructor() {
    this.list = [];
  }

  add(x, y, angle) {
    const corpse = {
      id: crypto.randomUUID(),
      x,
      y,
      angle: angle ?? 0,
      expiresAt: performance.now() + settings.CORPSE_DURATION_MS,
    };
    this.list.push(corpse);
    return corpse;
  }

  removeExpired() {
    const now = performance.now();
    const removed = [];

    this.list = this.list.filter((corpse) => {
      if (corpse.expiresAt <= now) {
        removed.push(corpse);
        return false;
      }
      return true;
    });

    return removed;
  }
}