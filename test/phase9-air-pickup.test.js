import test from 'node:test';
import assert from 'node:assert/strict';
import { phase9AirPickupTestHooks } from '../phase9.js';

test('jump sweep collects a pickup when the vehicle hitbox only grazes it mid-air',()=>{
  const radius=74;
  const motion={type:'jump',fromX:1000,fromY:3000,toX:1180,toY:3000,apex:150};
  const middle=phase9AirPickupTestHooks.motionPoint(motion,.5);
  const box={x:middle.x+radius-1,y:middle.y-8};
  assert.equal(phase9AirPickupTestHooks.motionTouchesPickup(motion,box,radius),true);
});

test('jump sweep does not collect a pickup outside the hitbox along the complete arc',()=>{
  const radius=74;
  const motion={type:'jump',fromX:1000,fromY:3000,toX:1180,toY:3000,apex:150};
  const box={x:1450,y:2450};
  assert.equal(phase9AirPickupTestHooks.motionTouchesPickup(motion,box,radius),false);
});

test('fall sweep can collect a pickup without requiring a grounded endpoint contact',()=>{
  const radius=74;
  const motion={type:'fall',fromX:1000,fromY:2600,toX:1015,toY:3100,apex:0};
  const middle=phase9AirPickupTestHooks.motionPoint(motion,.5);
  const box={x:middle.x,y:middle.y-8+radius-1};
  assert.equal(phase9AirPickupTestHooks.motionTouchesPickup(motion,box,radius),true);
});
