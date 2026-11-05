import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from './config';
import type { Obstacle, Point, ZoneId } from './types';
import { collides, obstaclesFor } from './world';

// 클릭 이동 경로만 계산합니다. 저장되는 경로도 이 수보다 길어지지 않습니다.
export const MAX_NAVIGATION_POINTS = 200;
const CELL = 24;
const BORDER = PLAYER_RADIUS + 25;
const COLUMNS = Math.floor((WORLD_WIDTH - BORDER * 2) / CELL) + 1;
const ROWS = Math.floor((WORLD_HEIGHT - BORDER * 2) / CELL) + 1;
const COUNT = COLUMNS * ROWS;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
interface Field { zone: ZoneId; obstacles: Obstacle[]; points: Point[]; walkable: Uint8Array; edges: Map<number, number[]> }
const fields = new Map<ZoneId, Field>();

const blocked = (point: Point, zone: ZoneId) => collides(point.x, point.y, PLAYER_RADIUS, zone);
function fieldFor(zone: ZoneId): Field {
  let field = fields.get(zone);
  if (!field) {
    const obstacles = obstaclesFor(zone);
    const points = Array.from({ length: COUNT }, (_, id) => ({ x: BORDER + id % COLUMNS * CELL, y: BORDER + Math.floor(id / COLUMNS) * CELL }));
    field = { zone, obstacles, points, walkable: Uint8Array.from(points, point => Number(!blocked(point, zone))), edges: new Map() };
    fields.set(zone, field);
  }
  return field;
}

// 검사 간격보다 짧게 모서리를 스치는 선도 장애물 내부를 통과할 수 없습니다.
function crossesObstacle(a: Point, b: Point, obstacle: Obstacle): boolean {
  let entry = 0, exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const extent = (axis === 'x' ? obstacle.width : obstacle.height) / 2 + PLAYER_RADIUS;
    const low = obstacle[axis] - extent, high = obstacle[axis] + extent;
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] <= low || a[axis] >= high) return false;
    } else {
      const first = (low - a[axis]) / delta, last = (high - a[axis]) / delta;
      entry = Math.max(entry, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
      if (entry >= exit) return false;
    }
  }
  return entry < exit;
}

function segmentClear(a: Point, b: Point, field: Field): boolean {
  if (blocked(a, field.zone) || blocked(b, field.zone)) return false;
  if (field.obstacles.some(obstacle => crossesObstacle(a, b, obstacle))) return false;
  const steps = Math.max(1, Math.ceil(distance(a, b) / 4));
  for (let step = 1; step <= steps; step++) {
    const point = { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps };
    if (blocked(point, field.zone)) return false;
  }
  return true;
}

/** 벽·나무·용암에 닿지 않는 직선 이동인지 확인합니다. */
export function isPathClear(start: Point, end: Point, zone: ZoneId): boolean {
  return [start.x, start.y, end.x, end.y].every(Number.isFinite) && segmentClear(start, end, fieldFor(zone));
}

function nearestNodes(point: Point, field: Field): number[] {
  const candidates: { id: number; distance: number }[] = [];
  const column = Math.round((point.x - BORDER) / CELL), row = Math.round((point.y - BORDER) / CELL);
  for (let y = Math.max(0, row - 3); y <= Math.min(ROWS - 1, row + 3); y++) {
    for (let x = Math.max(0, column - 3); x <= Math.min(COLUMNS - 1, column + 3); x++) {
      const id = y * COLUMNS + x, gap = distance(point, field.points[id]);
      if (field.walkable[id] && gap <= CELL * 2.5) candidates.push({ id, distance: gap });
    }
  }
  return candidates
    .sort((a, b) => a.distance - b.distance || a.id - b.id)
    .filter(item => segmentClear(point, field.points[item.id], field))
    .map(item => item.id);
}

function edgesFor(id: number, field: Field): number[] {
  const cached = field.edges.get(id);
  if (cached) return cached;
  const x = id % COLUMNS, y = Math.floor(id / COLUMNS);
  const edges: number[] = [];
  for (const [dx, dy] of directions) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLUMNS || ny >= ROWS) continue;
    if (dx && dy && (!field.walkable[y * COLUMNS + nx] || !field.walkable[ny * COLUMNS + x])) continue;
    const next = ny * COLUMNS + nx;
    if (field.walkable[next] && segmentClear(field.points[id], field.points[next], field)) edges.push(next);
  }
  field.edges.set(id, edges);
  return edges;
}

