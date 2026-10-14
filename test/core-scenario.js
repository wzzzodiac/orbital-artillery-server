import {createGameplayCore} from '../simulation/core.js';
import {HUANCAVELICA_V2_SCALE as scale} from '../simulation/terrain.js';
export function canonical(value){return JSON.parse(JSON.stringify(value,(k,v)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*1e6)/1e6:v));}
export function runCoreScenario(mask){
 const cases=[];
 function setup(weapon='basic'){
  const core=createGameplayCore(mask),room={status:'started',mode:'team',code:'CORE',simulation:{seed:12345,eventSequence:0},arena:{craters:[]},pickups:[],events:[],players:[],match:{activePlayerId:'p',turnOrder:['p','t'],turnIndex:0,turnNumber:1,turnDurationMs:40000,turnEndsAt:1040000,aimAngle:5,aimPower:10,wind:{signed:0}}};
  for(const [id,x,team]of[['p',100,'A'],['t',150,'B']])room.players.push({id,name:id,team,alive:true,hp:100,maxHp:100,spawn:{x:x*scale,y:core.terrain.findHuancavelicaV2SurfaceBelow(room,x*scale,379*scale-30)-8,facing:1},motion:null,airborne:null,inventory:[null,null],selectedItemSlot:1});
  if(weapon!=='basic'){room.players[0].inventory[0]={type:weapon,label:weapon};room.players[0].selectedItemSlot=2;}
  return{core,room};
 }
 {
  const{core,room}=setup();room.players[1].spawn.x=1300;
  core.command(room,'p','jump_player',{},1000000);
  const track=[];for(let i=1;i<=200;i++){const now=1000000+i*20;if(i===35)core.command(room,'p','air_input',{direction:1},now);if(i===55)core.command(room,'p','air_input',{direction:-1},now);if(i===65)core.command(room,'p','air_input',{direction:0},now);core.tick(room,now);if(i%10===0)track.push(core.snapshot(room.players[0]));}
  core.spawnPickup(room,[{x:500*scale,y:700*scale}],1005000);
  cases.push({type:'movement-seed-pickup',track,state:core.snapshot(room)});
 }
 for(const weapon of ['basic','heavy','triple','cluster','airstrike','nuke']){
  const{core,room}=setup(weapon);if(['triple','cluster','airstrike'].includes(weapon))room.players[1].shield={factor:.5};
  const response=core.command(room,'p','fire_projectile',{},1000000);if(!response.ok)throw new Error(JSON.stringify(response));
  const attack=room.match.projectile;
  for(let i=1;i<=1700&&room.match.projectile;i++)core.tick(room,1000000+i*20);
  if(room.match.projectile)throw new Error('Unbounded '+weapon);
  cases.push({type:weapon,attack,state:core.snapshot(room)});
 }
 {
  const{core,room}=setup();const p=room.players[0];p.hp=65;p.inventory=[{type:'heal'},{type:'shield'}];p.selectedItemSlot=2;core.command(room,'p','fire_projectile',{},1000000);p.selectedItemSlot=3;core.command(room,'p','fire_projectile',{},1000001);
  room.pickups=[{id:'touch',type:'heavy',label:'HEAVY BOMB',x:p.spawn.x,y:p.spawn.y-8}];core.tick(room,1000020);cases.push({type:'utilities-touch',state:core.snapshot(room)});
 }
 return canonical(cases);
}
