import { describe, expect, it } from 'vitest';
import { appearance, applyAction, createGame, power, stats, validateAction, xpRequired } from '../src/game/engine';
import { ATTACK_INTERVAL, ENHANCE_CHANCES, ENHANCE_FAILURE_LEVELS, GREEN_DURATION, MONSTERS, PLAYER_SPEED, POTIONS, RESPAWN_MS, XP_MULTIPLIER, ZONES } from '../src/game/config';
import { collides, SPAWN } from '../src/game/world';
import type { GameState, ZoneId } from '../src/game/types';

const START = 1_000_000;
const rng = () => 0.5;
function game(characterClass: 'knight' | 'elf' = 'knight') { return createGame('테스트영웅', characterClass, START); }
function prepared(zone: ZoneId = 'island', level = 1, enhancement = 0): GameState {
  let s = game(); s.player.level = level; s.player.enhancement = enhancement; s.player.hp = stats(s.player).maxHp;
  s = applyAction(s, { type: 'travel', zone }, START, rng);
  s.monsters = [s.monsters[0]];
  s.monsters[0].x = s.player.x + 35; s.monsters[0].y = s.player.y;
  s.monsters[0].homeX = s.monsters[0].x; s.monsters[0].homeY = s.monsters[0].y;
  s.player.autoPotion.enabled = false;
  return s;
}
function tick(s: GameState, count = 1, random = rng): GameState {
  for (let i = 0; i < count; i++) s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, s.time + 200, random);
  return s;
}

describe('캐릭터와 이동', () => {
  it('기사/요정의 무기·체력·방어·사거리가 다르고 이동속도는 같다', () => {
    const knight = game(), elf = game('elf');
    expect(stats(knight.player).maxHp).toBeGreaterThan(stats(elf.player).maxHp);
    expect(stats(knight.player).defense).toBeGreaterThan(stats(elf.player).defense);
    expect(stats(elf.player).range).toBeGreaterThan(stats(knight.player).range);
    const a = applyAction(knight, { type: 'tick', dx: 1, dy: 0 }, START + 200);
    const b = applyAction(elf, { type: 'tick', dx: 1, dy: 0 }, START + 200);
    expect(a.player.x).toBe(250); expect(b.player.x).toBe(a.player.x);
    expect(knight.player.x).toBe(SPAWN.x); // immutable input
  });
  it('대각선 이동을 정규화하고 벽·바위 충돌을 적용한다', () => {
    const s = game();
    const next = applyAction(s, { type: 'tick', dx: 1, dy: 1 }, START + 200);
    expect(Math.hypot(next.player.x - s.player.x, next.player.y - s.player.y)).toBeCloseTo(30);
    s.player.x = 300; s.player.y = 250;
    const stopped = applyAction(s, { type: 'tick', dx: 1, dy: 0 }, START + 500);
    expect(stopped.player.x).toBeLessThan(320);
    expect(collides(stopped.player.x, stopped.player.y, 13, 'island')).toBe(false);
  });
  it('이동량/시간/불명 명령 변조를 거부한다', () => {
    for (const dx of [NaN, Infinity, 2]) expect(() => validateAction({ type: 'tick', dx, dy: 0 })).toThrow();
    expect(() => validateAction({ type: 'giveGold', amount: 100 })).toThrow();
    expect(() => applyAction(game(), { type: 'tick', dx: 0, dy: 0 }, START - 1)).toThrow();
    expect(validateAction({ type: 'enhance', level: 99 })).toEqual({ type: 'enhance' });
  });
  it('몬스터 선택 후 사거리까지 접근하고 수동 이동 시 공격을 중단한다', () => {
    let s = prepared(); s.monsters[0].x += 170;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 8);
    expect(s.player.x).toBeGreaterThan(SPAWN.x);
    expect(s.monsters[0].hp).toBeLessThan(s.monsters[0].maxHp);
    s = applyAction(s, { type: 'tick', dx: -1, dy: 0 }, s.time + 200);
    expect(s.targetId).toBeNull();
  });
  it('접촉 범위 밖의 비선공 몬스터는 공격받기 전까지 피해를 주지 않는다', () => {
    const s = prepared();
    s.monsters[0].x = s.monsters[0].homeX = s.player.x + 120;
    const after = tick(s, 10);
    expect(after.player.hp).toBe(s.player.hp);
    expect(after.monsters[0].aggro).toBe(false);
  });
  it('상위 사냥터 몬스터는 감지 범위에서 선공한다', () => {
    const s = prepared('temple', 30, 6);
    const after = tick(s, 3);
    expect(after.player.hp).toBeLessThan(s.player.hp);
    expect(after.monsters[0].aggro).toBe(true);
  });
});

