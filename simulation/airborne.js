import {VEHICLE_BODY} from './collision.js';
import {HUANCAVELICA_V2_WORLD_HEIGHT,HUANCAVELICA_V2_WORLD_WIDTH} from './terrain.js';
// World units / seconds. The server is the only authority for these values.
export const V2_AIR_PHYSICS = Object.freeze({
  jumpImpulse: 900,
  gravity: 520,
  airAcceleration: 2100,
  maxHorizontalSpeed: 620,
  airDrag: 1.35,
  terminalSpeed: 1100,
  bodyHalfWidth: VEHICLE_BODY.halfWidth,
  bodyTop: VEHICLE_BODY.top,
  bodyFeet: VEHICLE_BODY.feet,
  visualWidth: VEHICLE_BODY.visualWidth,
  visualHeight: VEHICLE_BODY.visualHeight,
  sweepDistance: 2,
  maxStepSeconds: 1 / 120,
  voidBoundary: HUANCAVELICA_V2_WORLD_HEIGHT + 80
});


export function createAirbornePhysics(terrain){
const {findHuancavelicaV2SurfaceNear,isHuancavelicaV2Solid,firstHuancavelicaV2SolidOnSegment}=terrain;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const solid = (room, x, y) => isHuancavelicaV2Solid(room, x, y);
const sideBlocked = (room, x, y, direction) => {
  const edge = x + direction * V2_AIR_PHYSICS.bodyHalfWidth;
  for(let offset=V2_AIR_PHYSICS.bodyTop;offset<=-4;offset+=3)if(solid(room,edge,y+offset))return true;
  return false;
};
const headBlocked = (room, x, y) => {for(let dx=-45;dx<=45;dx+=3)if(solid(room,x+dx,y+V2_AIR_PHYSICS.bodyTop))return true;return false;};
const bodyClear = (room, x, y) => ![-55,-30,-8].some(offset => [-42,0,42].some(dx => solid(room,x+dx,y+offset)));

function v2GroundSurface(room, spawn) {
  if (!spawn) return null;
  const feet = spawn.y + V2_AIR_PHYSICS.bodyFeet;
  let surface=null;
  for(let dx=-36;dx<=36;dx+=3){
    if(solid(room,spawn.x+dx,feet-7)||!solid(room,spawn.x+dx,feet+9))continue;
    const hit=firstHuancavelicaV2SolidOnSegment(room,{x:spawn.x+dx,y:feet-7},{x:spawn.x+dx,y:feet+9});
    if(hit&&(surface==null||hit.y<surface))surface=hit.y;
  }
  return surface;
}

function startV2Airborne(player, now, { jump = false, reason = 'ledge' } = {}) {
  if (player.airborne) return false;
  const input = clamp(Number(player.v2HorizontalInput) || 0, -1, 1);
  player.airborne = {
    vx: jump ? input * 80 : input * 55,
    vy: jump ? -V2_AIR_PHYSICS.jumpImpulse : 0,
    input,
    startedAt: now,
    updatedAt: now,
    reason
  };
  player.motion = null;
  return true;
}

function setV2AirInput(player, direction) {
  if (![-1, 0, 1].includes(direction)) return false;
  player.v2HorizontalInput = direction;
  if (player.airborne) player.airborne.input = direction;
  return true;
}

function walkV2Player(room,player,direction,now,onStep=()=>{}){
  const beforeX=player.spawn.x;player.motion=null;
  for(let remaining=15;remaining>0;remaining-=2){
    const x=clamp(player.spawn.x+direction*Math.min(2,remaining),45,HUANCAVELICA_V2_WORLD_WIDTH-45),feet=player.spawn.y+8;
    if(x===player.spawn.x)break;
    const surfaces=[-36,0,36].map(dx=>findHuancavelicaV2SurfaceNear(room,x+dx,feet,42,42)).filter(y=>y!=null);
    if(!surfaces.length){player.spawn={...player.spawn,x,facing:direction};startV2Airborne(player,now,{reason:'ledge'});onStep(player);return{moved:true,naturalDrop:true};}
    const y=Math.min(...surfaces)-8;
    if(!bodyClear(room,x,y)||sideBlocked(room,x,y,direction)||headBlocked(room,x,y))break;
    let ceiling=false;
    if(y<player.spawn.y)for(let dx=-45;dx<=45;dx+=3)if(firstHuancavelicaV2SolidOnSegment(room,{x:player.spawn.x+dx,y:player.spawn.y+V2_AIR_PHYSICS.bodyTop},{x:x+dx,y:y+V2_AIR_PHYSICS.bodyTop})){ceiling=true;break;}
    if(ceiling)break;
    player.spawn={x,y,facing:direction};onStep(player);
  }
  return{moved:player.spawn.x!==beforeX};
}

function sweepHorizontal(room, player, delta) {
  if (!delta) return false;
  const direction = Math.sign(delta), steps = Math.ceil(Math.abs(delta) / V2_AIR_PHYSICS.sweepDistance);
  for (let index = 0; index < steps; index += 1) {
    const x = clamp(player.spawn.x + delta / steps, V2_AIR_PHYSICS.bodyHalfWidth, HUANCAVELICA_V2_WORLD_WIDTH - V2_AIR_PHYSICS.bodyHalfWidth);
    if (x === player.spawn.x) continue;
    if (sideBlocked(room, x, player.spawn.y, direction)) return true;
    player.spawn.x = x;
  }
  player.spawn.facing = direction;
  return false;
}

function landingSurface(room, spawn, previousFeet) {
  const feet = spawn.y + V2_AIR_PHYSICS.bodyFeet;
  let surface=null;
  // Partial wheel support is valid. A blocked foot must become a landing,
  // not vy=0 while rejecting the same narrow edge on every later tick.
  for(let dx=-36;dx<=36;dx+=3){
    let fromY=previousFeet;
    if(solid(room,spawn.x+dx,fromY)){
      for(let rise=3;rise<=33&&solid(room,spawn.x+dx,fromY);rise+=3)fromY=previousFeet-rise;
      if(solid(room,spawn.x+dx,fromY))continue;
    }
    const hit=firstHuancavelicaV2SolidOnSegment(room,{x:spawn.x+dx,y:fromY},{x:spawn.x+dx,y:feet});
    if(hit&&(surface==null||hit.y<surface))surface=hit.y;
  }
  return surface==null?null:{...spawn,y:surface-V2_AIR_PHYSICS.bodyFeet};
}

function sweepVertical(room, player, delta) {
  if (!delta) return false;
  const descending = delta > 0, steps = Math.ceil(Math.abs(delta) / V2_AIR_PHYSICS.sweepDistance);
  for (let index = 0; index < steps; index += 1) {
    const previousFeet = player.spawn.y + V2_AIR_PHYSICS.bodyFeet;
    const y = player.spawn.y + delta / steps;
    if (descending) {
      const settled = landingSurface(room, { ...player.spawn, y }, previousFeet);
      if (settled) { player.spawn = settled; return 'landed'; }
    }
    if (!descending && headBlocked(room, player.spawn.x, y)) return 'blocked';
    player.spawn.y = y;
  }
  return false;
}

function advanceV2AirbornePlayer(room, player, now, onStep=()=>{}) {
  const air = player.airborne;
  if (!air || !player.spawn || player.alive === false) return false;
  // Bounded elapsed time avoids a huge teleport after process suspension. Every
  // simulated move is spatially swept, so even a late tick cannot tunnel.
  const elapsed=Math.max(0,(now-air.updatedAt)/1000);
  let remaining = Math.min(elapsed,.25);
  air.droppedSeconds=(air.droppedSeconds??0)+Math.max(0,elapsed-.25);
  if (!remaining) return false;
  while (remaining > 1e-7 && player.airborne) {
    const dt = Math.min(remaining, V2_AIR_PHYSICS.maxStepSeconds);
    remaining -= dt;
    air.vx = clamp((air.vx + air.input * V2_AIR_PHYSICS.airAcceleration * dt) * Math.exp(-V2_AIR_PHYSICS.airDrag * dt), -V2_AIR_PHYSICS.maxHorizontalSpeed, V2_AIR_PHYSICS.maxHorizontalSpeed);
    air.vy = Math.min(V2_AIR_PHYSICS.terminalSpeed, air.vy + V2_AIR_PHYSICS.gravity * dt);
    // Rising clears the ground before horizontal steering is tested; on descent
    // we test the side first so the body cannot cut diagonally through a wall.
    const rising = air.vy < 0;
    let hit = rising ? sweepVertical(room, player, air.vy * dt) : false;
    if (sweepHorizontal(room, player, air.vx * dt)) air.vx = 0;
    if (!rising) hit = sweepVertical(room, player, air.vy * dt);
    onStep(player);
    if (hit === 'landed') { player.airborne = null; break; }
    if (hit === 'blocked') air.vy = 0;
    if (player.spawn.y + V2_AIR_PHYSICS.bodyTop > V2_AIR_PHYSICS.voidBoundary) {
      player.airborne = null;
      player.v2HorizontalInput = 0;
      player.alive = false;
      player.hp = 0;
      break;
    }
  }
  if (player.airborne) air.updatedAt = now;
  return true;
}

const scoped=fn=>(room,...args)=>terrain.withTerrainSnapshot(room,()=>fn(room,...args));
return Object.freeze({v2GroundSurface:scoped(v2GroundSurface),startV2Airborne,setV2AirInput,walkV2Player:scoped(walkV2Player),advanceV2AirbornePlayer:scoped(advanceV2AirbornePlayer)});
}
