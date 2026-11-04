/**
 * npm run balance
 * 실제 applyAction 전투 엔진에 서버 시간 200ms 틱을 반복 입력합니다.
 * 각 레벨·직업·몬스터를 독립된 시드로 여러 번 사냥한 표본으로 성장 시간을 추정합니다.
 * 짧은 다음 몬스터 이동 1초를 포함합니다. 강화 복구·사망·휴식 시간은 제외합니다.
 * --check: 성장 구간 목표 ±20%, 화룡 +7~8 가속 8~13초, 기본 15~25초,
 * 주홍 물약 평균 2.2~3.8개, 가속 순수익 양수, 직업 간 성장시간 차이 15% 이내 검사.
 */
import { applyAction, createGame, stats, xpRequired } from '../src/game/engine';
import { GROWTH_STAGES, ZONES } from '../src/game/config';
import type { CharacterClass, ZoneId } from '../src/game/types';
import { spawnMonsters } from '../src/game/world';

function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const TICK_MS = 200;
const BETWEEN_KILLS_SECONDS = 1;
const TRIALS_PER_MONSTER = 8;
type Sample = { seconds: number; potions: number; damage: number; xp: number; adena: number };
function simulate(characterClass: CharacterClass, level: number, enhancement: number, zone: ZoneId, green: boolean, trials = TRIALS_PER_MONSTER): Sample {
  let s = createGame('밸런스검증', characterClass, 1_000_000);
  s.player.level = level; s.player.enhancement = enhancement;
  s.player.hp = stats(s.player).maxHp;
  s.player.autoPotion = { enabled: true, kind: 'orange' };
  s.player.potions.orange = 10000;
  s.zone = zone;
  let seconds = 0, potions = 0, damage = 0, experience = 0, adena = 0;
  let kills = 0;
  const rng = random(level * 311 + enhancement * 997 + (characterClass === 'elf' ? 721 : 131));
  for (const kind of ZONES[zone].monsters) for (let trial = 0; trial < trials; trial++) {
    // 동일 난도의 전투를 측정하기 위해 개발용 표본에서는 레벨을 고정합니다.
    s.player.level = level; s.player.xp = 0;
    s.player.x = 220; s.player.y = 510;
    s.player.greenUntil = green ? s.time + 600_000 : 0;
    const monster = spawnMonsters(zone).find(m => m.kind === kind)!;
    monster.x = 320; monster.y = 510; monster.homeX = 320; monster.homeY = 510;
    s.monsters = [monster]; s.targetId = monster.id;
    s.nextAttackAt = s.time; s.nextPotionAt = Math.min(s.nextPotionAt, s.time);
    s.logs = []; s.effects = [];
    const startTime = s.time, startPotions = s.player.potions.orange, startHp = s.player.hp, startMoney = s.player.adena;
    const beforeKills = s.player.kills;
    for (let step = 0; step < 400 && s.player.kills === beforeKills; step++) {
      s = applyAction(s, { type: 'tick', dx: 0, dy: 0 }, s.time + TICK_MS, rng);
      if (s.zone !== zone) throw new Error(`${zone} ${characterClass} ${level}레벨 사망: 목표 장비로 안정적인 사냥 불가`);
    }
    if (s.player.kills === beforeKills) throw new Error('80초 내 처치 실패');
    const used = startPotions - s.player.potions.orange;
    const received = Math.max(0, startHp - s.player.hp + used * 70);
    seconds += (s.time - startTime) / 1000 + BETWEEN_KILLS_SECONDS;
    potions += used; damage += received; experience += s.player.xp; adena += s.player.adena - startMoney; kills++;
    // 지역 이동/재생성 대기는 성장 목표의 순수 사냥 시간에 넣지 않습니다.
    // 다음 표본의 HP는 이어서 사용하므로 매 전투 무료 회복 효과가 없습니다.
    s.time += BETWEEN_KILLS_SECONDS * 1000;
  }
  return { seconds: seconds / kills, potions: potions / kills, damage: damage / kills, xp: experience / kills, adena: adena / kills };
}

