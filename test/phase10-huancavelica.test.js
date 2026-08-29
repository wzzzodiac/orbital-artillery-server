import test from 'node:test';
import assert from 'node:assert/strict';
import { phase10HuancavelicaTestHooks } from '../phase10-huancavelica.js';

test('Huancavelica Simulator is exposed as a Phase 10 terrain without changing the authoritative collision preset',()=>{
  const room={phase10TerrainAlias:'huancavelica'};
  const state={terrainPreset:'islands',terrainPresets:[{id:'islands',name:'Drift Islands'}],arena:{terrainPreset:'islands',terrainName:'Drift Islands'}};
  const decorated=phase10HuancavelicaTestHooks.decoratePublicState(room,state);
  assert.equal(decorated.terrainPreset,'huancavelica');
  assert.equal(decorated.arena.terrainName,'Huancavelica Simulator');
  assert.equal(decorated.arena.phase10Theme,'huancavelica');
  assert.equal(decorated.arena.collisionBasePreset,'islands');
  assert.ok(decorated.terrainPresets.some(entry=>entry.id==='huancavelica'&&entry.name==='Huancavelica Simulator'));
});
