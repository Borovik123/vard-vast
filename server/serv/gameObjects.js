/**
 * Unified runtime registry for dynamic world objects.
 *
 * Cells remain the authoritative spatial storage for backwards compatibility,
 * while this registry is the authoritative index for objects that need
 * periodic processing or fast iteration. Adding a new object type requires
 * registering it once; the main game loop does not need another per-type scan.
 */
export class GameObjectManager {
    constructor() {
      this.byType = new Map();
      this.byCell = new WeakMap();
      this.processors = new Map();
    }
  
    _typeSet(type) {
      let set = this.byType.get(type);
      if (!set) {
        set = new Set();
        this.byType.set(type, set);
      }
      return set;
    }
  
    register(type, cell, object, key = null) {
      if (!type || !cell || !object) return null;
      let cellMap = this.byCell.get(cell);
      if (!cellMap) {
        cellMap = new Map();
        this.byCell.set(cell, cellMap);
      }
  
      const previous = cellMap.get(type);
      if (previous && previous.object === object && previous.key === key) return previous;
      if (previous) this.unregisterEntry(previous);
  
      const entry = { type, cell, object, key };
      cellMap.set(type, entry);
      this._typeSet(type).add(entry);
      return entry;
    }
  
    registerMany(type, cell, objects) {
      if (!Array.isArray(objects)) return [];
      const entries = [];
      for (const object of objects) {
        if (!object) continue;
        const key = object.id ?? Symbol();
        const entry = this.register(`${type}:${String(key)}`, cell, object, key);
        if (entry) entries.push(entry);
      }
      return entries;
    }
  
    unregister(type, cell, object = null) {
      const entry = this.byCell.get(cell)?.get(type);
      if (!entry) return false;
      if (object && entry.object !== object) return false;
      this.unregisterEntry(entry);
      return true;
    }
  
    unregisterEntry(entry) {
      if (!entry) return;
      const set = this.byType.get(entry.type);
      set?.delete(entry);
      const cellMap = this.byCell.get(entry.cell);
      if (cellMap?.get(entry.type) === entry) cellMap.delete(entry.type);
    }
  
    clearCell(cell) {
      const cellMap = this.byCell.get(cell);
      if (!cellMap) return;
      for (const entry of cellMap.values()) this.unregisterEntry(entry);
      cellMap.clear();
    }
  
    get(type) {
      return this.byType.get(type) ?? new Set();
    }
  
    count(type) {
      return this.byType.get(type)?.size ?? 0;
    }
  
    registerProcessor(type, processor) {
      if (typeof processor !== "function") throw new TypeError(`Processor for ${type} must be a function`);
      this.processors.set(type, processor);
      return () => this.processors.delete(type);
    }
  
    process(now, deltaSeconds) {
      const changed = [];
      for (const [type, processor] of this.processors) {
        const entries = this.byType.get(type);
        if (!entries?.size) continue;
        for (const entry of Array.from(entries)) {
          // The object may have been removed by a previous processor during the
          // same tick. Do not process stale entries.
          if (!entries.has(entry)) continue;
          const result = processor(entry.object, entry.cell, now, deltaSeconds, entry);
          if (result) changed.push({ type, entry, result });
        }
      }
      return changed;
    }
  
    registerCellObjects(cell) {
      if (!cell) return;
      if (cell.campfire) this.register("campfire", cell, cell.campfire);
      else this.unregister("campfire", cell);
  
      if (cell.workbench) this.register("workbench", cell, cell.workbench);
      else this.unregister("workbench", cell);
  
      if (cell.sapling) this.register("sapling", cell, cell.sapling);
      else this.unregister("sapling", cell);
  
      if (cell.building && cell.building !== cell.workbench) this.register("building", cell, cell.building);
      else this.unregister("building", cell);
    }
  
    registerGroundItem(cell, loot) {
      if (!cell || !loot) return;
      this.register(`ground_item:${loot.id}`, cell, loot, loot.id);
    }
  
    unregisterGroundItem(cell, lootId) {
      if (!cell || !lootId) return;
      this.unregister(`ground_item:${lootId}`, cell);
    }
  
    getGroundItems() {
      const result = [];
      for (const [type, entries] of this.byType) {
        if (!type.startsWith("ground_item:")) continue;
        for (const entry of entries) result.push(entry);
      }
      return result;
    }
  }
  
  export const gameObjectManager = new GameObjectManager();