describe('클릭 이동과 근접 자동 공격', () => {
  it('클릭 이동은 순간이동하지 않고 일정 속도로 목적지에서 멈춘다', () => {
    const initial = game(); initial.monsters = [];
    let s = applyAction(initial, { type: 'moveTo', x: SPAWN.x + 75, y: SPAWN.y }, START);
    expect(s.player.x).toBe(SPAWN.x);
    expect(s.moveDestination).toEqual({ x: SPAWN.x + 75, y: SPAWN.y });
    s = tick(s);
    expect(s.player.x - initial.player.x).toBeCloseTo(PLAYER_SPEED * .2);
    s = tick(s, 2);
    expect(s.player.x).toBeCloseTo(SPAWN.x + 75);
    expect(s.moveDestination).toBeNull(); expect(s.movePath).toEqual([]);
    expect(tick(s, 5).player.x).toBe(s.player.x);
  });
  it('바위를 우회하는 경로 전체에서 충돌하지 않고 목적지에 도착한다', () => {
    let s = game(); s.monsters = []; s.player.x = 300; s.player.y = 250;
    s = applyAction(s, { type: 'moveTo', x: 420, y: 250 }, START);
    expect(s.movePath!.length).toBeGreaterThan(1);
    expect(s.movePath!.length).toBeLessThanOrEqual(200);
    for (let i = 0; s.moveDestination && i < 50; i++) {
      const previous = { x: s.player.x, y: s.player.y };
      s = tick(s);
      expect(collides(s.player.x, s.player.y, 13, s.zone)).toBe(false);
      expect(Math.hypot(s.player.x - previous.x, s.player.y - previous.y)).toBeLessThanOrEqual(30.000001);
    }
    expect(s.moveDestination).toBeNull();
    expect(s.player.x).toBeCloseTo(420); expect(s.player.y).toBeCloseTo(250);
  });
  it('장애물 클릭은 근처 빈 땅을 선택하고 잘못된 좌표는 거부한다', () => {
    let s = game(); s.monsters = [];
    s = applyAction(s, { type: 'moveTo', x: 360, y: 250 }, START);
    const destination = s.moveDestination!;
    expect(destination).not.toEqual({ x: 360, y: 250 });
    expect(collides(destination.x, destination.y, 13, s.zone)).toBe(false);
    for (const point of [{ x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: -1, y: 1 }, { x: 1601, y: 1 }, { x: 1, y: 1041 }]) {
      expect(() => validateAction({ type: 'moveTo', ...point })).toThrow();
    }
  });
  it('새 클릭으로 목적지를 교체하고 수동 이동은 같은 시각에도 경로를 취소한다', () => {
    let s = game(); s.monsters = [];
    s = applyAction(s, { type: 'moveTo', x: 600, y: 510 }, START);
    s = applyAction(s, { type: 'moveTo', x: 220, y: 570 }, START);
    expect(s.moveDestination).toEqual({ x: 220, y: 570 });
    s = applyAction(s, { type: 'tick', dx: -1, dy: 0 }, START);
    expect(s.moveDestination).toBeNull(); expect(s.movePath).toEqual([]);
    expect(tick(s).player.x).toBe(SPAWN.x);
    s = applyAction(s, { type: 'moveTo', x: 600, y: 510 }, s.time);
    s = applyAction(s, { type: 'tick', dx: -1, dy: 0 }, s.time + 200);
    expect(s.player.x).toBe(SPAWN.x - 30); expect(s.moveDestination).toBeNull();
  });
  it('몬스터 선택과 지역 이동은 클릭 이동을 취소한다', () => {
    const initial = prepared();
    const walking = applyAction(initial, { type: 'moveTo', x: 700, y: 510 }, START);
    const targeting = applyAction(walking, { type: 'target', id: initial.monsters[0].id }, START);
    expect(targeting.moveDestination).toBeNull(); expect(targeting.movePath).toEqual([]);
    expect(targeting.targetId).toBe(initial.monsters[0].id);
    for (const zone of ['island', 'tower'] as const) {
      const traveling = applyAction(walking, { type: 'travel', zone }, START);
      expect(traveling.moveDestination).toBeNull(); expect(traveling.movePath).toEqual([]);
      expect(traveling.targetId).toBeNull();
    }
  });
  it('클릭 이동 중 사망하면 부활 지점에서 경로를 버린다', () => {
    let s = prepared('volcano'); s.player.hp = 1;
    s = applyAction(s, { type: 'moveTo', x: 700, y: 510 }, START);
    s = tick(s);
    expect(s.zone).toBe('island'); expect({ x: s.player.x, y: s.player.y }).toEqual(SPAWN);
    expect(s.moveDestination).toBeNull(); expect(s.movePath).toEqual([]);
  });
  it('의도적인 클릭·키보드 이동 중에는 근처 몬스터를 자동 공격하지 않는다', () => {
    const initial = prepared();
    const clicked = tick(applyAction(initial, { type: 'moveTo', x: 600, y: 510 }, START));
    const keyboard = applyAction(initial, { type: 'tick', dx: 1, dy: 0 }, START + 200);
    for (const after of [clicked, keyboard]) {
      expect(after.targetId).toBeNull();
      expect(after.monsters[0].hp).toBe(initial.monsters[0].hp);
      expect(after.monsters[0].aggro).toBe(false);
    }
  });
  it.each(['knight', 'elf'] as const)('%s는 선택 없이 58px 이내의 살아 있는 몬스터를 자동 공격한다', characterClass => {
    const initial = prepared(); initial.player.class = characterClass;
    const after = tick(initial);
    expect(after.targetId).toBe(initial.monsters[0].id);
    expect(after.monsters[0].hp).toBeLessThan(initial.monsters[0].hp);
  });
  it.each(['ifrit', 'phoenix'] as const)('%s가 자신의 사거리에서 공격하면 가만히 있던 기사도 반격한다', kind => {
    const initial = prepared('volcano', 75, 7);
    const monster = initial.monsters[0];
    monster.kind = kind; monster.hp = monster.maxHp = MONSTERS[kind].hp;
    monster.x = monster.homeX = initial.player.x + MONSTERS[kind].range;
    monster.aggro = true;
    const after = tick(initial, 3);
    expect(after.targetId).toBe(monster.id);
    expect(after.monsters[0].hp).toBeLessThan(monster.hp);
    const walking = applyAction(initial, { type: 'tick', dx: -1, dy: 0 }, START + 200);
    expect(walking.targetId).toBeNull();
    expect(walking.monsters[0].hp).toBe(monster.hp);
  });
  it('요정의 210px 사거리까지 자동 탐색하지 않으며 기존 목표는 계속 공격한다', () => {
    let s = prepared(); s.player.class = 'elf';
    s.monsters[0].x = s.monsters[0].homeX = s.player.x + 150;
    const idle = tick(s);
    expect(idle.targetId).toBeNull(); expect(idle.monsters[0].hp).toBe(s.monsters[0].hp);
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, START);
    const selected = tick(s);
    expect(selected.targetId).toBe(s.monsters[0].id);
    expect(selected.monsters[0].hp).toBeLessThan(s.monsters[0].hp);
  });
  it('자동 목표는 공격 중인 적을 우선하고 같은 조건이면 가장 가까운 적을 고른다', () => {
    const initial = game(); initial.monsters = initial.monsters.slice(0, 3);
    initial.monsters.forEach((m, index) => {
      m.x = m.homeX = initial.player.x + 20 + index * 15; m.y = m.homeY = initial.player.y;
      m.nextAttackAt = START + 10000;
    });
    expect(tick(initial).targetId).toBe(initial.monsters[0].id);
    initial.monsters[2].aggro = true;
    expect(tick(initial).targetId).toBe(initial.monsters[2].id);
    initial.monsters[2].alive = false; initial.monsters[2].respawnAt = START + 10000;
    expect(tick(initial).targetId).toBe(initial.monsters[0].id);
  });
  it('기존 저장본은 이동 필드 없이 호환되며 저장한 경로는 재접속 후 이어진다', () => {
    const old = game(); old.monsters = [];
    delete old.moveDestination; delete old.movePath;
    const loaded = tick(JSON.parse(JSON.stringify(old)) as GameState);
    expect(loaded.moveDestination).toBeNull(); expect(loaded.movePath).toEqual([]);
    const walking = applyAction(loaded, { type: 'moveTo', x: 600, y: 510 }, loaded.time);
    const resumed = tick(JSON.parse(JSON.stringify(walking)) as GameState);
    expect(resumed.player.x).toBeCloseTo(250); expect(resumed.moveDestination).toEqual(walking.moveDestination);
  });
});

