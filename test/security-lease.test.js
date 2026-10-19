import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { armJoinDeadline } from '../connection-lease.js';

test('prejoin deadline closes raw and unjoined transports, protects admitted members and clears on close', () => {
  for (const admitted of [false, true]) {
    const transport = new EventEmitter();
    let action, closed = 0, cleared = 0;
    transport.close = () => closed++;
    armJoinDeadline(transport, () => admitted, {
      setTimer(fn, ms) { assert.equal(ms, 15000); action = fn; return { unref() {} }; },
      clearTimer() { cleared++; }
    });
    action();
    assert.equal(closed, admitted ? 0 : 1);
    transport.emit('close');
    assert.equal(cleared, 1);
  }
});
