import { randomInt } from 'node:crypto';
import { findRoomBySocket, getRoom } from './rooms.js';
import {
  advanceTurnIfDue6A as baseAdvance,
  fireProjectile6A as baseFire,
  jumpActivePlayer6A as baseJump,
  moveActivePlayer6A as baseMove,
  publicRoomState6A as basePublic,
  selectItem6A as baseSelect
} from './phase6a.js';

const HEAL_AMOUNT = 30;
const MAX_HP = 100;
const HEAL_WEIGHT = 15;
const AIR_STRIKE_WEIGHT = 8;
const BASE_POOL_WEIGHT = 100;
const FULL_POOL_WEIGHT = BASE_POOL_WEIGHT + HEAL_WEIGHT + AIR_STRIKE_WEIGHT;
const AIR_STRIKE_SHELLS = 7;
const AIR_STRIKE_WARNING_MS = 1200;
const AIR_STRIKE_STAGGER_MS = 120;
const AIR_STRIKE_DAMAGE = 16;
const AIR_STRIKE_RADIUS = 165;
const AIR_STRIKE_CRATER_RADIUS = 72;
const AIR_STRIKE_CRATER_DEPTH = 62;
const AIR_STRIKE_SPACING = 105;
const GROUND_OFFSET = 8;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;

const ITEM_POOL = [
  { type: 'heavy', label: 'HEAVY BOMB', weight: 30 },
  { type: 'triple', label: 'TRIPLE SHOT', weight: 30 },
  { type: 'cluster', label: 'CLUSTER BOMB', weight: 25 },
  { type: 'shield', label: 'SHIELD', weight: 15 },
  { type: 'heal', label: 'HEAL +30', weight: HEAL_WEIGHT },
  { type: 'airstrike', label: 'AIR STRIKE', weight: AIR_STRIKE_WEIGHT }
];