let failed = false;
const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) { failed = true; failures.push(message); }
}
const growthRows: Record<string, string | number>[] = [];
const totalHours: Record<CharacterClass, number> = { knight: 0, elf: 0 };
for (const characterClass of ['knight', 'elf'] as const) for (const stage of GROWTH_STAGES) {
  let predictedSeconds = 0, averageKillSeconds = 0;
  for (let level = stage.from; level < stage.to; level++) {
    const observed = simulate(characterClass, level, stage.enhancement, stage.zone, true);
    // 몬스터별 경험치 평균은 설정된 균등분포의 기대값. 시간은 엔진의 실측입니다.
    predictedSeconds += xpRequired(level) / stage.xpPerKill * observed.seconds;
    averageKillSeconds += observed.seconds / (stage.to - stage.from);
  }
  const hours = predictedSeconds / 3600;
  const deviation = (hours / stage.hours - 1) * 100;
  check(Math.abs(deviation) <= 20, `${characterClass} ${stage.from}→${stage.to} 성장 시간이 목표 ±20%를 벗어났습니다.`);
  totalHours[characterClass] += hours;
  growthRows.push({ 직업: characterClass === 'knight' ? '기사' : '요정', 구간: `${stage.from}→${stage.to}`, 사냥터: ZONES[stage.zone].name, 목표시간: stage.hours, 예상시간: hours.toFixed(2), 차이: `${deviation.toFixed(1)}%`, 평균처치초: averageKillSeconds.toFixed(2) });
}
console.log('실제 서버 전투 엔진 반복 시뮬레이션 — 200ms 틱, 1초 이동, 직업/레벨/몬스터별 8회');
console.table(growthRows);
console.log(`1→99레벨 예상 총시간: 기사 ${totalHours.knight.toFixed(2)}h / 요정 ${totalHours.elf.toFixed(2)}h (목표 13h)`);
check(Math.max(totalHours.knight, totalHours.elf) / Math.min(totalHours.knight, totalHours.elf) <= 1.15, '직업 간 예상 성장 시간 차이가 15%를 초과합니다.');

const volcanoRows: Record<string, string | number>[] = [];
let greenSeconds = 0, normalSeconds = 0, greenPotions = 0, count = 0;
for (const characterClass of ['knight', 'elf'] as const) for (const enhancement of [7, 8]) for (const green of [true, false]) {
  const sample = simulate(characterClass, 75, enhancement, 'volcano', green, 24);
  const profit = sample.adena - sample.potions * 60 - (green ? sample.seconds * 4000 / 600 : 0);
  if (green) {
    greenSeconds += sample.seconds;
    greenPotions += sample.potions;
    check(profit > 0, `화룡 ${characterClass} +${enhancement} 가속 사냥의 순수익이 양수가 아닙니다.`);
  } else normalSeconds += sample.seconds;
  count++;
  volcanoRows.push({ 직업: characterClass === 'knight' ? '기사' : '요정', 강화: `+${enhancement}`, 가속: green ? '사용' : '없음', 처치초: sample.seconds.toFixed(2), 주홍물약: sample.potions.toFixed(2), 평균아데나: sample.adena.toFixed(0), 순수익: profit.toFixed(0) });
}
console.table(volcanoRows);
const greenMean = greenSeconds / (count / 2), normalMean = normalSeconds / (count / 2);
const potionMean = greenPotions / (count / 2);
check(greenMean >= 8 && greenMean <= 13, '화룡 가속 평균 처치 시간이 8~13초를 벗어났습니다.');
check(normalMean >= 15 && normalMean <= 25, '화룡 기본 평균 처치 시간이 15~25초를 벗어났습니다.');
check(potionMean >= 2.2 && potionMean <= 3.8, '화룡 가속 주홍 물약 평균 소비가 2.2~3.8개를 벗어났습니다.');
console.log(`75레벨 화룡 +7~8 평균: 가속 ${greenMean.toFixed(2)}초 / 기본 ${normalMean.toFixed(2)}초 / 가속 주홍 물약 ${potionMean.toFixed(2)}개. 물약은 연속 전투의 실제 소모량입니다.`);

const towerRows: Record<string, string | number>[] = [];
for (const characterClass of ['knight', 'elf'] as const) {
  const times: number[] = [];
  for (const enhancement of [9, 10]) {
    const sample = simulate(characterClass, 95, enhancement, 'tower', true, 24);
    const profit = sample.adena - sample.potions * 60 - sample.seconds * 4000 / 600;
    times.push(sample.seconds);
    check(profit > 0, `오만 ${characterClass} +${enhancement} 가속 사냥의 순수익이 양수가 아닙니다.`);
    towerRows.push({ 직업: characterClass === 'knight' ? '기사' : '요정', 강화: `+${enhancement}`, 처치초: sample.seconds.toFixed(2), 주홍물약: sample.potions.toFixed(2), 순수익: profit.toFixed(0) });
  }
  check(times[1] < times[0], `${characterClass} +10 무기가 +9보다 빠르게 처치하지 못합니다.`);
}
console.log('95레벨 오만의 탑 가속 사냥 — +9 안정성, +10 사냥 속도와 순수익 검증');
console.table(towerRows);
console.log('가정: 적정 무기 고정, 한 번에 몬스터 1마리, 초록 물약 유지. 지형 경로·추가 몬스터·강화 복구·휴식은 실제 시간을 늘릴 수 있습니다.');
if (failed) {
  console.error('허용 범위 밖 밸런스 항목:', failures.join('\n'));
  if (process.argv.includes('--check')) process.exitCode = 1;
} else console.log('밸런스 검사 통과: 성장시간·직업차이·화룡 처치시간/물약/순수익·오만 +9/+10.');