describe('보상·레벨·사망', () => {
  it.each(['island', 'temple', 'volcano', 'tower'] as const)('%s 보상 범위와 주문서 판정, 중복 보상 방지', zone => {
    let s = prepared(zone, 60, 9);
    s.monsters[0].hp = 1;
    const before = structuredClone(s.player);
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 3, () => 0);
    expect(s.player.adena - before.adena).toBe(ZONES[zone].adena[0]);
    expect(s.player.xp - before.xp).toBe(ZONES[zone].xp[0] * XP_MULTIPLIER);
    expect(s.player.scrolls).toBe(before.scrolls + 1);
    expect(s.monsters[0].alive).toBe(false);
    const paid = s.player.adena;
    s = tick(s, 10, () => 0);
    expect(s.player.adena).toBe(paid);
    expect(() => applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time)).toThrow();
  });
  it.each(['island', 'temple', 'volcano', 'tower'] as const)('%s의 실제 경험치 추첨값에 정확히 3배를 적용하고 로그에 표시한다', zone => {
    for (const sample of [0, .5, 1 - Number.EPSILON]) {
      const initial = prepared(zone, 60, 9); initial.monsters[0].hp = 1;
      const after = tick(initial, 3, () => sample);
      const [minimum, maximum] = ZONES[zone].xp;
      const expected = (minimum + Math.floor(sample * (maximum - minimum + 1))) * 3;
      expect(after.player.xp - initial.player.xp).toBe(expected);
      expect(after.logs.some(entry => entry.kind === 'reward' && entry.text.includes(`경험치 ${expected} ·`))).toBe(true);
    }
  });
  it('드롭 확률 경계값을 실제 개별 처치에 적용한다', () => {
    for (const sample of [0.049, 0.05]) {
      let s = prepared(); s.monsters[0].hp = 1;
      s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
      s = tick(s, 3, () => sample);
      expect(s.player.scrolls).toBe(sample < 0.05 ? 9 : 8);
    }
  });
  it.each([30, 60, 90])('%i레벨 달성 시 변신·HP회복·로그가 적용된다', level => {
    let s = prepared('island', level - 1, 9);
    s.player.xp = xpRequired(level - 1) - 1; s.player.hp = 1; s.monsters[0].hp = 1;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 3);
    expect(s.player.level).toBe(level);
    expect(s.player.hp).toBe(stats(s.player).maxHp);
    expect(s.effects.some(e => e.kind === 'transform' && e.value === level)).toBe(true);
    expect(appearance(s.player)).not.toBe('기사');
  });
  it('99레벨 절대자의 일격은 현재 인스턴스만 일괄 처치하며 경험치를 지급하지 않는다', () => {
    let s = game(), other = game('elf');
    s.player.level = 99; s.player.enhancement = 10; s.player.hp = stats(s.player).maxHp;
    s.monsters[0].x = s.player.x + 30; s.monsters[0].y = s.player.y;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s);
    expect(s.monsters.every(m => !m.alive)).toBe(true);
    expect(s.player.xp).toBe(0);
    expect(s.player.adena).toBe(2500);
    expect(other.monsters.every(m => m.alive)).toBe(true);
    expect(appearance(s.player)).toBe('황금빛 전설의 기사');
    expect(s.effects.some(e => e.kind === 'nova')).toBe(true);
  });
  it('사망 시 손실 없이 섬에서 부활하고 가속만 해제한다', () => {
    let s = prepared('volcano', 60, 7); s.player.hp = 1; s.player.greenUntil = s.time + 600000;
    s.player.autoPotion = { enabled: true, kind: 'orange' };
    const before = structuredClone(s.player);
    s = tick(s);
    expect(s.zone).toBe('island'); expect(s.player.hp).toBe(stats(s.player).maxHp);
    expect(s.player.greenUntil).toBe(0); expect(s.player.autoPotion).toEqual(before.autoPotion);
    for (const key of ['level', 'xp', 'adena', 'enhancement', 'scrolls'] as const) expect(s.player[key]).toBe(before[key]);
  });
  it('오프라인 경과시간으로 사냥하거나 이동할 수 없으며 몬스터는 정해진 시간 후 재생성된다', () => {
    let s = prepared(); s.monsters[0].hp = 1;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    const offline = applyAction(s, { type: 'tick', dx: 1, dy: 0 }, s.time + 60000);
    expect(offline.player.adena).toBe(s.player.adena); expect(offline.player.x).toBe(s.player.x);
    s = tick(s, 3); const at = s.monsters[0].respawnAt;
    expect(at - s.effects.find(e => e.kind === 'death')!.time).toBe(RESPAWN_MS);
    while (s.time < at) s = tick(s);
    expect(s.monsters[0].alive).toBe(true); expect(s.monsters[0].generation).toBe(1);
  });
});

