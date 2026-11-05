import type { GameState } from '../game/types';

export interface CheckpointRequest {
  requestId: string;
  revision: number;
  state: GameState;
}

export interface CheckpointAck {
  revision: number;
  savedAt: number;
  state?: GameState;
}

export type CheckpointSender = (body: CheckpointRequest, keepalive?: boolean) => Promise<CheckpointAck>;

interface PendingSnapshot {
  state: GameState;
  sequence: number;
  keepalive: boolean;
}
interface Attempt {
  body: CheckpointRequest;
  sequence: number;
  keepalive: boolean;
}
interface Waiter {
  sequence: number;
  resolve: (ack: CheckpointAck) => void;
  reject: (error: unknown) => void;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function conflict(): Error & { status: number } {
  return Object.assign(new Error('다른 게임 창에서 저장한 기록이 있습니다. 게임을 다시 불러와주세요.'), { status: 409 });
}

/**
 * 계정/플레이 세션마다 새 인스턴스를 만듭니다. 전투는 로컬에서 계속 진행하고,
 * 이 객체는 저장 요청의 순서와 DB revision만 관리합니다. 서버 응답의 state를
 * 진행 중인 로컬 캐릭터에 덮어쓰지 않습니다.
 */
export class CheckpointSession {
  private currentRevision: number;
  private savedAt: number | null = null;
  private sequence = 0;
  private running = false;
  private pending: PendingSnapshot | null = null;
  // 응답이 유실된 요청은 이미 DB에 반영되었을 수 있으므로 원래 ID/스냅샷을 보관합니다.
  private uncertain: Attempt | null = null;
  private blockedError: unknown = null;
  private waiters: Waiter[] = [];

  constructor(initialRevision: number, private readonly send: CheckpointSender) {
    if (!Number.isSafeInteger(initialRevision) || initialRevision < 0) throw new Error('저장 버전이 올바르지 않습니다.');
    this.currentRevision = initialRevision;
  }

  get revision(): number { return this.currentRevision; }
  get lastSavedAt(): number | null { return this.savedAt; }
  get blocked(): boolean { return this.blockedError !== null; }

  save(state: GameState, options: { keepalive?: boolean } = {}): Promise<CheckpointAck> {
    if (this.blockedError !== null) return Promise.reject(this.blockedError);
    let snapshot: GameState;
    try { snapshot = structuredClone(state); }
    catch { return Promise.reject(new Error('게임 기록을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.')); }
    const sequence = ++this.sequence;
    // 전송 중 여러 번 저장을 누르면 마지막 스냅샷을 저장하고 모든 대기 요청을 완료합니다.
    this.pending = { state: snapshot, sequence, keepalive: options.keepalive === true || this.pending?.keepalive === true };
    const result = new Promise<CheckpointAck>((resolve, reject) => { this.waiters.push({ sequence, resolve, reject }); });
    if (!this.running) {
      this.running = true;
      void this.drain();
    }
    return result;
  }

  /** 브라우저 종료 시 best-effort 저장입니다. 브라우저가 전송 완료를 보장하지는 않습니다. */
  flushOnExit(state: GameState): Promise<CheckpointAck> { return this.save(state, { keepalive: true }); }

  private async drain(): Promise<void> {
    try {
      while (this.uncertain || this.pending) {
        let attempt = this.uncertain;
        if (!attempt) {
          const pending = this.pending!;
          this.pending = null;
          attempt = {
            body: { requestId: crypto.randomUUID(), revision: this.currentRevision, state: pending.state },
            sequence: pending.sequence,
            keepalive: pending.keepalive,
          };
          this.uncertain = attempt;
        }
        const response = await this.send(structuredClone(attempt.body), attempt.keepalive || this.pending?.keepalive === true);
        if (!response || !Number.isSafeInteger(response.revision) || response.revision < 0
          || !Number.isSafeInteger(response.savedAt) || response.savedAt < 0) {
          throw new Error('저장 완료 응답을 확인하지 못했습니다. 다시 저장해주세요.');
        }
        // 예상보다 새로운 revision을 받아도 자동으로 그 위에 덮어쓰지 않습니다.
        if (response.revision !== attempt.body.revision + 1) throw conflict();
        const ack = Object.freeze({ revision: response.revision, savedAt: response.savedAt });
        this.currentRevision = ack.revision;
        this.savedAt = ack.savedAt;
        this.uncertain = null;
        const completed = this.waiters.filter(waiter => waiter.sequence <= attempt.sequence);
        this.waiters = this.waiters.filter(waiter => waiter.sequence > attempt.sequence);
        for (const waiter of completed) waiter.resolve(ack);
      }
    } catch (error) {
      const status = statusOf(error);
      if (status === 409) this.blockedError = error;
      // 확실히 거절된 요청은 재시도할 필요가 없습니다. 타임아웃·5xx·429는 같은 ID로 확인합니다.
      if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) this.uncertain = null;
      this.pending = null;
      const waiters = this.waiters;
      this.waiters = [];
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      this.running = false;
    }
  }
}
