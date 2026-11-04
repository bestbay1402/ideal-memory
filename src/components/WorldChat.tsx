'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getAuthClient } from '@/lib/supabase';
import { CHAT_MAX_LENGTH, CHAT_SEND_INTERVAL_MS, CHAT_TOPIC, fetchChatHistory, mergeChatMessages, presenceTickets, readChatMessage, sendChatMessage, type ChatIdentity, type ChatMessage } from '@/lib/chat';
import './chat.css';

export interface WorldChatProps { enabled: boolean; userId: string | null; token?: string | null; nickname?: string }
type Connection = 'connecting' | 'connected' | 'disconnected';

/** 채팅 연결·재시도·Presence는 전투 요청 큐나 시뮬레이션 시간을 사용하지 않습니다. */
export default function WorldChat({ enabled, userId, token }: WorldChatProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<ChatIdentity[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const mounted = useRef(true);
  const sessionRef = useRef({ enabled, userId, generation: 0 });
  if (sessionRef.current.enabled !== enabled || sessionRef.current.userId !== userId) {
    sessionRef.current = { enabled, userId, generation: sessionRef.current.generation + 1 };
  }
  const sendingRef = useRef(false);
  const lastSend = useRef(0);
  const receipt = useRef<{ body: string; id: string } | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    receipt.current = null; sendingRef.current = false; lastSend.current = 0;
    setDraft(''); setSending(false); setMessages([]); setPeople([]);
  }, [enabled, userId]);
  useEffect(() => {
    const client = getAuthClient();
    setPeople([]); setReady(false); setError('');
    if (!enabled || !userId || !client) return;
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let identity: ChatIdentity | null = null;
    let presenceTimer: ReturnType<typeof setTimeout> | null = null;
    let historyBusy = false;
    let presenceRequest = 0;
    setConnection('connecting');

    const history = async () => {
      if (historyBusy || disposed) return;
      historyBusy = true;
      try {
        const rows = await fetchChatHistory(client);
        if (!disposed) setMessages(current => mergeChatMessages(current, rows));
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '채팅 기록 연결을 확인해주세요.');
      } finally { historyBusy = false; }
    };
    const resolvePeople = async () => {
      if (!channel || disposed) return;
      const request = ++presenceRequest;
      const tickets = presenceTickets(channel.presenceState());
      if (!tickets.length) { setPeople([]); return; }
      try {
        const { data, error: failure } = await client.rpc('resolve_chat_presence', { p_tickets: tickets });
        if (!disposed && request === presenceRequest && !failure) setPeople((data ?? []) as ChatIdentity[]);
      } catch { /* Presence 장애는 전투나 메시지 표시를 중지하지 않습니다. */ }
    };
    const schedulePeople = () => {
      if (presenceTimer) clearTimeout(presenceTimer);
      presenceTimer = setTimeout(() => { void resolvePeople(); }, 180);
    };
    const heartbeat = async () => {
      try {
        const { data, error: failure } = await client.rpc('get_chat_identity');
        if (failure || !data?.[0]) throw new Error('채팅 접속자 정보를 확인하지 못했습니다.');
        if (disposed) return;
        identity = data[0] as ChatIdentity;
        if (channel) await channel.track({ ticket: identity.ticket });
        schedulePeople();
      } catch { /* 다음 주기에 다시 확인합니다. */ }
    };
    const connect = async () => {
      try {
        if (token) await client.realtime.setAuth(token);
        const { data, error: failure } = await client.rpc('get_chat_identity');
        if (failure || !data?.[0]) throw new Error('채팅 연결에 실패했습니다. 온라인 캐릭터와 데이터베이스 설정을 확인해주세요.');
        if (disposed) return;
        identity = data[0] as ChatIdentity;
        setReady(true);
        // 전송은 SQL RPC만 사용합니다. 클라이언트 Broadcast 전송은 하지 않습니다.
        channel = client.channel(CHAT_TOPIC, { config: { private: true, broadcast: { self: false }, presence: { key: identity.ticket } } });
        channel.on('broadcast', { event: 'message' }, event => {
          const row = readChatMessage(event.payload);
          if (row && !disposed) setMessages(current => mergeChatMessages(current, [row]));
        }).on('presence', { event: 'sync' }, schedulePeople).subscribe(status => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            setConnection('connected'); setError('');
            void channel?.track({ ticket: identity!.ticket }).catch(() => {
              if (!disposed) setConnection('disconnected');
            });
            void history();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnection('disconnected'); setPeople([]);
          }
        });
        await history();
      } catch (cause) {
        if (!disposed) {
          setConnection('disconnected');
          setError(cause instanceof Error ? cause.message : '채팅 서버에 연결하지 못했습니다.');
        }
      }
    };
    void connect();
    const refresh = setInterval(() => { void history(); }, 15_000);
    const pulse = setInterval(() => { void heartbeat(); }, 25_000);
    const online = () => { if (!disposed) setRetry(value => value + 1); };
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      clearInterval(refresh); clearInterval(pulse);
      if (presenceTimer) clearTimeout(presenceTimer);
      window.removeEventListener('online', online);
      if (channel) { void channel.untrack().catch(() => undefined); void client.removeChannel(channel).catch(() => undefined); }
    };
  }, [enabled, userId, token, retry]);

  // 초기 연결 실패나 닫힌 채널도 복구합니다. 이 타이머는 전투 요청과 독립적입니다.
  useEffect(() => {
    if (!enabled || !userId || connection !== 'disconnected') return;
    const timer = setTimeout(() => { if (navigator.onLine) setRetry(value => value + 1); }, 5000);
    return () => clearTimeout(timer);
  }, [enabled, userId, connection, retry]);

  useEffect(() => {
    if (followBottom.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, collapsed]);
  useEffect(() => {
    const focusChat = (event: KeyboardEvent) => {
      if (!enabled || !userId || event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target?.closest('input,textarea,select,button,[contenteditable="true"],[role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); event.stopPropagation();
      setCollapsed(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('keydown', focusChat, true);
    return () => window.removeEventListener('keydown', focusChat, true);
  }, [enabled, userId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const client = getAuthClient();
    if (!enabled || !userId || !client || sendingRef.current) return;
    if (Date.now() - lastSend.current < CHAT_SEND_INTERVAL_MS) { setError('2초에 한 번 전송할 수 있습니다.'); return; }
    const body = draft.trim();
    if (!body) return;
    if (!receipt.current || receipt.current.body !== body) receipt.current = { body, id: crypto.randomUUID() };
    const generation = sessionRef.current.generation;
    const stillCurrent = () => mounted.current && generation === sessionRef.current.generation;
    sendingRef.current = true; setSending(true); setError('');
    try {
      const row = await sendChatMessage(client, body, receipt.current.id);
      if (!stillCurrent()) return;
      lastSend.current = Date.now(); receipt.current = null;
      setMessages(current => mergeChatMessages(current, [row])); setDraft(''); followBottom.current = true;
    } catch (cause) {
      if (stillCurrent()) setError(cause instanceof Error ? cause.message : '메시지를 전송하지 못했습니다.');
    } finally {
      if (stillCurrent()) { sendingRef.current = false; setSending(false); inputRef.current?.focus(); }
    }
  };
  const active = enabled && !!userId;
  return <aside className={`world-chat ${collapsed ? 'chat-collapsed' : ''}`} aria-label="전체 채팅">
    <header className="chat-header"><div><span className={`chat-light ${active ? connection : ''}`} /><strong>전체 채팅</strong><small>{active ? `${people.length}명 접속` : '온라인 전용'}</small></div><button type="button" aria-label={collapsed ? '채팅 펼치기' : '채팅 접기'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '+' : '−'}</button></header>
    {!collapsed && <>
      {!active ? <div className="chat-offline"><span>✉</span><p>함께 나누는 모험 이야기</p><small>온라인 계정으로 플레이하면<br />친구들과 전체 채팅을 할 수 있습니다.</small></div> : <>
        <div className="chat-presence"><span>{connection === 'connected' ? '● 연결됨' : connection === 'connecting' ? '연결 중…' : '연결 끊김 · 전투는 계속됩니다'}</span><details><summary>접속자 보기</summary><ul>{people.length ? people.map(person => <li key={person.ticket}>{person.nickname}</li>) : <li>접속 정보 확인 중</li>}</ul></details>{connection === 'disconnected' && <button onClick={() => setRetry(value => value + 1)} type="button">재연결</button>}</div>
        <div className="chat-messages" ref={listRef} role="log" aria-label="전체 채팅 메시지" aria-live="polite" aria-relevant="additions" onScroll={event => { const node = event.currentTarget; followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40; }}>
          {!messages.length && <p className="chat-empty">아직 전해진 이야기가 없습니다.<br />첫 인사를 건네보세요.</p>}
          {messages.map(message => <p key={message.id} className={`chat-message chat-${message.kind}`}><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })}</time><strong>{message.kind === 'golden' ? '✦ ' : message.kind === 'system' ? '◆ ' : ''}{message.nickname}</strong><span>{message.body}</span></p>)}
        </div>
        {error && <p className="chat-error" role="status">{error}</p>}
        <form className="chat-compose" onSubmit={submit}><input ref={inputRef} aria-label="전체 채팅 메시지 입력" placeholder={ready ? 'Enter를 눌러 대화하기…' : '채팅 연결을 기다리는 중…'} value={draft} maxLength={CHAT_MAX_LENGTH * 2} disabled={!ready || sending} onChange={event => setDraft(event.target.value)} onFocus={() => window.dispatchEvent(new CustomEvent('classic-chat-focus'))} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); inputRef.current?.blur(); } if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} /><button type="submit" disabled={!ready || sending || !draft.trim()} aria-label="채팅 전송">{sending ? '…' : '전송'}</button></form><p className="chat-footnote">최근 100개 보관 · {CHAT_MAX_LENGTH}자 · 전송 간격 2초</p>
      </>}
    </>}
  </aside>;
}
