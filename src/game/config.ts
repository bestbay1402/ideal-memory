import type { CharacterClass, MonsterKind, PotionKind, ZoneId } from './types';

// 게임 밸런스는 이 파일에서 변경합니다. 확률은 0~1 사이의 값입니다.
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 1040;
export const PLAYER_RADIUS = 13;
export const PLAYER_SPEED = 150; // 기사와 요정의 이동속도(초당 픽셀)
export const ATTACK_INTERVAL = 1000;
export const AUTO_ATTACK_RANGE = 58; // 가만히 있을 때 주변 몬스터를 자동으로 선택하는 거리
export const GREEN_DURATION = 600_000; // 초록 물약 10분 (서버 시간)
export const POTION_INTERVAL = 1000;
export const AUTO_POTION_THRESHOLD = 0.8;
export const RESPAWN_MS = 8000;
export const MAX_TICK_MS = 500;
export const MAX_LEVEL = 99;
export const MAX_ENHANCEMENT = 10;
export const ENHANCE_CHANCES = [1, 1, 1, 1, 0.95, 0.70, 0.50, 0.30, 0.19, 0.10] as const;
// 배열 위치는 현재 강화 수치입니다. +0~+4 도달은 100% 성공하므로 앞 네 실패값은 사용되지 않습니다.
export const ENHANCE_FAILURE_LEVELS = [0, 1, 2, 3, 3, 4, 5, 6, 7, 8] as const;
// 필요 경험치는 유지하고 몬스터에게서 받는 경험치만 3배로 늘립니다.
export const XP_MULTIPLIER = 3;
export const ATTACK_BONUS = [0, 3, 6, 10, 15, 22, 31, 44, 61, 86, 125] as const;
export const ARMOR_BONUS = [0, 1, 2, 3, 5, 7, 10, 14, 19, 25, 33] as const;
export const CLASSES: Record<CharacterClass, { name: string; weapon: string; hp: number; hpPerLevel: number; attack: number; defense: number; range: number }> = {
  knight: { name: '기사', weapon: '싸울아비 장검', hp: 180, hpPerLevel: 9, attack: 16, defense: 8, range: 58 },
  elf: { name: '요정', weapon: '사이하의 활', hp: 140, hpPerLevel: 7, attack: 15, defense: 5, range: 210 },
};
export const POTIONS: Record<PotionKind, { name: string; price: number; heal: number; color: string }> = {
  red: { name: '빨강 물약', price: 20, heal: 30, color: '#dc5b5b' },
  orange: { name: '주홍 물약', price: 60, heal: 70, color: '#fba04d' },
  clear: { name: '맑은 물약', price: 140, heal: 150, color: '#a6deeb' },
  green: { name: '초록 물약', price: 4000, heal: 0, color: '#79c477' },
};
export const ZONES: Record<ZoneId, { name: string; recommendedEnhancement: number; description: string; color: string; aggressive: boolean; adena: [number, number]; xp: [number, number]; scrollChance: number; monsters: [MonsterKind, MonsterKind] }> = {
  island: { name: '말하는 섬', recommendedEnhancement: 0, description: '바람이 머무는 숲, 모험이 시작되는 곳', color: '#4c715b', aggressive: false, adena: [40, 60], xp: [10, 20], scrollChance: 0.05, monsters: ['slime', 'werewolf'] },
  temple: { name: '카오틱 신전', recommendedEnhancement: 6, description: '붉은 안개 너머 잠든 고대 신전', color: '#9c4f52', aggressive: true, adena: [120, 180], xp: [30, 45], scrollChance: 0.1, monsters: ['bugbear', 'orc'] },
  volcano: { name: '화룡의 둥지', recommendedEnhancement: 7, description: '꺼지지 않는 불꽃과 검게 탄 대지', color: '#d67741', aggressive: true, adena: [300, 420], xp: [70, 100], scrollChance: 0.18, monsters: ['ifrit', 'phoenix'] },
  tower: { name: '오만의 탑', recommendedEnhancement: 9, description: '마지막 영웅을 기다리는 어둠의 성채', color: '#887da7', aggressive: true, adena: [700, 1000], xp: [150, 220], scrollChance: 0.3, monsters: ['vampire', 'cougar'] },
};
export const MONSTERS: Record<MonsterKind, { name: string; hp: number; attack: number; defense: number; speed: number; attackInterval: number; range: number }> = {
  slime: { name: '슬라임', hp: 58, attack: 14, defense: 0, speed: 43, attackInterval: 1700, range: 39 },
  werewolf: { name: '늑대인간', hp: 90, attack: 18, defense: 2, speed: 80, attackInterval: 1500, range: 44 },
  bugbear: { name: '버그베어', hp: 390, attack: 33, defense: 8, speed: 62, attackInterval: 1600, range: 46 },
  orc: { name: '오크전사', hp: 340, attack: 35, defense: 6, speed: 78, attackInterval: 1500, range: 48 },
  ifrit: { name: '이프리트', hp: 1500, attack: 59, defense: 10, speed: 76, attackInterval: 1450, range: 62 },
  phoenix: { name: '피닉스', hp: 1350, attack: 57, defense: 8, speed: 92, attackInterval: 1450, range: 92 },
  vampire: { name: '뱀파이어', hp: 1580, attack: 74, defense: 18, speed: 83, attackInterval: 1400, range: 58 },
  cougar: { name: '쿠거', hp: 1490, attack: 78, defense: 16, speed: 103, attackInterval: 1450, range: 48 },
};
// 필요 경험치표의 기준은 기존 1/2/4/6시간을 유지합니다. 실제 성장 목표는 XP_MULTIPLIER로 나눕니다.
// 1~30: 말하는 섬, 30~60: 카오틱 신전, 60~90: 화룡의 둥지, 90~99: 오만의 탑.
export const GROWTH_STAGES = [
  // scripts/balance.ts의 실제 전투 엔진 표본으로 보정한 가속 처치시간(짧은 이동 1초 포함).
  { from: 1, to: 30, hours: 1, zone: 'island' as ZoneId, killSeconds: 2.18, xpPerKill: 15, enhancement: 3 },
  { from: 30, to: 60, hours: 2, zone: 'temple' as ZoneId, killSeconds: 4.49, xpPerKill: 37.5, enhancement: 6 },
  { from: 60, to: 90, hours: 4, zone: 'volcano' as ZoneId, killSeconds: 11.3, xpPerKill: 85, enhancement: 7 },
  { from: 90, to: 99, hours: 6, zone: 'tower' as ZoneId, killSeconds: 8.0, xpPerKill: 185, enhancement: 9 },
] as const;
export const XP_TABLE: number[] = Array.from({ length: 100 }, (_, level) => {
  if (level === 0 || level >= 99) return 0;
  const stage = GROWTH_STAGES.find(s => level >= s.from && level < s.to)!;
  const count = stage.to - stage.from;
  const average = stage.hours * 3600 / stage.killSeconds * stage.xpPerKill / count;
  // 동일 구간 내에서는 조금씩 증가하며 구간 전체 평균은 정확히 유지합니다.
  return Math.round(average * (0.8 + 0.4 * (level - stage.from) / Math.max(1, count - 1)));
});
