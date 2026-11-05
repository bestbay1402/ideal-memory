import { describe, expect, it, vi } from 'vitest';
import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '../src/game/config';
import { findPath, isPathClear, MAX_NAVIGATION_POINTS } from '../src/game/navigation';
import type { Point, ZoneId } from '../src/game/types';
import { collides } from '../src/game/world';

function expectSafeRoute(start: Point, route: Point[] | null, zone: ZoneId): Point[] {
  expect(route).not.toBeNull();
  expect(route!.length).toBeLessThanOrEqual(MAX_NAVIGATION_POINTS);
  let previous = start;
  for (const point of route!) {
    expect(point).not.toEqual(start);
    expect(point).not.toEqual(previous);
    expect(isPathClear(previous, point, zone)).toBe(true);
    const samples = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y)));
    for (let step = 0; step <= samples; step++) {
      const x = previous.x + (point.x - previous.x) * step / samples;
      const y = previous.y + (point.y - previous.y) * step / samples;
      expect(collides(x, y, PLAYER_RADIUS, zone)).toBe(false);
    }
    previous = point;
  }
  return route!;
}

describe('땅 클릭 경로 탐색', () => {
  it('빈 땅까지 직선으로 이동하고 시작점이나 입력 객체를 바꾸지 않는다', () => {
    const start = Object.freeze({ x: 220, y: 510 });
    const destination = Object.freeze({ x: 450, y: 510 });
    const path = expectSafeRoute(start, findPath(start, destination, 'island'), 'island');
    expect(path).toEqual([destination]);
    expect(path[0]).not.toBe(destination);
    expect(findPath(start, start, 'island')).toEqual([]);
    path[0].x = -100;
    expect(findPath(start, destination, 'island')).toEqual([destination]);
  });

  it.each([
    { zone: 'island' as const, start: { x: 280, y: 660 }, destination: { x: 410, y: 660 }, obstacle: '나무' },
    { zone: 'tower' as const, start: { x: 1190, y: 670 }, destination: { x: 1330, y: 670 }, obstacle: '벽' },
    { zone: 'volcano' as const, start: { x: 550, y: 640 }, destination: { x: 750, y: 640 }, obstacle: '용암' },
  ])('$obstacle 주위를 돌아 정확한 도착점까지 이동한다', ({ zone, start, destination }) => {
    expect(isPathClear(start, destination, zone)).toBe(false);
    const path = expectSafeRoute(start, findPath(start, destination, zone), zone);
    expect(path.length).toBeGreaterThan(1);
    expect(path.at(-1)).toEqual(destination);
  });

  it.each([
    { zone: 'island' as const, destination: { x: 345, y: 660 } },
    { zone: 'temple' as const, destination: { x: 1260, y: 670 } },
    { zone: 'volcano' as const, destination: { x: 650, y: 640 } },
  ])('$zone 장애물 클릭은 가까운 안전한 땅으로 조정한다', ({ zone, destination }) => {
    const start = { x: 220, y: 510 };
    expect(collides(destination.x, destination.y, PLAYER_RADIUS, zone)).toBe(true);
    const path = expectSafeRoute(start, findPath(start, destination, zone), zone);
    const end = path.at(-1)!;
    expect(end).not.toEqual(destination);
    expect(Math.hypot(end.x - destination.x, end.y - destination.y)).toBeLessThanOrEqual(96);
  });

  it.each([
    { x: -10000, y: -10000 },
    { x: 10000, y: 10000 },
    { x: -10000, y: 10000 },
    { x: 10000, y: -10000 },
  ])('맵 밖 클릭 $x,$y는 충돌 경계 안으로 제한한다', destination => {
    const border = PLAYER_RADIUS + 25;
    const start = { x: 220, y: 510 };
    const path = expectSafeRoute(start, findPath(start, destination, 'island'), 'island');
    expect(path.at(-1)).toEqual({
      x: Math.min(WORLD_WIDTH - border, Math.max(border, destination.x)),
      y: Math.min(WORLD_HEIGHT - border, Math.max(border, destination.y)),
    });
  });

  it('키보드로 도달 가능한 경계에서도 출발하며 막힌 시작점은 거부한다', () => {
    const start = { x: PLAYER_RADIUS + 25, y: 510 };
    expectSafeRoute(start, findPath(start, { x: 220, y: 510 }, 'island'), 'island');
    expect(findPath({ x: 0, y: 510 }, { x: 220, y: 510 }, 'island')).toBeNull();
    expect(findPath({ x: 360, y: 250 }, { x: 220, y: 510 }, 'island')).toBeNull();
  });

  it('샘플 사이의 짧은 모서리 관통도 거부하고 안전한 대각선은 양방향으로 통과한다', () => {
    const start = { x: 318.9, y: 213.2 }, end = { x: 319.2, y: 212.9 };
    expect(collides(start.x, start.y, PLAYER_RADIUS, 'island')).toBe(false);
    expect(collides(end.x, end.y, PLAYER_RADIUS, 'island')).toBe(false);
    expect(isPathClear(start, end, 'island')).toBe(false);
    const clearStart = { x: 305, y: 215.25 }, clearEnd = { x: 333.5, y: 206.5 };
    expect(isPathClear(clearStart, clearEnd, 'island')).toBe(true);
    expect(isPathClear(clearEnd, clearStart, 'island')).toBe(true);
    expectSafeRoute(clearStart, findPath(clearStart, clearEnd, 'island'), 'island');
  });

  it.each([NaN, Infinity, -Infinity])('유한하지 않은 좌표 %s를 거부한다', value => {
    for (const axis of ['x', 'y'] as const) {
      const point = { x: 220, y: 510, [axis]: value };
      expect(findPath(point, { x: 500, y: 510 }, 'island')).toBeNull();
      expect(findPath({ x: 220, y: 510 }, point, 'island')).toBeNull();
      expect(isPathClear({ x: 220, y: 510 }, point, 'island')).toBe(false);
    }
  });

  it('양쪽을 완전히 가른 벽에서는 탐색을 종료하고 도달 불가를 반환한다', async () => {
    const wall = { x: 800, y: WORLD_HEIGHT / 2, width: 32, height: WORLD_HEIGHT, kind: 'wall' as const };
    vi.resetModules();
    vi.doMock('../src/game/world', () => ({
      obstaclesFor: () => [wall],
      collides: (x: number, y: number, radius: number) => (
        x < radius + 25 || y < radius + 25 || x > WORLD_WIDTH - radius - 25 || y > WORLD_HEIGHT - radius - 25
        || (x + radius > wall.x - wall.width / 2 && x - radius < wall.x + wall.width / 2)
      ),
    }));
    try {
      const isolated = await import('../src/game/navigation');
      expect(isolated.findPath({ x: 100, y: 510 }, { x: 1400, y: 510 }, 'island')).toBeNull();
    } finally {
      vi.doUnmock('../src/game/world');
      vi.resetModules();
    }
  });

  it('반복되는 긴 경로 탐색도 유한한 시간과 경로 크기로 끝난다', () => {
    const started = performance.now();
    const zones: ZoneId[] = ['island', 'temple', 'volcano', 'tower'];
    for (let i = 0; i < 80; i++) {
      const path = findPath({ x: 220, y: 510 }, { x: 1480, y: 850 - i * 5 }, zones[i % zones.length]);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
      expect(path!.length).toBeLessThanOrEqual(MAX_NAVIGATION_POINTS);
    }
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
