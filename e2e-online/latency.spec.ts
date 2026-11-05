import { test, expect, type Page } from '@playwright/test';
import { createGame } from '../src/game/engine';
import type { GameState } from '../src/game/types';

const NICKNAME = '온라인지연기사';
const OWNER = '11111111-1111-4111-8111-111111111111';
const RESPONSE_DELAY_MS = 800;
type Checkpoint = { requestId: string; revision: number; state: GameState };
type Ack = { revision: number; savedAt: number; state: GameState };

declare global {
  interface Window { __renderedPlayer?: { x: number; y: number; at: number } }
}
async function visualPosition(page: Page) {
  return page.evaluate(() => window.__renderedPlayer!);
}

/** 실제 로그인·입력·캔버스를 사용합니다. 외부 서비스만 테스트 서버 응답으로 대체합니다. */
async function onlineGame(page: Page, prepare?: (state: GameState) => void) {
  let stored = createGame(NICKNAME, 'knight', Date.now());
  prepare?.(stored);
  let revision = 0;
  let disconnected = false;
  let activeRequests = 0, peakRequests = 0, responses = 0;
  let hold = false;
  let release: (() => void) | undefined;
  let held: Promise<void> | undefined;
  const checkpoints: Checkpoint[] = [];
  const forbiddenActions: unknown[] = [];
  const receipts = new Map<string, Ack>();
  const user = {
    id: OWNER, aud: 'authenticated', role: 'authenticated', email: 'latency@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: OWNER, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;

  // 실제 닉네임 렌더링에서 월드 좌표를 관찰할 뿐, 게임 상태·이동 코드는 수정하지 않습니다.
  await page.addInitScript(nickname => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof original>) {
      if (args[0] === nickname) window.__renderedPlayer = { x: args[1], y: args[2] + 68, at: performance.now() };
      return original.apply(this, args);
    };
  }, NICKNAME);
  await page.route('**/api/auth/**', route => route.fulfill({ json:
    route.request().url().includes('/api/auth/user') ? user : {
      access_token: accessToken, refresh_token: 'test-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    },
  }));
  await page.route('https://onlinetest.supabase.co/**', route => route.fulfill({ json:
    route.request().url().endsWith('/rpc/get_chat_identity')
      ? [{ nickname: NICKNAME, ticket: OWNER }] : [],
  }));
  // 실시간 채팅이 고장 나도 로컬 전투와 저장이 서로 막히지 않아야 합니다.
  await page.routeWebSocket('wss://onlinetest.supabase.co/**', socket => socket.close());
  await page.route('**/api/game', route => route.fulfill({ json: {
    state: structuredClone(stored), revision, serverTime: Date.now(),
  } }));
  await page.route('**/api/action', route => {
    forbiddenActions.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, json: { error: '온라인 플레이 중 개별 이동·전투 API를 호출하면 안 됩니다.' } });
  });
  await page.route('**/api/checkpoint', async route => {
    const checkpoint = route.request().postDataJSON() as Checkpoint;
    checkpoints.push(structuredClone(checkpoint));
    activeRequests++;
    peakRequests = Math.max(peakRequests, activeRequests);
    try {
      if (hold) await held;
      await new Promise(resolve => setTimeout(resolve, RESPONSE_DELAY_MS));
      if (disconnected) {
        await route.fulfill({ status: 503, json: { error: '테스트 저장 연결이 끊겼습니다.' } });
        return;
      }
      if (!receipts.has(checkpoint.requestId)) {
        if (checkpoint.revision !== revision) {
          await route.fulfill({ status: 409, json: { error: '다른 창에서 저장한 기록이 있습니다. 다시 접속해주세요.' } });
          return;
        }
        stored = structuredClone(checkpoint.state);
        revision++;
        receipts.set(checkpoint.requestId, { state: structuredClone(stored), revision, savedAt: Date.now() });
      }
      responses++;
      await route.fulfill({ json: receipts.get(checkpoint.requestId)! });
    } finally { activeRequests--; }
  });
  await page.goto('/');
  await page.getByRole('button', { name: '캐릭터 생성 / 로그인' }).click();
  await page.getByLabel('이메일', { exact: true }).fill('latency@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__renderedPlayer)).toBe(true);
  return {
    stored: () => structuredClone(stored),
    revision: () => revision,
    checkpoints,
    forbiddenActions,
    responses: () => responses,
    peakRequests: () => peakRequests,
    disconnect: () => { disconnected = true; },
    reconnect: () => { disconnected = false; },
    otherDeviceSave: () => { stored.player.x = 700; revision++; },
    hold: () => { hold = true; held = new Promise<void>(resolve => { release = resolve; }); },
    release: () => { hold = false; release?.(); },
  };
}

