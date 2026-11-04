import { test, expect, type Page } from '@playwright/test';
import { createGame, stats } from '../src/game/engine';
import type { GameState, CharacterClass } from '../src/game/types';
const KEY = 'classic-beomjae-demo-v1';

async function saved(page: Page): Promise<GameState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
}
async function newDemo(page: Page, characterClass: CharacterClass = 'knight') {
  await page.goto('/');
  await page.getByRole('button', { name: /계정 없이 로컬 데모/ }).click();
  if (characterClass === 'elf') await page.getByRole('button', { name: /ELF 요정/ }).click();
  await page.getByLabel('캐릭터 닉네임').fill(characterClass === 'knight' ? '브라우저기사' : '브라우저요정');
  await page.getByRole('button', { name: '모험의 첫걸음 내딛기 →' }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
}
async function selectMonster(page: Page, index = 0) {
  const state = await saved(page);
  const monster = state.monsters[index];
  const cameraX = Math.min(600, Math.max(0, state.player.x - 500));
  const cameraY = Math.min(440, Math.max(0, state.player.y - 300));
  const canvas = page.getByTestId('game-canvas');
  const rect = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: (monster.x - cameraX) / 1000 * rect.width, y: (monster.y - cameraY - 21) / 600 * rect.height } });
}

test('메인 화면·확률표 공개, 외부 연결 없는 랭킹 상태도 명확하다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /클래식.*범죄와의 전쟁/ })).toBeVisible();
  await page.getByRole('button', { name: /무기 강화 확률표/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('tbody tr')).toHaveCount(10);
  await expect(dialog.locator('tbody tr').last()).toContainText('5%');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '전체 랭킹 · 영웅의 전당' }).click();
  await expect(page.getByRole('dialog')).toContainText('실제 온라인 캐릭터만');
  await expect(page.getByRole('dialog')).toContainText('로컬 데모 캐릭터는 이 목록에 등록되지 않습니다.');
});

test('기사 생성→WASD 이동→마우스 사냥→처치 보상→새로고침 저장 복구', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await newDemo(page);
  const start = (await saved(page)).player;
  await page.keyboard.down('d');
  await expect.poll(async () => (await saved(page)).player.x).toBeGreaterThan(start.x + 30);
  await page.keyboard.up('d');
  await selectMonster(page);
  await expect.poll(async () => (await saved(page)).targetId).not.toBeNull();
  await expect.poll(async () => (await saved(page)).player.kills, { timeout: 18000 }).toBe(1);
  const killed = (await saved(page)).player;
  expect(killed.adena).toBeGreaterThanOrEqual(start.adena + 40);
  expect(killed.xp).toBeGreaterThanOrEqual(10);
  await page.reload();
  await page.getByRole('button', { name: /저장된 로컬 데모 이어하기/ }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  expect((await saved(page)).player.kills).toBe(1);
  expect((await saved(page)).player.adena).toBe(killed.adena);
  expect(errors).toEqual([]);
});

test('요정 생성·원거리 사냥, 상점·강화·초록 물약·지역 제한·채팅 분리', async ({ page }) => {
  await newDemo(page, 'elf');
  expect((await saved(page)).player.class).toBe('elf');
  await page.keyboard.press('b');
  await page.getByLabel('구매 수량').fill('3');
  await page.getByRole('button', { name: '빨강 물약 3개 구매' }).click();
  await expect.poll(async () => (await saved(page)).player.adena).toBe(1940);
  expect((await saved(page)).player.potions.red).toBe(28);
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.getByRole('button', { name: '✧ 무기 강화하기' }).click();
  await expect.poll(async () => (await saved(page)).player.enhancement).toBe(1);
  expect((await saved(page)).player.scrolls).toBe(7);
  await expect(page.getByRole('dialog')).toContainText('강화 성공');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '초록 물약 사용', exact: true }).click();
  await expect.poll(async () => (await saved(page)).player.greenUntil).toBeGreaterThan(Date.now());
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: /REGION 02/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /REGION 03/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await selectMonster(page);
  await expect.poll(async () => (await saved(page)).player.kills, { timeout: 15000 }).toBe(1);
  await expect(page.locator('.world-chat')).toContainText('온라인');
});

test('공개 랭킹 오른쪽 처치 수 표시·전투력 순서 유지 (표시용 API fixture)', async ({ page }) => {
  await page.route('**/api/rankings?sort=*', route => route.fulfill({ json: { rankings: [
    { nickname: '전투력우선', class: 'knight', level: 99, xp: 0, enhancement: 10, bestEnhancement: 10, power: 19900, kills: 7 },
    { nickname: '처치수많음', class: 'elf', level: 20, xp: 12, enhancement: 3, bestEnhancement: 4, power: 5000, kills: 1234 },
  ] } }));
  await page.goto('/');
  await page.getByRole('button', { name: '전체 랭킹 · 영웅의 전당' }).click();
  const table = page.locator('.ranking-table');
  await expect(table.locator('th').last()).toHaveText('몬스터 처치 수');
  await expect(table.locator('tbody tr').first()).toContainText('전투력우선');
  await expect(table.locator('tbody tr').last().locator('td').last()).toHaveText('1,234');
});

test('99레벨 데모 저장 fixture: 실제 캔버스 공격 한 번에10마리 집계·최종변신 유지', async ({ page }) => {
  const state = createGame('전설검증', 'knight', Date.now());
  state.player.level = 99;
  state.player.enhancement = 10;
  state.player.bestEnhancement = 10;
  state.player.hp = stats(state.player).maxHp;
  state.player.kills = 42;
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: KEY, state });
  await page.goto('/');
  await page.getByRole('button', { name: /저장된 로컬 데모 이어하기/ }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await selectMonster(page);
  await expect.poll(async () => (await saved(page)).player.kills).toBe(52);
  const current = await saved(page);
  expect(current.monsters.every(monster => !monster.alive)).toBe(true);
  expect(current.player.xp).toBe(0);
  await expect(page.locator('.player-identity')).toContainText('황금빛 전설의 기사');
});
