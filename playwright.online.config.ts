import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

// 테스트 전용 공개 주소/키입니다. 모든 인증·게임·채팅 요청을 브라우저에서 가로채며,
// 실제 Supabase 프로젝트나 회원 데이터에 연결하지 않습니다.
export default defineConfig({
  testDir: './e2e-online',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  outputDir: 'test-results/online',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: { width: 1440, height: 1050 },
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 3001',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://onlinetest.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_browser_test_fixture',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  },
});