interface QueueEntry { id: number; score: number }
class Queue {
  private entries: QueueEntry[] = [];
  get length() { return this.entries.length; }
  push(entry: QueueEntry) {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent].score <= entry.score) break;
      this.entries[index] = this.entries[parent]; index = parent;
    }
    this.entries[index] = entry;
  }
  pop(): QueueEntry {
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let index = 0;
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].score < this.entries[child].score) child++;
        if (this.entries[child].score >= last.score) break;
        this.entries[index] = this.entries[child]; index = child;
      }
      this.entries[index] = last;
    }
    return first;
  }
}

/** 시작점을 제외한 경로입니다. 장애물 클릭은 가까운 빈 땅으로 조정하며, 불가능하면 null입니다. */
export function findPath(start: Point, requested: Point, zone: ZoneId): Point[] | null {
  if (![start.x, start.y, requested.x, requested.y].every(Number.isFinite)) return null;
  const field = fieldFor(zone);
  // 시작점은 이동시키지 않습니다. 유효하지 않은 저장 좌표를 경로로 순간 이동시키지 않습니다.
  const origin = start;
  if (blocked(origin, zone)) return null;
  const clipped = { x: Math.min(WORLD_WIDTH - BORDER, Math.max(BORDER, requested.x)), y: Math.min(WORLD_HEIGHT - BORDER, Math.max(BORDER, requested.y)) };
  let destination = clipped;
  if (blocked(clipped, zone)) {
    const candidate = field.points.map((point, id) => ({ point, id, distance: distance(point, clipped) }))
      .filter(item => field.walkable[item.id] && item.distance <= CELL * 4)
      .sort((a, b) => a.distance - b.distance || distance(a.point, origin) - distance(b.point, origin))[0];
    if (!candidate) return null;
    destination = candidate.point;
  }
  if (distance(origin, destination) < 0.001) return [];
  if (segmentClear(origin, destination, field)) return [{ ...destination }];
  const starts = nearestNodes(origin, field), goals = nearestNodes(destination, field);
  if (!starts.length || !goals.length) return null;
  const goalSet = new Set(goals);
  const costs = new Float64Array(COUNT).fill(Infinity);
  const parents = new Int32Array(COUNT).fill(-1);
  const visited = new Uint8Array(COUNT);
  const queue = new Queue();
  for (const id of starts) {
    costs[id] = distance(origin, field.points[id]);
    queue.push({ id, score: costs[id] + distance(field.points[id], destination) });
  }
  let goal = -1, expanded = 0;
  while (queue.length && expanded < COUNT) {
    const current = queue.pop().id;
    if (visited[current]) continue;
    visited[current] = 1; expanded++;
    if (goalSet.has(current)) { goal = current; break; }
    for (const next of edgesFor(current, field)) {
      if (visited[next]) continue;
      const cost = costs[current] + distance(field.points[current], field.points[next]);
      if (cost < costs[next]) {
        costs[next] = cost; parents[next] = current;
        queue.push({ id: next, score: cost + distance(field.points[next], destination) });
      }
    }
  }
  if (goal < 0) return null;
  const reverse: Point[] = [];
  for (let id = goal; id !== -1; id = parents[id]) {
    reverse.push(field.points[id]);
    if (reverse.length > COUNT) return null;
  }
  const route = [...reverse.reverse(), destination];
  const smooth: Point[] = [];
  let cursor = origin, index = 0;
  while (index < route.length) {
    let end = route.length - 1;
    while (end > index && !segmentClear(cursor, route[end], field)) end--;
    if (!segmentClear(cursor, route[end], field)) return null;
    if (distance(cursor, route[end]) > 0.001) smooth.push({ ...route[end] });
    cursor = route[end]; index = end + 1;
    if (smooth.length > MAX_NAVIGATION_POINTS) return null;
  }
  return smooth;
}
