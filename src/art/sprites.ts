/**
 * 이 게임을 위해 직접 그린 원본 픽셀 스프라이트입니다.
 * 1문자 = 2px. 발 위치를 기준으로 그려 지형/그림자와 맞춥니다.
 * 나중에 스프라이트 시트로 교체하려면 drawSprite의 인터페이스를 유지하세요.
 */
export interface SpriteOptions {
  time: number;
  moving?: boolean;
  attacking?: boolean;
  dead?: boolean;
  facing?: number;
  level?: number;
  enhancement?: number;
}
type Palette = Record<string, string>;
export const spriteKinds = ['knight', 'elf', 'slime', 'werewolf', 'bugbear', 'orc', 'ifrit', 'phoenix', 'vampire', 'cougar'] as const;

function pixels(ctx: CanvasRenderingContext2D, rows: string[], colors: Palette, x: number, y: number) {
  rows.forEach((row, py) => { for (let px = 0; px < row.length; px++) { const color = colors[row[px]]; if (color) { ctx.fillStyle = color; ctx.fillRect(x + px, y + py, 1, 1); } } });
}
function block(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) { ctx.fillStyle=color; ctx.fillRect(x,y,w,h); }

const knightHead = [
  '    OOOO    ',
  '   OHHHHO   ',
  '  OHHHHHHO  ',
  '  OHHLLHHO  ',
  '  OHHLLHHO  ',
  '  ODDDDDDO  ',
  '  OHEDDEHO  ',
  '   OHLHHO   ',
  '   OHOHHO   ',
  '    OOOO    ',
];
const knightBody = [
  '  OOO    OOO  ',
  ' OHHHOOOOHHHO ',
  'OHHHLHHHLHHHHO',
  'OHDOLHHHLODHHO',
  'OHOOLLLLLOOHHO',
  'OHO OLHLO OHHO',
  'OHO OHHHO OHHO',
  ' OO ODDDO  OO ',
  '   OGGGGGO    ',
  '   OHDDHHO    ',
  '   OHDDHHO    ',
  '   OOOOOOO    ',
];
const elfHead = [
  '     OOOO     ',
  '    OHHHHO    ',
  '   OHHLHHHO   ',
  '   OHLLHHHHO  ',
  '  OHHLLHHHHO  ',
  'OSSOSSSSHOSSO ',
  ' OSOSESSHOSO  ',
  '  OSOSSSHSO   ',
  '   OSSSSHHO   ',
  '    OOOHHO    ',
];
const elfBody = [
  '    OOOO    ',
  '   OGGGGO   ',
  '  OGLGGLGO  ',
  ' OSGGLGGGSO ',
  'OSOGGGGGGOSO',
  'OSOOGGGGOOSO',
  'OSO OGGO OSO',
  ' OO ODDO OO ',
  '   OGGGGO   ',
  '  OGLGGGGO  ',
  '  OGGGGGGO  ',
  '   OOOOOO   ',
];
const bonesHead = [
  '   OOOOO   ',
  '  OBBBBBO  ',
  ' OBBHHBBBO ',
  ' OBHBBBHBO ',
  ' OBBOBOBBO ',
  ' OBOOBOOBO ',
  '  OBBDBBO  ',
  '  OBDBDBO  ',
  '   OBBBO   ',
  '    OBO    ',
];
const bonesBody = [
  '  OOO   OOO  ',
  ' OBBBBOBBBBO ',
  'OBBO BBB OBBO',
  'OBO OBDBO OBO',
  'OBO BOBDB OBO',
  'OBO OBDBO OBO',
  'OBO BOBDB OBO',
  ' OO  OBO  OO ',
  '    OBBO     ',
  '   OBBBBO    ',
  '   OBDBBO    ',
  '    OOOO     ',
];

