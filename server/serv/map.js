import settings from "./settings.js";
import { spawnNatureOnCells } from "./natureObjects.js";

export class NatureObject {
  constructor(params) {
    this.type = params.eType;
    this.width = settings.CELL_SIDE_LENGTH_PIXEL;
    this.height = settings.CELL_SIDE_LENGTH_PIXEL;
    this.x = params.x;
    this.y = params.y;
  }
}

export class Cell {
  constructor(params) {
    this.type = params.eType;
    Object.defineProperty(this, "subscribers", { value: new Set(), writable: true, enumerable: false });
    this.x = params.x;
    this.y = params.y;
    this.color = params.color;
    this.indexX = params.indexX;
    this.indexY = params.indexY;
    this.w = settings.CELL_SIDE_LENGTH_PIXEL;
    this.h = settings.CELL_SIDE_LENGTH_PIXEL;
    this.natureType = params.natureType ?? "empty";
    this.natureImage = params.natureImage;
    this.hitboxRadius = params.hitboxRadius ?? 0;
    this.hp = params.hp ?? 0;
    this.maxHp = params.maxHp ?? 0;
    this.groundItem = params.groundItem ?? null;
    this.groundItems = params.groundItems ?? null;
    this.sapling = params.sapling ?? null;
    this.building = params.building ?? null;
    this.campfire = params.campfire ?? null; // НОВОЕ
  }
}

export class CellsList {
  constructor() {
    this.list = [];
    this.VisibleList = [];
    this.grid = [];
  }

  add(params) {
    const obj = new Cell(params);
    this.list.push(obj);
    return obj;
  }

  addParams() {
    const params = { eType: "cell" };
    this.grid = Array.from(
      { length: settings.MAP_SIDE_LENGTH + 1 },
      () => []
    );

    for (let i = 1; i <= settings.MAP_SIDE_LENGTH; i++) {
      for (let j = 1; j <= settings.MAP_SIDE_LENGTH; j++) {
        params.indexX = i;
        params.indexY = j;
        params.color = "#536c55";
        params.x = i * settings.CELL_SIDE_LENGTH_PIXEL - 200;
        params.y = j * settings.CELL_SIDE_LENGTH_PIXEL - 200;
        const cell = this.add(params);
        this.grid[i][j] = cell;
      }
    }
  }

  addNatureObjects() {
    const counts = spawnNatureOnCells(this.list);
    console.log("[nature] spawn counts:", counts);
  }