describe('누적 몬스터 처치 수와 재생성 보존', () => {
  it('신규 캐릭터는 0이며 기존 저장본의 누락된 필드도 0으로 보완한다', () => {
    const s = game();
    expect(s.player.kills).toBe(0);
    delete (s.player as Partial<typeof s.player>).kills;
    const loaded = tick(JSON.parse(JSON.stringify(s)) as GameState);
    expect(loaded.player.kills).toBe(0);
  });
  it.each(['island', 'temple', 'volcano', 'tower'] as const)('%s 처치를 한 번만 합산하고 저장·재접속 후 유지한다', zone => {
    let s = prepared(zone, 60, 9);
    s.player.kills = 123;
    s.monsters[0].hp = 1;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 3);
    expect(s.player.kills).toBe(124);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    expect(tick(saved, 10).player.kills).toBe(124);
  });
  it('99레벨 일격은 살아 있는 몬스터만 정확히 합산하고 반복 틱은 재집계하지 않는다', () => {
    let s = game();
    s.player.level = 99; s.player.kills = 25;
    s.monsters[0].x = s.player.x + 20; s.monsters[0].y = s.player.y;
    s.monsters[3].alive = false; s.monsters[3].hp = 0; s.monsters[3].respawnAt = START + RESPAWN_MS;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s);
    expect(s.player.kills).toBe(34);
    const money = s.player.adena;
    s = tick(s, 10);
    expect(s.player.kills).toBe(34); expect(s.player.adena).toBe(money);
  });
  it.each(['knight', 'elf'] as const)('+10 %s 광역 공격이 처치한 몬스터도 각각 합산한다', characterClass => {
    let s = game(characterClass); s.player.enhancement = 10;
    s.monsters = s.monsters.slice(0, 2);
    s.monsters.forEach((m, i) => { m.x = s.player.x + 35 + 40 * i; m.y = s.player.y; m.hp = 1; });
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 1, () => 0);
    expect(s.player.kills).toBe(2);
    expect(tick(s, 3).player.kills).toBe(2);
  });
  it('사망과 지역 이동은 처치 수를 초기화하지 않으며 종합 전투력에도 영향을 주지 않는다', () => {
    let s = prepared('volcano', 60, 7); s.player.hp = 1; s.player.kills = 999;
    const combatPower = power(s.player);
    s = tick(s);
    expect(s.zone).toBe('island'); expect(s.player.kills).toBe(999);
    s = applyAction(s, { type: 'travel', zone: 'temple' }, s.time);
    expect(s.player.kills).toBe(999); expect(power(s.player)).toBe(combatPower);
  });
  it('지역 왕복/현재 지역 이동으로 죽은 몬스터를 즉시 다시 만들 수 없다', () => {
    let s = prepared('temple', 60, 9); s.monsters[0].hp = 1;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 3);
    const respawnAt = s.monsters[0].respawnAt;
    s = applyAction(s, { type: 'travel', zone: 'temple' }, s.time);
    expect(s.monsters[0].alive).toBe(false);
    s = applyAction(s, { type: 'travel', zone: 'island' }, s.time);
    s = applyAction(s, { type: 'travel', zone: 'temple' }, s.time);
    expect(s.monsters[0].alive).toBe(false);
    expect(s.monsters[0].respawnAt).toBe(respawnAt);
    expect(s.player.kills).toBe(1);
    while (s.time < respawnAt) s = tick(s);
    expect(s.monsters[0].alive).toBe(true);
  });
});

