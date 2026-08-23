export function cloneInventory(inventory) {
  return (inventory ?? []).map((slot) =>
    slot ? { itemId: slot.itemId, amount: slot.amount } : null
  );
}

export function restoreInventory(inventory, snapshot) {
  inventory.length = 0;
  for (const slot of snapshot) inventory.push(slot ? { ...slot } : null);
}

export function runInventoryTransaction(inventory, operation) {
  const snapshot = cloneInventory(inventory);
  try {
    const result = operation();
    if (result === false || result?.ok === false) {
      restoreInventory(inventory, snapshot);
      return { ok: false, result };
    }
    return { ok: true, result };
  } catch (error) {
    restoreInventory(inventory, snapshot);
    throw error;
  }
}