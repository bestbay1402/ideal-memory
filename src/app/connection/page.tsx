'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConnectionReport } from '@/server/connection-check';
import './connection.css';

const labels = { ok: '정상', error: '확인 필요', warning: '안내', skipped: '대기' };

export default function ConnectionPage() {
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const check = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError(''); setCopied(false);
    try {
      const response = await fetch('/api/connection', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('게임 서버의 연결 확인 요청에 실패했습니다. 잠시 후 다시 눌러주세요.');
      const result = await response.json() as ConnectionReport;
      if (!signal?.aborted) setReport(result);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error && cause.message !== 'Failed to fetch' ? cause.message : '게임 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러주세요.');
    } finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, [check]);
  const summary = report ? [
    '클래식: 범죄와의 전쟁 — 연결 확인',
    `확인 시간: ${report.checkedAt}`,
    ...(report.projectHost ? [`프로젝트 주소: ${report.projectHost}`] : []),
    ...report.checks.map(item => `${item.id} / ${labels[item.status]} / ${item.label}: ${item.message}`),
  ].join('\n') : '';
  const firstProblem = report?.checks.find(item => item.status === 'error');
  return <main className="connection-page">
    <a href="/" className="connection-brand">✥ 클래식: 범죄와의 전쟁</a>
    <section className="connection-panel">
      <p className="section-label">CONNECTION CHECK</p>
      <h1>연결 상태 확인</h1>
      <p className="connection-intro">회원가입과 캐릭터 저장에 필요한 연결을 자동으로 확인합니다.<br />계정이나 비밀번호를 입력할 필요가 없습니다.</p>
      {busy ? <div className="connection-banner" role="status">인증 서버와 게임 저장소를 확인하고 있습니다…</div> : error ? <div className="connection-banner connection-failed" role="alert">{error}</div> : report && <div className={`connection-banner ${report.ok ? 'connection-good' : 'connection-failed'}`} role="status">
        <strong>{report.ok ? '인증 서버와 게임 저장소에 연결되었습니다.' : '아래 항목을 먼저 확인하면 됩니다.'}</strong>
        {firstProblem && <p>{firstProblem.message}</p>}
        {report.ok && <p>게임으로 돌아가 회원가입을 다시 시도해주세요. 실제 가입 결과는 가입 화면에서 확인할 수 있습니다.</p>}
      </div>}
      {report && <><dl className="connection-checks">{report.checks.map(item => <div key={item.id} className={`connection-row connection-${item.status}`}>
        <dt><span className="connection-status">{labels[item.status]}</span>{item.label}</dt><dd>{item.message}</dd>
      </div>)}</dl><details className="connection-details"><summary>공유할 확인 결과 보기</summary><textarea aria-label="공유할 연결 확인 결과" value={summary} readOnly rows={9} onFocus={event => event.currentTarget.select()} /><p>API 키와 비밀번호는 이 결과에 포함되지 않습니다.</p></details></>}
      <div className="connection-actions">
        {report && <button className="button primary" onClick={async () => { try { await navigator.clipboard.writeText(summary); setCopied(true); } catch { document.querySelector<HTMLTextAreaElement>('.connection-details textarea')?.closest('details')?.setAttribute('open', ''); setCopied(false); } }}>{copied ? '복사했습니다' : '확인 결과 복사'}</button>}
        <button className="button outline" disabled={busy} onClick={() => void check()}>{busy ? '확인 중…' : '다시 확인'}</button>
        <a href="/" className="button outline">게임으로 돌아가기</a>
      </div>
      {report && !report.ok && <p className="connection-share">‘확인 결과 복사’를 눌러 이 대화에 붙여넣어주세요. 문제가 생긴 항목을 정확히 확인할 수 있습니다.</p>}
    </section>
  </main>;
}