describe('강화·입장·방어구', () => {
  it('안전 강화 +4까지 항상 성공하고 이후 모든 확률 경계와 단계별 실패 하락을 적용한다', () => {
    expect(ENHANCE_CHANCES).toEqual([1, 1, 1, 1, .95, .70, .50, .30, .19, .10]);
    expect(ENHANCE_FAILURE_LEVELS).toEqual([0, 1, 2, 3, 3, 4, 5, 6, 7, 8]);
    for (let enhancement = 0; enhancement < 10; enhancement++) {
      const s = game(); s.player.enhancement = enhancement;
      const success = applyAction(s, { type: 'enhance' }, START, () => ENHANCE_CHANCES[enhancement] - 0.0001);
      expect(success.player.enhancement).toBe(enhancement + 1);
      expect(success.player.scrolls).toBe(s.player.scrolls - 1);
      if (enhancement < 4) {
        for (const sample of [0, .5, 1 - Number.EPSILON]) {
          expect(applyAction(s, { type: 'enhance' }, START, () => sample).player.enhancement).toBe(enhancement + 1);
        }
      } else {
        const failed = applyAction(s, { type: 'enhance' }, START, () => ENHANCE_CHANCES[enhancement]);
        expect(failed.player.enhancement).toBe(enhancement - 1);
        expect(failed.player.scrolls).toBe(s.player.scrolls - 1);
        expect(failed.player.adena).toBe(s.player.adena);
        expect(failed.logs.at(-1)?.text).toContain(`+${enhancement - 1}`);
        expect(failed.effects.at(-1)?.value).toBe(enhancement - 1);
      }
    }
  });
  it('강화는 실제 방어력에 반영되고 최고 기록은 실패 후에도 유지된다', () => {
    let s = game(); s.player.enhancement = 9; s.player.bestEnhancement = 9;
    const before = stats(s.player).defense;
    s = applyAction(s, { type: 'enhance' }, START, () => 0.99);
    expect(stats(s.player).defense).toBeLessThan(before);
    expect(s.player.bestEnhancement).toBe(9);
    expect(power(s.player)).toBe(8100);
  });
  it('주문서 부족 및 +10 초과 강화를 거부한다', () => {
    let s = game(); s.player.scrolls = 0;
    expect(() => applyAction(s, { type: 'enhance' }, START)).toThrow('주문서');
    s = game(); s.player.enhancement = 10;
    expect(() => applyAction(s, { type: 'enhance' }, START)).toThrow('+10');
    expect(s.player.scrolls).toBe(8);
  });
  it.each(['island', 'temple', 'volcano', 'tower'] as const)('+0 무기로 %s에 자유롭게 입장한다', zone => {
    expect(applyAction(game(), { type: 'travel', zone }, START).zone).toBe(zone);
  });
  it('강화 실패 후에도 현재 사냥터와 위치를 유지한다', () => {
    let s = prepared('tower', 90, 9);
    s.player.x += 120;
    const point = { x: s.player.x, y: s.player.y };
    s = applyAction(s, { type: 'enhance' }, START, () => 0.9);
    expect(s.zone).toBe('tower'); expect({ x: s.player.x, y: s.player.y }).toEqual(point);
    expect(s.player.enhancement).toBe(8);
  });
  it.each(['knight', 'elf'] as const)('+10 %s 무기의 10%% 특수 공격이 주변 대상에 피해를 준다', characterClass => {
    let s = game(characterClass); s.player.enhancement = 10; s.player.level = 90;
    s.player.hp = stats(s.player).maxHp;
    s.monsters = s.monsters.slice(0, 2);
    s.monsters[0].x = s.player.x + 40; s.monsters[0].y = s.player.y; s.monsters[0].hp = 1000;
    s.monsters[1].x = s.player.x + 100; s.monsters[1].y = s.player.y;
    s = applyAction(s, { type: 'target', id: s.monsters[0].id }, s.time);
    s = tick(s, 1, () => 0);
    expect(s.monsters[1].hp).toBeLessThan(MONSTERS[s.monsters[1].kind].hp);
    expect(s.effects.some(e => e.kind === (characterClass === 'knight' ? 'cleave' : 'pierce'))).toBe(true);
  });
});

