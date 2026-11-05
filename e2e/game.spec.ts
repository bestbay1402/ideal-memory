import { test, expect, type Page } from '@playwright/test';
import { createGame, stats } from '../src/game/engine';
import type { GameState, CharacterClass, Point } from '../src/game/types';
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
async function loadDemo(page: Page, state: GameState) {
  await page.addInitScript(({ key, state }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, { key: KEY, state });
  await page.goto('/');
  await page.getByRole('button', { name: /저장된 로컬 데모 이어하기/ }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
}
function quietGame(nickname: string) {
  const state = createGame(nickname, 'knight', Date.now());
  for (const monster of state.monsters) {
    monster.alive = false;
    monster.respawnAt = state.time + 60 * 60 * 1000;
  }
  return state;
}
async function clickGround(page: Page, point: Point) {
  const state = await saved(page);
  const cameraX = Math.min(600, Math.max(0, state.player.x - 500));
  const cameraY = Math.min(440, Math.max(0, state.player.y - 300));
  const canvas = page.getByTestId('game-canvas');
  const rect = (await canvas.boundingBox())!;
  await canvas.click({ position: {
    x: (point.x - cameraX) / 1000 * rect.width,
    y: (point.y - cameraY) / 600 * rect.height,
  } });
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
  const rows = dialog.locator('tbody tr');
  const chances = ['100%', '100%', '100%', '100%', '95%', '70%', '50%', '30%', '19%', '10%'];
  for (let index = 0; index < chances.length; index++) {
    await expect(rows.nth(index).locator('td').nth(1)).toHaveText(chances[index]);
    await expect(rows.nth(index).locator('td').nth(2)).toHaveText(index < 4 ? '실패 없음' : `+${index - 1}로 하락`);
  }
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

test('요정 생성·원거리 사냥, 상점·강화·인벤토리 수동 물약·채팅 분리', async ({ page }) => {
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
  await page.keyboard.press('i');
  await page.locator('.inventory-item').filter({ hasText: '초록 물약' }).getByRole('button', { name: '사용', exact: true }).click();
  await expect.poll(async () => (await saved(page)).player.greenUntil).toBeGreaterThan(Date.now());
  await page.keyboard.press('Escape');
  await selectMonster(page);
  await expect.poll(async () => (await saved(page)).player.kills, { timeout: 15000 }).toBe(1);
  await expect(page.locator('.world-chat')).toContainText('온라인');
});

test('땅을 클릭하면 바위를 돌아 목적지에 도착하고 WASD 입력은 클릭 이동을 취소한다', async ({ page }) => {
  const state = quietGame('경로검증');
  state.player.x = 260;
  state.player.y = 250;
  await loadDemo(page, state);
  const destination = { x: 460, y: 250 };
  const visited: Point[] = [];
  await clickGround(page, destination); // (360, 250)의 바위 뒤를 클릭합니다.
  await expect.poll(async () => {
    const { x, y } = (await saved(page)).player;
    visited.push({ x, y });
    return Math.hypot(x - destination.x, y - destination.y);
  }, { intervals: [50], timeout: 10000 }).toBeLessThan(12);
  expect(visited.some(point => Math.abs(point.y - 250) >= 36)).toBe(true);
  expect(visited.every(point => !(point.x > 319 && point.x < 401 && point.y > 213 && point.y < 287))).toBe(true);

  await clickGround(page, { x: 850, y: 250 });
  await expect.poll(async () => (await saved(page)).player.x).toBeGreaterThan(500);
  const turning = (await saved(page)).player;
  await page.keyboard.down('w');
  await expect.poll(async () => (await saved(page)).player.y).toBeLessThan(turning.y - 35);
  await page.keyboard.up('w');
  const stopped = (await saved(page)).player;
  await page.waitForTimeout(650); // 여러 게임 틱이 지나도 예전 목적지로 이동을 재개하지 않습니다.
  const after = (await saved(page)).player;
  expect(Math.abs(after.x - stopped.x)).toBeLessThan(3);
  expect(Math.abs(after.y - stopped.y)).toBeLessThan(3);
});

test('스크롤된 카메라와 축소된 캔버스에서도 클릭한 월드 좌표로 이동한다', async ({ page }) => {
  const state = quietGame('카메라좌표검증');
  state.player.x = 1000;
  state.player.y = 500;
  await page.setViewportSize({ width: 1100, height: 1050 });
  await loadDemo(page, state);
  const destination = { x: 1300, y: 720 };
  await clickGround(page, destination);
  await expect.poll(async () => {
    const player = (await saved(page)).player;
    return Math.hypot(player.x - destination.x, player.y - destination.y);
  }).toBeLessThan(12);
});

test('입력 없이 가까운 살아 있는 몬스터를 자동 처치하고 3배 경험치를 받는다', async ({ page }) => {
  const state = quietGame('자동사냥검증');
  const monster = state.monsters[0];
  monster.alive = true;
  monster.hp = 1;
  monster.x = monster.homeX = state.player.x + 35;
  monster.y = monster.homeY = state.player.y;
  await loadDemo(page, state);
  await expect.poll(async () => (await saved(page)).player.kills).toBe(1);
  const current = await saved(page);
  expect(current.monsters[0].alive).toBe(false);
  expect(current.player.xp).toBeGreaterThanOrEqual(30);
  expect(current.player.xp).toBeLessThanOrEqual(60);
  expect(current.player.xp % 3).toBe(0);
  expect(current.player.x).toBe(state.player.x);
  expect(current.player.y).toBe(state.player.y);
  await expect(page.locator('.log-content')).toContainText('슬라임 처치');
});

test('물약 슬롯 클릭과 숫자키는 하나만 자동 선택하고 같은 슬롯을 누르면 모두 해제된다', async ({ page }) => {
  const state = quietGame('물약선택검증');
  state.player.potions.clear = 3;
  state.player.potions.green = 3;
  state.player.greenUntil = state.time + 60_000;
  await loadDemo(page, state);
  const slots = page.locator('.quick-potions button');
  const selected = page.locator('.quick-potions button[aria-pressed="true"]');
  await expect(slots).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    // 이미 선택된 초기 빨강 슬롯도 먼저 해제하여 각 슬롯의 선택 동작을 검증합니다.
    if (await slots.nth(index).getAttribute('aria-pressed') === 'true') await slots.nth(index).click();
    await slots.nth(index).click();
    await expect(selected).toHaveCount(1);
    await expect(slots.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect(slots.nth(index)).toHaveClass(/auto-selected/);
    await slots.nth(index).click();
    await expect(selected).toHaveCount(0);
    expect((await saved(page)).player.autoPotion.enabled).toBe(false);
  }
  await slots.nth(0).click();
  await slots.nth(1).click();
  await expect(selected).toHaveCount(1);
  await expect(slots.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(slots.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await slots.nth(1).click();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press(String(index + 1));
    await expect(selected).toHaveCount(1);
    await expect(slots.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('4');
  await expect(selected).toHaveCount(0);
  expect((await saved(page)).player.potions).toEqual(state.player.potions);
});

test('선택한 초록 물약은 효과가 끝날 때 재사용하며 활성 효과 중에는 소비하지 않는다', async ({ page }) => {
  await page.clock.install();
  const state = quietGame('초록자동검증');
  state.player.potions.green = 3;
  await loadDemo(page, state);
  const green = page.locator('.quick-potions button').nth(3);
  await green.click();
  await expect(green).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await saved(page)).player.potions.green).toBe(2);
  const activated = (await saved(page)).player.greenUntil;
  await page.clock.fastForward(60_000);
  expect((await saved(page)).player.potions.green).toBe(2);
  await page.clock.fastForward(540_500);
  await expect.poll(async () => (await saved(page)).player.potions.green).toBe(1);
  expect((await saved(page)).player.greenUntil).toBeGreaterThan(activated);
  await expect(green).toHaveAttribute('aria-pressed', 'true');
});

test('모험 기록은 캔버스 바로 아래 월드 안에 있고 조작 바보다 위에 있다', async ({ page }) => {
  await newDemo(page);
  const canvas = page.getByTestId('game-canvas');
  const log = page.locator('.world-frame > .log-panel');
  await expect(log).toBeVisible();
  expect(await canvas.evaluate(element => element.nextElementSibling?.classList.contains('log-panel'))).toBe(true);
  const canvasBox = (await canvas.boundingBox())!;
  const logBox = (await log.boundingBox())!;
  const actions = (await page.locator('.action-bar').boundingBox())!;
  expect(logBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  expect(logBox.y + logBox.height).toBeLessThanOrEqual(actions.y);
  await page.getByRole('button', { name: '로그 접기', exact: true }).click();
  await expect(log).toHaveClass(/compact/);
  await page.getByRole('button', { name: '로그 펼치기', exact: true }).click();
  await expect(log).not.toHaveClass(/compact/);
});

test('+0 무기로 모든 사냥터에 입장하며 지도와 사이드바는 강화 추천만 표시한다', async ({ page }) => {
  await newDemo(page);
  const zones = [
    { id: 'temple', recommendation: '+6검 이상 추천' },
    { id: 'volcano', recommendation: '+7검 이상 추천' },
    { id: 'tower', recommendation: '+9검 이상 추천' },
    { id: 'island', recommendation: '+0검 이상 추천' },
  ] as const;
  await expect(page.locator('.mini-zones')).not.toContainText('잠김');
  for (const zone of zones) {
    await page.keyboard.press('m');
    const map = page.getByRole('dialog');
    await expect(map).not.toContainText('잠김');
    const destination = map.locator(`.map-zone.zone-${zone.id}`);
    await expect(destination).toBeEnabled();
    await expect(destination).toContainText(zone.recommendation);
    await destination.click();
    await expect.poll(async () => (await saved(page)).zone).toBe(zone.id);
    expect((await saved(page)).player.enhancement).toBe(0);
  }
  await page.locator('.mini-zone.zone-tower').click();
  await expect.poll(async () => (await saved(page)).zone).toBe('tower');
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
  await loadDemo(page, state);
  await selectMonster(page);
  await expect.poll(async () => (await saved(page)).player.kills).toBe(52);
  const current = await saved(page);
  expect(current.monsters.every(monster => !monster.alive)).toBe(true);
  expect(current.player.xp).toBe(0);
  await expect(page.locator('.player-identity')).toContainText('황금빛 전설의 기사');
});
