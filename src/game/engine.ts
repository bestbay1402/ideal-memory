import { ARMOR_BONUS, ATTACK_BONUS, ATTACK_INTERVAL, AUTO_ATTACK_RANGE, AUTO_POTION_THRESHOLD, CLASSES, ENHANCE_CHANCES, ENHANCE_FAILURE_LEVELS, GREEN_DURATION, MAX_ENHANCEMENT, MAX_LEVEL, MAX_TICK_MS, MONSTERS, PLAYER_RADIUS, PLAYER_SPEED, POTION_INTERVAL, POTIONS, RESPAWN_MS, WORLD_HEIGHT, WORLD_WIDTH, XP_MULTIPLIER, XP_TABLE, ZONES } from './config';
import type { Action, CharacterClass, EffectKind, GameLog, GameState, Monster, Player, Point, PotionKind, ZoneId } from './types';
import { findPath, isPathClear, MAX_NAVIGATION_POINTS } from './navigation';
import { collides, SPAWN, spawnMonsters } from './world';

export function xpRequired(level: number): number { return XP_TABLE[level] ?? 0; }
export function power(player: Player): number { return player.level * 100 + player.enhancement * 1000; }
export function appearance(player: Player): string {
  const knight = player.class === 'knight';
  if (player.level >= 90) return knight ? '황금빛 전설의 기사' : '빛나는 천상의 궁수';
  if (player.level >= 60) return knight ? '데스나이트' : '다크엘프';
  if (player.level >= 30) return knight ? '해골' : '해골 궁수';
  return CLASSES[player.class].name;
}
export function stats(player: Player) {
  const c = CLASSES[player.class];
  return {
    maxHp: c.hp + (player.level - 1) * c.hpPerLevel,
    attack: c.attack + Math.floor((player.level - 1) * 0.24) + ATTACK_BONUS[player.enhancement],
    defense: c.defense + Math.floor((player.level - 1) * 0.08) + ARMOR_BONUS[player.enhancement],
    range: c.range,
    attackInterval: ATTACK_INTERVAL,
  };
}
function log(s: GameState, text: string, kind: GameLog['kind'] = 'info') {
  s.logs.push({ id: ++s.sequence, time: s.time, text, kind });
  s.logs = s.logs.slice(-60);
}
function effect(s: GameState, kind: EffectKind, point: Point, extra: { toX?: number; toY?: number; value?: number; text?: string } = {}) {
  s.effects.push({ id: ++s.sequence, time: s.time, kind, x: point.x, y: point.y, ...extra });
}
export function createGame(nickname: string, characterClass: CharacterClass, now: number): GameState {
  if (!['knight', 'elf'].includes(characterClass)) throw new Error('직업을 선택해주세요.');
  if (typeof nickname !== 'string' || !/^[\p{L}\p{N}_]{2,14}$/u.test(nickname.trim())) throw new Error('닉네임은 한글·영문·숫자·밑줄 2~14자로 입력해주세요.');
  if (!Number.isFinite(now)) throw new Error('서버 시간을 확인할 수 없습니다.');
  const player: Player = {
    ...SPAWN, nickname: nickname.trim(), class: characterClass, level: 1, xp: 0,
    hp: CLASSES[characterClass].hp, adena: 2000, enhancement: 0, bestEnhancement: 0, scrolls: 8, kills: 0,
    potions: { red: 25, orange: 10, clear: 0, green: 1 },
    autoPotion: { enabled: true, kind: 'red' }, greenUntil: 0,
  };
  const s: GameState = { version: 1, player, monsters: spawnMonsters('island'), zone: 'island', time: now, targetId: null, nextAttackAt: now, nextPotionAt: now, greenWarningSent: false, sequence: 0, logs: [], effects: [], zoneMonsters: {}, moveDestination: null, movePath: [] };
  log(s, `${nickname}님, 말하는 섬에 오신 것을 환영합니다.`, 'success');
  log(s, '모험 지원품: 아데나 2,000 · 주문서 8장 · 빨강 25 · 주홍 10 · 초록 1');
  return s;
}

