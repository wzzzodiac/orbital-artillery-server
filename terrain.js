export function createTerrainState(seed = 0) {
  return {
    seed,
    craters: []
  };
}

export function addCrater(terrain, crater) {
  terrain.craters.push({ x: crater.x, y: crater.y, radius: crater.radius });
}