function weapon(ctx: CanvasRenderingContext2D, archer: boolean, enhanced: number, attacking: boolean, t: number, color: string) {
  ctx.save(); ctx.translate(archer ? 9 : 10, -13);
  if (attacking) ctx.rotate(archer ? -.1 : -.9 + Math.sin(t / 60) * .25);
  const gold = enhanced === 10;
  if (gold) { ctx.shadowColor='#ffd769'; ctx.shadowBlur=10; }
  if (archer) {
    const bow = gold ? '#ffe28e' : color;
    block(ctx, '#1b1720', 0,-10,2,20);
    block(ctx, bow,1,-9,2,3); block(ctx,bow,3,-6,2,4); block(ctx,bow,4,-2,2,5); block(ctx,bow,3,3,2,4); block(ctx,bow,1,7,2,3);
    block(ctx,'#b8b3a0',0,-8,1,17); block(ctx,'#7c4727',1,-1,3,3);
    if(attacking) { block(ctx,'#ebdfbe',-7,0,14,1); block(ctx,gold?'#fff2b5':'#c4e3e4',7,-1,3,3); }
  } else {
    block(ctx,'#191d2b',0,-16,3,17); block(ctx,gold?'#fff2c4':'#a4c7ce',0,-15,2,15); block(ctx,gold?'#f3b94d':'#4f7d8e',2,-13,1,13);
    block(ctx,'#e7d5a1',1,-16,1,3); block(ctx,gold?'#e9b64c':'#c4a360',-2,0,7,2); block(ctx,'#6e432f',0,2,3,4); block(ctx,'#edcf82',0,6,3,1);
  }
  ctx.restore();
}
function character(ctx: CanvasRenderingContext2D, kind:string, options:SpriteOptions) {
  const archer=kind==='elf'; const level=options.level??1; const t=options.time;
  const walk=options.moving ? Math.sin(t/85) : 0;
  const gold=level>=90, dark=level>=60, bone=level>=30 && level<60;
  const outline=dark?'#100f20':'#111b25';
  const armor=gold?'#cf9b38':dark?'#333349':'#637c92';
  const light=gold?'#ffe9a4':dark?'#626079':'#b4d0d5';
  const shade=gold?'#735124':dark?'#211f37':'#344c60';
  const cloth=gold?'#f0ddb0':dark?'#442945':archer?'#41664e':'#743b38';
  const pal:Palette={O:outline,H:armor,L:light,D:shade,E:gold?'#fffbd4':dark?'#e15442':'#162637',G:cloth,S:dark&&archer?'#a7a1c5':'#d1a17c',B:'#d4d0b8'};
  // 布/cape spreads with steps, silhouette remains distinct from the armor.
  const cape=[
    '   OOOO   ', '  OGGGGO  ', ' OGGGGGGO ', ' OGGGGGGO ', ' OGGGGGGO ',
    'OGGGGGGGGO', 'OGGGGGGGGO', 'OGGGGGGGGO', 'OGGGGGGGGO', ' OGGGGGGO ', '  OG OG   '
  ];
  pixels(ctx,cape,{O:outline,G:cloth},-5+Math.round(walk),-18);
  // Boots and walking stride are independent of upper-body sprite.
  const leg=bone?'#c8c6af':archer?'#465542':armor;
  block(ctx,outline,-5,-7+Math.round(walk),4,7); block(ctx,leg,-4,-7+Math.round(walk),2,5);
  block(ctx,outline,1,-7-Math.round(walk),4,7); block(ctx,leg,2,-7-Math.round(walk),2,5);
  block(ctx,outline,-6,-2+Math.round(walk),5,2); block(ctx,outline,1,-2-Math.round(walk),5,2);
  block(ctx,bone?'#e6e3ce':light,-5,-2+Math.round(walk),3,1); block(ctx,bone?'#e6e3ce':light,2,-2-Math.round(walk),3,1);
  ctx.save();ctx.translate(0,options.moving?Math.round(Math.abs(walk)):Math.sin(t/700)*.25);
  if (bone) { pixels(ctx,bonesBody,{...pal,B:'#c4c4ae',H:'#f4edd4',D:'#6f7167'},-6,-19); pixels(ctx,bonesHead,{...pal,B:'#d3d3ba',H:'#f6edce',D:'#777566'},-5,-28); }
  else if(archer) {
    pixels(ctx,elfBody,pal,-6,-19);
    pixels(ctx,elfHead,{...pal,H:gold?'#f3ead3':dark?'#d6d4e6':'#b6a66a',L:gold?'#fff6df':dark?'#f2effa':'#e4d39a'},-7,-28);
    if(dark) {block(ctx, gold?'#efd88b':'#292638',-4,-24,7,1);block(ctx,gold?'#fff4b0':'#9c7bba',-1,-25,1,2);}
  } else {
    pixels(ctx,knightBody,pal,-7,-19); pixels(ctx,knightHead,pal,-6,-28);
    if(dark) {block(ctx,armor,-6,-29,2,4);block(ctx,light,-7,-30,2,2);block(ctx,armor,4,-29,2,4);block(ctx,light,5,-30,2,2);}
  }
  weapon(ctx,archer,options.enhancement??0,Boolean(options.attacking),t,gold?'#ecdaaa':dark?'#9180b5':'#bca36e');
  if(!archer){
    const shield=[' OOO ','OHHHO','OHLHO','OHLHO','OHLHO',' OHO ','  O  '];
    pixels(ctx,shield,{O:outline,H:gold?'#b28639':dark?'#3e354f':'#5e7187',L:gold?'#fff0ae':'#c5ac71'},-12,-17);
  }
  if(gold){
    // Tiny orbiting star pixels indicate the final transformation.
    for(let i=0;i<5;i++){const a=t/950+i*1.256;block(ctx,i%2?'#fff1b7':'#b88939',Math.round(Math.cos(a)*16),Math.round(-15+Math.sin(a)*12),1,1);}
  }
  ctx.restore();
}

