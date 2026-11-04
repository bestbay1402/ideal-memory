import { test, expect } from '@playwright/test';

// 진단 결과의 표시만 격리합니다. 실제 외부 연결 결과로 취급하지 않습니다.
test('연결 오류를 한 화면에 표시하고 안전한 공유 결과를 제공한다', async ({ page }) => {
  await page.route('**/api/connection', route => route.fulfill({ json: {
    ok: false, checkedAt: '2026-11-04T03:00:00.000Z', projectHost: 'exampleprojectxxxxxx.supabase.co',
    checks: [
      { id: 'url', label: '프로젝트 주소', status: 'ok', message: '프로젝트 주소 형식이 올바릅니다.' },
      { id: 'publicKey', label: '공개 연결 키', status: 'ok', message: '공개 키가 등록되어 있습니다.' },
      { id: 'serverKey', label: '서버 저장 키', status: 'ok', message: '서버 키가 등록되어 있습니다.' },
      { id: 'auth', label: '회원가입 서버 연결', status: 'error', message: '이 Supabase 주소의 서버를 찾을 수 없습니다. 프로젝트 실행 상태를 확인해주세요.' },
      { id: 'database', label: '게임 데이터베이스', status: 'error', message: '프로젝트 실행 상태를 확인해주세요.' },
    ],
  } }));
  await page.goto('/connection');
  await expect(page.getByRole('heading', { name: '연결 상태 확인' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('서버를 찾을 수 없습니다');
  await expect(page.locator('.connection-row')).toHaveCount(5);
  await page.getByText('공유할 확인 결과 보기').click();
  await expect(page.getByLabel('공유할 연결 확인 결과')).toHaveValue(/auth \/ 확인 필요/);
  await expect(page.getByRole('button', { name: '확인 결과 복사' })).toBeVisible();
  await page.getByRole('link', { name: '게임으로 돌아가기' }).click();
  await expect(page.getByRole('heading', { name: /클래식.*범죄와의 전쟁/ })).toBeVisible();
});

test('진단 연결 실패도 화면을 멈추지 않고 재확인할 수 있다', async ({ page }) => {
  let recovered = false;
  await page.route('**/api/connection', route => {
    return !recovered ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fulfill({ json: {
      ok: true, checkedAt: '2026-11-04T03:00:00.000Z', checks: [],
    } });
  });
  await page.goto('/connection');
  await expect(page.locator('.connection-banner[role=alert]')).toContainText('연결 확인 요청에 실패');
  recovered = true;
  await page.getByRole('button', { name: '다시 확인' }).click();
  await expect(page.getByRole('status')).toContainText('인증 서버와 게임 저장소에 연결되었습니다');
});

test('로그인 화면에서 연결 확인으로 바로 이동한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '캐릭터 생성 / 로그인', exact: true }).click();
  await page.getByRole('link', { name: /연결 상태 확인/ }).click();
  await expect(page).toHaveURL(/\/connection$/);
  await expect(page.getByRole('heading', { name: '연결 상태 확인' })).toBeVisible();
});