  getVisibleCells(xPlayer, yPlayer, idPlayer, playersList = null) {
    this.VisibleList = [];
    const player = playersList?.findById?.(idPlayer) ?? playersList?.list?.find?.((p) => p.id === idPlayer) ?? null;
    const previousCells = player?.visibleCells ?? [];
    const nextCells = [];
    const playerXCell = Math.ceil(xPlayer / settings.CELL_SIDE_LENGTH_PIXEL);
    const playerYCell = Math.ceil(yPlayer / settings.CELL_SIDE_LENGTH_PIXEL);

    const minX = Math.max(1, playerXCell - settings.VISIBLE_CELLS_X);
    const maxX = Math.min(
      settings.MAP_SIDE_LENGTH,
      playerXCell + settings.VISIBLE_CELLS_X
    );
    const minY = Math.max(1, playerYCell - settings.VISIBLE_CELLS_Y);
    const maxY = Math.min(
      settings.MAP_SIDE_LENGTH,
      playerYCell + settings.VISIBLE_CELLS_Y
    );

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.grid[ix][iy];
        if (!cell) continue;

        if (cell.building) cell._buildingData = cell.building.serialize(); else cell._buildingData = null;

        // Сериализуем костёр для клиента
        if (cell.campfire) {
          cell._campfireData = cell.campfire.serialize();
        } else {
          cell._campfireData = null;
        }

        cell.subscribers.add(idPlayer);
        nextCells.push(cell);
        this.VisibleList.push(cell);
      }
    }

    const nextSet = new Set(nextCells);
    for (const cell of previousCells) {
      if (!nextSet.has(cell)) cell.subscribers.delete(idPlayer);
    }

    playersList?.addVisibleCells(
      this.VisibleList,
      idPlayer,
      playerXCell,
      playerYCell
    );
    return this.VisibleList;
  }

  unsubscribePlayer(idPlayer, cells = null) {
    const source = cells ?? this.list;
    for (const cell of source) cell?.subscribers?.delete?.(idPlayer);
  }

  /**
   * Возвращает препятствия (природа, костры) в радиусе searchRadius.
   * Используется для коллизий движения.
   */
  getNearbyObstacles(x, y, searchRadius) {
    const obstacles = [];
    const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
    const centerCellX = Math.ceil(x / cellSize);
    const centerCellY = Math.ceil(y / cellSize);
    // Убедимся, что радиус покрывает минимум 1 клетку
    const cellRadius = Math.max(1, Math.ceil(searchRadius / cellSize) + 1);

    const minX = Math.max(1, centerCellX - cellRadius);
    const maxX = Math.min(settings.MAP_SIDE_LENGTH, centerCellX + cellRadius);
    const minY = Math.max(1, centerCellY - cellRadius);
    const maxY = Math.min(settings.MAP_SIDE_LENGTH, centerCellY + cellRadius);

    const playerInsideCircle = (cx, cy, radius) => Math.hypot(x - cx, y - cy) <= radius + 1e-6;
    const playerInsideRect = (cx, cy, width, height, rotation = 0) => {
      const angle = Number(rotation || 0);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
    };

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.grid[ix][iy];
        if (!cell) continue;

        // Природные объекты (круги)
        if (cell.natureType !== "empty" && cell.hp > 0 && cell.hitboxRadius > 0) {
          obstacles.push({
            cx: cell.x + cell.w / 2,
            cy: cell.y + cell.h / 2,
            radius: cell.hitboxRadius,
            allowInside: playerInsideCircle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.hitboxRadius),
          });
        }

        // Саженцы (если блокируют движение)
        if (cell.sapling && cell.sapling.hp > 0 && (cell.sapling.movementHitboxRadius ?? 0) > 0) {
          obstacles.push({
            cx: cell.x + cell.w / 2,
            cy: cell.y + cell.h / 2,
            radius: cell.sapling.movementHitboxRadius,
            allowInside: playerInsideCircle(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.sapling.movementHitboxRadius),
          });
        }

        // ---- Здания (стены, двери) ----
        if (cell.building) {
          const b = cell.building;
          if (b.kind === "door") {
            // Если есть playerCollisionCells – используем их (для OPEN и CLOSED)
            if (Array.isArray(b.playerCollisionCells) && b.playerCollisionCells.length) {
              for (const pos of b.playerCollisionCells) {
                const bc = this.grid[pos.indexX]?.[pos.indexY];
                if (bc) {
                  obstacles.push({
                    shape: "rect",
                    cx: bc.x + bc.w / 2,
                    cy: bc.y + bc.h / 2,
                    width: 200,
                    height: 200,
                    rotation: 0,
                    allowInside: playerInsideRect(bc.x + bc.w / 2, bc.y + bc.h / 2, 200, 200, 0),
                  });
                }
              }
            } else if (b.state === "CLOSED") {
              // Если playerCollisionCells пуст, но дверь закрыта – блокируем свою клетку
              obstacles.push({
                shape: "rect",
                cx: cell.x + cell.w / 2,
                cy: cell.y + cell.h / 2,
                width: 200,
                height: 200,
                rotation: 0,
                allowInside: playerInsideRect(cell.x + cell.w / 2, cell.y + cell.h / 2, 200, 200, 0),
              });
            }
            // В состояниях OPEN, OPENING, CLOSING – коллизии нет (playerCollisionCells пуст)
          } else {
            // Стены и другие здания всегда блокируют
            obstacles.push({
              shape: "rect",
              cx: cell.x + cell.w / 2,
              cy: cell.y + cell.h / 2,
              width: 200,
              height: 200,
              rotation: 0,
              allowInside: playerInsideRect(cell.x + cell.w / 2, cell.y + cell.h / 2, 200, 200, 0),
            });
          }
        }

        // Костры (круги)
        if (cell.campfire) {
          const radius = settings.CAMPFIRE_HITBOX_RADIUS || 90;
          obstacles.push({
            shape: "circle",
            cx: cell.x + cell.w / 2,
            cy: cell.y + cell.h / 2,
            radius: radius,
            allowInside: playerInsideCircle(cell.x + cell.w / 2, cell.y + cell.h / 2, radius),
          });
        }

        // Верстаки (прямоугольники)
        if (cell.workbench) {
          obstacles.push({
            shape: "rect",
            cx: cell.x + cell.w / 2,
            cy: cell.y + cell.h / 2,
            width: cell.workbench.hitboxWidth ?? settings.WORKBENCH?.hitboxWidth ?? 164,
            height: cell.workbench.hitboxHeight ?? settings.WORKBENCH?.hitboxHeight ?? 116,
            rotation: (Number(cell.workbench.hitboxRotation ?? ((cell.workbench.rotation ?? 0) + 1) % 4) * Math.PI / 2),
            allowInside: playerInsideRect(cell.x + cell.w / 2, cell.y + cell.h / 2, cell.workbench.hitboxWidth ?? settings.WORKBENCH?.hitboxWidth ?? 164, cell.workbench.hitboxHeight ?? settings.WORKBENCH?.hitboxHeight ?? 116, Number(cell.workbench.hitboxRotation ?? ((cell.workbench.rotation ?? 0) + 1) % 4) * Math.PI / 2),
          });
        }
      }
    }
    return obstacles;
  }
  /**
   * Возвращает клетки с природой или саженцами в радиусе.
   * Используется для атак по природе.
   */
  getNearbyNatureCells(x, y, searchRadius) {
    const cells = [];
    const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
    const centerCellX = Math.ceil(x / cellSize);
    const centerCellY = Math.ceil(y / cellSize);
    const cellRadius = Math.ceil(searchRadius / cellSize) + 1;

    const minX = Math.max(1, centerCellX - cellRadius);
    const maxX = Math.min(settings.MAP_SIDE_LENGTH, centerCellX + cellRadius);
    const minY = Math.max(1, centerCellY - cellRadius);
    const maxY = Math.min(settings.MAP_SIDE_LENGTH, centerCellY + cellRadius);

    const playerInsideCircle = (cx, cy, radius) => Math.hypot(x - cx, y - cy) <= radius + 1e-6;
    const playerInsideRect = (cx, cy, width, height, rotation = 0) => {
      const angle = Number(rotation || 0);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
    };

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.grid[ix][iy];
        if (!cell) continue;
        // Если есть природа или саженец
        if (cell.natureType !== "empty" || cell.sapling) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }

  /**
   * НОВЫЙ МЕТОД: возвращает все атакуемые клетки (природа, саженцы, костры)
   * в радиусе. Используется в combat.js для атак по объектам.
   */
  getNearbyAttackableCells(x, y, searchRadius) {
    const cells = [];
    const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
    const centerCellX = Math.ceil(x / cellSize);
    const centerCellY = Math.ceil(y / cellSize);
    const cellRadius = Math.ceil(searchRadius / cellSize) + 1;

    const minX = Math.max(1, centerCellX - cellRadius);
    const maxX = Math.min(settings.MAP_SIDE_LENGTH, centerCellX + cellRadius);
    const minY = Math.max(1, centerCellY - cellRadius);
    const maxY = Math.min(settings.MAP_SIDE_LENGTH, centerCellY + cellRadius);

    const playerInsideCircle = (cx, cy, radius) => Math.hypot(x - cx, y - cy) <= radius + 1e-6;
    const playerInsideRect = (cx, cy, width, height, rotation = 0) => {
      const angle = Number(rotation || 0);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
    };

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.grid[ix][iy];
        if (!cell) continue;
        // Добавляем клетку, если в ней есть природа, саженец, костёр или верстак
        if (cell.natureType !== "empty" || cell.sapling || cell.campfire || cell.workbench || cell.building) {
          cells.push(cell);
        }
      }
    }
    return cells;
  }

  /**
   * Возвращает все клетки в радиусе (без фильтрации).
   */
  getNearbyCells(x, y, searchRadius) {
    const cells = [];
    const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
    const centerCellX = Math.ceil(x / cellSize);
    const centerCellY = Math.ceil(y / cellSize);
    const cellRadius = Math.ceil(searchRadius / cellSize) + 1;

    const minX = Math.max(1, centerCellX - cellRadius);
    const maxX = Math.min(settings.MAP_SIDE_LENGTH, centerCellX + cellRadius);
    const minY = Math.max(1, centerCellY - cellRadius);
    const maxY = Math.min(settings.MAP_SIDE_LENGTH, centerCellY + cellRadius);

    const playerInsideCircle = (cx, cy, radius) => Math.hypot(x - cx, y - cy) <= radius + 1e-6;
    const playerInsideRect = (cx, cy, width, height, rotation = 0) => {
      const angle = Number(rotation || 0);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return Math.abs(lx) <= width / 2 && Math.abs(ly) <= height / 2;
    };

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        const cell = this.grid[ix][iy];
        if (cell) cells.push(cell);
      }
    }
    return cells;
  }

  /**
   * Получение клетки по мировым координатам.
   */
  getCellAtWorld(x, y) {
    const cellSize = settings.CELL_SIDE_LENGTH_PIXEL;
    const ix = Math.floor(x / cellSize) + 1;
    const iy = Math.floor(y / cellSize) + 1;
    if (
      ix < 1 ||
      iy < 1 ||
      ix > settings.MAP_SIDE_LENGTH ||
      iy > settings.MAP_SIDE_LENGTH
    ) {
      return null;
    }
    return this.grid[ix]?.[iy] ?? null;
  }

  /**
   * Возвращает клетки, свободные для спавна (пустые, без саженцев).
   */
  getFreeSpawnCells() {
    return this.list.filter(
      (cell) =>
        (cell.natureType === "empty" || cell.hp <= 0) && !cell.sapling && !cell.campfire && !cell.workbench && !cell.building
    );
  }
}