async function moveRight(page: Page, distance = 40) {
  await page.getByTestId('game-canvas').focus();
  const start = await visualPosition(page);
  await page.keyboard.down('d');
  await expect.poll(async () => (await visualPosition(page)).x - start.x, { timeout: 1500 }).toBeGreaterThan(distance);
  await page.keyboard.up('d');
  return visualPosition(page);
}
async function selectNearbyMonster(page: Page, state: GameState) {
  const monster = state.monsters[0];
  const position = await visualPosition(page);
  const cameraX = Math.min(600, Math.max(0, position.x - 500));
  const cameraY = Math.min(440, Math.max(0, position.y - 300));
  const canvas = page.getByTestId('game-canvas');
  const rect = (await canvas.boundingBox())!;
  await canvas.click({ position: {
    x: (monster.x - cameraX) / 1000 * rect.width,
    y: (monster.y - cameraY - 21) / 600 * rect.height,
  } });
}

test('온라인 이동·처치는 서버 응답을 기다리지 않고 실행되며 개별 전투 요청을 보내지 않는다', async ({ page }) => {
  const game = await onlineGame(page, state => {
    const monster = state.monsters[0];
    monster.x = monster.homeX = state.player.x + 35;
    monster.y = monster.homeY = state.player.y;
    monster.hp = 1;
  });
  const original = game.stored();
  await selectNearbyMonster(page, original);
  await expect(page.locator('.stats-list')).toContainText('누적 몬스터 처치1');
  await expect(page.locator('.log-content')).toContainText('슬라임 처치');
  await moveRight(page);
  expect(game.stored()).toEqual(original);
  expect(game.checkpoints).toHaveLength(0);
  expect(game.forbiddenActions).toHaveLength(0);
});

test('저장 응답이 800ms 이상 늦어도 이동을 계속하며 성공 응답이 현재 위치를 되돌리지 않는다', async ({ page }) => {
  const game = await onlineGame(page);
  await moveRight(page);
  game.hold();
  await page.getByRole('button', { name: '지금 저장', exact: true }).first().click();
  await expect.poll(() => game.checkpoints.length).toBe(1);
  const sentX = game.checkpoints[0].state.player.x;
  const advanced = await moveRight(page, 65);
  expect(game.responses()).toBe(0);
  expect(advanced.x).toBeGreaterThan(sentX + 50);
  game.release();
  await expect.poll(() => game.responses()).toBe(1);
  expect(game.stored().player.x).toBe(sentX);
  const afterReply = await visualPosition(page);
  expect(afterReply.x).toBeGreaterThan(sentX + 50);
  expect(game.peakRequests()).toBe(1);
  expect(game.forbiddenActions).toHaveLength(0);
});

