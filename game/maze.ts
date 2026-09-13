export interface Maze {
  size: number;
  passages: number[][];
}

/** Randomized depth-first carving produces a connected maze with no isolated cells. */
export function generateMaze(random: () => number = Math.random, size = 16): Maze {
  if (!Number.isInteger(size) || size < 2 || size > 20) throw new Error('Invalid maze size.');
  const passages: number[][] = Array.from({ length: size * size }, () => []);
  const visited = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const cell = stack[stack.length - 1];
    const row = Math.floor(cell / size);
    const col = cell % size;
    const neighbors = [row > 0 ? cell - size : -1, col < size - 1 ? cell + 1 : -1,
      row < size - 1 ? cell + size : -1, col > 0 ? cell - 1 : -1]
      .filter(next => next >= 0 && !visited.has(next));
    if (!neighbors.length) { stack.pop(); continue; }
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('Invalid random source.');
    const next = neighbors[Math.floor(draw * neighbors.length)];
    passages[cell].push(next);
    passages[next].push(cell);
    visited.add(next);
    stack.push(next);
  }
  return { size, passages };
}

export function isMazeSolution(maze: Maze, path: readonly number[]): boolean {
  return path.length >= 2 && path.length <= 10000 && path[0] === 0
    && path[path.length - 1] === maze.size * maze.size - 1
    && path.every((cell, index) => Number.isInteger(cell) && cell >= 0 && cell < maze.passages.length
      && (index === 0 || maze.passages[path[index - 1]]?.includes(cell)));
}

export function moveMazePath(maze: Maze, path: readonly number[], next: number): number[] {
  const player = path[path.length - 1];
  if (!maze.passages[player]?.includes(next)) return [...path];
  const previous = path.indexOf(next);
  return previous >= 0 ? path.slice(0, previous + 1) : [...path, next];
}

/** Short, axis-aligned swipes move cell by cell and never pass through walls. */
export function swipeMazePath(maze: Maze, path: readonly number[], dx: number, dy: number): number[] {
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (!Number.isFinite(distance) || distance < 5) return [...path];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const offset = Math.sign(horizontal ? dx : dy) * (horizontal ? 1 : maze.size);
  let next = [...path];
  for (let step = 0; step < Math.min(32, Math.floor(distance / 5)); step++) {
    const player = next[next.length - 1];
    if (player === maze.size ** 2 - 1 || !maze.passages[player].includes(player + offset)) break;
    next = moveMazePath(maze, next, player + offset);
  }
  return next;
}

export type TreasureGame = 'maze' | 'tower_defense';
export type TreasureMinigame = { kind: 'maze'; maze: Maze }
  | { kind: 'tower_defense'; defense: import('./towerDefense').DefenseLevel };
export type TreasureChallenge = {
  id: string;
  sessionId: string;
  treasureId: string;
} & ({ kind?: 'maze'; maze: Maze } | { kind: 'tower_defense'; defense: import('./towerDefense').DefenseLevel });
