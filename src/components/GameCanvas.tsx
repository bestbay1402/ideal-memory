'use client';

import { useEffect, useRef } from 'react';
import type { Effect, GameState, Point } from '../game/types';
import { CLASSES, MONSTERS, RESPAWN_MS, WORLD_HEIGHT, WORLD_WIDTH, ZONES } from '../game/config';
import { decorationsFor, obstaclesFor, SIGN } from '../game/world';
import { stats } from '../game/engine';
import { drawBillboard, drawObject, drawTerrain } from '../art/terrain';
import { drawSprite } from '../art/sprites';

export interface GameCanvasProps {
  state: GameState;
  onTarget: (id: string) => void;
  onMove: (dx: number, dy: number) => void;
  onMoveTo: (x: number, y: number) => void;
  paused?: boolean;
}
const WIDTH = 1000;
const HEIGHT = 600;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#f1e7cb', size = 12) {
  ctx.font = `${size >= 15 ? 'bold ' : ''}${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#07100fe6';
  ctx.strokeText(text,x,y); ctx.fillStyle = color; ctx.fillText(text,x,y);
}
function hpBar(ctx: CanvasRenderingContext2D,x:number,y:number,width:number,ratio:number,player=false) {
  ctx.fillStyle='#0b1013';ctx.fillRect(x-width/2-1,y-1,width+2,6);
  ctx.fillStyle='#3d2728';ctx.fillRect(x-width/2,y,width,4);
  const w=Math.round(width*clamp(ratio,0,1));
  ctx.fillStyle=player?'#87ba78':'#c56857';ctx.fillRect(x-width/2,y,w,4);
  ctx.fillStyle=player?'#bddba0':'#e78d6f';ctx.fillRect(x-width/2,y,w,1);
}
function drawEffect(ctx: CanvasRenderingContext2D, e: Effect, now: number) {
  const age=now-e.time; if(age<0||age>1400)return;
  const p=clamp(age/650,0,1);ctx.save();ctx.translate(e.x,e.y-14);
  const golden=['nova','cleave','pierce','transform','enhanceSuccess'].includes(e.kind);
  const color=golden?'#f9d87c':e.kind==='heal'?'#a6e4ae':e.kind==='enhanceFail'?'#f37161':'#e1ebdb';
  if(e.kind==='hit'||e.kind==='heal'){
    ctx.globalAlpha=clamp(1-age/1050,0,1);label(ctx,(e.kind==='heal'?'+':'')+String(e.value??''),0,-35-age*.045,e.kind==='heal'?'#b1efaa':'#ffe1b8',e.value&&e.value>80?19:15);
  } else if(e.kind==='slash'||e.kind==='cleave'){
    ctx.globalAlpha=1-p;ctx.rotate(Math.atan2((e.toY??e.y)-e.y,(e.toX??e.x+1)-e.x));
    ctx.strokeStyle=color;ctx.lineWidth=e.kind==='cleave'?8:4;ctx.beginPath();ctx.arc(0,0,e.kind==='cleave'?100:48,-1.05,1.05);ctx.stroke();ctx.strokeStyle='#fff8d3';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,e.kind==='cleave'?112:55,-.8,.8);ctx.stroke();
  } else if(e.kind==='arrow'||e.kind==='pierce'){
    const tx=(e.toX??e.x)-e.x,ty=(e.toY??e.y)-e.y;const travel=clamp(age/230,0,1);
    ctx.translate(tx*travel,ty*travel);ctx.rotate(Math.atan2(ty,tx));ctx.globalAlpha=1-clamp((age-220)/320,0,1);
    ctx.strokeStyle=e.kind==='pierce'?'#ffdb6f':'#c9c4a0';ctx.lineWidth=e.kind==='pierce'?4:2;ctx.beginPath();ctx.moveTo(-24,0);ctx.lineTo(9,0);ctx.stroke();ctx.fillStyle='#eee6c8';ctx.beginPath();ctx.moveTo(14,0);ctx.lineTo(5,-4);ctx.lineTo(5,4);ctx.fill();ctx.strokeStyle='#887657';ctx.beginPath();ctx.moveTo(-22,-4);ctx.lineTo(-17,0);ctx.lineTo(-22,4);ctx.stroke();
    if(e.kind==='pierce'){ctx.shadowColor='#ffc44e';ctx.shadowBlur=20;ctx.fillStyle='#ffdc75';ctx.fillRect(-55,-2,56,4);}
  } else if(['level','transform','nova','enhanceSuccess','enhanceFail','respawn'].includes(e.kind)){
    const t=clamp(age/1300,0,1);ctx.globalAlpha=1-t;
    if(e.kind==='transform'||e.kind==='level'||e.kind==='enhanceSuccess'){
      const glow=ctx.createLinearGradient(0,-220,0,20);glow.addColorStop(0,'#ffe6aa00');glow.addColorStop(1,golden?'#ffe6aa77':'#a2e5ff66');ctx.fillStyle=glow;ctx.fillRect(-22-t*15,-220,44+t*30,240);
    }
    ctx.strokeStyle=color;ctx.lineWidth=e.kind==='nova'?5:2;ctx.beginPath();ctx.ellipse(0,10,(e.kind==='nova'?650:100)*t+12,(e.kind==='nova'?380:45)*t+6,0,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<18;i++){const a=i/18*Math.PI*2;ctx.fillStyle=i%2?'#fff2c1':color;const r=30+t*100;ctx.fillRect(Math.cos(a)*r,Math.sin(a)*r*.6-t*85,3,5);}
    if(e.text&&age<1100)label(ctx,e.text,0,-80-t*20,color,18);
  } else if(e.kind==='death'){
    ctx.globalAlpha=1-p;for(let i=0;i<8;i++){ctx.fillStyle='#b1957455';ctx.fillRect(Math.cos(i)*p*35,-Math.sin(i)*p*22,5,5);}
  }
  ctx.restore();
}

export default function GameCanvas({state,onTarget,onMove,onMoveTo,paused=false}:GameCanvasProps) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const stateRef=useRef(state), targetRef=useRef(onTarget), moveRef=useRef(onMove), moveToRef=useRef(onMoveTo), pausedRef=useRef(paused);
  const receivedRef=useRef(0),cameraRef=useRef({x:0,y:0});
  const visualsRef=useRef<Map<string,Point>>(new Map());
  stateRef.current=state;targetRef.current=onTarget;moveRef.current=onMove;moveToRef.current=onMoveTo;pausedRef.current=paused;
  useEffect(()=>{receivedRef.current=performance.now();},[state]);
  useEffect(()=>{if(paused)moveRef.current(0,0);},[paused]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.imageSmoothingEnabled=false;
    const floor=document.createElement('canvas');floor.width=WORLD_WIDTH;floor.height=WORLD_HEIGHT;
    const floorCtx=floor.getContext('2d')!;
    let oldZone='',frame=0,last=performance.now(),raf=0;
    const keys=new Set<string>();
    const updateMovement=()=>{
      const dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
      const dy=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));
      moveRef.current(pausedRef.current?0:dx,pausedRef.current?0:dy);
    };
    const keyDown=(event:KeyboardEvent)=>{
      const elem=event.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(elem?.tagName)||elem?.isContentEditable||pausedRef.current)return;
      const key=event.key.toLowerCase();if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright'].includes(key)){event.preventDefault();keys.add(key);updateMovement();}
    };
    const keyUp=(event:KeyboardEvent)=>{if(keys.delete(event.key.toLowerCase()))updateMovement();};
    const blur=()=>{keys.clear();moveRef.current(0,0);};
    window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',blur);window.addEventListener('classic-chat-focus',blur);
    const interpolate=(id:string,x:number,y:number,delta:number)=>{
      const old=visualsRef.current.get(id)??{x,y};const distant=Math.hypot(old.x-x,old.y-y)>240;
      const a=distant?1:1-Math.exp(-delta/55);const next={x:old.x+(x-old.x)*a,y:old.y+(y-old.y)*a};visualsRef.current.set(id,next);return{...next,moving:Math.hypot(x-old.x,y-old.y)>.65,facing:x>=old.x?1:-1};
    };
    const draw=(stamp:number)=>{
      const s=stateRef.current;const delta=Math.min(stamp-last,40);last=stamp;frame++;
      const now=s.time+Math.max(0,stamp-receivedRef.current);
      if(oldZone!==s.zone){oldZone=s.zone;drawTerrain(floorCtx,s.zone,WORLD_WIDTH,WORLD_HEIGHT);visualsRef.current.clear();}
      const p=interpolate('player',s.player.x,s.player.y,delta);const statsNow=stats(s.player);
      const camera={x:clamp(p.x-WIDTH/2,0,WORLD_WIDTH-WIDTH),y:clamp(p.y-HEIGHT/2,0,WORLD_HEIGHT-HEIGHT)};cameraRef.current=camera;
      ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.save();ctx.translate(-Math.round(camera.x),-Math.round(camera.y));ctx.drawImage(floor,0,0);
      const objects=obstaclesFor(s.zone);const decorations=decorationsFor(s.zone);
      for(const d of decorations){
        if(d.kind==='grass'){ctx.fillStyle='#4f684d';ctx.fillRect(d.x,d.y-4,1,4);ctx.fillRect(d.x-3,d.y-2,2,2);ctx.fillRect(d.x+2,d.y-3,1,3);}
        if(d.kind==='flower'){ctx.fillStyle='#91a56e';ctx.fillRect(d.x,d.y-4,1,6);ctx.fillStyle='#d7bd8d';ctx.fillRect(d.x-1,d.y-6,3,3);}
        if(d.kind==='bones'){ctx.fillStyle='#8c827055';ctx.fillRect(d.x,d.y,10,2);ctx.fillRect(d.x-1,d.y-2,3,5);ctx.fillRect(d.x+8,d.y-2,3,5);}
        if(d.kind==='rune'){ctx.strokeStyle='#b29c6933';ctx.lineWidth=1;ctx.strokeRect(d.x-5,d.y-3,10,6);ctx.beginPath();ctx.moveTo(d.x-8,d.y);ctx.lineTo(d.x+8,d.y);ctx.stroke();}
      }
      if(s.moveDestination){
        const destination=s.moveDestination;const pulse=1+Math.sin(now*.006)*.12;
        ctx.save();ctx.translate(destination.x,destination.y);ctx.strokeStyle='#e4cf8a';ctx.lineWidth=2;ctx.globalAlpha=.8;
        ctx.beginPath();ctx.ellipse(0,0,13*pulse,6*pulse,0,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(4,0);ctx.moveTo(0,-3);ctx.lineTo(0,3);ctx.stroke();ctx.restore();
      }
      const entities:{depth:number;draw:()=>void}[]=[];
      objects.forEach(o=>entities.push({depth:o.y+o.height/2,draw:()=>drawObject(ctx,{x:o.x-o.width/2,y:o.y-o.height/2,w:o.width,h:o.height,kind:o.kind},s.zone,now)}));
      decorations.filter(d=>d.kind==='torch').forEach(d=>entities.push({depth:d.y,draw:()=>drawObject(ctx,{x:d.x-9,y:d.y-12,w:18,h:24,kind:'torch'},s.zone,now)}));
      if(s.zone==='island')entities.push({depth:SIGN.y+22,draw:()=>drawBillboard(ctx,SIGN.x,SIGN.y)});
      for(const m of s.monsters){
        const deathAge=now-(m.respawnAt-RESPAWN_MS);if(!m.alive&&deathAge>850)continue;
        const visual=interpolate(m.id,m.x,m.y,delta);
        entities.push({depth:visual.y,draw:()=>{
          if(m.id===s.targetId&&m.alive){ctx.save();ctx.strokeStyle='#d4bb73';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();ctx.ellipse(visual.x,visual.y+1,25,11,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
          ctx.save();if(!m.alive){ctx.globalAlpha=clamp(1-deathAge/850,0,1);ctx.translate(visual.x,visual.y);ctx.scale(1,Math.max(.18,1-deathAge/1000));ctx.translate(-visual.x,-visual.y);}
          drawSprite(ctx,m.kind,visual.x,visual.y,{time:now,moving:visual.moving,attacking:m.nextAttackAt-now>MONSTERS[m.kind].attackInterval-250,dead:!m.alive,facing:visual.facing});ctx.restore();
          if(m.alive){const top=m.kind==='slime'?31:m.kind==='cougar'?38:59;label(ctx,MONSTERS[m.kind].name,visual.x,visual.y-top,m.aggro?'#efb5a1':'#e0d4b5',11);hpBar(ctx,visual.x,visual.y-top+6,40,m.hp/m.maxHp);if(m.aggro)label(ctx,'!',visual.x+27,visual.y-top+4,'#ed9a79',14);}
        }});
      }
      entities.push({depth:p.y,draw:()=>{
        const attacking=s.nextAttackAt-now>(s.player.greenUntil>now?500:1000)-230;
        if(s.player.greenUntil>now){ctx.strokeStyle='#91cd6570';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(p.x,p.y+2,21,9,0,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){ctx.fillStyle='#b5e28c';ctx.fillRect(p.x+Math.cos(now*.003+i*2)*21,p.y-8-Math.sin(now*.003+i*2)*10,2,2);}}
        drawSprite(ctx,s.player.class,p.x,p.y,{time:now,moving:p.moving,attacking,facing:p.facing,level:s.player.level,enhancement:s.player.enhancement});
        label(ctx,s.player.nickname,p.x,p.y-68,s.player.enhancement===10?'#ffe18e':'#e5f0d1',13);hpBar(ctx,p.x,p.y-61,49,s.player.hp/statsNow.maxHp,true);
      }});
      entities.sort((a,b)=>a.depth-b.depth).forEach(e=>e.draw());
      s.effects.forEach(e=>drawEffect(ctx,e,now));
      // 작고 느린 빛과 재는 맵 분위기만 더하며 전투 판정과 분리되어 있습니다.
      for(let i=0;i<32;i++){
        const x=((i*137+now*.008*(i%2?1:-1))%WORLD_WIDTH+WORLD_WIDTH)%WORLD_WIDTH,y=(i*97+Math.sin(now*.0005+i)*20)%WORLD_HEIGHT;
        const a=.15+.25*(.5+.5*Math.sin(now*.002+i));ctx.fillStyle=s.zone==='island'?`rgba(200,221,139,${a})`:s.zone==='volcano'?`rgba(255,139,71,${a})`:`rgba(193,177,177,${a*.5})`;ctx.fillRect(x,y,2,2);
      }
      ctx.restore();
      const vignette=ctx.createRadialGradient(WIDTH/2,HEIGHT*.48,HEIGHT*.18,WIDTH/2,HEIGHT*.48,WIDTH*.65);vignette.addColorStop(0,'#060d1200');vignette.addColorStop(1,s.zone==='temple'?'#230609aa':'#050e15b0');ctx.fillStyle=vignette;ctx.fillRect(0,0,WIDTH,HEIGHT);
      if(s.effects.some(e=>e.kind==='nova'&&now-e.time<500)){ctx.fillStyle=`rgba(255,218,132,${.25*(1-Math.max(...s.effects.filter(e=>e.kind==='nova').map(e=>now-e.time))/500)})`;ctx.fillRect(0,0,WIDTH,HEIGHT);}
      // 조용한 게임 화면 내 지역명과 미니맵.
      ctx.fillStyle='#07100ed9';ctx.fillRect(20,20,210,51);ctx.strokeStyle='#88794b66';ctx.strokeRect(20.5,20.5,210,51);label(ctx,ZONES[s.zone].name,125,42,'#e1d5ad',15);label(ctx,ZONES[s.zone].aggressive?'위험 지역 · 선공 몬스터':'안전한 여정 · 비선공 몬스터',125,60,'#a2b396',10);
      const mx=WIDTH-160,my=20,mw=140,mh=91;
      ctx.fillStyle='#0b1316df';ctx.fillRect(mx-5,my-5,mw+10,mh+27);ctx.strokeStyle='#9d875762';ctx.strokeRect(mx-5.5,my-5.5,mw+11,mh+28);
      ctx.fillStyle=s.zone==='island'?'#22372b':'#352e36';ctx.fillRect(mx,my,mw,mh);
      for(const o of objects){ctx.fillStyle='#75816866';ctx.fillRect(mx+o.x/WORLD_WIDTH*mw-2,my+o.y/WORLD_HEIGHT*mh-1,4,3);}
      for(const m of s.monsters.filter(m=>m.alive)){ctx.fillStyle=m.aggro?'#e88d69':'#a9a17b';ctx.fillRect(mx+m.x/WORLD_WIDTH*mw-1,my+m.y/WORLD_HEIGHT*mh-1,2,2);}
      ctx.fillStyle='#ffe4a0';ctx.fillRect(mx+p.x/WORLD_WIDTH*mw-2,my+p.y/WORLD_HEIGHT*mh-2,4,4);label(ctx,'WORLD  /  '+(Object.keys(ZONES).indexOf(s.zone)+1).toString().padStart(2,'0'),mx+mw/2,my+mh+15,'#b9b49e',9);
      if(frame%2===0){/* Frame counter intentionally stable for sprite cadence. */}
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);window.removeEventListener('classic-chat-focus',blur);moveRef.current(0,0);};
  },[]);

  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} tabIndex={0} role="img"
    aria-label={`${ZONES[state.zone].name} 사냥터. 땅을 클릭하거나 WASD 또는 방향키로 이동하고 몬스터를 클릭하여 공격하세요.`}
    data-testid="game-canvas"
    style={{display:'block',width:'100%',height:'auto',aspectRatio:`${WIDTH} / ${HEIGHT}`,imageRendering:'pixelated',outline:'none',cursor:paused?'default':'crosshair',background:'#111d17'}}
    onPointerDown={event=>{
      if(pausedRef.current||event.button!==0)return;event.currentTarget.focus();
      const rect=event.currentTarget.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width*WIDTH+cameraRef.current.x,y=(event.clientY-rect.top)/rect.height*HEIGHT+cameraRef.current.y;
      let nearest:string|null=null,distance=45;
      for(const m of stateRef.current.monsters){if(!m.alive)continue;const visual=visualsRef.current.get(m.id)??m;const d=Math.hypot(visual.x-x,(visual.y-21-y)*.85);if(d<distance){distance=d;nearest=m.id;}}
      if(nearest)targetRef.current(nearest);else moveToRef.current(x,y);
    }} />;
}