describe('물약과 경제', () => {
  it('구매 금액 차감, 수량 증가, 잔액 부족 및 부정 수량 거부', () => {
    const s = game();
    const next = applyAction(s, { type: 'buy', kind: 'orange', quantity: 5 }, START);
    expect(next.player.adena).toBe(1700); expect(next.player.potions.orange).toBe(15);
    expect(() => applyAction(s, { type: 'buy', kind: 'green', quantity: 1 }, START)).toThrow('아데나');
    for (const quantity of [-1, 0, 1.5, NaN, Infinity, 1000]) expect(() => validateAction({ type: 'buy', kind: 'red', quantity })).toThrow();
    expect(POTIONS.green.price).toBe(4000);
  });
  it('HP 80% 이하에서만 자동 사용하고 초당 최대 1개 소모', () => {
    let s = prepared(); s.player.autoPotion.enabled = true;
    s.monsters = [];
    s.player.hp = stats(s.player).maxHp * 0.8 + 1;
    expect(tick(s).player.potions.red).toBe(25);
    s.player.hp = stats(s.player).maxHp * 0.8;
    s = tick(s); expect(s.player.potions.red).toBe(24);
    s.player.hp = 20; s = tick(s, 4); expect(s.player.potions.red).toBe(24);
    s = tick(s); expect(s.player.potions.red).toBe(23);
  });
  it('물약 소진 시 자동 사용을 끄고 초과 회복하지 않는다', () => {
    let s = prepared(); s.player.autoPotion.enabled = true; s.player.potions.red = 0; s.player.hp = 10;
    s = tick(s); expect(s.player.autoPotion.enabled).toBe(false);
    s.player.hp = stats(s.player).maxHp - 1; s.player.potions.clear = 1;
    s = applyAction(s, { type: 'usePotion', kind: 'clear' }, s.time + 1000);
    expect(s.player.hp).toBe(stats(s.player).maxHp);
  });
  it('네 종류 중 선택한 한 물약만 자동으로 사용한다', () => {
    let s = game(); s.monsters = []; s.player.hp = 10;
    s.player.potions.clear = 2; s.player.potions.green = 2;
    const kinds = ['red', 'orange', 'clear', 'green'] as const;
    for (const kind of kinds) {
      s.player.hp = 10; s.player.greenUntil = 0;
      s = applyAction(s, { type: 'autoPotion', enabled: true, kind }, s.time);
      expect(s.player.autoPotion).toEqual({ enabled: true, kind });
      const before = { ...s.player.potions };
      s = tick(s, 5);
      for (const other of kinds) expect(s.player.potions[other]).toBe(before[other] - Number(other === kind));
    }
  });
  it('초록 자동 물약은 체력과 무관하게 만료 후 사용하고 활성 효과를 갱신하지 않는다', () => {
    let s = game(); s.monsters = []; s.player.potions.green = 3;
    s = applyAction(s, { type: 'autoPotion', enabled: true, kind: 'green' }, START);
    s = tick(s);
    const expires = s.player.greenUntil;
    const usedAt = s.logs.find(entry => entry.text.startsWith('초록 물약:'))!.time;
    expect(expires).toBe(usedAt + GREEN_DURATION);
    expect(s.player.potions.green).toBe(2);
    s = tick(s, 20);
    expect(s.player.potions.green).toBe(2); expect(s.player.greenUntil).toBe(expires);
    s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, expires - 100);
    expect(s.player.potions.green).toBe(2); expect(s.player.greenUntil).toBe(expires);
    s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, expires);
    expect(s.player.potions.green).toBe(1); expect(s.player.greenUntil).toBe(expires + GREEN_DURATION);
    expect(s.logs.filter(entry => entry.text === '초록 물약 효과가 종료되었습니다.')).toHaveLength(1);
  });
  it('빈 초록 물약은 활성 효과가 끝났을 때 알림을 한 번 남기고 자동 사용을 끈다', () => {
    let s = game(); s.monsters = []; s.player.potions.green = 0; s.player.greenUntil = START + 1000;
    s = applyAction(s, { type: 'autoPotion', enabled: true, kind: 'green' }, START);
    s = tick(s, 4);
    expect(s.player.autoPotion.enabled).toBe(true); expect(s.player.greenUntil).toBe(START + 1000);
    s = tick(s);
    expect(s.player.autoPotion.enabled).toBe(false); expect(s.player.greenUntil).toBe(0);
    s = tick(s, 10);
    expect(s.logs.filter(entry => entry.text.includes('초록 물약') && entry.text.includes('모두 소진'))).toHaveLength(1);
  });
  it('초록 물약은 서버 시각 10분, 재사용 시 갱신하며 30초 경고·만료를 처리', () => {
    let s = applyAction(game(), { type: 'usePotion', kind: 'green' }, START);
    expect(s.player.greenUntil).toBe(START + GREEN_DURATION);
    s.player.potions.green = 1;
    s = applyAction(s, { type: 'usePotion', kind: 'green' }, START + 10000);
    expect(s.player.greenUntil).toBe(START + 10000 + GREEN_DURATION);
    s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, s.player.greenUntil - 30000);
    expect(s.logs.some(l => l.text.includes('30초'))).toBe(true);
    s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, s.player.greenUntil);
    expect(s.player.greenUntil).toBe(0);
    expect(s.logs.at(-1)?.text).toContain('종료');
  });
  it('초록 물약 공격 횟수는 기본 공격의 약 2배이며 틱 주기에 누적 지연되지 않는다', () => {
    function count(green: boolean) {
      let s = prepared(); s.monsters[0].hp = 100000; s.player.hp = 100000;
      if (green) s.player.greenUntil = START + 600000;
      s = applyAction(s, { type: 'target', id: s.monsters[0].id }, START);
      const seen = new Set<number>();
      for (let i = 0; i < 100; i++) {
        s = tick(s);
        s.effects.filter(e => e.kind === 'slash' && e.x === s.player.x).forEach(e => seen.add(e.id));
      }
      return seen.size;
    }
    expect(ATTACK_INTERVAL).toBe(1000);
    expect(count(true) / count(false)).toBeGreaterThanOrEqual(1.9);
    expect(count(true) / count(false)).toBeLessThanOrEqual(2.1);
  });
});

