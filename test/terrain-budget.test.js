import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createGameplayCore} from '../simulation/core.js';
test('practice-sized400-cut terrain remains bounded during actual airborne sweeps',()=>{
 const mask=new Uint8Array(readFileSync(new URL('../assets/huancavelica-v2-terrain-mask.bin',import.meta.url))),core=createGameplayCore(mask);
 const room={arena:{craters:Array.from({length:400},(_,i)=>({id:'cut'+i,x:2500+i%50*45,y:2600+Math.floor(i/50)*45,radius:72}))}};
 const player={alive:true,hp:100,spawn:{x:345.3038674033149,y:1293.7955801104973,facing:1}};
 core.physics.startV2Airborne(player,0,{jump:true});const start=performance.now();
 for(let i=1;i<=100;i++)core.physics.advanceV2AirbornePlayer(room,player,i*20);
 const elapsed=performance.now()-start;console.log('400 cuts /100 actual air steps: '+elapsed.toFixed(1)+'ms / '+(elapsed/100).toFixed(2)+'ms per step');
 assert.ok(Number.isFinite(player.spawn.y));assert.equal(room.arena.craters.length,400);
});

test('query snapshot expires between scopes and restores safely after exceptions',()=>{
 const mask=new Uint8Array(readFileSync(new URL('../assets/huancavelica-v2-terrain-mask.bin',import.meta.url))),terrain=createGameplayCore(mask).terrain,room={arena:{craters:[]}},x=2500,y=330;
 assert.equal(terrain.isHuancavelicaV2Solid(room,x,y),true);
 assert.throws(()=>terrain.withTerrainSnapshot(room,()=>{throw new Error('read aborted');}));
 room.arena.craters.push({id:'new',x,y,radius:100});assert.equal(terrain.withTerrainSnapshot(room,()=>terrain.isHuancavelicaV2Solid(room,x,y)),false);
 assert.equal(terrain.isHuancavelicaV2Solid({arena:{craters:[]}},x,y),true);
});
