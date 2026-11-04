import { MONSTERS, WORLD_HEIGHT, WORLD_WIDTH, ZONES } from './config';
import type { Decoration, Monster, Obstacle, Point, ZoneId } from './types';

export const SPAWN: Point = { x: 220, y: 510 };
export const SIGN: Point = { x: 210, y: 396 };
export const MONSTER_SPAWNS: Point[] = [
  { x: 480, y: 440 }, { x: 700, y: 270 }, { x: 960, y: 270 }, { x: 1240, y: 330 },
  { x: 1380, y: 590 }, { x: 1150, y: 780 }, { x: 840, y: 790 }, { x: 540, y: 780 },
  { x: 810, y: 520 }, { x: 1100, y: 530 },
];
const stone: Obstacle[] = [
  { x: 360, y: 250, width: 56, height: 48, kind: 'rock' },
  { x: 560, y: 560, width: 60, height: 42, kind: 'rock' },
  { x: 975, y: 635, width: 72, height: 48, kind: 'rock' },
  { x: 1290, y: 865, width: 80, height: 55, kind: 'rock' },
];
export function obstaclesFor(zone: ZoneId): Obstacle[] {
  const items: Obstacle[] = [...stone.map(p => ({ ...p }))];
  for (let i = 0; i < 16; i++) {
    const x = 90 + (i * 263) % 1430;
    const y = i % 2 ? 110 + (i * 37) % 100 : 890 + (i * 29) % 90;
    items.push({ x, y, width: 36, height: 35, kind: zone === 'island' ? 'tree' : 'pillar' });
  }
  if (zone === 'island') items.push({ x: 345, y: 660, width: 36, height: 35, kind: 'tree' }, { x: 1190, y: 160, width: 36, height: 35, kind: 'tree' });
  if (zone === 'volcano') items.push({ x: 650, y: 640, width: 105, height: 58, kind: 'lava' }, { x: 1070, y: 95, width: 160, height: 44, kind: 'lava' });
  if (zone === 'tower' || zone === 'temple') items.push({ x: 455, y: 125, width: 180, height: 30, kind: 'wall' }, { x: 1260, y: 670, width: 32, height: 130, kind: 'wall' });
  return items;
}
export function decorationsFor(zone: ZoneId): Decoration[] {
  const items: Decoration[] = Array.from({ length: 65 }, (_, i) => ({ x: 50 + (i * 179) % 1500, y: 70 + (i * 137) % 920, kind: zone === 'island' ? (i % 4 ? 'grass' : 'flower') : (i % 3 ? 'bones' : 'rune') }));
  if (zone === 'island') items.push({ ...SIGN, kind: 'sign' });
  else items.push({ x: 200, y: 390, kind: 'torch' }, { x: 430, y: 310, kind: 'torch' }, { x: 1120, y: 700, kind: 'torch' });
  return items;
}
export function collides(x: number, y: number, radius: number, zone: ZoneId): boolean {
  if (x < radius + 25 || y < radius + 25 || x > WORLD_WIDTH - radius - 25 || y > WORLD_HEIGHT - radius - 25) return true;
  return obstaclesFor(zone).some(o => x + radius > o.x - o.width / 2 && x - radius < o.x + o.width / 2 && y + radius > o.y - o.height / 2 && y - radius < o.y + o.height / 2);
}
export function spawnMonsters(zone: ZoneId): Monster[] {
  return MONSTER_SPAWNS.map((p, i) => {
    const kind = ZONES[zone].monsters[i % 2];
    return { ...p, id: `${zone}-${i}`, kind, hp: MONSTERS[kind].hp, maxHp: MONSTERS[kind].hp, homeX: p.x, homeY: p.y, alive: true, aggro: false, respawnAt: 0, nextAttackAt: 0, generation: 0 };
  });
}