const HOLES={rolling:[],terraces:[[2430,2550]],twinpeaks:[[2390,2510]],basin:[[1140,1240],[3760,3860]],brokenridge:[[1010,1140],[2410,2550],[3860,3980]],islands:[[900,1040],[1920,2080],[2910,3070],[3960,4110]],canyon:[[2380,2580]]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const gaussian=(x,c,w,a)=>a*Math.exp(-((x-c)**2)/w);
const plateau=(x,l,r,y,f)=>x>=l&&x<=r?y:f;
function baseY(p,x){switch(p){case'terraces':{let y=3520+Math.sin(x/560)*100;y=plateau(x,330,900,3190,y);y=plateau(x,1040,1640,2920,y);y=plateau(x,1770,2350,3250,y);y=plateau(x,2630,3260,2820,y);y=plateau(x,3390,3970,3110,y);return plateau(x,4110,4680,2870,y);}case'twinpeaks':{let y=3650-gaussian(x,1200,260000,850)-gaussian(x,3820,300000,900)+Math.sin(x/280)*60;if(x>650&&x<980)y=3000;if(x>1510&&x<1850)y=3170;if(x>3150&&x<3460)y=3090;if(x>4050&&x<4410)y=2890;return y;}case'basin':{let y=2870+gaussian(x,2500,850000,690)+Math.sin(x/410)*65;if(x>420&&x<950)y=2750;if(x>1320&&x<1760)y=3160;if(x>3240&&x<3680)y=3160;if(x>4050&&x<4580)y=2750;return y;}case'brokenridge':{let y=3490+Math.sin(x/210)*170+Math.sin(x/690+1.1)*130;if(x>420&&x<900)y=3070;if(x>1260&&x<1720)y=2740;if(x>1900&&x<2320)y=3260;if(x>2700&&x<3160)y=2860;if(x>3330&&x<3770)y=3180;if(x>4140&&x<4620)y=2780;return y;}case'islands':if(x<900)return 3100-gaussian(x,520,90000,260);if(x<1920)return 2840-gaussian(x,1470,125000,190);if(x<2910)return 3260-gaussian(x,2480,130000,320);if(x<3960)return 2760-gaussian(x,3470,135000,220);return 3160-gaussian(x,4540,100000,280);case'canyon':{let y=2920+Math.min(Math.abs(x-2500)*.28,700);if(x>420&&x<980)y=2700;if(x>1120&&x<1640)y=3030;if(x>1800&&x<2260)y=3380;if(x>2740&&x<3200)y=3380;if(x>3360&&x<3880)y=3030;if(x>4020&&x<4580)y=2700;return y;}default:{let y=3440+Math.sin(x/470)*165+Math.sin(x/980+.7)*95;if(x>700&&x<1120)y=3140;if(x>1760&&x<2140)y=2920;if(x>2840&&x<3240)y=3170;if(x>3890&&x<4320)y=2860;return y;}}}
function surface(room,x){const px=clamp(x,0,WORLD_WIDTH),p=room.terrainPreset||'rolling';if((HOLES[p]||[]).some(([l,r])=>px>=l&&px<=r))return WORLD_HEIGHT;let y=baseY(p,px);for(const c of room.arena?.craters||[]){const dx=Math.abs(px-c.x);if(dx<c.radius)y+=c.depth*Math.sqrt(Math.max(0,1-(dx/c.radius)**2));}return clamp(y,120,WORLD_HEIGHT);}

function rollPhase6cForNewPickup(room) {
  if (!room?.match || !Array.isArray(room.pickups)) return false;
  const turn = room.match.turnNumber ?? 0;
  let changed = false;
  for (const box of room.pickups) {
    if (box.spawnTurn !== turn || box.phase6cPoolRolled) continue;
    box.phase6cPoolRolled = true;
    const roll = randomInt(FULL_POOL_WEIGHT);
    if (roll < HEAL_WEIGHT) {
      box.type = 'heal';
      box.label = 'HEAL +30';
      changed = true;
    } else if (roll < HEAL_WEIGHT + AIR_STRIKE_WEIGHT) {
      box.type = 'airstrike';
      box.label = 'AIR STRIKE';
      changed = true;
    }
  }
  return changed;
}

function publicState(room) {
  let state = basePublic(room);
  if (rollPhase6cForNewPickup(room)) state = basePublic(room);
  state.phase = '6C.2';
  state.itemPool = ITEM_POOL.map(item => ({ ...item }));
  state.healRules = { amount: HEAL_AMOUNT, maxHp: MAX_HP, instant: true, consumesTurn: false, blockedAtFullHp: true };
  state.airStrikeRules = { shells: AIR_STRIKE_SHELLS, warningMs: AIR_STRIKE_WARNING_MS, damagePerShell: AIR_STRIKE_DAMAGE, radius: AIR_STRIKE_RADIUS, fullFriendlyFire: true, selfDamage: true };
  state.players = state.players.map(publicPlayer => {
    const player = room.players.find(entry => entry.id === publicPlayer.id);
    return { ...publicPlayer, lastUtility: player?.lastUtility ? { ...player.lastUtility } : null };
  });
  if (state.match?.projectile?.weaponType === 'airstrike') {
    state.match.projectile = { ...state.match.projectile, airStrikeShells: state.match.projectile.airStrikeShells?.map(shell => ({ ...shell })) };
  }
  return state;
}

function utilityValidationError(room, player, socketId) {
  if (!room) return 'not_in_room';
  if (room.status !== 'started') return 'match_not_started';
  if (room.match?.activePlayerId !== socketId) return 'not_your_turn';
  if (room.match?.projectile) return 'shot_in_flight';
  if (!player?.spawn || player.alive === false) return 'player_missing';
  if (player.motion?.endsAt && Date.now() < player.motion.endsAt) return 'player_in_motion';
  return null;
}

function resultFor(room){const alive=room.players.filter(p=>p.alive!==false);if(room.mode==='survival'){if(alive.length>1)return null;return{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:alive.length===0};}const teams=[...new Set(alive.map(p=>p.team))];if(teams.length>1)return null;return{type:'team',winnerTeam:teams[0]??null,draw:teams.length===0};}

function collectAirStrikePickup(room, shooter, x, y) {
  if (!Array.isArray(room.pickups) || !Array.isArray(shooter?.inventory)) return false;
  let changed = false;
  for (let i = room.pickups.length - 1; i >= 0; i -= 1) {
    const box = room.pickups[i];
    if (Math.hypot(box.x - x, box.y - y) > AIR_STRIKE_RADIUS) continue;
    const slot = shooter.inventory.findIndex(item => item == null);
    if (slot < 0) break;
    shooter.inventory[slot] = { type: box.type, label: box.label, pickedAtTurn: room.match?.turnNumber ?? 0 };
    shooter.lastPickup = { type: box.type, label: box.label, method: 'explosion', at: Date.now() };
    room.pickups.splice(i, 1);
    changed = true;
  }
  return changed;
}

function settleAfterAirStrike(room, now) {
  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const nextY = surface(room, player.spawn.x);
    if (nextY >= WORLD_HEIGHT - 1) {
      player.hp = 0;
      player.alive = false;
      player.motion = null;
      continue;
    }
    const targetY = nextY - GROUND_OFFSET;
    if (targetY > player.spawn.y + 2) {
      const fromY = player.spawn.y;
      player.spawn.y = targetY;
      player.motion = { type:'fall', startedAt:now, endsAt:now+Math.min(900,Math.max(300,(targetY-fromY)*2.2)), fromX:player.spawn.x, fromY, toX:player.spawn.x, toY:targetY, apex:0 };
    }
  }
}

