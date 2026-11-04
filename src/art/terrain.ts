/** 직접 그린 오리지널 픽셀 배경. 외부 게임 리소스를 사용하지 않습니다. */
export type TerrainZone = 'island' | 'temple' | 'volcano' | 'tower';
export type TerrainObject = { x: number; y: number; w: number; h: number; kind?: string };

function hash(x: number, y: number, seed = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function poly(ctx: CanvasRenderingContext2D, color: string, points: number[][]) {
  ctx.fillStyle = color; ctx.beginPath(); points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
}

export function drawTerrain(ctx: CanvasRenderingContext2D, zone: TerrainZone, width: number, height: number) {
  const grass = zone === 'island';
  rect(ctx, grass ? '#1b3026' : zone === 'temple' ? '#302021' : zone === 'volcano' ? '#252329' : '#272b32', 0,0,width,height);
  const colors = grass ? ['#203c2b','#29432d','#183026','#30472e','#213829'] : zone === 'temple' ? ['#35272b','#403031','#31272c','#3e2c30','#453333'] : zone === 'volcano' ? ['#29272d','#333037','#3c3232','#25262d','#302d34'] : ['#30363e','#343c43','#2c323b','#37404a','#333944'];
  for(let y=0;y<height;y+=24) for(let x=0;x<width;x+=48){
    const offset = (y/24)%2 ? 24 : 0;
    const px=x-offset;
    rect(ctx,colors[Math.floor(hash(x,y)*colors.length)],px+1,y+1,46,22);
    if(!grass){
      rect(ctx,'#ffffff08',px+2,y+2,43,1);
      rect(ctx,'#080d1588',px+2,y+22,44,1);
      if(hash(x,y,2)>.62){rect(ctx,'#0b111c70',px+14,y+7,8,1);rect(ctx,'#0b111c50',px+22,y+8,3,5);}
    }
  }
  if(grass){
    // 완만한 흙길을 바탕에 그린 뒤 작은 자갈과 잔디를 겹칩니다.
    ctx.strokeStyle='#514b37';ctx.lineWidth=92;ctx.lineCap='round';ctx.beginPath();
    ctx.moveTo(70,height*.38);ctx.bezierCurveTo(width*.3,height*.32,width*.4,height*.72,width*.7,height*.53);ctx.bezierCurveTo(width*.86,height*.4,width*.88,height*.38,width+30,height*.48);ctx.stroke();
    ctx.strokeStyle='#645941';ctx.lineWidth=63;ctx.stroke();
    ctx.strokeStyle='#70604766';ctx.lineWidth=30;ctx.stroke();
  }
  for(let i=0;i<width*height/170;i++){
    const x=Math.floor(hash(i,3)*width),y=Math.floor(hash(i,7)*height);
    if(grass){
      const color=['#42613c','#3c5435','#597144','#18291f','#748158'][i%5];
      rect(ctx,color,x,y,2,3);if(i%3===0){rect(ctx,color,x-2,y+2,2,3);rect(ctx,color,x+2,y+1,2,4);}
      if(i%23===0){rect(ctx,'#938671',x,y,5,3);rect(ctx,'#b5a185',x,y,3,1);}
      if(i%61===0){rect(ctx,'#cba454',x,y,2,2);rect(ctx,'#75935c',x,y+2,1,3);}
    } else {
      rect(ctx,['#171b2155','#66626b33','#0c121855'][i%3],x,y,i%4+1,1);
      if(zone==='volcano'&&i%21===0){rect(ctx,'#a34224',x,y,6,1);rect(ctx,'#dd6225',x+4,y+1,3,1);}
      if(zone==='temple'&&i%37===0){rect(ctx,'#782e2f',x,y,2,5);rect(ctx,'#782e2f',x-2,y+2,6,1);}
    }
  }
  if(zone!=='island'){
    const cx=width/2,cy=height/2;
    ctx.save();ctx.translate(cx,cy);ctx.scale(1,.6);ctx.strokeStyle=zone==='volcano'?'#b158272b':zone==='temple'?'#bd5c493b':'#a9b4be22';ctx.lineWidth=3;
    for(const r of [110,120,154]){ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();}
    for(let i=0;i<8;i++){ctx.rotate(Math.PI/4);ctx.strokeRect(-5,-148,10,26);}
    ctx.restore();
  }
  // Map edge stays visibly bounded.
  rect(ctx,'#080e12aa',0,0,width,12);rect(ctx,'#080e12aa',0,height-12,width,12);rect(ctx,'#080e12aa',0,0,12,height);rect(ctx,'#080e12aa',width-12,0,12,height);
}

export function drawObject(ctx: CanvasRenderingContext2D, obj: TerrainObject, zone: TerrainZone, time: number) {
  const {x,y,w,h}=obj; const cx=x+w/2, foot=y+h;
  const kind=obj.kind ?? (zone==='island'?'tree':zone==='volcano'?'rock':'pillar');
  if(kind==='lava'){
    const pulse=.5+.5*Math.sin(time*.002+x);
    rect(ctx,'#3b1616',x-3,y-3,w+6,h+6);rect(ctx,'#86281a',x,y,w,h);rect(ctx,'#d6531c',x+5,y+4,w-10,h-8);
    for(let yy=y+4;yy<y+h-3;yy+=9)for(let xx=x+4;xx<x+w-2;xx+=13){rect(ctx,(Math.sin(xx+yy+time*.001)>0)?'#ffb331':'#f07923',xx,yy,8+pulse*4,2);}
    return;
  }
  ctx.fillStyle='#02070d55';ctx.beginPath();ctx.ellipse(cx+5,foot+1,w*.75,Math.max(8,w*.23),0,0,Math.PI*2);ctx.fill();
  if(kind==='tree'){
    const canopyW=Math.max(62,w*1.8),top=foot-Math.max(94,h+63);
    rect(ctx,'#251f1c',cx-8,top+33,16,foot-top-30);rect(ctx,'#54402a',cx-5,top+39,8,foot-top-39);rect(ctx,'#796047',cx-3,top+50,2,foot-top-52);
    poly(ctx,'#30291e',[[cx-15,foot+2],[cx-4,foot-16],[cx+6,foot-14],[cx+15,foot+2]]);
    const layers=[{yy:top+12,ww:.62,c:'#122b23'},{yy:top+31,ww:1,c:'#15352a'},{yy:top+50,ww:.91,c:'#1d4130'}];
    for(const l of layers){const hw=canopyW*l.ww*.5;poly(ctx,'#10261e',[[cx, l.yy-27],[cx+hw,l.yy+13],[cx+hw-5,l.yy+20],[cx+hw*.35,l.yy+24],[cx-hw,l.yy+17],[cx-hw+4,l.yy+7]]);poly(ctx,l.c,[[cx-3,l.yy-25],[cx+hw*.7,l.yy+8],[cx+hw*.8,l.yy+14],[cx-6,l.yy+15],[cx-hw+7,l.yy+11]]);}
    for(let i=0;i<22;i++){const dx=(hash(x,i)*2-1)*canopyW*.4,dy=hash(y,i)*54;rect(ctx,i%3?'#35603b':'#4a7045',cx+dx,top+dy,4+i%3,2);}
  } else if(kind==='rock'){
    const top=y-Math.max(8,h*.35);
    poly(ctx,'#191d23',[[x-3,foot-5],[x+3,top+10],[x+w*.35,top],[x+w*.78,top+3],[x+w+3,foot-6],[x+w*.75,foot+2],[x+6,foot+3]]);
    poly(ctx,zone==='volcano'?'#484047':'#59605c',[[x+3,foot-7],[x+7,top+11],[x+w*.35,top+3],[x+w*.69,top+5],[x+w*.53,foot-10]]);
    poly(ctx,zone==='volcano'?'#332e38':'#3e4847',[[x+w*.69,top+5],[x+w-2,foot-8],[x+w*.71,foot],[x+w*.53,foot-10]]);
    rect(ctx,zone==='volcano'?'#74534c':'#849087',x+w*.3,top+6,w*.3,2);
    if(zone==='island'){rect(ctx,'#465c3d',x+5,foot-5,w*.3,4);rect(ctx,'#637d47',x+6,foot-5,w*.23,2);}
  } else if(kind==='wall'){
    const rise=Math.min(40,Math.max(20,h));
    rect(ctx,'#151c24',x-2,y-rise-2,w+4,h+rise+3);rect(ctx,zone==='temple'?'#554449':'#4a535c',x,y-rise,w,h+rise);
    for(let yy=y-rise;yy<foot;yy+=14)for(let xx=x;xx<x+w;xx+=28){rect(ctx,'#1c242b',xx,yy,Math.min(28,x+w-xx),1);rect(ctx,'#202830',xx,yy,1,14);rect(ctx,'#75808955',xx+2,yy+2,Math.min(24,x+w-xx-2),1);}
    poly(ctx,'#6b737a',[[x,y-rise],[x+6,y-rise-9],[x+w+6,y-rise-9],[x+w,y-rise]]);
  } else {
    const top=y-Math.max(42,h*.8);
    rect(ctx,'#25272d',x-4,foot-8,w+8,10);rect(ctx,'#666169',x-2,foot-12,w+4,5);rect(ctx,'#393a43',x+3,top+6,w-6,foot-top-18);rect(ctx,'#64626b',x+5,top+8,5,foot-top-23);rect(ctx,'#77717a',x+5,top+8,2,foot-top-23);rect(ctx,'#272d36',x+w-10,top+8,5,foot-top-23);rect(ctx,'#4e4a52',x-1,top,w+2,8);rect(ctx,'#867a7c',x-3,top-4,w+6,5);
    if(kind==='torch'||hash(x,y)>.7){
      rect(ctx,'#2a2122',cx-3,top+17,6,16);rect(ctx,'#9a7546',cx-6,top+19,12,4);
      const f=Math.sin(time*.014+x)*3;poly(ctx,'#d94a21',[[cx-6,top+18],[cx-7,top+4],[cx-3,top-4+f],[cx,top+6],[cx+4,top-5-f],[cx+7,top+13],[cx+4,top+19]]);poly(ctx,'#ffc264',[[cx-3,top+17],[cx-2,top+5],[cx+1,top+9],[cx+4,top+5],[cx+3,top+17]]);
      const glow=ctx.createRadialGradient(cx,top+8,0,cx,top+8,65);glow.addColorStop(0,'#ff832b22');glow.addColorStop(1,'#ff832b00');ctx.fillStyle=glow;ctx.fillRect(cx-65,top-57,130,130);
    }
  }
}

export function drawBillboard(ctx: CanvasRenderingContext2D,x:number,y:number) {
  ctx.save();ctx.translate(x,y);
  rect(ctx,'#231d17',-73,-21,7,63);rect(ctx,'#231d17',65,-21,7,63);
  rect(ctx,'#151816',-88,-52,176,71);rect(ctx,'#9e7741',-85,-50,170,65);rect(ctx,'#382d24',-82,-47,164,59);
  for(let row=0;row<4;row++){rect(ctx,row%2?'#56412a':'#5f482e',-81,-46+row*14,162,13);rect(ctx,'#7c5b34',-79,-44+row*14,158,1);}
  for(const xx of [-78,73])for(const yy of [-42,9]){rect(ctx,'#181c20',xx-3,yy-3,7,7);rect(ctx,'#a0a29a',xx-1,yy-1,2,2);}
  ctx.shadowColor='#1b140d';ctx.shadowOffsetY=2;ctx.font='bold 15px "Noto Sans KR", sans-serif';ctx.textAlign='center';ctx.fillStyle='#f1d99b';ctx.fillText('자~~ 드가자~~~!',0,-21);ctx.font='12px "Noto Sans KR", sans-serif';ctx.fillStyle='#d2c199';ctx.fillText('제작자 : 예수',0,0);ctx.restore();
}
