import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateMaze, isMazeSolution, moveMazePath, swipeMazePath, type Maze } from './maze';
import { beginTreasureChallenge, completeTreasureChallenge, createSave, DEFAULT_SOLO_CONFIG,
  getTreasureReward, processLocations, removeTreasureBox, setTracking, treasureProgress, validateConfig } from './engine';

const NOW = 1000000;
const SESSION = 'maze-session';
const fresh = (limit = 10) => processLocations(createSave({ ...DEFAULT_SOLO_CONFIG, maxTreasureRewards: limit }, SESSION, NOW),
  SESSION, [{ latitude: 0, longitude: 0, accuracy: 3, timestamp: NOW }], NOW, 0, false, () => 0);

function solve(maze: Maze): number[] {
  const paths = [[0]];
  const seen = new Set([0]);
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const cell = path[path.length - 1];
    if (cell === maze.size * maze.size - 1) return path;
    for (const next of maze.passages[cell]) {
      if (!seen.has(next)) { seen.add(next); paths.push([...path, next]); }
    }
  }
  throw new Error('Maze has no route to the treasure.');
}

test('random mazes connect all cells, respect grid walls, and vary between seeds', () => {
  const layouts = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    let value = seed;
    const maze = generateMaze(() => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; });
    layouts.add(JSON.stringify(maze));
    assert.equal(maze.passages.length, 256);
    assert.equal(maze.passages.reduce((sum, neighbors) => sum + neighbors.length, 0), 510);
    const seen = new Set<number>();
    const walk = [0];
    while (walk.length) {
      const cell = walk.pop()!;
      if (seen.has(cell)) continue;
      seen.add(cell);
      for (const next of maze.passages[cell]) {
        assert.ok(maze.passages[next].includes(cell));
        assert.equal(Math.abs(cell % 16 - next % 16) + Math.abs(Math.floor(cell / 16) - Math.floor(next / 16)), 1);
        walk.push(next);
      }
    }
    assert.equal(seen.size, 256);
    assert.ok(isMazeSolution(maze, solve(maze)));
    assert.equal(isMazeSolution(maze, [0, 255]), false);
    assert.equal(isMazeSolution(maze, [255]), false);
    assert.equal(isMazeSolution(maze, [0, -1, 255]), false);
  }
  assert.ok(layouts.size > 20);
});

test('only a valid solution for the active treasure challenge grants its saved reward once', () => {
  const save = fresh();
  const id = save.treasures[0].id;
  const started = beginTreasureChallenge(save, SESSION, id, NOW, () => 0);
  const challenge = started.treasureChallenge!;
  assert.ok(challenge.kind !== 'tower_defense');
  assert.deepEqual(started.effects, []);
  assert.equal(treasureProgress(started).collected, 0);
  assert.equal(beginTreasureChallenge(started, SESSION, id, NOW), started);
  assert.equal(completeTreasureChallenge(started, SESSION, challenge.id, [0, 255], NOW), started);
  assert.equal(completeTreasureChallenge(started, SESSION, 'wrong', solve(challenge.maze), NOW), started);
  assert.equal(completeTreasureChallenge(started, 'wrong', challenge.id, solve(challenge.maze), NOW), started);
  const completed = completeTreasureChallenge(started, SESSION, challenge.id, solve(challenge.maze), NOW, () => 0);
  assert.equal(completed.treasureChallenge, null);
  assert.equal(treasureProgress(completed).collected, 1);
  assert.equal(completed.effects[0].type, getTreasureReward(save.treasures[0]).type);
  assert.equal(completeTreasureChallenge(completed, SESSION, challenge.id, solve(challenge.maze), NOW), completed);
});

test('stale GPS, removed boxes and stopped sessions cannot open treasures through the maze', () => {
  const save = fresh();
  const id = save.treasures[0].id;
  assert.equal(beginTreasureChallenge(save, SESSION, id, NOW + 31000), save);
  const started = beginTreasureChallenge(save, SESSION, id, NOW, () => 0);
  const challenge = started.treasureChallenge!;
  assert.ok(challenge.kind !== 'tower_defense');
  const path = solve(challenge.maze);
  assert.equal(completeTreasureChallenge(started, SESSION, challenge.id, path, NOW + 31000), started);
  const removed = removeTreasureBox(started, SESSION, id, NOW);
  assert.equal(completeTreasureChallenge(removed, SESSION, challenge.id, path, NOW), removed);
  const paused = setTracking(started, false, 'paused', NOW);
  assert.equal(paused.treasureChallenge, null);
  assert.equal(completeTreasureChallenge(paused, SESSION, challenge.id, path, NOW), paused);
});

test('the reward cap stops items while successful labyrinths still increase the collected counter', () => {
  for (const limit of [0, 1]) {
    let save = fresh(limit);
    const ids = save.treasures.map(box => box.id);
    for (const id of ids) {
      save = beginTreasureChallenge(save, SESSION, id, NOW, () => 0);
      const challenge = save.treasureChallenge!;
      assert.ok(challenge.kind !== 'tower_defense');
      save = completeTreasureChallenge(save, SESSION, challenge.id, solve(challenge.maze), NOW, () => 0);
    }
    assert.deepEqual(treasureProgress(save), { collected: 2, rewarded: limit, limit });
    assert.equal(save.effects.length, limit);
    if (limit) assert.equal(save.effects[0].expiresAt, NOW + 15 * 60000);
    assert.equal(save.distanceItemsClaimed, 0);
    assert.equal(save.orbItemsClaimed, 0);
    const reloaded = JSON.parse(JSON.stringify(save));
    assert.deepEqual(treasureProgress(reloaded), treasureProgress(save));
  }
  for (const maxTreasureRewards of [-1, 1.5, Infinity, NaN]) assert.ok(validateConfig({ ...DEFAULT_SOLO_CONFIG, maxTreasureRewards }));
});


test('finger movement follows passages, stops at walls, and backtracks without jumping cells', () => {
  const maze = generateMaze(() => 0);
  let path = [0];
  const first = maze.passages[0][0];
  path = moveMazePath(maze, path, first);
  assert.deepEqual(path, [0, first]);
  assert.deepEqual(moveMazePath(maze, path, 255), path);
  assert.deepEqual(moveMazePath(maze, path, -1), path);
  assert.deepEqual(moveMazePath(maze, path, 0), [0]);
  const solution = solve(maze);
  let traced = [0];
  for (const cell of solution.slice(1)) traced = moveMazePath(maze, traced, cell);
  assert.ok(isMazeSolution(maze, traced));
});


test('sensitive five-pixel swipes move along a corridor without slipping through walls', () => {
  const maze = generateMaze(() => 0);
  assert.deepEqual(swipeMazePath(maze, [0], 4, 0), [0]);
  assert.deepEqual(swipeMazePath(maze, [0], 5, 1), [0, 1]);
  assert.deepEqual(swipeMazePath(maze, [0], -50, 0), [0]);
  const right = swipeMazePath(maze, [0], 500, 0);
  assert.equal(right[right.length - 1], 15);
  assert.deepEqual(swipeMazePath(maze, right, 0, -50), right);
  assert.deepEqual(swipeMazePath(maze, [0], NaN, 0), [0]);
});