describe('온라인 응답 지연 보정', () => {
  function advance(s: GameState, duration: number, interval: number, dx = 0): GameState {
    const end = s.time + duration;
    while (s.time < end) s = applyAction(s, { type: 'tick', dx, dy: 0 }, Math.min(end, s.time + interval), rng);
    return s;
  }

  it.each([800, 1500])('%ims 응답에서도 200ms 응답과 같은 서버 시간만큼 이동한다', interval => {
    const initial = game();
    const smooth = advance(initial, 6000, 200, 1);
    const delayed = advance(initial, 6000, interval, 1);
    expect(delayed.player.x).toBeCloseTo(SPAWN.x + 900);
    expect(delayed.player.x).toBeCloseTo(smooth.player.x);
    expect(delayed.time).toBe(smooth.time);
    expect(initial.player.x).toBe(SPAWN.x);
  });

  it.each([800, 1500])('%ims 응답에서도 공격 주기와 중간 초록 물약 만료가 유지된다', interval => {
    let initial = prepared();
    initial.player.hp = 100000;
    initial.monsters[0].hp = 100000;
    initial.player.greenUntil = START + 10_000;
    initial = applyAction(initial, { type: 'target', id: initial.monsters[0].id }, START);
    const smooth = advance(initial, 24_000, 200);
    const delayed = advance(initial, 24_000, interval);
    expect(delayed.monsters[0].hp).toBe(smooth.monsters[0].hp);
    expect(delayed.player.hp).toBe(smooth.player.hp);
    expect(delayed.nextAttackAt).toBe(smooth.nextAttackAt);
    expect(delayed.player.greenUntil).toBe(0);
    expect(delayed.logs.filter(l => l.text === '초록 물약 효과가 종료되었습니다.')).toHaveLength(1);
  });

  it.each([800, 1500])('%ims 응답에서도 자동 물약을 서버 기준 초당 한 번만 사용한다', interval => {
    const initial = prepared('island', 60);
    initial.monsters = [];
    initial.player.hp = 100;
    initial.player.autoPotion.enabled = true;
    const smooth = advance(initial, 12_000, 200);
    const delayed = advance(initial, 12_000, interval);
    expect(delayed.player.hp).toBe(smooth.player.hp);
    expect(delayed.player.potions.red).toBe(smooth.player.potions.red);
    expect(initial.player.potions.red - delayed.player.potions.red).toBe(12);
    expect(delayed.nextPotionAt).toBe(smooth.nextPotionAt);
  });

  it('2초까지의 지연만 보정하고 그보다 긴 공백과 같은 시각의 재요청으로 사냥하지 않는다', () => {
    let initial = prepared();
    initial.monsters[0].hp = 1;
    initial = applyAction(initial, { type: 'target', id: initial.monsters[0].id }, START);
    const permitted = applyAction(initial, { type: 'tick', dx: 0, dy: 0 }, START + 2000, rng);
    expect(permitted.player.kills).toBe(1);
    const repeated = applyAction(permitted, { type: 'tick', dx: 0, dy: 0 }, permitted.time, rng);
    expect(repeated.player).toEqual(permitted.player);
    for (const elapsed of [2001, 60_000, 3_600_000]) {
      const inactive = applyAction(initial, { type: 'tick', dx: 0, dy: 0 }, START + elapsed, rng);
      expect(inactive.player).toEqual(initial.player);
      expect(inactive.monsters).toEqual(initial.monsters);
      expect(inactive.time).toBe(START + elapsed);
    }
  });

  it('지연 중 사망하면 부활 위치에서 중단하고 남은 과거 입력을 버린다', () => {
    const initial = prepared('volcano', 60, 7);
    initial.player.hp = 1;
    const after = applyAction(initial, { type: 'tick', dx: 1, dy: 0 }, START + 1500, rng);
    expect(after.zone).toBe('island');
    expect({ x: after.player.x, y: after.player.y }).toEqual(SPAWN);
    expect(after.player.hp).toBe(stats(after.player).maxHp);
    expect(after.time).toBe(START + 1500);
  });

  it('99레벨의 지연된 광역 공격도 실제 몬스터 수만 보상·집계한다', () => {
    let initial = game();
    initial.player.level = 99;
    initial.monsters[0].x = initial.player.x + 30;
    initial.monsters[0].y = initial.player.y;
    initial = applyAction(initial, { type: 'target', id: initial.monsters[0].id }, START);
    const after = applyAction(initial, { type: 'tick', dx: 0, dy: 0 }, START + 1500, rng);
    expect(after.player.kills).toBe(initial.monsters.length);
    expect(after.player.adena - initial.player.adena).toBe(50 * initial.monsters.length);
    expect(after.player.xp).toBe(0);
    expect(advance(after, 1500, 1500).player.kills).toBe(initial.monsters.length);
  });
});
