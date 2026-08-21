
export function chooseVectorToAdd(movement, id, application) {
  if (movement === "KeyW") application.playersList.addVector(id, "up");
  if (movement === "KeyS") application.playersList.addVector(id, "down");
  if (movement === "KeyD") application.playersList.addVector(id, "right");
  if (movement === "KeyA") application.playersList.addVector(id, "left");
  if (movement === "ShiftLeft" || movement === "ShiftRight") application.playersList.setSprinting(id, true);
}

export function chooseVectorToDelete(movement, id, application) {
  if (movement === "KeyW") application.playersList.deleteVector(id, "up");
  if (movement === "KeyS") application.playersList.deleteVector(id, "down");
  if (movement === "KeyD") application.playersList.deleteVector(id, "right");
  if (movement === "KeyA") application.playersList.deleteVector(id, "left");
  if (movement === "ShiftLeft" || movement === "ShiftRight") application.playersList.setSprinting(id, false);
}