test('저장·채팅 연결 장애 중에도 플레이하며 채팅창 WASD는 캐릭터를 움직이지 않는다', async ({ page }) => {
  const game = await onlineGame(page);
  game.disconnect();
  await page.getByRole('button', { name: '지금 저장', exact: true }).first().click();
  await expect(page.locator('.error-toast')).toContainText('테스트 저장 연결이 끊겼습니다.');
  await moveRight(page, 65);
  await page.getByTestId('game-canvas').focus();
  await page.keyboard.press('Enter');
  const chat = page.getByRole('textbox', { name: '전체 채팅 메시지 입력' });
  await expect(chat).toBeFocused();
  await page.waitForTimeout(350); // 입력 해제 후 기존 보간을 마칩니다.
  const start = await visualPosition(page);
  await chat.pressSequentially('wasd WASD', { delay: 40 });
  await page.waitForTimeout(300);
  const after = await visualPosition(page);
  expect(Math.abs(after.x - start.x)).toBeLessThan(2);
  expect(Math.abs(after.y - start.y)).toBeLessThan(2);
  expect(game.stored().player.x).toBe(220);
  expect(game.responses()).toBe(0);
  expect(game.forbiddenActions).toHaveLength(0);
  game.reconnect();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '지금 저장', exact: true }).click();
  await expect.poll(() => game.responses()).toBe(2); // 유실 가능성이 있는 원래 요청 확인 후 최신 기록 저장
  expect(game.checkpoints[1].requestId).toBe(game.checkpoints[0].requestId);
  expect(game.checkpoints[1].state).toEqual(game.checkpoints[0].state);
  expect(game.checkpoints[2].revision).toBe(1);
  await expect(page.locator('.error-toast')).toBeHidden();
  await expect(page.getByTestId('save-status')).toContainText('마지막 저장');
});

test('다른 창의 저장과 충돌하면 덮어쓰지 않고 서버 기록을 다시 불러올 수 있다', async ({ page }) => {
  const game = await onlineGame(page);
  await moveRight(page);
  game.otherDeviceSave();
  await page.getByRole('button', { name: '지금 저장', exact: true }).click();
  await expect(page.locator('.save-conflict')).toBeVisible();
  await expect(page.getByRole('button', { name: '지금 저장', exact: true })).toBeDisabled();
  expect(game.stored().player.x).toBe(700);
  expect(game.revision()).toBe(1);
  await page.getByRole('button', { name: '서버 기록 다시 불러오기', exact: true }).click();
  await expect(page.locator('.save-conflict')).toBeHidden();
  await expect.poll(async () => Math.abs((await visualPosition(page)).x - 700)).toBeLessThan(2);
  await moveRight(page);
  expect(game.forbiddenActions).toHaveLength(0);
});

test('정상 종료는 마지막 상태를 저장하고 다시 로그인한 화면에서 저장된 캐릭터를 불러온다', async ({ page }) => {
  const game = await onlineGame(page);
  await moveRight(page, 70);
  await page.getByRole('button', { name: '게임 설정', exact: true }).click();
  await page.getByRole('button', { name: '저장하고 시작 화면으로', exact: true }).click();
  await expect.poll(() => game.responses()).toBe(1);
  await expect(page.getByRole('heading', { name: /클래식.*범죄와의 전쟁/ })).toBeVisible();
  const savedX = game.stored().player.x;
  expect(savedX).toBeGreaterThan(280);
  await page.reload();
  await page.getByRole('button', { name: '내 캐릭터 불러오기', exact: true }).click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect.poll(async () => Math.abs((await visualPosition(page)).x - savedX)).toBeLessThan(2);
  expect(game.forbiddenActions).toHaveLength(0);
});

test('수동 저장이 없어도 10분에 한 번 자동 저장한다', async ({ page }) => {
  await page.clock.install();
  const game = await onlineGame(page);
  await moveRight(page);
  await page.clock.fastForward(9 * 60 * 1000);
  expect(game.checkpoints).toHaveLength(0);
  await page.clock.fastForward(61 * 1000);
  await expect.poll(() => game.responses()).toBe(1);
  expect(game.checkpoints).toHaveLength(1);
  expect(game.stored().player.x).toBeGreaterThan(250);
  await page.clock.fastForward(9 * 60 * 1000);
  expect(game.checkpoints).toHaveLength(1);
  expect(game.forbiddenActions).toHaveLength(0);
});
