export type CharacterClass = 'knight' | 'elf';
export type ZoneId = 'island' | 'temple' | 'volcano' | 'tower';
export type HealPotionKind = 'red' | 'orange' | 'clear';
export type PotionKind = HealPotionKind | 'green';
export type MonsterKind = 'slime' | 'werewolf' | 'bugbear' | 'orc' | 'ifrit' | 'phoenix' | 'vampire' | 'cougar';
export interface Point { x: number; y: number }
export interface Player extends Point {
  nickname: string; class: CharacterClass; level: number; xp: number; hp: number;
  adena: number; enhancement: number; bestEnhancement: number; scrolls: number;
  /** 모든 사냥터의 누적 처치 수. 사망·이동·재접속으로 초기화하지 않습니다. */
  kills: number;
  potions: Record<PotionKind, number>;
  autoPotion: { enabled: boolean; kind: HealPotionKind };
  greenUntil: number;
}
export interface Monster extends Point {
  id: string; kind: MonsterKind; hp: number; maxHp: number;
  homeX: number; homeY: number; alive: boolean; aggro: boolean;
  respawnAt: number; nextAttackAt: number; generation: number;
}
export type EffectKind = 'slash' | 'arrow' | 'hit' | 'death' | 'level' | 'transform' | 'enhanceSuccess' | 'enhanceFail' | 'heal' | 'nova' | 'cleave' | 'pierce' | 'respawn';
export interface Effect extends Point { id: number; kind: EffectKind; time: number; toX?: number; toY?: number; value?: number; text?: string }
export interface GameLog { id: number; time: number; text: string; kind: 'info' | 'combat' | 'reward' | 'success' | 'warning' }
export interface GameState {
  version: 1; player: Player; monsters: Monster[]; zone: ZoneId; time: number;
  targetId: string | null; nextAttackAt: number; nextPotionAt: number;
  greenWarningSent: boolean; sequence: number; logs: GameLog[]; effects: Effect[];
  /** 떠난 지역의 몬스터 생명 주기를 보관해 지역 이동으로 재생성을 우회하지 못합니다. */
  zoneMonsters?: Partial<Record<ZoneId, Monster[]>>;
}
export type Action =
  | { type: 'tick'; dx: number; dy: number }
  | { type: 'target'; id: string }
  | { type: 'travel'; zone: ZoneId }
  | { type: 'enhance' }
  | { type: 'buy'; kind: PotionKind; quantity: number }
  | { type: 'usePotion'; kind: PotionKind }
  | { type: 'autoPotion'; enabled: boolean; kind: HealPotionKind };
export interface Obstacle extends Point { width: number; height: number; kind: 'tree' | 'rock' | 'pillar' | 'wall' | 'lava' }
export interface Decoration extends Point { kind: 'grass' | 'flower' | 'torch' | 'bones' | 'rune' | 'sign' }
