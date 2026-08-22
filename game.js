export class GameSession {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.status = 'lobby';
    this.craters = [];
    this.wind = { direction: 1, strength: 0 };
    this.currentTurn = null;
  }
}
