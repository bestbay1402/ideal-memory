import { runConnectionChecks, type ConnectionReport } from '../../../server/connection-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// 공개 진단은 조회 전용입니다. 동시 요청은 한 검사에 합치고 30초간 재사용합니다.
let cached: { expires: number; report: ConnectionReport } | null = null;
let inFlight: Promise<ConnectionReport> | null = null;
export async function GET() {
  if (!cached || cached.expires <= Date.now()) {
    if (!inFlight) {
      inFlight = runConnectionChecks().then(report => {
        cached = { report, expires: Date.now() + 30_000 };
        return report;
      }).finally(() => { inFlight = null; });
    }
    const report = await inFlight;
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(cached.report, { headers: { 'Cache-Control': 'no-store' } });
}
