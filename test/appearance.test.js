import test from 'node:test';
import assert from 'node:assert/strict';
import {ANIMALS,CARTS} from '../appearance.js';
import {isValidClientPayload} from '../client-events.js';
import {createRoom,joinRoom,roomStore,setPlayerAppearance,setPlayerReady,startRoom,activateRoom,publicRoomState} from '../rooms.js';
import {publicRoomState9,setTerrain9,rematchRoom9} from '../phase11-huancavelica-v2.js';
function setup(){roomStore.clear();const room=createRoom('host','Host').room;joinRoom(room.code,'guest','Guest');return room;}
test('cosmetic protocol keeps old clients valid and validates every enum',()=>{
 assert.ok(isValidClientPayload('create_room',{name:'Old'}));assert.ok(isValidClientPayload('join_room',{name:'Old',code:'ABCD'}));
 for(const animal of ANIMALS)for(const cart of CARTS){
  assert.ok(isValidClientPayload('set_appearance',{animal:animal.id,cart:cart.id}));
  assert.ok(isValidClientPayload('create_room',{name:'New',animal:animal.id,cart:cart.id}));
  assert.ok(isValidClientPayload('join_room',{name:'New',code:'ABCD',animal:animal.id,cart:cart.id}));
 }
 for(const value of [null,{},['cuy'],'../cuy','<script>',1])assert.equal(isValidClientPayload('set_appearance',{animal:value,cart:'kart'}),false);
 for(const value of [null,{},['kart'],'../kart','<script>',1])assert.equal(isValidClientPayload('set_appearance',{animal:'cuy',cart:value}),false);
 assert.equal(isValidClientPayload('set_appearance',{animal:'cuy',cart:'kart',hp:999}),false);
 assert.equal(isValidClientPayload('create_room',{name:'Bad',animal:'dragon'}),false);
});
test('cosmetics mutate only the requesting player and do not touch combat state',()=>{
 const room=setup();room.players[0].ready=true;const before=structuredClone(room);
 assert.ok(setPlayerAppearance('host','cat','wood').ok);
 const expected=structuredClone(before);expected.players[0].appearance={animal:'cat',cart:'donofrio'};expected.players[0].ready=false;
 expected.lastLobbyActivityAt=room.lastLobbyActivityAt;assert.deepEqual(room,expected);
 assert.equal(setPlayerAppearance('outsider','cat','wood').error,'not_in_room');
});
test('same cosmetics are allowed for multiple players and same-choice retry retains ready',()=>{
 const room=setup();setPlayerAppearance('host','fox','buggy');setPlayerAppearance('guest','fox','buggy');setPlayerReady('host',true);
 assert.ok(setPlayerAppearance('host','fox','buggy').ok);assert.equal(room.players[0].ready,true);
 assert.deepEqual(room.players[0].appearance,room.players[1].appearance);
});

test('canonical Peru fleet accepts all eight vehicles and old ids migrate without clearing READY again',()=>{
 assert.deepEqual(CARTS.map(c=>c.id),['mototaxi','tico','yaris','pnp','donofrio','microbus','triciclo','rappi']);
 const room=setup();
 for(const cart of CARTS){assert.ok(setPlayerAppearance('host','cuy',cart.id).ok);assert.equal(publicRoomState(room).players[0].appearance.cart,cart.id);}
 setPlayerAppearance('host','cuy','mototaxi');setPlayerReady('host',true);
 assert.ok(setPlayerAppearance('host','cuy','kart').ok);assert.equal(room.players[0].ready,true);
 assert.equal(room.players[0].appearance.cart,'mototaxi');roomStore.clear();
});
test('invalid cosmetics and post-lobby requests leave room untouched',()=>{
 const room=setup();
 for(const status of ['lobby','countdown','started','finished']){
  room.status=status;const before=structuredClone(room);
  assert.equal(setPlayerAppearance('host','unknown','wood').ok,false);assert.deepEqual(room,before);
  if(status!=='lobby'){assert.equal(setPlayerAppearance('host','cat','wood').error,'appearance_locked');assert.deepEqual(room,before);}
 }
});
test('public state carries normalized cosmetics without leaking private metadata',()=>{
 const room=setup();setPlayerAppearance('host','capybara','scrap');room.players[1].appearance={animal:'evil',cart:'kart',private:'secret'};
 const state=publicRoomState(room);assert.deepEqual(state.players[0].appearance,{animal:'capybara',cart:'microbus'});
 assert.deepEqual(state.players[1].appearance,{animal:'cuy',cart:'mototaxi'});assert.equal(state.players[0].clientIdentity,undefined);
});
test('v2 countdown, activation and rematch keep each selected animal and cart',()=>{
 const room=setup();setTerrain9('host','huancavelica-v2');setPlayerAppearance('host','bear','tank');setPlayerAppearance('guest','rabbit','rover');
 setPlayerReady('host',true);setPlayerReady('guest',true);assert.ok(startRoom('host').ok);activateRoom(room.code,room.match.startAt);
 const looks=room.players.map(p=>p.appearance);assert.deepEqual(publicRoomState9(room).players.map(p=>p.appearance),looks);
 room.status='finished';assert.ok(rematchRoom9('host',{randomMap:false}).ok);
 assert.deepEqual(publicRoomState9(room).players.map(p=>p.appearance),looks);roomStore.clear();
});