function applyAirStrikeShell(room, q, shell, now) {
  if (shell.applied) return false;
  shell.applied = true;
  const shooter = room.players.find(player => player.id === q.ownerPlayerId);
  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const distance = Math.hypot(player.spawn.x - shell.x, (player.spawn.y - 10) - shell.y);
    if (distance > AIR_STRIKE_RADIUS) continue;
    let damage = Math.max(1, Math.round(AIR_STRIKE_DAMAGE * (1 - distance / AIR_STRIKE_RADIUS)));
    if (player.shield) {
      damage = Math.max(1, Math.ceil(damage * player.shield.factor));
      player.shield = null;
    }
    player.hp = Math.max(0, (player.hp ?? MAX_HP) - damage);
    player.lastDamage = { amount: damage, at: now, sourcePlayerId: q.ownerPlayerId };
    if (player.hp <= 0) player.alive = false;
  }
  if (shell.y < WORLD_HEIGHT - 1) room.arena.craters.push({ id:`${q.id}-air-${shell.index}`, x:shell.x, radius:AIR_STRIKE_CRATER_RADIUS, depth:AIR_STRIKE_CRATER_DEPTH, createdAt:now });
  if (collectAirStrikePickup(room, shooter, shell.x, shell.y)) q.pickupCollected = true;
  settleAfterAirStrike(room, now);
  room.match.pendingResult = resultFor(room);
  return true;
}

function prepareAirStrike(room, q, now) {
  const centerX = clamp(q.impactX, 40, WORLD_WIDTH - 40);
  const firstImpactAt = now + AIR_STRIKE_WARNING_MS;
  const half = (AIR_STRIKE_SHELLS - 1) / 2;
  q.weaponType = 'airstrike';
  q.targetX = centerX;
  q.warningUntil = firstImpactAt;
  q.pickupCollected = false;
  q.airStrikeShells = Array.from({ length:AIR_STRIKE_SHELLS }, (_, index) => {
    const x = clamp(centerX + (index - half) * AIR_STRIKE_SPACING, 35, WORLD_WIDTH - 35);
    const y = surface(room, x);
    return { index, x, y, startY:Math.max(80,y-1050), impactAt:firstImpactAt + index * AIR_STRIKE_STAGGER_MS, applied:false };
  });
  q.impactAt = firstImpactAt;
  q.specialResolveAt = q.airStrikeShells.at(-1).impactAt;
  q.resolveAt = q.specialResolveAt + 900;
  room.match.turnEndsAt = q.resolveAt;
}

function advanceAirStrike(room, now) {
  const q = room.match?.projectile;
  if (!q || q.weaponType !== 'airstrike') return null;
  let changed = false;
  for (const shell of q.airStrikeShells ?? []) if (!shell.applied && now >= shell.impactAt) changed = applyAirStrikeShell(room, q, shell, now) || changed;
  if (now < q.resolveAt) return changed ? room : null;

  if (room.match.pendingResult) {
    room.match.projectile = null;
    room.match.turnEndsAt = now;
    return baseAdvance(room.code, now) ?? room;
  }

  if (q.pickupCollected) {
    room.match.projectile = null;
    room.match.shotResolvedAt = now;
    room.match.turnEndsAt = now + Math.max(1000, q.resumeTurnMs ?? 0);
    room.camera = { mode:'follow', targetPlayerId:room.match.activePlayerId };
    return room;
  }

  room.match.projectile = null;
  room.match.turnEndsAt = now;
  return baseAdvance(room.code, now) ?? room;
}

export function fireProjectile6A(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  const player = room.players.find(entry => entry.id === socketId);
  const slot = player?.selectedItemSlot ?? 1;
  const item = slot > 1 ? player?.inventory?.[slot - 2] : null;

  if (item?.type === 'heal') {
    const blocked = utilityValidationError(room, player, socketId);
    if (blocked) return { ok: false, error: blocked };
    if ((player.hp ?? MAX_HP) >= MAX_HP) return { ok: false, error: 'heal_full_hp' };
    const before = player.hp ?? MAX_HP;
    const after = Math.min(MAX_HP, before + HEAL_AMOUNT);
    const healed = after - before;
    player.hp = after;
    player.inventory[slot - 2] = null;
    player.selectedItemSlot = 1;
    player.lastUtility = { type: 'heal', label: `HEAL +${healed} HP`, amount: healed, at: Date.now() };
    return { ok: true, room, healed };
  }

  if (item?.type === 'airstrike') {
    const blocked = utilityValidationError(room, player, socketId);
    if (blocked) return { ok:false, error:blocked };
    const now = Date.now();
    const remainingTurnMs = Math.max(0, (room.match?.turnEndsAt ?? now) - now);
    const result = baseFire(socketId);
    if (!result.ok) return result;
    const q = result.room.match?.projectile;
    if (!q) return { ok:false, error:'airstrike_target_failed' };
    q.resumeTurnMs = remainingTurnMs;
    prepareAirStrike(result.room, q, now);
    player.lastUtility = { type:'airstrike', label:'AIR STRIKE INBOUND', at:now };
    return result;
  }

  return baseFire(socketId);
}

export function publicRoomState6A(room) { return publicState(room); }
export function advanceTurnIfDue6A(code, now = Date.now()) { const room=getRoom(code); if(room?.match?.projectile?.weaponType==='airstrike') return advanceAirStrike(room,now); return baseAdvance(code, now); }
export function moveActivePlayer6A(socketId, direction) { return baseMove(socketId, direction); }
export function jumpActivePlayer6A(socketId, direction) { return baseJump(socketId, direction); }
export function selectItem6A(socketId, slot) { return baseSelect(socketId, slot); }
