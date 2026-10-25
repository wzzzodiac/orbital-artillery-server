import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runCoreScenario} from './core-scenario.js';
import {createGameplayCore} from '../simulation/core.js';
const mask=new Uint8Array(readFileSync(new URL('../assets/huancavelica-v2-terrain-mask.bin',import.meta.url)));
test('shared core deterministic commands, seeds, contacts, cuts, physics and utilities replay',()=>{
 const a=runCoreScenario(mask),b=runCoreScenario(mask);assert.deepEqual(a,b);
 // Full wheel support changes four post-crater landing heights; contacts, HP,
 // cuts and turn results match the previous recorded replay (see QA diff).
 assert.equal(createHash('sha256').update(JSON.stringify(a)).digest('hex'),'58169e4bfa7e91a342eac12069fbac955e87d033ebe41f7e4fdf1198d9cd964b');
 for(const c of a.filter(x=>['basic','heavy','triple','cluster','airstrike','nuke'].includes(x.type))){
  assert.ok(c.state.arena.craters.length>0,c.type+' real cut');assert.equal(c.state.match.projectile,null);
  assert.ok(c.state.players.some(p=>p.hp<100),c.type+' real damage');
 }
 const utilities=a.at(-1).state.players[0];assert.equal(utilities.hp,85);assert.ok(utilities.shield);assert.equal(utilities.inventory[0].type,'heavy');
 const files=['terrain','airborne','weapons','combat','rules','projectiles','core'];
 for(const f of files)assert.doesNotMatch(readFileSync(new URL('../simulation/'+f+'.js',import.meta.url),'utf8'),/node:|Date\.now|Math\.random|document\.|window\.|fetch\(/);
});
test('core masks isolate mutations and snapshots are detached',()=>{
 const a=createGameplayCore(mask),b=createGameplayCore(mask),r={arena:{craters:[]}};
 const clean=a.terrain.huancavelicaV2MaskForRoom(r).slice();r.arena.craters.push({id:'c',x:2500,y:310,radius:190});
 assert.notDeepEqual(a.terrain.huancavelicaV2MaskForRoom(r),clean);assert.deepEqual(b.terrain.huancavelicaV2MaskForRoom({arena:{craters:[]}}),clean);
 const view=a.snapshot(r);view.arena.craters.length=0;assert.equal(r.arena.craters.length,1);
});
if(process.argv.includes('--digest'))console.log(createHash('sha256').update(JSON.stringify(runCoreScenario(mask))).digest('hex'));
