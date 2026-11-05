import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/game/engine';
import { CheckpointSession, type CheckpointAck, type CheckpointRequest } from '../src/lib/checkpoint-session';

function game(kills = 0) {
  const state = createGame('저장테스트', 'knight', 1_000_000 + kills);
  state.player.kills = kills;
  return state;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ack = (revision: number): CheckpointAck => ({ revision, savedAt: 1_000_000 + revision });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('브라우저 게임 체크포인트 저장 순서', () => {
  it('로컬 진행 중인 상태를 서버 응답으로 덮어쓰지 않고 버전과 저장 시간만 갱신한다', async () => {
    const state = game(4);
    const serverState = game(99);
    const send = vi.fn(async () => ({ ...ack(8), state: serverState }));
    const session = new CheckpointSession(7, send);
    const saved = await session.save(state);
    expect(saved).toEqual(ack(8));
    expect(session.revision).toBe(8);
    expect(session.lastSavedAt).toBe(1_000_008);
    expect(state.player.kills).toBe(4);
    expect(session.blocked).toBe(false);
  });

  it('전송 중 자동 저장·수동 저장·종료 저장을 최신 스냅샷으로 합치고 요청을 겹치지 않는다', async () => {
    const firstReply = deferred<CheckpointAck>();
    let inFlight = 0, maximum = 0;
    const bodies: CheckpointRequest[] = [];
    const keepalives: boolean[] = [];
    const session = new CheckpointSession(10, async (body, keepalive) => {
      maximum = Math.max(maximum, ++inFlight);
      bodies.push(body);
      keepalives.push(!!keepalive);
      const response = bodies.length === 1 ? await firstReply.promise : ack(body.revision + 1);
      inFlight--;
      return response;
    });
    const first = session.save(game(1));
    const middle = session.save(game(2));
    const last = session.flushOnExit(game(3));
    expect(bodies).toHaveLength(1);
    firstReply.resolve(ack(11));
    expect(await first).toEqual(ack(11));
    expect(await middle).toEqual(ack(12));
    expect(await last).toEqual(ack(12));
    expect(bodies.map(body => [body.revision, body.state.player.kills])).toEqual([[10, 1], [11, 3]]);
    expect(keepalives).toEqual([false, true]);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
    expect(maximum).toBe(1);
  });

  it('DB 반영 뒤 응답이 유실되면 같은 ID·버전·내용부터 확인하고 최신 기록을 다음 버전에 저장한다', async () => {
    const calls: CheckpointRequest[] = [];
    let committedRevision = 5;
    let committedKills = 0;
    const receipts = new Set<string>();
    const session = new CheckpointSession(5, async body => {
      calls.push(structuredClone(body));
      if (!receipts.has(body.requestId)) {
        expect(body.revision).toBe(committedRevision);
        committedRevision++;
        committedKills = body.state.player.kills;
        receipts.add(body.requestId);
      }
      if (calls.length === 1) throw new TypeError('response lost after commit');
      return ack(committedRevision);
    });
    const firstState = game(10);
    await expect(session.save(firstState)).rejects.toThrow('response lost');
    firstState.player.kills = 900; // 호출 이후 원본 변경은 보관된 요청에 영향을 주지 않습니다.
    expect(session.revision).toBe(5);
    expect(session.lastSavedAt).toBeNull();
    const secondState = game(12);
    await expect(session.save(secondState)).resolves.toEqual(ack(7));
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2].requestId).not.toBe(calls[1].requestId);
    expect(calls[2].revision).toBe(6);
    expect(calls[2].state.player.kills).toBe(12);
    expect(committedKills).toBe(12);
    expect(committedRevision).toBe(7);
  });

  it('전송 함수가 입력을 변경하더라도 불확실한 저장 재시도 본문은 바뀌지 않는다', async () => {
    const bodies: CheckpointRequest[] = [];
    const send = vi.fn(async (body: CheckpointRequest) => {
      bodies.push(structuredClone(body));
      if (bodies.length === 1) {
        body.state.player.kills = 99;
        body.requestId = 'mutated';
        throw new Error('network timeout');
      }
      return ack(body.revision + 1);
    });
    const session = new CheckpointSession(0, send);
    const state = game(3);
    await expect(session.save(state)).rejects.toThrow('network timeout');
    await session.save(game(4));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(state.player.kills).toBe(3);
  });

  it.each([408, 429, 500, 503])('HTTP %i도 결과 확인 전에는 같은 요청 ID로 재시도한다', async status => {
    const bodies: CheckpointRequest[] = [];
    const session = new CheckpointSession(0, async body => {
      bodies.push(body);
      if (bodies.length === 1) throw httpError(status);
      return ack(body.revision + 1);
    });
    await expect(session.save(game())).rejects.toMatchObject({ status });
    await session.save(game(1));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2].revision).toBe(1);
  });

  it.each([400, 401, 403, 413])('확정 거부 HTTP %i 후에는 이전 잘못된 본문을 재전송하지 않는다', async status => {
    const bodies: CheckpointRequest[] = [];
    const session = new CheckpointSession(0, async body => {
      bodies.push(body);
      if (bodies.length === 1) throw httpError(status);
      return ack(body.revision + 1);
    });
    await expect(session.save(game())).rejects.toMatchObject({ status });
    await session.save(game(1));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
    expect(bodies[1].revision).toBe(0);
    expect(bodies[1].state.player.kills).toBe(1);
  });

  it('다른 기기의 저장과 충돌하면 해당 세션의 업로드를 차단하고 새 버전 위에 덮어쓰지 않는다', async () => {
    const reply = deferred<CheckpointAck>();
    const send = vi.fn(() => reply.promise);
    const session = new CheckpointSession(4, send);
    const first = session.save(game(3));
    const last = session.flushOnExit(game(8));
    const failed = Promise.allSettled([first, last]);
    reply.reject(httpError(409));
    expect((await failed).every(result => result.status === 'rejected')).toBe(true);
    expect(session.blocked).toBe(true);
    await expect(session.save(game(10))).rejects.toMatchObject({ status: 409 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(session.revision).toBe(4);
  });

  it('응답에 예상보다 최신 버전이 오면 저장 충돌로 처리한다', async () => {
    const send = vi.fn(async () => ack(50));
    const session = new CheckpointSession(4, send);
    await expect(session.save(game())).rejects.toMatchObject({ status: 409 });
    expect(session.revision).toBe(4);
    expect(session.blocked).toBe(true);
    await expect(session.flushOnExit(game())).rejects.toMatchObject({ status: 409 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('올바르지 않은 성공 응답은 완료로 표시하지 않고 원래 요청을 보관한다', async () => {
    const bodies: CheckpointRequest[] = [];
    const session = new CheckpointSession(0, async body => {
      bodies.push(body);
      if (bodies.length === 1) return { revision: 1, savedAt: Number.NaN };
      return ack(body.revision + 1);
    });
    await expect(session.save(game())).rejects.toThrow('저장 완료 응답');
    expect(session.lastSavedAt).toBeNull();
    expect(session.revision).toBe(0);
    await session.save(game(1));
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('다른 플레이 세션은 저장 버전·보관 요청·차단 상태를 공유하지 않는다', async () => {
    const sendA = vi.fn(async () => { throw httpError(409); });
    const sendB = vi.fn(async (body: CheckpointRequest) => ack(body.revision + 1));
    const a = new CheckpointSession(10, sendA);
    const b = new CheckpointSession(2, sendB);
    await expect(a.save(game(10))).rejects.toMatchObject({ status: 409 });
    await expect(b.save(game(20))).resolves.toEqual(ack(3));
    expect(a.blocked).toBe(true);
    expect(b.blocked).toBe(false);
    expect(b.revision).toBe(3);
  });

  it('종료 저장 요청의 keepalive 옵션이 이후 합쳐진 최신 저장까지 유지된다', async () => {
    const reply = deferred<CheckpointAck>();
    const flags: boolean[] = [];
    const session = new CheckpointSession(0, async (body, keepalive) => {
      flags.push(!!keepalive);
      return flags.length === 1 ? reply.promise : ack(body.revision + 1);
    });
    const first = session.save(game());
    const exiting = session.flushOnExit(game(1));
    const latest = session.save(game(2));
    reply.resolve(ack(1));
    await Promise.all([first, exiting, latest]);
    expect(flags).toEqual([false, true]);
  });
});
