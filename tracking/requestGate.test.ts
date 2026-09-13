import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestGate } from './requestGate';

test('a stalled GPS request cannot accumulate parallel watchdog requests', async () => {
  let now = 1_000;
  const gate = new RequestGate(8_000, () => now);
  let calls = 0;
  let finish!: () => void;
  const pending = gate.run(() => {
    calls++;
    return new Promise<void>(resolve => { finish = resolve; });
  });
  for (let second = 0; second < 60; second++) {
    now += 1_000;
    await gate.run(async () => { calls++; });
  }
  assert.equal(calls, 1);
  finish();
  await pending;
  await gate.run(async () => { calls++; });
  assert.equal(calls, 2, 'Recovery can resume after the old request finishes');
});

test('rapid GPS failures wait for the retry interval without blocking later recovery', async () => {
  let now = 1_000;
  const gate = new RequestGate(8_000, () => now);
  let calls = 0;
  await assert.rejects(gate.run(async () => {
    calls++;
    throw new Error('GPS unavailable');
  }), /GPS unavailable/);
  now += 7_999;
  await gate.run(async () => { calls++; });
  assert.equal(calls, 1);
  now++;
  await gate.run(async () => { calls++; });
  assert.equal(calls, 2);
});

test('frequent notification changes produce at most one native update per interval', async () => {
  let now = 1_000;
  const gate = new RequestGate(10_000, () => now);
  let updates = 0;
  for (let second = 0; second <= 30; second++) {
    await gate.run(async () => { updates++; });
    now += 1_000;
  }
  assert.equal(updates, 4);
});

test('moving the device clock backward does not stall GPS recovery', async () => {
  let now = 100_000;
  const gate = new RequestGate(8_000, () => now);
  let calls = 0;
  await gate.run(async () => { calls++; });
  now = 1_000;
  await gate.run(async () => { calls++; });
  assert.equal(calls, 2);
});
