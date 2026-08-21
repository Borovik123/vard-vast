/** Craft recipes shared by normal crafting, campfires and workbenches. */
export const CRAFT_RECIPES = [
  {
    id: "blueberry_seed", station: "campfire", label: "Blueberry seed",
    description: "Plant on soil to grow a blueberry bush.",
    info: "Craft time: 10s (5s in improved campfire)",
    result: { itemId: "blueberrySeed", amount: 1 }, ingredients: [{ itemId: "blueberry", amount: 5 }], durationMs: 10000,
  },
  {
    id: "wildberry_seed", station: "campfire", label: "Wildberry seed",
    description: "Plant on soil to grow a wildberry bush.",
    info: "Craft time: 10s (5s in improved campfire)",
    result: { itemId: "wildberrySeed", amount: 1 }, ingredients: [{ itemId: "wildberry", amount: 5 }], durationMs: 10000,
  },
  {
    id: "wood_spear", station: "normal", label: "Wood Spear", description: "A basic throwing spear.", info: "Damage: 100",
    result: { itemId: "spear", amount: 1 }, ingredients: [{ itemId: "wood", amount: 10 }], durationMs: 2000,
  },
  {
    id: "campfire", station: "normal", label: "Campfire", description: "A basic campfire.", info: "HP: 300",
    result: { itemId: "campfire", amount: 1 }, ingredients: [{ itemId: "stone", amount: 10 }, { itemId: "wood", amount: 50 }], durationMs: 15000,
  },
  {
    id: "campfire_max", station: "normal", label: "Improved Campfire", description: "An advanced campfire.", info: "HP: 500, crafts 2x faster",
    result: { itemId: "campfire_max", amount: 1 }, ingredients: [{ itemId: "stone", amount: 30 }, { itemId: "wood", amount: 100 }], durationMs: 20000,
  },
  {
    id: "workbench", station: "normal", label: "Workbench", description: "A crafting station.", info: "HP: 400",
    result: { itemId: "workbench", amount: 1 }, ingredients: [{ itemId: "wood", amount: 40 }, { itemId: "stone", amount: 20 }], durationMs: 15000,
  },
  {
    id: "hatchet", station: "normal", label: "Stone Hatchet", description: "A basic harvesting tool.", info: "Damage: 10",
    result: { itemId: "hatchet", amount: 1 }, ingredients: [{ itemId: "stone", amount: 5 }, { itemId: "wood", amount: 20 }], durationMs: 5000,
  },
  {
    id: "pickaxe_stone", station: "workbench", label: "Stone Pickaxe", description: "A mining tool.", info: "Damage: 25",
    result: { itemId: "pickaxe_stone", amount: 1 }, ingredients: [{ itemId: "stone", amount: 30 }, { itemId: "wood", amount: 100 }], durationMs: 15000,
  },
  {
    id: "hammer", station: "workbench", label: "Hammer", description: "A heavy construction tool.", info: "Damage: 150; 750 to your own objects",
    result: { itemId: "hammer", amount: 1 }, ingredients: [{ itemId: "wood", amount: 300 }, { itemId: "metal", amount: 10 }], durationMs: 120000,
  },
  {
    id: "metal", station: "campfire_max", label: "Metal", description: "Smelt iron ore into metal.", info: "1 ore → 1 metal, 30s",
    result: { itemId: "metal", amount: 1 }, ingredients: [{ itemId: "ironOre", amount: 1 }], durationMs: 30000,
  },
];

const BUILDING_RECIPES = [
  ["wood_wall","Wood wall",10_000,20,"wood"], ["wood_door","Wood door",15_000,60,"wood"],
  ["stone_wall","Stone wall",15_000,20,"stone"], ["stone_door","Stone door",20_000,60,"stone"],
  ["metal_wall","Metal wall",40_000,3,"metal"], ["metal_door","Metal door",60_000,9,"metal"],
].map(([id,label,duration,amount,itemId]) => ({ id:`build_${id}`, station:"workbench", label, description:`Placeable ${label.toLowerCase()}`, info:`HP: building`, result:{itemId:id,amount:1}, ingredients:[{itemId,amount}], durationMs:duration, workbenchDurationMs:duration }));
CRAFT_RECIPES.push(...BUILDING_RECIPES);
const WORKBENCH_RECIPES = new Set(["wood_spear", "campfire", "campfire_max", "workbench", "hatchet", "pickaxe_stone", "hammer", ...BUILDING_RECIPES.map(r=>r.id)]);

export function getCraftRecipe(id) { return CRAFT_RECIPES.find((r) => r.id === id) ?? null; }
export function getCraftClientCatalog() {
  return CRAFT_RECIPES.map((r) => ({ ...r, ingredients: r.ingredients.map((i) => ({ ...i })), result: { ...r.result } }));
}
export function isRecipeForStation(recipe, station) {
  if (!recipe) return false;
  if (station === "normal") return recipe.station === "normal";
  if (station === "campfire") return recipe.station === "campfire";
  if (station === "campfire_max") return recipe.station === "campfire" || recipe.id === "metal";
  if (station === "workbench") return WORKBENCH_RECIPES.has(recipe.id);
  return false;
}

export const CRAFTBOX_LAYOUT = {
  nativeWidth: 1190, nativeHeight: 809,
  grid: { cols: 5, rows: 6, origins: [69,185,301,417,533,649], colStarts: [61,177,294,409,525], cellSize: 97 },
  result: { icon: { cx: 784, cy: 121, size: 118 }, info: { x: 894, y: 62, w: 240, h: 118 }, cx: 1010, cy: 121, size: 110 },
  ingredients: { startX: 713, y: 215, cellSize: 79, gap: 12 },
  craftButton: { x: 894, y: 302, w: 259, h: 79 },
};