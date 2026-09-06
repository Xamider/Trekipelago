import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForegroundClock } from './foregroundClock';

test('startup and background epochs cannot permit spawn work', () => {
  const clock = new ForegroundClock();
  assert.equal(clock.permits(clock.capture()), false);
  clock.setVisible(true);
  assert.equal(clock.permits(clock.capture()), true);
  clock.setVisible(false);
  assert.equal(clock.permits(clock.capture()), false);
});

test('a spawn command queued before screen lock is rejected when it executes', async () => {
  const clock = new ForegroundClock();
  clock.setVisible(true);
  const captured = clock.capture();
  const queuedSpawn = Promise.resolve().then(() => clock.permits(captured));
  clock.setVisible(false);
  assert.equal(await queuedSpawn, false);
});

test('foreground return allows new work but rejects an earlier visible epoch', async () => {
  const clock = new ForegroundClock();
  clock.setVisible(true);
  const earlierEpoch = clock.capture();
  const queuedSpawn = Promise.resolve().then(() => clock.permits(earlierEpoch));
  clock.setVisible(false);
  clock.setVisible(true);
  assert.equal(await queuedSpawn, false);
  assert.equal(clock.permits(clock.capture()), true);
});
