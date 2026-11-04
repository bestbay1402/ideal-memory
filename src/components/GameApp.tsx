'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { applyAction, appearance, createGame, power, stats, xpRequired } from '@/game/engine';
import { CLASSES, ENHANCE_CHANCES, MONSTERS, POTIONS, ZONES } from '@/game/config';
import type { Action, CharacterClass, GameState, HealPotionKind, PotionKind, ZoneId } from '@/game/types';
import { getAuthClient, onlineConfigured } from '@/lib/supabase';
import { createOnlineGame, fetchRankings, loadGame, sendOnlineAction, type RankingEntry, type RankingKind } from '@/lib/transport';

const WorldChat = dynamic(() => import('./WorldChat'), { ssr: false });
const GameCanvas = dynamic(() => import('./GameCanvas'), { ssr: false, loading: () => <div className="canvas-loading"><span className="rune-loader">✧</span> 모험의 세계를 불러오는 중…</div> });
type Modal = 'play' | 'demo' | 'auth' | 'create' | 'inventory' | 'shop' | 'enhance' | 'ranking' | 'probability' | 'map' | 'help' | 'settings' | null;
const DEMO_KEY = 'classic-beomjae-demo-v1';
const CLASS_LABEL: Record<CharacterClass, string> = { knight: '기사', elf: '요정' };
const number = (n: number) => Math.floor(n).toLocaleString('ko-KR');
const potionKinds: PotionKind[] = ['red', 'orange', 'clear', 'green'];
const zoneOrder: ZoneId[] = ['island', 'temple', 'tower', 'volcano'];

