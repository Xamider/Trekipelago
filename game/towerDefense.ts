import { generateMaze } from './maze';

export type TowerType = 'pulse' | 'cannon' | 'frost' | 'sniper';
export interface TowerPlacement { cell: number; type: TowerType }
export interface DefenseLevel { size: 16; path: number[]; enemyCount: number }
export interface Enemy { id: number; boss: boolean; health: number; progress: number; slowUntil: number }
export interface Shot { from: number; x: number; y: number; type: TowerType }
export interface DefenseState {
  tick: number;
  spawned: number;
  defeated: number;
  enemies: Enemy[];
  cooldowns: number[];
  shots: Shot[];
  status: 'running' | 'won' | 'lost';
}
export const DEFENSE_STEP_MS = 100;
export const MAX_DEFENSE_TICKS = 1800;
export const TOWER_LIMIT = 3;
export const TOWERS: Record<TowerType, { name: string; description: string; range: number; damage: number; cooldown: number; color: string }> = {
  pulse: { name: 'Pulse', description: 'Rapid single-target fire', range: 2.7, damage: 6, cooldown: 6, color: '#70f40b' },
  cannon: { name: 'Cannon', description: 'Heavy splash damage', range: 2.7, damage: 15, cooldown: 15, color: '#fbbf24' },
  frost: { name: 'Frost', description: 'Slows enemies by 50%', range: 2.8, damage: 4, cooldown: 12, color: '#0dd3c3' },
  sniper: { name: 'Sniper', description: 'Long range, powerful shots', range: 4, damage: 22, cooldown: 20, color: '#c084fc' },
};

function drawInt(random: () => number, count: number): number {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('Invalid random source.');
  return Math.floor(draw * count);
}

/** A random coarse maze supplies varied bends and detours, with room for tower placement. */
export function generateDefenseLevel(random: () => number = Math.random): DefenseLevel {
  let seed = drawInt(random, 4294967296);
  const pathRandom = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let route: number[] = [];
  for (let attempt = 0; attempt < 32; attempt++) {
    const maze = generateMaze(pathRandom, 5);
    const queue = [[0]];
    const visited = new Set([0]);
    for (let index = 0; index < queue.length; index++) {
      const path = queue[index];
      const end = path[path.length - 1];
      if (end === 24) { route = path; break; }
      for (const next of maze.passages[end]) {
        if (!visited.has(next)) { visited.add(next); queue.push([...path, next]); }
      }
    }
    if (route.length >= 15 && route.length <= 23) break;
  }
  let x = 0;
  let y = 1;
  const path = [16];
  const appendTo = (nextX: number, nextY: number) => {
    while (x !== nextX || y !== nextY) {
      if (x !== nextX) x += Math.sign(nextX - x);
      else y += Math.sign(nextY - y);
      path.push(y * 16 + x);
    }
  };
  for (const cell of route) appendTo(1 + cell % 5 * 3, 1 + Math.floor(cell / 5) * 3);
  appendTo(15, 13);
  const rotations = drawInt(pathRandom, 4);
  const mirrored = drawInt(pathRandom, 2) === 1;
  const transformed = path.map(cell => {
    let col = cell % 16;
    let row = Math.floor(cell / 16);
    if (mirrored) col = 15 - col;
    for (let turn = 0; turn < rotations; turn++) [col, row] = [15 - row, col];
    return row * 16 + col;
  });
  return { size: 16, path: transformed, enemyCount: 5 + drawInt(pathRandom, 6) };
}

export function validTowerPlacements(level: DefenseLevel, towers: readonly TowerPlacement[]): boolean {
  return towers.length > 0 && towers.length <= TOWER_LIMIT && new Set(towers.map(tower => tower.cell)).size === towers.length
    && towers.every(tower => Number.isInteger(tower.cell) && tower.cell >= 0 && tower.cell < level.size ** 2
      && Object.hasOwn(TOWERS, tower.type) && !level.path.includes(tower.cell));
}

export function enemyPosition(level: DefenseLevel, progress: number): { x: number; y: number } {
  const index = Math.min(Math.floor(progress), level.path.length - 1);
  const from = level.path[index];
  const to = level.path[Math.min(index + 1, level.path.length - 1)];
  const fraction = progress - Math.floor(progress);
  return { x: from % 16 + (to % 16 - from % 16) * fraction,
    y: Math.floor(from / 16) + (Math.floor(to / 16) - Math.floor(from / 16)) * fraction };
}

export function startDefense(): DefenseState {
  return { tick: 0, spawned: 0, defeated: 0, enemies: [], cooldowns: [], shots: [], status: 'running' };
}

/** Fixed ticks are shared by the animation and reward verification. */
export function stepDefense(level: DefenseLevel, towers: readonly TowerPlacement[], state: DefenseState): DefenseState {
  if (state.status !== 'running') return state;
  const next: DefenseState = { ...state, tick: state.tick + 1,
    enemies: state.enemies.map(enemy => ({ ...enemy })), cooldowns: [...state.cooldowns], shots: [] };
  if (!validTowerPlacements(level, towers) || next.tick > MAX_DEFENSE_TICKS) return { ...next, status: 'lost' };
  if (next.spawned <= level.enemyCount && state.tick >= next.spawned * 18) {
    const boss = next.spawned === level.enemyCount;
    next.enemies.push({ id: next.spawned, boss, health: boss ? 240 : 35, progress: 0, slowUntil: 0 });
    next.spawned++;
  }
  towers.forEach((tower, index) => {
    if ((next.cooldowns[index] ?? 0) > next.tick) return;
    const spec = TOWERS[tower.type];
    const inRange = next.enemies.filter(enemy => {
      const position = enemyPosition(level, enemy.progress);
      return enemy.health > 0 && Math.hypot(position.x - tower.cell % 16, position.y - Math.floor(tower.cell / 16)) <= spec.range;
    }).sort((a, b) => b.progress - a.progress);
    const target = inRange[0];
    if (!target) return;
    const position = enemyPosition(level, target.progress);
    next.shots.push({ from: tower.cell, ...position, type: tower.type });
    next.cooldowns[index] = next.tick + spec.cooldown;
    for (const enemy of next.enemies) {
      const hit = enemy.id === target.id || (tower.type === 'cannon' && (() => {
        const other = enemyPosition(level, enemy.progress);
        return Math.hypot(other.x - position.x, other.y - position.y) <= 1.5;
      })());
      if (!hit || enemy.health <= 0) continue;
      enemy.health -= spec.damage;
      if (tower.type === 'frost') enemy.slowUntil = next.tick + 16;
    }
  });
  const survivors = next.enemies.filter(enemy => enemy.health > 0);
  next.defeated += next.enemies.length - survivors.length;
  next.enemies = survivors;
  for (const enemy of next.enemies) {
    enemy.progress += (enemy.boss ? 1 : 1.8) * (enemy.slowUntil > next.tick ? 0.5 : 1) * DEFENSE_STEP_MS / 1000;
    if (enemy.progress >= level.path.length - 1) next.status = 'lost';
  }
  if (next.defeated === level.enemyCount + 1) next.status = 'won';
  return next;
}

export function simulateDefense(level: DefenseLevel, towers: readonly TowerPlacement[]): DefenseState {
  let state = startDefense();
  do { state = stepDefense(level, towers, state); } while (state.status === 'running');
  return state;
}
