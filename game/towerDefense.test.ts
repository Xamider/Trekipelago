import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDefenseLevel, simulateDefense, startDefense, stepDefense, TOWERS, validTowerPlacements, type DefenseLevel, type TowerPlacement } from './towerDefense';
import { beginTreasureChallenge, completeDefenseChallenge, completeTreasureChallenge, createSave, DEFAULT_SOLO_CONFIG,
  processLocations, treasureProgress } from './engine';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const strongDefense: TowerPlacement[] = [59, 3].map(cell => ({ cell, type: 'sniper' }));

test('generated defense routes are continuous 16 by 16 paths with 5–10 enemies with varied entrances and bends', () => {
  const paths = new Set<string>();
  const counts = new Set<number>();
  for (let seed = 1; seed <= 30; seed++) {
    const level = generateDefenseLevel(seeded(seed));
    paths.add(JSON.stringify(level.path));
    counts.add(level.enemyCount);
    assert.equal(level.size, 16);
    assert.ok(level.enemyCount >= 5 && level.enemyCount <= 10);
    assert.equal(new Set(level.path).size, level.path.length);
    level.path.forEach((cell, index) => {
      assert.ok(cell >= 0 && cell < 256);
      if (index) {
        const previous = level.path[index - 1];
        assert.equal(Math.abs(cell % 16 - previous % 16) + Math.abs(Math.floor(cell / 16) - Math.floor(previous / 16)), 1);
      }
    });
  }
  assert.ok(paths.size > 10);
  assert.equal(counts.size, 6);
});

test('placement enforces the path, board, tower types and maximum of three', () => {
  const level = generateDefenseLevel(() => 0);
  for (const invalid of [[], [...strongDefense, { cell: 7, type: 'pulse' as const }, { cell: 8, type: 'pulse' as const }],
    [{ cell: level.path[0], type: 'pulse' as const }], [{ cell: -1, type: 'pulse' as const }],
    [{ cell: 256, type: 'pulse' as const }], [strongDefense[0], strongDefense[0]],
    [{ cell: 55, type: 'invalid' as 'pulse' }]]) {
    assert.equal(validTowerPlacements(level, invalid), false);
    assert.equal(simulateDefense(level, invalid).status, 'lost');
  }
  assert.equal(Object.keys(TOWERS).length, 4);
  assert.equal(simulateDefense(level, [{ cell: 255, type: 'pulse' }]).status, 'lost');
});

test('combat includes one boss, slowing and splash, and is deterministic', () => {
  const level: DefenseLevel = { size: 16, path: Array.from({ length: 16 }, (_, x) => x + 16), enemyCount: 5 };
  const towers: TowerPlacement[] = [{ cell: 1, type: 'frost' }, { cell: 3, type: 'cannon' }, { cell: 5, type: 'pulse' }];
  let state = startDefense();
  let sawBoss = false;
  let sawSlow = false;
  const shots = new Set<string>();
  while (state.status === 'running') {
    state = stepDefense(level, towers, state);
    sawBoss ||= state.enemies.some(enemy => enemy.boss);
    sawSlow ||= state.enemies.some(enemy => enemy.slowUntil > state.tick);
    state.shots.forEach(shot => shots.add(shot.type));
  }
  assert.ok(sawBoss);
  assert.ok(sawSlow);
  assert.deepEqual([...shots].sort(), ['cannon', 'frost', 'pulse']);
  assert.deepEqual(simulateDefense(level, towers), state);
});

test('cannon damages clustered enemies, frost slows one target, and sniper reaches beyond pulse range', () => {
  const level: DefenseLevel = { size: 16, path: Array.from({ length: 16 }, (_, x) => x + 16), enemyCount: 5 };
  const cluster = { ...startDefense(), spawned: level.enemyCount + 1, enemies: [
    { id: 0, boss: false, health: 35, progress: 1, slowUntil: 0 },
    { id: 1, boss: false, health: 35, progress: 1.5, slowUntil: 0 },
  ] };
  const cannon = stepDefense(level, [{ cell: 0, type: 'cannon' }], cluster);
  assert.deepEqual(cannon.enemies.map(enemy => enemy.health), [20, 20]);
  const frost = stepDefense(level, [{ cell: 0, type: 'frost' }], cluster);
  assert.equal(frost.enemies[0].health, 35);
  assert.equal(frost.enemies[1].health, 31);
  assert.ok(Math.abs(frost.enemies[1].progress - 1.59) < 0.0001);
  assert.equal(frost.enemies[1].slowUntil, 17);
  const distant = { ...cluster, enemies: [{ ...cluster.enemies[0], progress: 3 }] };
  assert.equal(stepDefense(level, [{ cell: 0, type: 'pulse' }], distant).enemies[0].health, 35);
  assert.equal(stepDefense(level, [{ cell: 0, type: 'sniper' }], distant).enemies[0].health, 13);
  assert.deepEqual(cluster.enemies.map(enemy => enemy.health), [35, 35]);
});

test('only winning tower placements complete the correct challenge and grant one treasure reward', () => {
  const now = 1000000;
  const session = 'defense-test';
  let save = processLocations(createSave(DEFAULT_SOLO_CONFIG, session, now), session,
    [{ latitude: 0, longitude: 0, accuracy: 3, timestamp: now }], now, 0, false, () => 0);
  save.treasures[0].minigame = { kind: 'tower_defense', defense: generateDefenseLevel(seeded(2)) };
  save = beginTreasureChallenge(save, session, save.treasures[0].id, now, seeded(2));
  const challenge = save.treasureChallenge!;
  assert.equal(challenge.kind, 'tower_defense');
  assert.equal(completeTreasureChallenge(save, session, challenge.id, [0, 255], now), save);
  assert.equal(completeDefenseChallenge(save, session, challenge.id, [], now), save);
  assert.equal(completeDefenseChallenge(save, 'stale', challenge.id, strongDefense, now), save);
  const complete = completeDefenseChallenge(save, session, challenge.id, strongDefense, now, () => 0);
  assert.equal(complete.treasureChallenge, null);
  assert.equal(treasureProgress(complete).collected, 1);
  assert.equal(completeDefenseChallenge(complete, session, challenge.id, strongDefense, now), complete);
});


test('varied defense layouts defeat every single tower while well-placed defenses can win', () => {
  const fixtures = [
    { seed: 1, cells: [149, 1] }, { seed: 2, cells: [59, 3] },
    { seed: 3, cells: [92, 5] }, { seed: 4, cells: [132, 0] },
    { seed: 5, cells: [139, 27] }, { seed: 12, cells: [188, 121] },
    { seed: 20, cells: [166, 27] },
  ];
  const lengths = new Set<number>();
  for (const fixture of fixtures) {
    const level = generateDefenseLevel(seeded(fixture.seed));
    lengths.add(level.path.length);
    for (let cell = 0; cell < 256; cell++) {
      if (level.path.includes(cell)) continue;
      for (const type of Object.keys(TOWERS) as TowerPlacement['type'][]) {
        assert.equal(simulateDefense(level, [{ cell, type }]).status, 'lost', `Seed ${fixture.seed}: solo ${type} at ${cell}`);
      }
    }
    const result = simulateDefense(level, fixture.cells.map(cell => ({ cell, type: 'sniper' })));
    assert.equal(result.status, 'won');
    assert.equal(result.defeated, level.enemyCount + 1);
  }
  assert.ok(lengths.size >= 3);
});