const slime = [
  '      OOOOOO      ',
  '    OOGGGGGGOO    ',
  '   OGGHHGGGGGGO   ',
  '  OGGHHHGGGGGGGO  ',
  ' OGGHHGGGGGGGGGGO ',
  ' OGGGGGGGGGGGGGGO ',
  'OGGGGGGGGGGGGGGGGO',
  'OGGGEDGGGGGEDGGGGO',
  'OGGGEHGGGGGEHGGGGO',
  'OGGGGGGGGGGGGGGGGO',
  ' OGGGGGDGGGGGGGGO ',
  'OGGGGGGGGGGGGGGGGO',
  ' OODDDDDDDDDDDDOO ',
  '   OOOOOOOOOOOO   ',
];
const werewolf = [
  '   OO        OO   ',
  '   OHO      OHO   ',
  '   OHHOOOOOOHHO   ',
  '    OHHHLHHHHO    ',
  '    OHHLHHHHHO    ',
  '    OHEHHHEHHO    ',
  '     HHSSHHHO     ',
  '    OHHSSSHHO     ',
  '    OHHDDDHO      ',
  '   OHHHBBHHHHO    ',
  '  OHHHHBBHHHHHO   ',
  ' OHHHHHBBHHHHHHO  ',
  'OHHHOHHBBHHHOHHHO ',
  'OHHO OHHBHHO OHHO ',
  'OHHO OHBBHHO OHHO ',
  'OHHO  OHHHO  OHHO ',
  'OBBO  ODDDO  OBBO ',
  'OBBO OHDHDHO OBBO ',
  ' OO OHHOOHHHO OO  ',
  '    OHHO OHHO     ',
  '   OHHHO OHHHO    ',
  '   OBBBO OBBBO    ',
  '    OOO   OOO     ',
];
const bugbear = [
  '    OO      OO    ',
  '   OHHOOOOOOHHO   ',
  '   OHHHHHHHHHHO   ',
  '   OHHHLHHHHHHO   ',
  '   OHEHHHHEHHHO   ',
  '    OHHSSHHHHO    ',
  '    OHSDSHHHO     ',
  '   OHHBDDBHHHO    ',
  '  OHHHHHHHHHHHO   ',
  ' OHHHHHHLHHHHHHO  ',
  'OHHHHOHLHHHHOHHHO ',
  'OHHHHOHHHHHHOHHHO ',
  'OHHHOHHHLHHHHOHHO ',
  'OHHHOHHHLHHHHOHHO ',
  'OHHHOHHHLHHHHOHHO ',
  ' OBBOHHHHHHHHOBO  ',
  '  OOOGGGGGGGGOO   ',
  '    OGGGGGGGGO    ',
  '    OHHOOHHHHO    ',
  '    OHHO OHHHO    ',
  '   OHHHO OHHHHO   ',
  '   ODBBO OBBDDO   ',
  '    OOO   OOOO    ',
];
const orc = [
  '     OOOOOO     ',
  '    OHHHHHHO    ',
  '   OHHLLHHHHO   ',
  '   OHHHHHHHHO   ',
  '   OHEHHHEHHO   ',
  '    HHSSHHHO    ',
  '   OHHBDDBHHO   ',
  '    OHHHHHHO    ',
  '  OOODDDDDDOOO  ',
  ' OGGGDDDDDDGGGO ',
  'OGGGGOHHHHOGGGGO',
  'OHHHOOHHHHOOHHHO',
  'OHHO OHLHHO OHHO',
  'OHHO OHHHHO OHHO',
  'OHHO OHHHHO OHHO',
  ' OO OGGGGGGO OO ',
  '    ODDDDDGO    ',
  '   OGGGGGGGGO   ',
  '   ODDOOODDDO   ',
  '   ODDO ODDDO   ',
  '  ODDDO ODDDDO  ',
  '  OOOOO OOOOOO  ',
];
const ifrit = [
  '      L    L      ',
  '   L  HL  LH  L   ',
  '   HL HHLLHH LH   ',
  '    HHHHHHHHHH    ',
  '    OHHLHHHHO     ',
  '    OHHLHHHHO     ',
  '    OHEHHHEHO     ',
  '    OHHHHHHHO     ',
  '     OHLHHHO      ',
  '   OOHHHHHHHOO    ',
  '  OHHHHLLHHHHHO   ',
  ' OHHHHLLLHHHHHHO  ',
  'OHHHOHLLLHHHOHHHO ',
  'OHHO OHLLHHO OHHO ',
  'OHHO OHHHHHO OHHO ',
  'OHHO OHHHHHO OHHO ',
  ' LH  OHHHHHO  HL  ',
  ' L   OHLLHHO   L  ',
  '      OHHLHO      ',
  '       OHHHO      ',
  '      OHHLHO      ',
  '       OHHHO      ',
  '        LHL       ',
  '         L        ',
];
const vampire = [
  '     OOOOOO     ',
  '    OHHHHHHO    ',
  '   OHHLHHHHHO   ',
  '   OHSSSSSHHO   ',
  '   OHSESSHSHO   ',
  '    OSSSSSHO    ',
  '    OSBDSBO     ',
  '  OO OSSSO OO   ',
  ' OGGGOOOOGGGGO  ',
  ' OGGGOSOOGGGGO  ',
  'OGGGGOLLOGGGGGO ',
  'OGGGGOLLOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  'OGGGGODDOGGGGGO ',
  ' OGGGODDOGGGGO  ',
  '  OGGODDOGGGO   ',
  '   OOO  OOOO    ',
];
const cougar = [
  '      OO  OO              ',
  '      OHO OHO             ',
  '     OHHOOHHO             ',
  '    OHHHHHHHHO            ',
  '    OHLHHHHHHOOOOOO       ',
  '    OHEHHHHHHHHHHHHO      ',
  '   OHHBHHHHHHHHHHHHHOO    ',
  '   OHDHHHHHHHLHHHHHHHHO   ',
  '    OHHHHHHHHHHHHHHHHOHO  ',
  '     OHHHHHHHHHHHHHHHO HO ',
  '      OHHHHHHHHHHHHHO  HO ',
  '      OHHOHHHHHHHHOHO  HO ',
  '      OHHO OHHOOHHO HO OO ',
  '      OHHO OHHO OHHO HO   ',
  '     OHHHO OHHO OHHHOOHO  ',
  '     OBBBO OBBBO OBBBOBO  ',
  '      OOO   OOO   OOO O   ',
];
const phoenixBody = [
  '         LL         ',
  '        LHH L       ',
  '        LHHLH       ',
  '       OHHHH        ',
  '       OHHEHO       ',
  '       OHHHHHBB     ',
  '        OHHHOB      ',
  '       OHHHHHO      ',
  '      OHHLLHHHO     ',
  '      OHLLLHHHO     ',
  '      OHHLLHHHO     ',
  '       OHHHHHO      ',
  '       OHHHHHO      ',
  '        OHHHO       ',
  '       LHHLHHL      ',
  '       LHLLHHL      ',
  '        LHLHL       ',
  '       LHLHL        ',
  '       LHL L        ',
  '        L           ',
];
function monster(ctx:CanvasRenderingContext2D, kind:string, options:SpriteOptions) {
  const t=options.time; const move=options.moving?Math.sin(t/100):Math.sin(t/450)*.35;
  const palettes:Record<string,Palette>={
    slime:{O:'#193b39',G:'#497a51',H:'#8ab96e',D:'#284d3b',E:'#141f26'},
    werewolf:{O:'#1b2028',H:'#656b70',L:'#a3a69b',B:'#d7ccb0',S:'#454a4d',D:'#212730',E:'#e4c34e'},
    bugbear:{O:'#231c1c',H:'#80634d',L:'#b89b6c',B:'#ddcba7',S:'#5c4539',D:'#322c2b',E:'#e3bd5a',G:'#534839'},
    orc:{O:'#1c241e',H:'#69794d',L:'#a2a56a',B:'#e4d3af',S:'#59663e',D:'#343432',E:'#f1be59',G:'#67453d'},
    ifrit:{O:'#502b29',H:'#c46735',L:'#f9ba53',E:'#fff0b3'},
    vampire:{O:'#141624',H:'#252131',L:'#c1bdba',S:'#bbb5ba',B:'#eee6d6',D:'#332735',G:'#663247',E:'#f26a60'},
    cougar:{O:'#302525',H:'#987246',L:'#c8aa6f',B:'#e6d3a4',D:'#4d3d32',E:'#f3d368'},
    phoenix:{O:'#733b32',H:'#db733e',L:'#ffcc72',B:'#ffeca3',E:'#fffbc6'}
  };
  ctx.save();
  if(kind==='slime') {
    const pulse=Math.sin(t/290)*.08;
    ctx.scale(1-pulse,1+pulse);
    pixels(ctx,slime,palettes.slime,-9,-14);
  } else if(kind==='phoenix') {
    const wing=Math.sin(t/120)*3;
    const p=palettes.phoenix;
    for(let side=-1;side<=1;side+=2){
      ctx.save();ctx.scale(side,1);ctx.translate(0,wing);
      pixels(ctx,['     OOO         ','   OOHHHOO       ',' OOHHLHHHHOO     ','OHHLLHHHHHHHOO   ',' OHLLLHHHHHHHHOO ','  OHHLLHHHHHHHHO ','   OHLLHHHHHHHO  ','    OHLLHHHHHO   ','     OHLLHHHO    ','       OLHHO     ','         OO      '],p,3,-23);
      ctx.restore();
    }
    pixels(ctx,phoenixBody,p,-10,-27+move);
  } else {
    const maps:Record<string,string[]>={werewolf,bugbear,orc,ifrit,vampire,cougar};
    const map=maps[kind]??werewolf;
    if(kind==='ifrit'){ctx.shadowColor='#dc772e';ctx.shadowBlur=10;}
    ctx.translate(0,Math.round(move));
    pixels(ctx,map,palettes[kind]??palettes.werewolf,-map[0].length/2,-map.length);
    if(kind==='orc') {
      block(ctx,'#483b31',10,-22,2,22);block(ctx,'#afbac0',8,-23,7,5);block(ctx,'#5b707c',12,-22,4,4);block(ctx,'#e0d5af',8,-24,6,1);
    }
    if(kind==='bugbear') {
      ctx.save();ctx.translate(10,-14);if(options.attacking)ctx.rotate(-.8);
      block(ctx,'#594634',0,-10,3,17);block(ctx,'#8a7150',-1,-10,6,8);block(ctx,'#ad946b',0,-10,2,7);block(ctx,'#4c4137',-1,-4,6,2);ctx.restore();
    }
    if(kind==='vampire' && options.attacking) {block(ctx,'#d6c4c2',-12,-15,5,2);block(ctx,'#d6c4c2',9,-15,5,2);}
    if(kind==='ifrit')for(let i=0;i<5;i++){const phase=((t/90+i*5)%13);block(ctx,i%2?'#f9c467':'#d37136',Math.sin(i*2.9)*12,-phase-2,1,2);}
  }
  ctx.restore();
}

/** Draw original sprite; world coordinates refer to center of feet. */
export function drawSprite(ctx:CanvasRenderingContext2D,kind:string,x:number,y:number,options:SpriteOptions) {
  ctx.save();ctx.translate(Math.round(x),Math.round(y));
  if(options.dead){ctx.globalAlpha*=.4;ctx.rotate(-Math.PI/2);ctx.scale(.8,.8);}
  const direction=(options.facing??1)<0?-1:1;
  ctx.scale(2*direction,2);
  if(options.attacking && kind!=='elf' && kind!=='phoenix')ctx.translate(Math.sin(options.time/65)*1.1,0);
  if(kind==='knight'||kind==='elf')character(ctx,kind,options);else monster(ctx,kind,options);
  ctx.restore();
}