function PotionIcon({ kind, size = 30 }: { kind: PotionKind; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 36" aria-hidden="true" className="item-icon"><path d="M11 2h10v5h-2v6l7 7v11H6V20l7-7V7h-2z" fill="#181d21" stroke="#a5a897" strokeWidth="2"/><path d="M8 23h16v7H8zM10 20h12v4H10z" fill={POTIONS[kind].color}/><path d="M10 23h3v5h-3zM14 8h2v8h-2z" fill="#f4efda" opacity=".7"/><path d="M11 2h10v5H11z" fill="#9c7141"/><path d="M8 31h16v2H8z" fill="#050a0b"/></svg>;
}
function WeaponIcon({ elf = false, golden = false, size = 58 }: { elf?: boolean; golden?: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={golden ? 'weapon-icon golden-weapon' : 'weapon-icon'}>{elf ? <><path d="M19 7c39 5 39 45 0 50l12-15V22z" fill="none" stroke={golden ? '#e7c56d' : '#ab8350'} strokeWidth="5"/><path d="M19 7v50" stroke="#e7dfbd"/><path d="M8 32h43m-7-5 8 5-8 5" fill="none" stroke="#d3e7e6" strokeWidth="2"/><path d="M29 25v14" stroke="#547e70" strokeWidth="5"/></> : <><path d="m48 5 7 2-2 8-27 29-8-8z" fill={golden ? '#e7c56d' : '#afc8c8'} stroke="#354342" strokeWidth="2"/><path d="m50 10-28 30" stroke="#f6f4d9" strokeWidth="3"/><path d="m13 33 18 18" stroke={golden ? '#f3d578' : '#c4a05a'} strokeWidth="6"/><path d="m20 43-9 10" stroke="#87603e" strokeWidth="6"/><path d="m8 51 5 6" stroke="#c6a45f" strokeWidth="5"/></>}</svg>;
}
function ScrollIcon() { return <svg width="34" height="36" viewBox="0 0 34 36" aria-hidden="true"><path d="M9 3h20v25H9z" fill="#d8c58e"/><path d="M4 3h9v7H4zM9 27h24v7H9z" fill="#ae8b51"/><path d="M15 11h9m-9 5h7m-7 5h9" stroke="#846c42" strokeWidth="2"/><path d="m19 13 3 4-3 5-3-5z" fill="#b55341"/></svg>; }
function getSavedDemo(): GameState | null {
  try { const state = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); return state?.version === 1 && state?.player && Array.isArray(state.monsters) ? state : null; } catch { return null; }
}

export default function GameApp() {
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [mode, setMode] = useState<'demo' | 'online'>('demo');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [nickname, setNickname] = useState('');
  const [chosenClass, setChosenClass] = useState<CharacterClass>('knight');
  const [hasDemo, setHasDemo] = useState(false);
  const [rankingKind, setRankingKind] = useState<RankingKind>('power');
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState('');
  const [shopKind, setShopKind] = useState<PotionKind>('red');
  const [quantity, setQuantity] = useState(10);
  const [enhanceResult, setEnhanceResult] = useState<'success' | 'failure' | null>(null);
  const [compactLog, setCompactLog] = useState(false);
  const stateRef = useRef<GameState | null>(null);
  const modeRef = useRef<'demo' | 'online'>('demo');
  const tokenRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const movementRef = useRef({ dx: 0, dy: 0 });
  const pendingRef = useRef(false);
  const requestRef = useRef<Promise<void> | null>(null);
  const modalRef = useRef<Modal>(null);
  const errorsRef = useRef(0);
  const logsRef = useRef<HTMLDivElement>(null);
  const modalElementRef = useRef<HTMLElement>(null);
  const epochRef = useRef(0);

  const updateState = useCallback((next: GameState) => {
    stateRef.current = next;
    setGame(next);
    if (modeRef.current === 'demo') {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(next)); setHasDemo(true); } catch { /* Storage-disabled browsers can still play this session. */ }
    }
  }, []);
  const enterGame = useCallback((next: GameState, nextMode: 'demo' | 'online') => {
    epochRef.current++;
    modeRef.current = nextMode;
    setMode(nextMode);
    updateState(next);
    movementRef.current = { dx: 0, dy: 0 };
    runningRef.current = true;
    errorsRef.current = 0;
    setError(''); setModal(null); setScreen('game');
  }, [updateState]);
  useEffect(() => {
    setHasDemo(!!getSavedDemo());
    const auth = getAuthClient();
    if (!auth) return;
    auth.auth.getSession().then(({ data }) => { const access = data.session?.access_token ?? null; tokenRef.current = access; setToken(access); setSessionUserId(data.session?.user.id ?? null); }).catch(() => setNotice('로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요.'));
    const { data } = auth.auth.onAuthStateChange((_event, session) => {
      tokenRef.current = session?.access_token ?? null;
      setToken(session?.access_token ?? null);
      setSessionUserId(session?.user.id ?? null);
      if (!session && modeRef.current === 'online') { epochRef.current++; runningRef.current = false; movementRef.current = { dx: 0, dy: 0 }; setScreen('home'); setModal(null); }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    modalRef.current = modal;
    movementRef.current = { dx: 0, dy: 0 };
    setEnhanceResult(null); setError('');
    if (!modal) return;
    const priorFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => modalElementRef.current?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      const dialog = modalElementRef.current;
      if (!dialog || event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', trapFocus); priorFocus?.focus(); };
  }, [modal]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); } }, [notice]);

  const perform = useCallback(async (action: Action, quiet = false) => {
    if (!stateRef.current || !runningRef.current) return;
    if (quiet && (requestRef.current || pendingRef.current)) return;
    if (!quiet && pendingRef.current) return;
    if (!quiet) { pendingRef.current = true; setBusy(true); setError(''); }
    const previous = requestRef.current;
    const epoch = epochRef.current;
    const request = (async () => {
      if (previous) await previous;
      if (!stateRef.current || !runningRef.current || epoch !== epochRef.current) return;
      try {
        const before = stateRef.current.player.enhancement;
        const next = modeRef.current === 'demo'
          ? applyAction(stateRef.current, action, Date.now())
          : await sendOnlineAction(tokenRef.current!, action);
        if (epoch !== epochRef.current) return;
        updateState(next);
        errorsRef.current = 0;
        if (action.type === 'enhance') {
          setEnhanceResult(next.player.enhancement > before ? 'success' : 'failure');
          if (next.player.enhancement === 10) setNotice('전설의 탄생! +10 강화에 성공했습니다!');
        }
      } catch (e) {
        if (epoch !== epochRef.current) return;
        const message = e instanceof Error ? e.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
        if (!quiet) setError(message);
        else if (++errorsRef.current >= 3) { setError(`연결이 원활하지 않습니다. ${message}`); }
      }
    })();
    requestRef.current = request;
    await request;
    if (requestRef.current === request) requestRef.current = null;
    if (!quiet) { pendingRef.current = false; setBusy(false); }
  }, [updateState]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (!runningRef.current || document.hidden) return;
      const move = modalRef.current ? { dx: 0, dy: 0 } : movementRef.current;
      void perform({ type: 'tick', ...move }, true);
    }, 200);
    const blur = () => { movementRef.current = { dx: 0, dy: 0 }; };
    window.addEventListener('blur', blur);
    window.addEventListener('classic-chat-focus', blur);
    return () => { clearInterval(interval); window.removeEventListener('blur', blur); window.removeEventListener('classic-chat-focus', blur); };
  }, [perform]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalRef.current) { e.preventDefault(); setModal(null); return; }
      if (e.target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable)) return;
      if (e.repeat) return;
      if (screen !== 'game') return;
      const keyMap: Record<string, Modal> = { i: 'inventory', e: 'enhance', r: 'ranking', b: 'shop', h: 'help', m: 'map' };
      const next = keyMap[e.key.toLowerCase()];
      if (next) { e.preventDefault(); setModal(old => old === next ? null : next); }
      if (e.key === '1') void perform({ type: 'usePotion', kind: 'red' });
      if (e.key === '2') void perform({ type: 'usePotion', kind: 'orange' });
      if (e.key === '3') void perform({ type: 'usePotion', kind: 'clear' });
      if (e.key === '4') void perform({ type: 'usePotion', kind: 'green' });
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [screen, perform]);
  useEffect(() => {
    if (modal !== 'ranking') return;
    let cancelled = false;
    setRankingLoading(true); setRankingError('');
    fetchRankings(rankingKind).then(rows => { if (!cancelled) setRankings(rows); }).catch(e => { if (!cancelled) { setRankings([]); setRankingError(e.message); } }).finally(() => { if (!cancelled) setRankingLoading(false); });
    return () => { cancelled = true; };
  }, [modal, rankingKind]);
  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [game?.logs]);

  async function startOnline() {
    if (!tokenRef.current) { setModal('auth'); return; }
    setBusy(true); setError('');
    try {
      const saved = await loadGame(tokenRef.current);
      if (saved) enterGame(saved, 'online');
      else { setNickname(''); setModal('create'); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function authenticate(e: FormEvent) {
    e.preventDefault(); const auth = getAuthClient(); if (!auth) return;
    setBusy(true); setError('');
    try {
      const result = signup ? await auth.auth.signUp({ email, password }) : await auth.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setPassword('');
      if (!result.data.session) { setNotice('가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해주세요.'); setSignup(false); return; }
      tokenRef.current = result.data.session.access_token;
      setToken(result.data.session.access_token);
      setSessionUserId(result.data.session.user.id);
      const saved = await loadGame(result.data.session.access_token);
      if (saved) enterGame(saved, 'online'); else { setNickname(''); setModal('create'); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function makeCharacter(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const name = nickname.trim();
      if (!/^[\p{L}\p{N}_]{2,14}$/u.test(name)) throw new Error('닉네임은 한글·영문·숫자·밑줄 2~14자로 입력해주세요.');
      if (modal === 'demo') enterGame(createGame(name, chosenClass, Date.now()), 'demo');
      else enterGame(await createOnlineGame(tokenRef.current!, name, chosenClass), 'online');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function continueDemo() {
    const saved = getSavedDemo();
    if (saved) enterGame(saved, 'demo'); else { setNickname('모험가'); setModal('demo'); }
  }
  async function goHome() {
    runningRef.current = false; movementRef.current = { dx: 0, dy: 0 };
    if (requestRef.current) await requestRef.current;
    setScreen('home'); setModal(null);
  }
  const player = game?.player;
  const derived = player ? stats(player) : null;
  const greenSeconds = game && player ? Math.max(0, Math.ceil((player.greenUntil - game.time) / 1000)) : 0;
  const xpPercent = player ? player.level >= 99 ? 100 : Math.min(100, player.xp / xpRequired(player.level) * 100) : 0;
  const modalTitles: Record<Exclude<Modal, null>, string> = { play: '당신의 모험을 시작하세요', demo: '데모 캐릭터 생성', auth: signup ? '새로운 모험가 등록' : '모험가 로그인', create: '캐릭터 생성', inventory: '인벤토리', shop: '여행자의 물약 상점', enhance: '무기 강화', ranking: '영웅의 전당', probability: '무기 강화 확률표', map: '아덴의 네 사냥터', help: '모험가 안내서', settings: '게임 설정' };

  return <main className={screen === 'home' ? 'app home-app' : 'app game-app'}>
    {screen === 'home' ? <>
      <header className="home-header"><a href="#" className="brand-mark" aria-label="클래식 홈"><span>✥</span> CLASSIC <i>CHRONICLES</i></a><div className="home-nav"><span className="connection-pill"><b className={onlineConfigured ? 'status-dot online' : 'status-dot'} />{onlineConfigured ? '온라인 서버 연결 설정됨' : '로컬 데모 플레이 가능'}</span><button onClick={() => setModal('help')}>게임 방법 <span>↗</span></button></div></header>
      <section className="hero">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-content">
          <p className="eyebrow"><span /> THE AGE OF LEGENDS <span /></p>
          <h1><span className="title-small">클래식</span><span className="title-rule">✦</span><span>범재와의 전쟁</span></h1>
          <p className="hero-description">다시, 검을 들 시간.<br />당신의 모험이 전설이 되는 곳.</p>
          <div className="hero-actions"><button className="button primary hero-start" onClick={() => token ? void startOnline() : setModal('play')} disabled={busy}><span>⚔</span> 게임 시작 <span className="arrow">→</span></button><button className="button hero-login" onClick={() => token ? void startOnline() : setModal('auth')}>{token ? '내 캐릭터 불러오기' : '캐릭터 생성 / 로그인'}</button></div>
          <button className="demo-link" onClick={continueDemo}>{hasDemo ? '저장된 로컬 데모 이어하기' : '계정 없이 로컬 데모 체험하기'} <span>↗</span></button>
          <div className="hero-tags"><span>2D 판타지 RPG</span><b>·</b><span>나만의 싱글 플레이</span><b>·</b><span>친구들과 랭킹 경쟁</span></div>
        </div>
        <div className="hero-caption"><span className="small-diamond">◆</span><div><small>YOUR FIRST CHAPTER</small><p>말하는 섬에서 시작되는 이야기</p></div></div>
        <div className="hero-vertical" aria-hidden="true">A NEW LEGEND AWAITS</div>
      </section>
      <section className="home-features" aria-label="게임 메뉴"><button className="feature-card" aria-label="전체 랭킹 · 영웅의 전당" onClick={() => setModal('ranking')}><span className="feature-icon">♜</span><div><small>HALL OF HEROES</small><h2>영웅의 전당</h2><p>친구들과 함께 써 내려가는 전설</p></div><span className="feature-arrow">↗</span></button><button className="feature-card" onClick={() => setModal('probability')}><span className="feature-icon">✧</span><div><small>FORGE YOUR DESTINY</small><h2>무기 강화 확률표</h2><p>+10, 가장 빛나는 무기에 도전하세요</p></div><span className="feature-arrow">↗</span></button><button className="feature-card" onClick={() => setModal('help')}><span className="feature-icon">♧</span><div><small>BEGIN YOUR JOURNEY</small><h2>모험가 안내서</h2><p>첫 발걸음을 위한 작은 길잡이</p></div><span className="feature-arrow">↗</span></button></section>
      <footer className="home-footer"><span>CLASSIC <i>—</i> 범재와의 전쟁</span><p>사냥하고, 성장하고, 전설이 되세요.</p><span>제작자 : 예수</span></footer>
    </> : game && player && derived && <>
      <header className="game-header"><button className="game-logo" onClick={() => void goHome()} title="시작 화면으로">✥ <span>클래식<small>범재와의 전쟁</small></span></button><div className="mode-badge"><b className={mode === 'online' ? 'status-dot online' : 'status-dot'} />{mode === 'demo' ? '로컬 데모' : '온라인 모험'}<small>{mode === 'demo' ? '이 브라우저에 저장 · 공용 랭킹 제외' : '서버 저장 · 공용 랭킹 참여'}</small></div><div className="header-actions"><button onClick={() => setModal('help')}>게임 방법</button><button onClick={() => setModal('settings')} aria-label="게임 설정">⚙</button></div></header>
      <section className="player-hud"><div className="player-portrait"><WeaponIcon elf={player.class === 'elf'} golden={player.level >= 90 || player.enhancement === 10} size={51} /><span>{player.level}</span></div><div className="player-identity"><small>{CLASS_LABEL[player.class]} <span>· {appearance(player)}</span></small><h1 className={player.enhancement === 10 ? 'gold-name' : ''}>{player.nickname}</h1></div><div className="vitals"><div className="bar-label"><span>HP</span><b>{number(player.hp)} <i>/ {number(derived.maxHp)}</i></b></div><div className="meter hp-meter"><span style={{ width: `${Math.max(0, player.hp / derived.maxHp * 100)}%` }} /></div><div className="exp-line"><small>EXP</small><div className="meter exp-meter"><span style={{ width: `${xpPercent}%` }} /></div><small>{player.level >= 99 ? 'MAX' : `${xpPercent.toFixed(1)}%`}</small></div></div><div className="currency"><small>보유 아데나</small><strong><span>◈</span> {number(player.adena)}</strong></div><div className={`green-buff ${greenSeconds > 0 ? 'active' : ''}`}><PotionIcon kind="green" size={27} /><div><small>{greenSeconds > 0 ? '공격속도 ×2' : '초록 물약'}</small><strong>{greenSeconds > 0 ? `${Math.floor(greenSeconds / 60)}:${String(greenSeconds % 60).padStart(2, '0')}` : '효과 없음'}</strong></div></div></section>
      <div className="game-layout"><section className="world-frame"><div className="world-caption"><div><span className="status-dot online" /><strong>{ZONES[game.zone].name}</strong><small>{game.zone === 'island' ? '비선공 지역' : '선공 몬스터 주의'}</small></div><button onClick={() => setModal('map')}>세계 지도 <kbd>M</kbd></button></div><GameCanvas state={game} onTarget={id => void perform({ type: 'target', id })} onMove={(dx, dy) => { movementRef.current = { dx, dy }; }} paused={!!modal} /><div className="world-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동</span><span>몬스터 클릭 · 자동 접근 및 공격</span><span>Lv. 99 · 절대자의 일격</span></div></section><aside className="adventure-sidebar"><section className="sidebar-panel"><p className="section-label">YOUR EQUIPMENT</p><h2>모험가의 장비</h2><div className="equipped-weapon"><WeaponIcon elf={player.class === 'elf'} golden={player.enhancement === 10} /><div><span className="equipment-level">+{player.enhancement}</span><strong>{CLASSES[player.class].weapon}</strong><small>방어구 +{player.enhancement} 연동</small></div></div><dl className="stats-list"><div><dt>공격력</dt><dd>{derived.attack}</dd></div><div><dt>방어력</dt><dd>{derived.defense}</dd></div><div><dt>종합 전투력</dt><dd className="gold-text">{number(power(player))}</dd></div><div><dt>누적 몬스터 처치</dt><dd>{number(player.kills ?? 0)}</dd></div></dl><button className="button outline full" onClick={() => setModal('enhance')}>✧ 무기 강화 <kbd>E</kbd></button></section><section className="sidebar-panel world-selector"><p className="section-label">THE FOUR REALMS</p><h2>사냥터 이동</h2><div className="mini-zones">{zoneOrder.map(zone => <button key={zone} className={`mini-zone zone-${zone} ${game.zone === zone ? 'selected' : ''}`} onClick={() => { if (player.enhancement >= ZONES[zone].requirement) void perform({ type: 'travel', zone }); else { setError(`+${ZONES[zone].requirement} 이상 무기가 필요합니다.`); setModal('map'); } }} disabled={busy || game.zone === zone} title={ZONES[zone].description}><span>{zone === 'island' ? '♧' : zone === 'temple' ? '♜' : zone === 'volcano' ? '♨' : '♖'}</span><b>{ZONES[zone].name}</b><small>{game.zone === zone ? '현재 위치' : player.enhancement < ZONES[zone].requirement ? `잠김 · +${ZONES[zone].requirement}` : ZONES[zone].requirement ? `+${ZONES[zone].requirement} 이상` : '입장 제한 없음'}</small></button>)}</div></section><div className="adventure-tip"><span>✦</span><p>강화 실패 시 무기는 사라지지 않고<br /><b>+3으로 돌아갑니다.</b></p></div></aside></div>
      <section className="action-bar"><div className="quick-potions">{potionKinds.map((kind, index) => <button key={kind} title={`${POTIONS[kind].name} 사용`} aria-label={`${POTIONS[kind].name} 사용`} onClick={() => void perform({ type: 'usePotion', kind })} disabled={busy || player.potions[kind] <= 0}><kbd>{index + 1}</kbd><PotionIcon kind={kind} /><span>{player.potions[kind]}</span></button>)}</div><div className="toolbar">{([['inventory', '▦', '인벤토리', 'I'], ['shop', '◈', '상점', 'B'], ['enhance', '✧', '무기 강화', 'E'], ['ranking', '♜', '랭킹', 'R'], ['help', '?', '도움말', 'H']] as const).map(([name, icon, label, key]) => <button key={name} onClick={() => setModal(name)}><span>{icon}</span>{label}<kbd>{key}</kbd></button>)}</div><button className={`auto-indicator ${player.autoPotion.enabled ? 'enabled' : ''}`} onClick={() => setModal('inventory')}><i />자동 물약 <b>{player.autoPotion.enabled ? 'ON' : 'OFF'}</b></button></section>
      <WorldChat enabled={mode === 'online'} token={token} userId={sessionUserId} />
      <section className={`log-panel ${compactLog ? 'compact' : ''}`}><div className="log-heading"><span>모험 기록 <small>SYSTEM LOG</small></span><button onClick={() => setCompactLog(!compactLog)} aria-label={compactLog ? '로그 펼치기' : '로그 접기'}>{compactLog ? '+' : '−'}</button></div><div className="log-content" ref={logsRef}>{game.logs.slice(-35).map(log => <p key={log.id} className={`log-${log.kind}`}><time>{new Date(log.time).toLocaleTimeString('ko-KR', { hour12: false })}</time>{log.text}</p>)}</div></section>
    </>}

    {notice && <div className="toast" role="status"><span>✦</span>{notice}<button onClick={() => setNotice('')} aria-label="알림 닫기">×</button></div>}
    {error && !modal && <div className="error-toast" role="alert">{error}<button onClick={() => setError('')} aria-label="오류 닫기">×</button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section ref={modalElementRef} tabIndex={-1} className={`modal modal-${modal}`} role="dialog" aria-modal="true" aria-label={modalTitles[modal]}><header className="modal-header"><div><p className="section-label">CLASSIC CHRONICLES</p><h2>{modalTitles[modal]}</h2></div><button className="modal-close" onClick={() => setModal(null)} aria-label="창 닫기">×</button></header><div className="modal-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {modal === 'play' && <div className="play-choices"><button onClick={() => void startOnline()}><span>♜</span><h3>친구들과 랭킹 경쟁</h3><p>계정으로 로그인하여 어디서든<br />나의 캐릭터를 이어서 플레이하세요.</p><b>온라인 게임 시작 →</b></button><button onClick={continueDemo}><span>⚔</span><h3>바로 모험 시작하기</h3><p>가입 없이 이 브라우저에서 플레이합니다.<br />데모 기록은 공용 랭킹에 포함되지 않습니다.</p><b>{hasDemo ? '로컬 데모 이어하기' : '로컬 데모 캐릭터 생성'} →</b></button></div>}
      {modal === 'auth' && <>{!onlineConfigured ? <div className="empty-state"><span>♜</span><h3>온라인 연결을 준비하고 있습니다</h3><p>현재 온라인 계정 서비스가 연결되지 않았습니다.<br />관리자가 Supabase 설정을 완료하면 회원가입과<br />공용 랭킹을 사용할 수 있습니다.</p><button className="button primary" onClick={continueDemo}>먼저 로컬 데모 플레이</button></div> : <form onSubmit={authenticate} className="auth-form"><p className="muted">당신의 캐릭터와 모험 기록을 안전하게 보관합니다.</p><label>이메일<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="adventurer@example.com" /></label><label>비밀번호<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="8자 이상 입력해주세요" /></label><button className="button primary full" disabled={busy}>{busy ? '연결 중…' : signup ? '회원가입' : '로그인'}</button><button type="button" className="text-button" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? '이미 계정이 있으신가요? 로그인' : '처음 방문하셨나요? 회원가입'}</button></form>}</>}
      {(modal === 'demo' || modal === 'create') && <form onSubmit={makeCharacter} className="character-form"><p className="muted">당신의 길을 선택하세요. 생성 후 직업은 변경할 수 없습니다.</p><div className="class-options">{(['knight', 'elf'] as const).map(c => <button type="button" key={c} className={chosenClass === c ? 'selected' : ''} onClick={() => setChosenClass(c)}><div className={`class-illustration class-${c}`}><WeaponIcon elf={c === 'elf'} size={90} /></div><small>{c === 'knight' ? 'KNIGHT' : 'ELF'}</small><h3>{CLASS_LABEL[c]}</h3><p>{c === 'knight' ? '튼튼한 방어 · 근거리 검술' : '긴 사거리 · 정교한 활 사격'}</p><span>{CLASSES[c].weapon}</span></button>)}</div><label>캐릭터 닉네임<input required minLength={2} maxLength={14} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="한글·영문·숫자·밑줄 2~14자" /></label>{modal === 'demo' && <p className="local-note">로컬 데모는 이 브라우저에만 저장됩니다. 새 캐릭터를 만들면 기존 데모 기록을 덮어씁니다.</p>}<button className="button primary full" disabled={busy}>{busy ? '캐릭터 생성 중…' : '모험의 첫걸음 내딛기 →'}</button></form>}
      {modal === 'inventory' && player && <><div className="inventory-equipment"><div className="item-slot large"><WeaponIcon elf={player.class === 'elf'} golden={player.enhancement === 10} /></div><div><small>장착 중 · {CLASS_LABEL[player.class]} 전용</small><h3 className="gold-text">+{player.enhancement} {CLASSES[player.class].weapon}</h3><p>방어구 +{player.enhancement} · 최고 강화 +{player.bestEnhancement}</p>{player.enhancement === 10 && <b className="gold-text">✦ {player.class === 'knight' ? '광역 검기' : '관통 화살'} — 10% 자동 발동</b>}</div></div><div className="inventory-grid"><div className="inventory-item"><ScrollIcon /><div><strong>무기강화주문서</strong><small>강화 시 1장 소모</small></div><b>{number(player.scrolls)}</b></div>{potionKinds.map(kind => <div key={kind} className="inventory-item"><PotionIcon kind={kind} /><div><strong>{POTIONS[kind].name}</strong><small>{kind === 'green' ? '10분간 공격속도 2배' : `HP ${POTIONS[kind].heal} 회복`}</small></div><b>{number(player.potions[kind])}</b><button disabled={busy || player.potions[kind] < 1} onClick={() => void perform({ type: 'usePotion', kind })}>사용</button></div>)}</div><div className="auto-potion-box"><div><h3>자동 체력회복 물약</h3><p>HP가 80% 이하일 때, 1초 간격으로 사용합니다.</p></div><select aria-label="자동 회복 물약 선택" disabled={busy} value={player.autoPotion.kind} onChange={e => void perform({ type: 'autoPotion', enabled: player.autoPotion.enabled, kind: e.target.value as HealPotionKind })}>{(['red', 'orange', 'clear'] as const).map(kind => <option key={kind} value={kind}>{POTIONS[kind].name}</option>)}</select><button className={`toggle ${player.autoPotion.enabled ? 'on' : ''}`} onClick={() => void perform({ type: 'autoPotion', kind: player.autoPotion.kind, enabled: !player.autoPotion.enabled })} disabled={busy} aria-pressed={player.autoPotion.enabled}>{player.autoPotion.enabled ? 'ON' : 'OFF'}</button></div></>}
      {modal === 'shop' && player && <><p className="shop-wallet">보유 아데나 <strong>◈ {number(player.adena)}</strong></p><div className="shop-products">{potionKinds.map(kind => <button key={kind} className={shopKind === kind ? 'selected' : ''} onClick={() => setShopKind(kind)}><PotionIcon kind={kind} size={46} /><strong>{POTIONS[kind].name}</strong><small>{kind === 'green' ? '공격속도 ×2 · 10분' : `HP ${POTIONS[kind].heal} 회복`}</small><b>◈ {number(POTIONS[kind].price)}</b></button>)}</div><div className="purchase-line"><label>구매 수량<input type="number" min={1} max={999} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(999, Math.trunc(Number(e.target.value) || 1))))} /></label><div><small>총 구매 금액</small><strong className={quantity * POTIONS[shopKind].price > player.adena ? 'danger-text' : 'gold-text'}>◈ {number(quantity * POTIONS[shopKind].price)}</strong></div></div><button className="button primary full" disabled={busy || quantity * POTIONS[shopKind].price > player.adena} onClick={() => void perform({ type: 'buy', kind: shopKind, quantity }).then(() => undefined)}>{busy ? '구매 중…' : quantity * POTIONS[shopKind].price > player.adena ? '아데나가 부족합니다' : `${POTIONS[shopKind].name} ${quantity}개 구매`}</button><p className="local-note">구매와 소모 결과는 즉시 저장됩니다.</p></>}
      {modal === 'enhance' && player && <div className={`enhancement ${enhanceResult || ''}`}><div className="forge-ring"><span className="forge-symbol">✧</span><WeaponIcon elf={player.class === 'elf'} golden={player.enhancement === 10} size={100} /></div><p className="section-label">{player.enhancement === 10 ? 'LEGENDARY WEAPON' : 'FORGE YOUR DESTINY'}</p><h3>+{player.enhancement} {CLASSES[player.class].weapon}</h3><p className="muted">무기와 방어구의 강화 수치가 함께 증가합니다.</p>{enhanceResult && <div className={`enhance-message ${enhanceResult}`}>{enhanceResult === 'success' ? `✦ 강화 성공! +${player.enhancement}의 힘이 깃들었습니다.` : '강화 실패… 무기와 방어구가 +3이 되었습니다.'}</div>}{player.enhancement < 10 ? <><div className="enhance-preview"><div><small>도전 단계</small><strong>+{player.enhancement} <span>→</span> +{player.enhancement + 1}</strong></div><div><small>성공 확률</small><strong className="gold-text">{Math.round(ENHANCE_CHANCES[player.enhancement] * 100)}<i>%</i></strong></div></div><div className="scroll-count"><ScrollIcon /><span>무기강화주문서</span><strong>{player.scrolls}장 <small> / 1장 필요</small></strong></div><p className="enhance-warning">실패 시 무기와 방어구는 +3으로 초기화됩니다.<br />상위 사냥터의 입장 조건이 부족해지면 말하는 섬으로 이동합니다.</p><button className="button primary full" disabled={busy || player.scrolls < 1} onClick={() => void perform({ type: 'enhance' })}>{busy ? '무기에 힘을 불어넣는 중…' : player.scrolls < 1 ? '강화주문서가 부족합니다' : '✧ 무기 강화하기'}</button></> : <div className="legendary-label">✦ 최고의 경지에 도달한 무기 ✦<p>일반 공격 시 10% 확률로 {player.class === 'knight' ? '광역 검기' : '관통 화살'} 발동</p></div>}<button className="text-button" onClick={() => setModal('probability')}>전체 강화 확률표 보기 ↗</button></div>}
      {modal === 'probability' && <><p className="muted">모든 직업에 동일하게 적용됩니다. 매 시도는 독립적으로 판정합니다.</p><table className="probability-table"><thead><tr><th>강화 단계</th><th>성공 확률</th><th>실패 시</th></tr></thead><tbody>{ENHANCE_CHANCES.map((chance, index) => <tr key={index} className={index === 9 ? 'legendary-row' : ''}><td>+{index} <span>→</span> <b>+{index + 1}</b></td><td><div className="probability-bar"><i style={{ width: `${chance * 100}%` }} /><b>{Math.round(chance * 100)}%</b></div></td><td>{chance === 1 ? '실패 없음' : '+3으로 초기화'}</td></tr>)}</tbody></table><p className="local-note">성공·실패 모두 주문서 1장 소모 · 무기 소멸 없음 · 최대 +10<br />온라인 강화 확률과 결과는 서버에서 결정합니다.</p></>}
      {modal === 'ranking' && <><p className="muted">각자의 모험, 하나의 전당. 실제 온라인 캐릭터만 표시됩니다.</p><div className="tab-row">{([['power', '종합 전투력'], ['level', '레벨'], ['weapon', '무기 강화']] as const).map(([key, label]) => <button key={key} className={rankingKind === key ? 'active' : ''} onClick={() => setRankingKind(key)}>{label}</button>)}</div>{rankingLoading ? <div className="empty-state">영웅의 기록을 불러오는 중…</div> : rankingError ? <div className="empty-state"><span>♜</span><h3>아직 전당의 문이 열리지 않았습니다</h3><p>{rankingError}</p><small>로컬 데모 캐릭터는 이 목록에 등록되지 않습니다.</small></div> : rankings.length === 0 ? <div className="empty-state"><span>♜</span><h3>첫 번째 전설을 기다립니다</h3><p>아직 등록된 온라인 캐릭터가 없습니다.<br />계정을 만들고 첫 모험을 시작해보세요.</p></div> : <div className="ranking-scroll"><table className="ranking-table"><thead><tr><th>순위</th><th>모험가</th><th>레벨</th><th>무기 / 방어구</th><th>전투력</th><th>최고 강화</th><th>몬스터 처치 수</th></tr></thead><tbody>{rankings.map((entry, index) => <tr key={`${entry.nickname}-${index}`}><td><span className={`rank-number rank-${index + 1}`}>{index + 1}</span></td><td><strong className={entry.enhancement === 10 ? 'gold-name' : ''}>{entry.nickname}</strong><small>{CLASS_LABEL[entry.class]}</small></td><td>{entry.level}<small>EXP {number(entry.xp)}</small></td><td>+{entry.enhancement} {CLASSES[entry.class].weapon}<small>방어구 +{entry.enhancement}</small></td><td className="gold-text">{number(entry.power)}</td><td>+{entry.bestEnhancement}</td><td className="kill-count">{number(entry.kills ?? 0)}</td></tr>)}</tbody></table></div>}<p className="local-note">종합 전투력 = 레벨 × 100 + 현재 무기 강화 × 1,000<br />몬스터 처치 수는 모든 사냥터의 누적 기록이며, 사망·재접속 후에도 유지됩니다.</p></>}
      {modal === 'map' && <><p className="muted">시계방향으로 이어지는 네 개의 세계. 더 강한 무기가 새로운 길을 엽니다.</p><div className="map-zones">{zoneOrder.map(zone => <button key={zone} className={`map-zone zone-${zone} ${game?.zone === zone ? 'selected' : ''}`} disabled={!player || busy || game?.zone === zone || player.enhancement < ZONES[zone].requirement} onClick={() => void perform({ type: 'travel', zone }).then(() => setModal(null))}><span className="map-emblem">{zone === 'island' ? '♧' : zone === 'temple' ? '♜' : zone === 'volcano' ? '♨' : '♖'}</span><small>REGION {zone === 'island' ? '01' : zone === 'temple' ? '02' : zone === 'volcano' ? '03' : '04'}</small><h3>{ZONES[zone].name}</h3><p>{ZONES[zone].description}</p><span>{ZONES[zone].monsters.map(m => MONSTERS[m].name).join(' · ')}</span><b>{game?.zone === zone ? '현재 위치' : ZONES[zone].requirement === 0 ? '누구나 입장' : `+${ZONES[zone].requirement} 이상 무기 필요`}</b><em>EXP {ZONES[zone].xp.join('~')} · 주문서 {Math.round(ZONES[zone].scrollChance * 100)}%</em></button>)}</div></>}
      {modal === 'help' && <div className="help-content"><div className="help-intro"><span>⚔</span><div><h3>당신만의 속도로, 전설을 향해.</h3><p>실시간 공동 사냥 없이 혼자 성장하고, 친구들과 기록으로 경쟁하는 클래식 RPG입니다.</p></div></div><div className="help-grid"><article><b>01</b><h3>이동과 사냥</h3><p><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> 또는 방향키로 이동합니다. 몬스터를 클릭하면 자동으로 접근해 공격합니다. 직접 이동하면 공격을 멈추고 이동합니다.</p></article><article><b>02</b><h3>강화와 성장</h3><p>몬스터에게서 아데나, 경험치, 강화주문서를 얻습니다. <kbd>E</kbd>에서 무기를 강화하세요. +6 신전, +7 화룡, +9 오만의 탑이 열립니다.</p></article><article><b>03</b><h3>물약과 생존</h3><p><kbd>B</kbd> 상점에서 물약을 구매합니다. <kbd>I</kbd> 인벤토리에서 자동 물약을 켜세요. 초록 물약은 10분간 공격속도가 2배입니다.</p></article><article><b>04</b><h3>전설의 경지</h3><p>30·60·90레벨에 자동 변신합니다. 99레벨에는 한 번의 공격으로 지역의 모든 몬스터를 처치합니다. 사망해도 경험치나 장비를 잃지 않습니다.</p></article></div><div className="shortcut-list"><span><kbd>I</kbd> 인벤토리</span><span><kbd>E</kbd> 강화</span><span><kbd>R</kbd> 랭킹</span><span><kbd>B</kbd> 상점</span><span><kbd>M</kbd> 지도</span><span><kbd>H</kbd> 도움말</span><span><kbd>1–4</kbd> 물약</span><span><kbd>Enter</kbd> 전체 채팅</span><span><kbd>ESC</kbd> 창 닫기</span></div><p className="local-note">로컬 데모는 브라우저에만 저장되고, 온라인 캐릭터와 공용 랭킹에 영향을 주지 않습니다.<br />온라인 플레이는 같은 계정으로 다른 컴퓨터에서도 이어갈 수 있습니다.</p></div>}
      {modal === 'settings' && <div className="settings-content"><div className="setting-row"><div><h3>플레이 모드</h3><p>{mode === 'demo' ? '로컬 데모 · 현재 브라우저에 자동 저장됩니다.' : '온라인 · 서버에 자동 저장됩니다.'}</p></div><span className="mode-tag">{mode === 'demo' ? 'DEMO' : 'ONLINE'}</span></div><div className="setting-row"><div><h3>시스템 로그</h3><p>화면 하단의 기록 표시를 줄입니다.</p></div><button className={`toggle ${compactLog ? 'on' : ''}`} onClick={() => setCompactLog(!compactLog)}>{compactLog ? '접기' : '펼치기'}</button></div><button className="button outline full" onClick={() => void goHome()}>저장하고 시작 화면으로</button>{mode === 'demo' && <button className="text-button danger-text" onClick={async () => { await goHome(); setNickname('모험가'); setModal('demo'); }}>새 데모 캐릭터 만들기</button>}{token && <button className="text-button" onClick={async () => { await goHome(); await getAuthClient()?.auth.signOut(); setNotice('로그아웃했습니다. 캐릭터는 서버에 보관됩니다.'); }}>계정 로그아웃</button>}</div>}
    </div><footer className="modal-footer"><span>제작자 : 예수</span><small><kbd>ESC</kbd> 닫기</small></footer></section></div>}
  </main>;
}