const potionKinds = ['red', 'orange', 'clear', 'green'];
export function validateAction(input: unknown): Action {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('올바르지 않은 요청입니다.');
  const a = input as Record<string, unknown>;
  switch (a.type) {
    case 'tick':
      if (typeof a.dx !== 'number' || typeof a.dy !== 'number' || !Number.isFinite(a.dx) || !Number.isFinite(a.dy) || Math.abs(a.dx) > 1 || Math.abs(a.dy) > 1) throw new Error('이동 방향이 올바르지 않습니다.');
      return { type: 'tick', dx: a.dx, dy: a.dy };
    case 'moveTo':
      if (typeof a.x !== 'number' || typeof a.y !== 'number' || !Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < 0 || a.x > WORLD_WIDTH || a.y < 0 || a.y > WORLD_HEIGHT) throw new Error('이동 목적지가 올바르지 않습니다.');
      return { type: 'moveTo', x: a.x, y: a.y };
    case 'target':
      if (typeof a.id !== 'string' || a.id.length > 60) throw new Error('대상이 올바르지 않습니다.');
      return { type: 'target', id: a.id };
    case 'travel':
      if (typeof a.zone !== 'string' || !Object.hasOwn(ZONES, a.zone)) throw new Error('존재하지 않는 사냥터입니다.');
      return { type: 'travel', zone: a.zone as ZoneId };
    case 'enhance': return { type: 'enhance' };
    case 'buy':
      if (typeof a.kind !== 'string' || !potionKinds.includes(a.kind) || !Number.isSafeInteger(a.quantity) || (a.quantity as number) < 1 || (a.quantity as number) > 999) throw new Error('구매 수량은 1~999개입니다.');
      return { type: 'buy', kind: a.kind as PotionKind, quantity: a.quantity as number };
    case 'usePotion':
      if (typeof a.kind !== 'string' || !potionKinds.includes(a.kind)) throw new Error('존재하지 않는 물약입니다.');
      return { type: 'usePotion', kind: a.kind as PotionKind };
    case 'autoPotion':
      if (typeof a.enabled !== 'boolean' || typeof a.kind !== 'string' || !potionKinds.includes(a.kind)) throw new Error('자동 물약 설정이 올바르지 않습니다.');
      return { type: 'autoPotion', enabled: a.enabled, kind: a.kind as PotionKind };
    default: throw new Error('지원하지 않는 명령입니다.');
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function move(point: Point, dx: number, dy: number, speed: number, dt: number, zone: ZoneId, radius = PLAYER_RADIUS) {
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const step = speed * dt / 1000;
  const nx = point.x + dx / Math.max(1, length) * step;
  const ny = point.y + dy / Math.max(1, length) * step;
  // 작은 하위 스텝으로 이동해 얇은 벽을 관통하지 못하도록 합니다.
  const steps = Math.max(1, Math.ceil(step / 8));
  const sx = (nx - point.x) / steps, sy = (ny - point.y) / steps;
  for (let i = 0; i < steps; i++) {
    if (!collides(point.x + sx, point.y, radius, zone)) point.x += sx;
    if (!collides(point.x, point.y + sy, radius, zone)) point.y += sy;
  }
}
function cancelMovement(s: GameState) {
  s.moveDestination = null;
  s.movePath = [];
}
function followPath(s: GameState, dt: number) {
  const path = s.movePath ?? [];
  let remaining = PLAYER_SPEED * dt / 1000;
  while (path.length && remaining > 0) {
    const waypoint = path[0], gap = distance(s.player, waypoint);
    if (gap < 0.000001) { path.shift(); continue; }
    const step = Math.min(8, remaining, gap);
    const x = s.player.x + (waypoint.x - s.player.x) / gap * step;
    const y = s.player.y + (waypoint.y - s.player.y) / gap * step;
    // 계산된 선분을 따라 이동하며, 벽에 부딪히면 미끄러져 경로를 벗어나지 않습니다.
    if (!isPathClear(s.player, { x, y }, s.zone)) { cancelMovement(s); return; }
    s.player.x = x; s.player.y = y;
    remaining -= step;
    if (step === gap) path.shift();
  }
  if (!path.length) cancelMovement(s);
}
function usePotion(s: GameState, kind: PotionKind, automatic = false): boolean {
  const p = s.player;
  if (automatic && kind === 'green' && p.greenUntil > s.time) return false;
  if (s.time < s.nextPotionAt) {
    if (automatic) return false;
    throw new Error('물약은 1초에 한 번 사용할 수 있습니다.');
  }
  if (p.potions[kind] <= 0) {
    if (!automatic) throw new Error('물약이 부족합니다.');
    p.autoPotion.enabled = false;
    log(s, `${POTIONS[kind].name}이 모두 소진되어 자동 물약을 중지했습니다.`, 'warning');
    return false;
  }
  if (kind !== 'green' && p.hp >= stats(p).maxHp) {
    if (automatic) return false;
    throw new Error('이미 체력이 가득 찼습니다.');
  }
  p.potions[kind]--;
  s.nextPotionAt = s.time + POTION_INTERVAL;
  if (kind === 'green') {
    p.greenUntil = s.time + GREEN_DURATION;
    s.greenWarningSent = false;
    log(s, '초록 물약: 10분 동안 공격속도가 2배가 됩니다.', 'success');
    effect(s, 'heal', p, { text: '가속' });
  } else {
    const recovered = Math.min(POTIONS[kind].heal, stats(p).maxHp - p.hp);
    p.hp += recovered;
    effect(s, 'heal', p, { value: recovered });
  }
  return true;
}
function changeZone(s: GameState, zone: ZoneId) {
  const cache = s.zoneMonsters ??= {};
  if (zone !== s.zone) {
    cache[s.zone] = s.monsters;
    s.monsters = cache[zone] ?? spawnMonsters(zone);
    delete cache[zone];
  }
  s.zone = zone;
  // 처치 여부/재생성 시각/남은 HP를 유지하고 추격만 끝냅니다.
  for (const m of s.monsters) {
    m.aggro = false;
    if (m.alive) { m.x = m.homeX; m.y = m.homeY; }
  }
  s.player.x = SPAWN.x; s.player.y = SPAWN.y;
  s.targetId = null;
  cancelMovement(s);
  s.nextAttackAt = s.time + 400;
  log(s, `${ZONES[zone].name}(으)로 이동했습니다.`);
}
function grantXp(s: GameState, amount: number) {
  const p = s.player;
  if (p.level >= MAX_LEVEL) return;
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= xpRequired(p.level)) {
    p.xp -= xpRequired(p.level);
    p.level++;
    p.hp = stats(p).maxHp;
    log(s, `${p.level}레벨 달성! 체력이 모두 회복되었습니다.`, 'success');
    effect(s, 'level', p, { value: p.level });
    if ([30, 60, 90].includes(p.level)) {
      log(s, `${p.level}레벨 달성! ${appearance(p)} 변신이 적용되었습니다.`, 'success');
      effect(s, 'transform', p, { value: p.level, text: appearance(p) });
    }
    if (p.level === MAX_LEVEL) {
      p.xp = 0;
      log(s, '99레벨! 절대자의 일격을 습득했습니다. 공격 시 현재 사냥터의 모든 몬스터를 처치합니다.', 'success');
    }
  }
}
function randomInt(min: number, max: number, rng: () => number) { return min + Math.floor(rng() * (max - min + 1)); }
function kill(s: GameState, m: Monster, rng: () => number) {
  if (!m.alive) return; // 같은 생명 주기의 보상을 정확히 한 번만 지급합니다.
  m.alive = false; m.hp = 0; m.aggro = false; m.respawnAt = s.time + RESPAWN_MS;
  s.player.kills++; // 광역 처치도 살아 있는 몬스터 1마리당 1회만 집계하며 누적값을 함께 저장합니다.
  if (s.targetId === m.id) s.targetId = null;
  effect(s, 'death', m, { text: MONSTERS[m.kind].name });
  const zone = ZONES[s.zone];
  const adena = randomInt(...zone.adena, rng);
  const xp = s.player.level >= MAX_LEVEL ? 0 : randomInt(...zone.xp, rng) * XP_MULTIPLIER;
  s.player.adena += adena;
  grantXp(s, xp);
  const scroll = rng() < zone.scrollChance;
  if (scroll) s.player.scrolls++;
  log(s, `${MONSTERS[m.kind].name} 처치 · 경험치 ${xp} · 아데나 ${adena}${scroll ? ' · 무기강화주문서 1장 획득!' : ''}`, 'reward');
}
function damage(s: GameState, m: Monster, amount: number, rng: () => number) {
  if (!m.alive) return;
  m.hp = Math.max(0, m.hp - amount); m.aggro = true;
  effect(s, 'hit', m, { value: amount });
  if (m.hp === 0) kill(s, m, rng);
}
function attack(s: GameState, m: Monster, rng: () => number) {
  const p = s.player;
  const interval = ATTACK_INTERVAL / (p.greenUntil > s.time ? 2 : 1);
  // 200ms 네트워크 틱에서도 500ms 공격 주기가 600ms로 누적 지연되지 않게 합니다.
  s.nextAttackAt = s.nextAttackAt < s.time - MAX_TICK_MS ? s.time + interval : s.nextAttackAt + interval;
  if (p.level === MAX_LEVEL) {
    effect(s, 'nova', p, { text: '절대자의 일격' });
    for (const monster of s.monsters) if (monster.alive) kill(s, monster, rng);
    return;
  }
  effect(s, p.class === 'knight' ? 'slash' : 'arrow', p, { toX: m.x, toY: m.y });
  const hit = Math.max(1, Math.round(stats(p).attack * (0.9 + rng() * 0.2)) - MONSTERS[m.kind].defense);
  damage(s, m, hit, rng);
  if (p.enhancement !== 10 || rng() >= 0.1) return;
  const knight = p.class === 'knight';
  effect(s, knight ? 'cleave' : 'pierce', p, { toX: m.x, toY: m.y, text: knight ? '광역 검기' : '관통 화살' });
  const vx = m.x - p.x, vy = m.y - p.y, length = Math.max(1, Math.hypot(vx, vy));
  for (const other of s.monsters) {
    if (!other.alive || other.id === m.id) continue;
    const projection = ((other.x - p.x) * vx + (other.y - p.y) * vy) / length;
    const perpendicular = Math.abs((other.x - p.x) * vy - (other.y - p.y) * vx) / length;
    const inArea = knight ? distance(other, m) <= 150 : projection >= length - 30 && projection <= length + 330 && perpendicular <= 65;
    if (inArea) damage(s, other, Math.max(1, Math.round(stats(p).attack * 1.5) - MONSTERS[other.kind].defense), rng);
  }
}
function die(s: GameState) {
  effect(s, 'death', s.player, { text: '쓰러졌습니다' });
  log(s, '쓰러졌습니다. 손실 없이 말하는 섬에서 부활합니다. 초록 물약 효과가 해제됩니다.', 'warning');
  s.player.greenUntil = 0; s.greenWarningSent = false;
  changeZone(s, 'island');
  s.player.hp = stats(s.player).maxHp;
  effect(s, 'respawn', s.player);
}
function tick(s: GameState, action: Extract<Action, { type: 'tick' }>, dt: number, rng: () => number): boolean {
  const p = s.player;
  for (const m of s.monsters) if (!m.alive && m.respawnAt <= s.time) {
    m.alive = true; m.hp = m.maxHp; m.x = m.homeX; m.y = m.homeY;
    m.aggro = false; m.generation++; m.nextAttackAt = s.time + 500;
    effect(s, 'respawn', m);
  }
  const manualMove = action.dx !== 0 || action.dy !== 0;
  const clickMove = !!s.moveDestination && !!s.movePath?.length;
  if (manualMove) {
    s.targetId = null;
    cancelMovement(s);
    move(p, action.dx, action.dy, PLAYER_SPEED, dt, s.zone);
  } else if (clickMove) {
    s.targetId = null;
    followPath(s, dt);
  }
  let target = s.monsters.find(m => m.id === s.targetId && m.alive);
  if (!target) s.targetId = null;
  if (!manualMove && !clickMove && !target) {
    target = s.monsters.filter(m => m.alive && (distance(p, m) <= AUTO_ATTACK_RANGE
      || (m.aggro && distance(p, m) <= MONSTERS[m.kind].range + 2)))
      .sort((a, b) => Number(b.aggro) - Number(a.aggro) || distance(p, a) - distance(p, b))[0];
    if (target) s.targetId = target.id;
  }
  if (target && !manualMove && !clickMove) {
    if (distance(p, target) > stats(p).range) move(p, target.x - p.x, target.y - p.y, PLAYER_SPEED, Math.min(dt, (distance(p, target) - stats(p).range + 2) / PLAYER_SPEED * 1000), s.zone);
    if (distance(p, target) <= stats(p).range + 2 && s.time >= s.nextAttackAt) attack(s, target, rng);
  }
  for (const m of s.monsters) {
    if (!m.alive) continue;
    const spec = MONSTERS[m.kind];
    if (ZONES[s.zone].aggressive && distance(p, m) < 190) m.aggro = true;
    if (m.aggro && distance(p, m) > 500) m.aggro = false;
    if (m.aggro) {
      if (distance(p, m) > spec.range) move(m, p.x - m.x, p.y - m.y, spec.speed, dt, s.zone, 12);
      if (distance(p, m) <= spec.range + 2 && s.time >= m.nextAttackAt) {
        m.nextAttackAt = m.nextAttackAt < s.time - MAX_TICK_MS ? s.time + spec.attackInterval : m.nextAttackAt + spec.attackInterval;
        const hit = Math.max(1, spec.attack - stats(p).defense);
        p.hp = Math.max(0, p.hp - hit);
        effect(s, 'slash', m, { toX: p.x, toY: p.y });
        effect(s, 'hit', p, { value: hit });
        if (p.hp === 0) { die(s); return false; }
      }
    } else {
      const index = Number(m.id.split('-').at(-1)) || 0;
      const destination = { x: m.homeX + Math.sin(s.time / 6500 + index * 2) * 36, y: m.homeY + Math.cos(s.time / 8200 + index * 3) * 26 };
      if (distance(m, destination) > 4) move(m, destination.x - m.x, destination.y - m.y, spec.speed * 0.28, dt, s.zone, 12);
    }
  }
  if (p.autoPotion.enabled && (p.autoPotion.kind === 'green'
    ? p.greenUntil <= s.time
    : p.hp <= stats(p).maxHp * AUTO_POTION_THRESHOLD)) usePotion(s, p.autoPotion.kind, true);
  return true;
}

function advanceClock(s: GameState, now: number) {
  s.time = now;
  if (s.player.greenUntil > 0 && s.player.greenUntil <= now) {
    s.player.greenUntil = 0;
    log(s, '초록 물약 효과가 종료되었습니다.', 'warning');
  } else if (s.player.greenUntil > now && s.player.greenUntil - now <= 30_000 && !s.greenWarningSent) {
    s.greenWarningSent = true;
    log(s, '초록 물약 효과가 30초 후 종료됩니다.', 'warning');
  }
}

// 프레임/타이머가 잠깐 늦어져도 이동·공격을 짧은 단위로 나누어 처리합니다.
// 온라인 화면은 로그인 때 받은 서버 시각에 단조 증가 시간을 더하며, 2초 초과 공백은 재생하지 않습니다.
const SIMULATION_STEP_MS = 100;
const MAX_CATCH_UP_MS = 2000;

export function applyAction(previous: GameState, input: Action, now: number, rng: () => number = Math.random): GameState {
  const action = validateAction(input);
  if (!Number.isFinite(now) || now < previous.time) throw new Error('서버 시간이 올바르지 않습니다.');
  const s: GameState = structuredClone(previous);
  // 이전 저장본에는 누적 처치 필드가 없으므로 첫 명령에서 안전하게 추가합니다.
  s.player.kills ??= 0;
  s.zoneMonsters ??= {};
  s.moveDestination ??= null;
  s.movePath ??= [];
  if (action.type === 'tick' && (action.dx !== 0 || action.dy !== 0)) {
    s.targetId = null;
    cancelMovement(s);
  }
  const elapsed = now - s.time;
  if (action.type === 'tick' && elapsed > 0 && elapsed <= MAX_CATCH_UP_MS) {
    while (s.time < now) {
      const dt = Math.min(SIMULATION_STEP_MS, now - s.time);
      advanceClock(s, s.time + dt);
      // 사망 후에는 남은 이전 이동 입력을 폐기하고 부활 위치를 유지합니다.
      if (!tick(s, action, dt, rng)) break;
    }
  }
  advanceClock(s, now);
  const p = s.player;
  switch (action.type) {
    case 'tick':
      break;
    case 'moveTo': {
      s.targetId = null;
      cancelMovement(s);
      const path = findPath(p, action, s.zone);
      if (path === null || path.length > MAX_NAVIGATION_POINTS) {
        log(s, '그곳으로 이동할 수 있는 길이 없습니다.', 'warning');
      } else if (path.length) {
        s.movePath = path;
        s.moveDestination = { ...path[path.length - 1] };
      }
      break;
    }
    case 'target':
      if (!s.monsters.some(m => m.id === action.id && m.alive)) throw new Error('이미 사라진 몬스터입니다.');
      cancelMovement(s);
      s.targetId = action.id;
      break;
    case 'travel':
      s.targetId = null;
      cancelMovement(s);
      if (action.zone === s.zone) break;
      changeZone(s, action.zone);
      break;
    case 'enhance': {
      if (p.enhancement >= MAX_ENHANCEMENT) throw new Error('이미 최고 단계인 +10 무기입니다.');
      if (p.scrolls < 1) throw new Error('무기강화주문서가 부족합니다.');
      p.scrolls--;
      const success = rng() < ENHANCE_CHANCES[p.enhancement];
      p.enhancement = success ? p.enhancement + 1 : ENHANCE_FAILURE_LEVELS[p.enhancement];
      p.bestEnhancement = Math.max(p.bestEnhancement, p.enhancement);
      if (success) {
        log(s, `+${p.enhancement} ${CLASSES[p.class].weapon} 강화에 성공했습니다!`, 'success');
        effect(s, 'enhanceSuccess', p, { value: p.enhancement, text: p.enhancement === 10 ? '전설의 +10 무기 탄생!' : `+${p.enhancement} 강화 성공!` });
      } else {
        log(s, `무기 강화에 실패했습니다. 무기와 방어구가 +${p.enhancement}(으)로 하락했습니다.`, 'warning');
        effect(s, 'enhanceFail', p, { value: p.enhancement });
      }
      break;
    }
    case 'buy': {
      const cost = POTIONS[action.kind].price * action.quantity;
      if (p.adena < cost) throw new Error('아데나가 부족합니다.');
      if (p.potions[action.kind] + action.quantity > 1_000_000) throw new Error('보유 한도를 초과합니다.');
      p.adena -= cost; p.potions[action.kind] += action.quantity;
      log(s, `${POTIONS[action.kind].name} ${action.quantity}개를 ${cost.toLocaleString('ko-KR')}아데나에 구매했습니다.`);
      break;
    }
    case 'usePotion': usePotion(s, action.kind); break;
    case 'autoPotion':
      p.autoPotion = { enabled: action.enabled, kind: action.kind };
      log(s, `자동 물약 ${action.enabled ? 'ON' : 'OFF'} · ${POTIONS[action.kind].name}`);
      break;
  }
  s.effects = s.effects.filter(e => now - e.time < 2200).slice(-100);
  return s;
}
