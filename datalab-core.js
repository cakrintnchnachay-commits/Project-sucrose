// ═══════════════════════════════════════════════════════════
// DATA LAB CORE — shared engine for Meta Lab + Player Lab
//
// One parser, one stats engine, one radar, one router, one
// compare drawer. Both labs are thin pages on top of this.
// Replaces ~40% duplicated code between metalab/playerlab and
// unlocks the previously unused CSV columns:
//   END TYPE (tempo), WEEK (trends), FIRST BLOOD,
//   DRAGON/SLAYER/TOWER (team objective control).
// ═══════════════════════════════════════════════════════════

var DLC_GAMES = null;            // parsed games (single fetch, shared)
var DLC_AGGS  = {};              // tour-filter → aggregate cache
var DLC_CMP   = {type:null, items:[]};   // compare pins
var _DLC_CSS  = false;
var _DLC_LOADCBS = [];

var DLC_SCOUT_GAMES = null;      // ANK Female scout CSV (lazy-loaded)
var DLC_SCOUT_AGGS  = {};        // separate agg cache — no collision with pro
var _DLC_SCOUT_LOADCBS = [];

var DLC_ROLES = ['DSL','JUG','MID','ADL','SUP'];
var DLC_TOURS = ['All', 'RPL Summer', 'GCS Spring', 'AOG Spring', 'APL WC', 'APL 2026'];
var DLC_WEEK_BUCKETS = ['W1','W2','W3','W4','W5','W6','W7','PO'];

// ── Canonical hero names (shared rule with Draft Lab) ───────
var _DLC_ALIAS = {
  'flowbornmage':     'Flowborn (Mage)',
  'flowbornmarksman': 'Flowborn (Marksman)'
};
function _dlcNormKey(n){ return String(n||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function dlcCanon(n){
  if (!n) return n;
  var k = _dlcNormKey(n);
  return _DLC_ALIAS[k] || n;
}

// ── Team logos (was _ML_TEAM_LOGOS in metalab) ───────────────
var DLC_TEAM_LOGOS = {
  BAC:'https://cdnr.escharts.com/uploads/public/633/180/963/6331809632832834626864.png',
  EA:'https://cdnr.escharts.com/uploads/public/641/d93/139/641d931390169216480804.png',
  TEN:'https://cdnr.escharts.com/uploads/public/696/441/177/696441177637d478458365.png',
  HD:'https://cdnr.escharts.com/uploads/public/65b/8ab/67d/65b8ab67d3130531356310.png',
  FS:'https://cdnr.escharts.com/uploads/public/670/bcf/c23/670bcfc235e78874074390.png',
  KOG:'https://cdnr.escharts.com/uploads/public/65b/8ab/2e6/65b8ab2e6c191639738634.png',
  BRU:'https://cdnr.escharts.com/uploads/public/698/e5d/003/698e5d0030bd1935492008.png',
  SLX:'https://cdnr.escharts.com/uploads/public/696/19e/221/69619e2214035062986431.png',
  GJC:'https://cdn-api.pandascore.co/images/team/image/138019/godji_check_allmode.png',
  FW:'https://cdnr.escharts.com/uploads/public/5e3/9ff/28d/5e39ff28df00d239605591.png',
  BMG:'https://cdnr.escharts.com/uploads/public/65d/ede/d85/65deded853423327188368.png',
  ONE:'https://cdnr.escharts.com/uploads/public/632/9e8/1c6/6329e81c623c2125032095.png',
  HKA:'https://cdnr.escharts.com/uploads/public/5ce/598/81c/5ce59881cbc48326077977.png',
  ANK:'https://cdnr.escharts.com/uploads/public/65d/edf/029/65dedf029c6ef904387850.png',
  DCG:'https://cdnr.escharts.com/uploads/public/659/be1/e66/659be1e66fffd240293207.png',
  LIT:'https://cdnr.escharts.com/uploads/public/696/659/26d/69665926d712f401697976.png',
  SGP:'https://cdnr.escharts.com/uploads/public/665/232/a25/665232a257ceb043723956.png',
  '1S':'https://cdnr.escharts.com/uploads/public/65d/ef7/7d4/65def77d41f86056197699.png',
  FPT:'https://cdnr.escharts.com/uploads/public/5ba/238/e7f/5ba238e7f2dca149694156.png',
  GAM:'https://cdnr.escharts.com/uploads/public/697/d4d/92e/697d4d92e1716581967983.png',
  SPN:'https://cdnr.escharts.com/uploads/public/682/1ea/474/6821ea474b5b2434399793.png',
  BOX:'https://cdnr.escharts.com/uploads/public/68d/ecc/251/68decc2513852541929810.png',
  FPL:'https://cdnr.escharts.com/uploads/public/67b/c39/f27/67bc39f27dcb9554580293.png',
  TS:'https://cdnr.escharts.com/uploads/public/5ce/819/ef4/5ce819ef4ad89755496819.png'
};

// ── CSV parsing (extended: endType / week / fb / objectives) ─

function _dlcSplitCSV(line) {
  var f=[], cur='', q=false;
  for (var i=0;i<line.length;i++){
    var c=line[i];
    if (c==='"') q=!q;
    else if (c===','&&!q){f.push(cur);cur='';}
    else cur+=c;
  }
  f.push(cur);
  return f;
}
function _dlcNum(s){ if(s==null)return NaN; return parseFloat(String(s).replace(/,/g,'').trim()); }

function dlcBuildGames(csvText) {
  var lines = csvText.split(/\r?\n/);
  if (!lines.length) return [];
  var headers = _dlcSplitCSV(lines[0]).map(function(h){ return h.trim().replace(/^"|"$/g,''); });
  function ci(n){ return headers.indexOf(n); }
  function get(row,n){ var i=ci(n); return i>=0&&i<row.length ? row[i].trim().replace(/^"|"$/g,'') : ''; }
  var PR = DLC_ROLES;
  var games=[];
  for (var li=1; li<lines.length; li++){
    var line=lines[li].trim();
    if (!line) continue;
    var row=_dlcSplitCSV(line);
    if (isNaN(_dlcNum(get(row,'A DSL KILL')))) continue;
    var dur=_dlcNum(get(row,'END TIME'));
    if (isNaN(dur)||dur<=0) continue;
    var teamA=get(row,'Team A'), teamB=get(row,'Team B');
    var winSide=(get(row,'MATCH WIN')===teamA)?'A':'B';
    var bans={A:[],B:[]};
    ['A','B'].forEach(function(S){
      for (var b=1;b<=4;b++){ var bn=dlcCanon(get(row,S+' BAN '+b)); if(bn) bans[S].push(bn); }
    });
    var goldA=_dlcNum(get(row,'A Gold')); if(isNaN(goldA)) goldA=0;
    var goldB=_dlcNum(get(row,'B Gold')); if(isNaN(goldB)) goldB=0;
    var picks=[], teamKills={A:0,B:0};
    ['A','B'].forEach(function(S){
      PR.forEach(function(R){
        var k=_dlcNum(get(row,S+' '+R+' KILL'));   if(isNaN(k))k=0;
        var d=_dlcNum(get(row,S+' '+R+' DEATH'));  if(isNaN(d))d=0;
        var a=_dlcNum(get(row,S+' '+R+' ASSIST')); if(isNaN(a))a=0;
        var dm=_dlcNum(get(row,S+' '+R+' DMG'));   if(isNaN(dm))dm=0;
        var dt=_dlcNum(get(row,S+' '+R+' DTK'));   if(isNaN(dt))dt=0;
        teamKills[S]+=k;
        picks.push({side:S,role:R,hero:dlcCanon(get(row,S+' '+R)),player:get(row,S+' P '+R),
                    k:k,d:d,a:a,dmg:dm,dtk:dt});
      });
    });
    // NEW: previously unused columns
    var fb=get(row,'FIRST BLOOD');
    function obj(S,col){ var v=_dlcNum(get(row,S+' '+col)); return isNaN(v)?null:v; }
    games.push({
      tour:get(row,'TYPE'), week:get(row,'WEEK'), dur:dur, winSide:winSide,
      teams:{A:teamA,B:teamB}, bans:bans, picks:picks, teamKills:teamKills,
      goldA:goldA, goldB:goldB,
      mvpHero:dlcCanon(get(row,'MVP Hero')), mvpPlayer:get(row,'MVP'),
      endType:get(row,'END TYPE'),
      fb:(fb===teamA)?'A':(fb===teamB)?'B':null,
      obj:{A:{dr:obj('A','DRAGON'),sl:obj('A','SLAYER'),tw:obj('A','TOWER')},
           B:{dr:obj('B','DRAGON'),sl:obj('B','SLAYER'),tw:obj('B','TOWER')}}
    });
  }
  return games;
}

// ── Week → trend bucket ──────────────────────────────────────
function dlcWeekBucket(wk) {
  if (!wk) return null;
  var m = /^w(\d+)/i.exec(wk);
  if (m) { var n=Math.min(+m[1],7); return 'W'+n; }
  if (/^po/i.test(wk)) return 'PO';
  return null;
}

// ── Aggregation (one pass per tournament filter, cached) ─────

function dlcAgg(tour) {
  tour = tour || 'All';
  if (DLC_AGGS[tour]) return DLC_AGGS[tour];
  var games = (DLC_GAMES||[]).filter(function(g){
    if (tour==='All') return true;
    if (g.tour===tour) return true;
    // 'APL WC' and 'APL 2026' both map to TYPE='APL' in the CSV
    if ((tour==='APL WC'||tour==='APL 2026') && g.tour==='APL') return true;
    return false;
  });
  var agg = {tour:tour, total:games.length, blueWins:0,
             heroes:{}, players:{}, teams:{}, pairs:{},
             bucketTotals:{}};

  function H(h){
    if(!agg.heroes[h]) agg.heroes[h]={g:0,w:0,bans:0,roles:{},players:{},
      weeks:{},snow:{g:0,w:0},late:{g:0,w:0},sideA:{g:0,w:0},sideB:{g:0,w:0},
      k:0,d:0,a:0,dmg:0,dtk:0,dur:0,kpSum:0,kpN:0,mvp:0};
    return agg.heroes[h];
  }
  function P(p){
    if(!agg.players[p]) agg.players[p]={g:0,w:0,team:'',roles:{},heroes:{},
      weeks:{},snow:{g:0,w:0},late:{g:0,w:0},sideA:{g:0,w:0},sideB:{g:0,w:0},
      k:0,d:0,a:0,dmg:0,dtk:0,dur:0,kpSum:0,kpN:0,mvp:0};
    return agg.players[p];
  }
  function T(t){
    if(!agg.teams[t]) agg.teams[t]={g:0,w:0,fbG:0,fbW:0,dr:0,sl:0,tw:0,objN:0,
      dur:0,sideA:{g:0,w:0},sideB:{g:0,w:0},snow:{g:0,w:0},late:{g:0,w:0},players:{}};
    return agg.teams[t];
  }

  games.forEach(function(g){
    if (g.winSide==='A') agg.blueWins++;
    var bucket = dlcWeekBucket(g.week);
    if (bucket) agg.bucketTotals[bucket]=(agg.bucketTotals[bucket]||0)+1;
    var isSnow = g.endType==='SNOWBALL';

    ['A','B'].forEach(function(S){
      var won = g.winSide===S;
      var abbr=g.teams[S];
      if (abbr){
        var tm=T(abbr);
        tm.g++; if(won)tm.w++;
        tm.dur+=g.dur;
        tm[S==='A'?'sideA':'sideB'].g++; if(won) tm[S==='A'?'sideA':'sideB'].w++;
        if (g.fb===S){ tm.fbG++; if(won)tm.fbW++; }
        var o=g.obj[S], oo=g.obj[S==='A'?'B':'A'];
        if (o.dr!=null&&oo.dr!=null){ tm.dr+=o.dr-oo.dr; tm.sl+=(o.sl||0)-(oo.sl||0); tm.tw+=(o.tw||0)-(oo.tw||0); tm.objN++; }
        var tmp = tm[isSnow?'snow':'late']; tmp.g++; if(won)tmp.w++;
      }
      (g.bans[S]||[]).forEach(function(h){
        if(!h)return;
        var x=H(h); x.bans++;
        if(bucket){ if(!x.weeks[bucket])x.weeks[bucket]={g:0,bans:0,w:0}; x.weeks[bucket].bans++; }
      });
    });

    g.picks.forEach(function(pk){
      if(!pk.hero) return;
      var won=g.winSide===pk.side;
      var tk=g.teamKills[pk.side];
      [ {o:H(pk.hero), isHero:true}, pk.player?{o:P(pk.player),isHero:false}:null ].forEach(function(ent){
        if(!ent) return;
        var x=ent.o;
        x.g++; if(won)x.w++;
        x.k+=pk.k; x.d+=pk.d; x.a+=pk.a; x.dmg+=pk.dmg; x.dtk+=pk.dtk; x.dur+=g.dur;
        if (tk>0){ x.kpSum+=Math.min((pk.k+pk.a)/tk,1); x.kpN++; }
        if (pk.role) x.roles[pk.role]=(x.roles[pk.role]||0)+1;
        x[pk.side==='A'?'sideA':'sideB'].g++; if(won) x[pk.side==='A'?'sideA':'sideB'].w++;
        var t=x[isSnow?'snow':'late']; t.g++; if(won)t.w++;
        if (bucket){ if(!x.weeks[bucket])x.weeks[bucket]={g:0,bans:0,w:0}; x.weeks[bucket].g++; if(won)x.weeks[bucket].w++; }
      });
      if (g.mvpHero===pk.hero) H(pk.hero).mvp++;
      if (pk.player){
        var pl=P(pk.player);
        pl.team=g.teams[pk.side]||pl.team;
        if (g.mvpPlayer===pk.player) pl.mvp++;
        if(!pl.heroes[pk.hero]) pl.heroes[pk.hero]={g:0,w:0};
        pl.heroes[pk.hero].g++; if(won)pl.heroes[pk.hero].w++;
        var hh=H(pk.hero);
        if(!hh.players[pk.player]) hh.players[pk.player]={g:0,w:0,team:''};
        hh.players[pk.player].g++; if(won)hh.players[pk.player].w++;
        hh.players[pk.player].team=g.teams[pk.side]||hh.players[pk.player].team;
        var abbr=g.teams[pk.side];
        if (abbr){
          var tp=T(abbr).players;
          if(!tp[pk.player]) tp[pk.player]={g:0,roles:{}};
          tp[pk.player].g++;
          if(pk.role) tp[pk.player].roles[pk.role]=(tp[pk.player].roles[pk.role]||0)+1;
        }
      }
    });

    // same-side hero pairs
    ['A','B'].forEach(function(S){
      var won=g.winSide===S;
      var hs=g.picks.filter(function(pk){return pk.side===S&&pk.hero;});
      for(var i=0;i<hs.length;i++) for(var j=i+1;j<hs.length;j++){
        var a=hs[i].hero,b=hs[j].hero;
        var key=a<b?a+'|'+b:b+'|'+a;
        if(!agg.pairs[key]) agg.pairs[key]={g:0,w:0,roles:{}};
        agg.pairs[key].g++; if(won)agg.pairs[key].w++;
        var rk=[hs[i].role,hs[j].role].sort().join('+');
        agg.pairs[key].roles[rk]=(agg.pairs[key].roles[rk]||0)+1;
      }
    });
  });

  agg._pctCache = {};
  DLC_AGGS[tour]=agg;
  return agg;
}

// ── Derived stats ────────────────────────────────────────────

function dlcShrunk(w,g,k){ k=k||10; return (w+k*0.5)/(g+k); }

function dlcDerive(x, total) {       // hero or player raw agg → stat object
  if (!x) return null;
  var s = {
    games:x.g, wins:x.w, wr:x.g?x.w/x.g:0, shrunkWR:dlcShrunk(x.w,x.g),
    kda:(x.k+x.a)/Math.max(x.d,1),
    killsPerMin:x.dur?x.k/x.dur:0, deathsPerMin:x.dur?x.d/x.dur:0,
    minPerDeath:x.d?x.dur/x.d:(x.dur||0),
    dmgPerMin:x.dur?x.dmg/x.dur:0, dtkPerMin:x.dur?x.dtk/x.dur:0,
    kp:x.kpN?(x.kpSum/x.kpN)*100:0,
    mvpRate:x.g?x.mvp/x.g:0, avgDur:x.g?x.dur/x.g:0,
    wrBlue:x.sideA.g?x.sideA.w/x.sideA.g:null,
    wrRed:x.sideB.g?x.sideB.w/x.sideB.g:null,
    snowG:x.snow.g, snowWR:x.snow.g?x.snow.w/x.snow.g:null,
    lateG:x.late.g, lateWR:x.late.g?x.late.w/x.late.g:null
  };
  if (x.bans!=null){
    s.bans=x.bans;
    s.pickRate=total?x.g/total:0;
    s.banRate=total?x.bans/total:0;
    s.presence=total?(x.g+x.bans)/total:0;
  }
  return s;
}

function dlcPrimaryRole(x){
  if(!x) return null;
  var ks=Object.keys(x.roles||{});
  if(!ks.length) return null;
  return ks.reduce(function(a,b){ return x.roles[a]>x.roles[b]?a:b; });
}

// trend: presence (heroes) or games-share (players) per week bucket
function dlcTrend(x, agg, isHero){
  var pts = DLC_WEEK_BUCKETS.map(function(b){
    var tot=agg.bucketTotals[b]||0;
    if(!tot) return null;
    var wx=(x.weeks||{})[b];
    var v = wx ? (isHero ? (wx.g+(wx.bans||0))/tot : wx.g/tot) : 0;
    return {b:b, v:v, n:tot};
  }).filter(Boolean);
  if (pts.length<3) return {pts:pts, arrow:'—', delta:0};
  var half=Math.floor(pts.length/2);
  var early=pts.slice(0,half), late=pts.slice(-half);
  function avg(a){ return a.reduce(function(s,p){return s+p.v;},0)/a.length; }
  var delta=avg(late)-avg(early);
  var arrow = delta>0.03?'▲':delta<-0.03?'▼':'—';
  return {pts:pts, arrow:arrow, delta:delta};
}

// meta score 0-100: WR (shrunk) + presence + trend
function dlcMetaScore(s, trend){
  if (!s||!s.games) return 0;
  var t = trend ? Math.max(-0.1,Math.min(0.1,trend.delta))/0.2+0.5 : 0.5;
  return Math.round(100*(0.5*s.shrunkWR + 0.35*Math.min((s.presence||0)*1.4,1) + 0.15*t));
}

// ── Percentiles / z-scores vs role peers ─────────────────────

function _dlcPeerVals(agg, kind, role, key, minG){
  var ck=kind+'|'+role+'|'+key;
  if (agg._pctCache[ck]) return agg._pctCache[ck];
  var src = kind==='hero'?agg.heroes:agg.players;
  var vals=[];
  Object.keys(src).forEach(function(name){
    var x=src[name];
    if (x.g<(minG||10)) return;
    if (role && dlcPrimaryRole(x)!==role) return;
    var s=dlcDerive(x, agg.total);
    if (s[key]!=null && !isNaN(s[key])) vals.push(s[key]);
  });
  vals.sort(function(a,b){return a-b;});
  agg._pctCache[ck]=vals;
  return vals;
}
function dlcPercentile(agg, kind, role, key, value, minG){
  var vals=_dlcPeerVals(agg, kind, role, key, minG);
  if (vals.length<4||value==null||isNaN(value)) return null;
  var below=0;
  for (var i=0;i<vals.length;i++) if (vals[i]<value) below++;
  return Math.round(100*below/vals.length);
}
function dlcZ(agg, kind, role, key, value, minG){
  var vals=_dlcPeerVals(agg, kind, role, key, minG);
  if (vals.length<4||value==null||isNaN(value)) return null;
  var m=vals.reduce(function(a,b){return a+b;},0)/vals.length;
  var sd=Math.sqrt(vals.reduce(function(a,b){return a+(b-m)*(b-m);},0)/vals.length)||1e-9;
  return (value-m)/sd;
}
function dlcRoleAvg(agg, kind, role, key, minG){
  var vals=_dlcPeerVals(agg, kind, role, key, minG);
  if (!vals.length) return null;
  return vals.reduce(function(a,b){return a+b;},0)/vals.length;
}

// ── Player style read (label + evidence) ─────────────────────

function dlcStyleRead(agg, ign, xOverride){
  // xOverride lets the subject's own rawAgg come from a different pool
  // (e.g. our players) while traits are still computed against the pure
  // pro `agg` passed in. Peer purity is preserved.
  var x=xOverride||agg.players[ign];
  if (!x||x.g<10) return {traits:[{label:'LOW SAMPLE', ev:'fewer than 10 games — style read unreliable'}]};
  var role=dlcPrimaryRole(x);
  var s=dlcDerive(x, agg.total);
  function z(k){ return dlcZ(agg,'player',role,k,s[k]); }
  function pct(k){ var p=dlcPercentile(agg,'player',role,k,s[k]); return p==null?'—':p+'th'; }
  var cand=[];
  var zk=z('killsPerMin'), zd=z('deathsPerMin'), zdmg=z('dmgPerMin'),
      zdtk=z('dtkPerMin'), zkp=z('kp'), zm=z('mvpRate');
  if (zk!=null&&zk>=0.8)  cand.push({pr:zk,label:'AGGRESSIVE FINISHER', ev:'kills/min '+pct('killsPerMin')+' pct of '+role+' ('+s.killsPerMin.toFixed(2)+')'});
  if (zdmg!=null&&zdmg>=0.8) cand.push({pr:zdmg,label:'DAMAGE ENGINE', ev:'DMG/min '+pct('dmgPerMin')+' pct of '+role+' ('+(s.dmgPerMin/1000).toFixed(1)+'k)'});
  if (zdtk!=null&&zdtk>=0.8) cand.push({pr:zdtk,label:'FRONTLINE ANCHOR', ev:'DTK/min '+pct('dtkPerMin')+' pct of '+role+' ('+(s.dtkPerMin/1000).toFixed(1)+'k)'});
  if (zkp!=null&&zkp>=0.8)  cand.push({pr:zkp,label:'TEAMFIGHT PLAYMAKER', ev:'kill participation '+pct('kp')+' pct ('+s.kp.toFixed(0)+'%)'});
  if (zd!=null&&zd<=-0.8)  cand.push({pr:-zd,label:'DISCIPLINED / LOW-RISK', ev:'deaths/min '+pct('deathsPerMin')+' pct — among the lowest in '+role});
  if (zd!=null&&zd>=1.0&&(zk==null||zk<0.5)) cand.push({pr:zd*0.9,label:'HIGH-RISK', ev:'deaths/min above '+role+' peers without matching kill output'});
  if (zm!=null&&zm>=1.0)   cand.push({pr:zm*0.8,label:'MVP MAGNET', ev:'MVP rate '+pct('mvpRate')+' pct ('+Math.round(s.mvpRate*100)+'%)'});
  // tempo trait
  if (s.snowG>=8&&s.lateG>=8&&s.snowWR!=null&&s.lateWR!=null){
    var d=s.snowWR-s.lateWR;
    if (d>=0.12) cand.push({pr:1+d,label:'EARLY TEMPO', ev:'WR '+Math.round(s.snowWR*100)+'% in snowball games vs '+Math.round(s.lateWR*100)+'% in late games'});
    else if (d<=-0.12) cand.push({pr:1-d,label:'LATE-GAME STABILIZER', ev:'WR '+Math.round(s.lateWR*100)+'% in late games vs '+Math.round(s.snowWR*100)+'% in snowball games'});
  }
  cand.sort(function(a,b){return b.pr-a.pr;});
  if (!cand.length) cand=[{label:'BALANCED PROFILE', ev:'no stat deviates strongly from '+role+' peers'}];
  return {traits:cand.slice(0,2), role:role};
}

// ── Hero meta verdict ────────────────────────────────────────

function dlcHeroVerdict(s, trend){
  if (!s||!s.games) return {label:'UNPICKED', cls:'mut', ev:'ban-only or no games in filter'};
  if (s.games<10)  return {label:'LOW SAMPLE', cls:'warn', ev:s.games+' games — read with caution'};
  var pres=s.presence||0, wr=s.wr;
  var rising=trend&&trend.arrow==='▲', falling=trend&&trend.arrow==='▼';
  if (pres>=0.5&&wr>=0.52) return {label:'TOP PRIORITY', cls:'good', ev:Math.round(pres*100)+'% presence at '+Math.round(wr*100)+'% WR — contest or ban'+(rising?', still rising':'')};
  if (pres>=0.5)           return {label:'CONTESTED BUT BEATABLE', cls:'warn', ev:'high presence ('+Math.round(pres*100)+'%) but only '+Math.round(wr*100)+'% WR'};
  if (wr>=0.56&&pres>=0.1) return {label:'SLEEPER PICK', cls:'good', ev:Math.round(wr*100)+'% WR at just '+Math.round(pres*100)+'% presence'+(rising?' — and rising':'')};
  if (falling&&pres>=0.15) return {label:'FALLING OFF', cls:'bad', ev:'presence declining across weeks'};
  if (rising)              return {label:'RISING PICK', cls:'good', ev:'presence climbing across weeks'};
  if (wr<0.45)             return {label:'UNDERPERFORMING', cls:'bad', ev:Math.round(wr*100)+'% WR across '+s.games+' games'};
  return {label:'STABLE / SITUATIONAL', cls:'mut', ev:Math.round(pres*100)+'% presence, '+Math.round(wr*100)+'% WR'};
}

// ── Formatters ───────────────────────────────────────────────

function dlcPct(v,d){ if(v==null||isNaN(v))return '—'; return (v*100).toFixed(d!=null?d:0)+'%'; }
function dlcF(v,d,suf){ if(v==null||isNaN(v))return '—'; return v.toFixed(d!=null?d:2)+(suf||''); }
function dlcFk(v){ if(v==null||isNaN(v))return '—'; return (v/1000).toFixed(1)+'k'; }
function dlcEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── UI building blocks ───────────────────────────────────────

// Stat cell with a delta bar vs role average
function dlcDeltaCell(label, val, avg, fmt, higherBetter){
  var barHtml='';
  if (val!=null && !isNaN(val) && avg!=null && avg>0){
    var rel = Math.max(-1, Math.min(1, (val-avg)/avg));      // ±100% of avg
    var good = higherBetter===false ? rel<0 : rel>0;
    var col = Math.abs(rel)<0.05 ? 'var(--grey-5)' : good ? 'var(--success)' : 'var(--danger)';
    var w = Math.abs(rel)*50;
    barHtml =
      '<div class="dlc-dbar"><div class="dlc-dbar-mid"></div>' +
        '<div class="dlc-dbar-fill" style="'+(rel>=0?'left:50%':'right:50%')+';width:'+w+'%;background:'+col+';"></div>' +
      '</div>' +
      '<div class="dlc-dbar-avg">avg '+fmt(avg)+'</div>';
  }
  return '<div class="hd-alltime-cell">' +
    '<div class="hd-alltime-val">'+fmt(val)+'</div>' +
    '<div class="hd-alltime-lbl">'+label+'</div>' + barHtml +
  '</div>';
}

// tiny SVG sparkline
function dlcSpark(pts, w, h, color){
  if (!pts||pts.length<2) return '';
  w=w||120; h=h||26;
  var max=Math.max.apply(null,pts.map(function(p){return p.v;}))||1;
  var step=w/(pts.length-1);
  var d=pts.map(function(p,i){
    return (i?'L':'M')+(i*step).toFixed(1)+','+(h-2-(p.v/max)*(h-6)).toFixed(1);
  }).join(' ');
  var last=pts[pts.length-1];
  return '<svg width="'+w+'" height="'+h+'" style="display:block;">'+
    '<path d="'+d+'" fill="none" stroke="'+(color||'rgba(100,180,255,0.9)')+'" stroke-width="1.5"/>'+
    '<circle cx="'+((pts.length-1)*step).toFixed(1)+'" cy="'+(h-2-(last.v/max)*(h-6)).toFixed(1)+'" r="2" fill="'+(color||'rgba(100,180,255,1)')+'"/>'+
  '</svg>';
}

// tempo split cell pair
function dlcTempoHtml(s){
  function cell(lbl,wr,g,col){
    return '<div class="dlc-tempo-cell">'+
      '<div class="dlc-tempo-wr" style="color:'+(wr==null?'var(--grey-5)':wr>=0.55?'var(--success)':wr<0.45?'var(--danger)':'var(--white)')+';">'+(wr==null?'—':Math.round(wr*100)+'%')+'</div>'+
      '<div class="dlc-tempo-lbl" style="color:'+col+';">'+lbl+'</div>'+
      '<div class="dlc-tempo-g">'+g+'G</div>'+
    '</div>';
  }
  var tag='';
  if (s.snowG>=8&&s.lateG>=8&&s.snowWR!=null&&s.lateWR!=null){
    var d=s.snowWR-s.lateWR;
    if (d>=0.12) tag='<span class="dlc-tempo-tag">EARLY STOMPER</span>';
    else if (d<=-0.12) tag='<span class="dlc-tempo-tag" style="color:rgba(188,140,255,0.95);border-color:rgba(188,140,255,0.4);">SCALES LATE</span>';
  }
  return '<div class="dlc-tempo">'+
    cell('SNOWBALL (<~14m)', s.snowWR, s.snowG, 'var(--warn)')+
    cell('LATE / GOD GAMES', s.lateWR, s.lateG, 'rgba(188,140,255,0.9)')+
    tag+
  '</div>';
}

// ── Generic radar (multi-series, hover tips) ─────────────────

var DLC_RADAR_AXES = [
  {key:'wr',        label:'Win Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'mvpRate',   label:'MVP Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'kda',       label:'KDA',       fmt:function(v){return v.toFixed(2);}},
  {key:'dmgPerMin', label:'DMG/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'dtkPerMin', label:'DTK/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'kp',        label:'Kill Part', fmt:function(v){return v.toFixed(0)+'%';}}
];
function dlcRadarCaps(){ return {wr:0.75, mvpRate:0.30, kda:5, dmgPerMin:7500, dtkPerMin:7500, kp:75}; }

var DLC_SERIES_COLORS = [
  {stroke:'rgba(100,180,255,0.95)', fill:'rgba(100,180,255,0.15)', dot:'rgba(100,180,255,1)'},
  {stroke:'rgba(255,150,80,0.95)',  fill:'rgba(255,150,80,0.13)',  dot:'rgba(255,150,80,1)'},
  {stroke:'rgba(80,220,140,0.55)',  fill:'rgba(80,220,140,0.08)',  dot:'rgba(80,220,140,0.8)'}
];

function dlcDrawRadar(canvasId, seriesArr, caps, opts){
  var canvas=document.getElementById(canvasId);
  if(!canvas) return;
  caps=caps||dlcRadarCaps();
  var cmp = opts&&opts.compare&&seriesArr.length===2;
  var dpr=window.devicePixelRatio||1;
  var dW=canvas.offsetWidth||280, dH=canvas.offsetHeight||280;
  canvas.width=dW*dpr; canvas.height=dH*dpr;
  canvas.style.width=dW+'px'; canvas.style.height=dH+'px';
  var ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  var n=DLC_RADAR_AXES.length, cx=dW/2, cy=dH/2, R=Math.min(dW,dH)/2-58;
  ctx.clearRect(0,0,dW,dH);
  function ang(i){ return (Math.PI*2*i/n)-Math.PI/2; }
  function pt(i,r){ return {x:cx+r*Math.cos(ang(i)), y:cy+r*Math.sin(ang(i))}; }
  [0.25,0.5,0.75,1].forEach(function(f){
    ctx.beginPath();
    for(var i=0;i<n;i++){var p=pt(i,R*f);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
    ctx.closePath();
    ctx.strokeStyle=f===1?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)';
    ctx.lineWidth=1; ctx.stroke();
  });
  for(var i=0;i<n;i++){var ep=pt(i,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ep.x,ep.y);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.stroke();}
  function norm(v,k){ if(v==null||isNaN(v))return 0; return Math.min(v/(caps[k]||1),1); }
  // reference series drawn first, primary series last (on top)
  seriesArr.forEach(function(ser,si){
    var col=ser.colors||DLC_SERIES_COLORS[si]||DLC_SERIES_COLORS[0];
    ctx.beginPath();
    DLC_RADAR_AXES.forEach(function(ax,i){
      var f=Math.max(norm(ser.vals[ax.key],ax.key),0.03);
      var p=pt(i,R*f);
      i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);
    });
    ctx.closePath();
    ctx.fillStyle=col.fill; ctx.fill();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=2; ctx.stroke();
    DLC_RADAR_AXES.forEach(function(ax,i){
      if(ser.vals[ax.key]==null)return;
      var p=pt(i,R*Math.max(norm(ser.vals[ax.key],ax.key),0.03));
      ctx.beginPath();ctx.arc(p.x,p.y,si===0?4.5:3,0,Math.PI*2);ctx.fillStyle=col.dot;ctx.fill();
    });
  });
  // axis labels. In compare mode the value shown is the HIGHER of the two
  // series, drawn in that series' own colour (no neutral/green).
  var main=seriesArr[0];
  DLC_RADAR_AXES.forEach(function(ax,i){
    var p=pt(i,R+42);
    ctx.textAlign='center';
    ctx.font='500 9px DM Sans,sans-serif'; ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.fillText(ax.label,p.x,p.y);
    if(cmp){
      var va=seriesArr[0].vals[ax.key], vb=seriesArr[1].vals[ax.key];
      var hi=(vb!=null&&(va==null||vb>va))?1:0;     // all radar axes: higher = better
      var v=seriesArr[hi].vals[ax.key];
      if(v!=null&&!isNaN(v)){
        ctx.font='bold 11px "Bebas Neue",sans-serif';
        ctx.fillStyle=(seriesArr[hi].colors||DLC_SERIES_COLORS[hi]).dot;
        ctx.fillText(ax.fmt(v),p.x,p.y+13);
      }
    } else {
      var val=main?main.vals[ax.key]:null;
      if(val!=null&&!isNaN(val)){
        ctx.font='bold 10.5px "Bebas Neue",sans-serif';
        ctx.fillStyle=(main.colors||DLC_SERIES_COLORS[0]).dot;
        ctx.fillText(ax.fmt(val),p.x,p.y+13);
      }
    }
  });
  // hover hits for ALL series. In compare mode each hit carries a combined
  // tooltip: the hovered series large, the other series small.
  var hits=[];
  seriesArr.forEach(function(ser,si){
    DLC_RADAR_AXES.forEach(function(ax,i){
      var v=ser.vals[ax.key];
      if(v==null||isNaN(v))return;
      var p=pt(i,R*Math.max(norm(v,ax.key),0.03));
      var hit={x:p.x,y:p.y,label:(ser.name?ser.name+' · ':'')+ax.label,value:ax.fmt(v)};
      if(cmp){
        var other=seriesArr[1-si];
        var cv=ser.colors||DLC_SERIES_COLORS[si], co=other.colors||DLC_SERIES_COLORS[1-si];
        var ov=other.vals[ax.key];
        hit.html='<div class="hd-radar-tip-lbl">'+ax.label+'</div>'+
          '<div class="hd-radar-tip-val" style="color:'+cv.dot+';">'+(ser.name?ser.name+' · ':'')+ax.fmt(v)+'</div>'+
          (ov!=null&&!isNaN(ov)?'<div class="hd-radar-tip-sub" style="color:'+co.dot+';">'+(other.name?other.name+' · ':'')+ax.fmt(ov)+'</div>':'');
      }
      hits.push(hit);
    });
  });
  canvas._dlcHits=hits;
  _dlcRadarEvents(canvas);
}
function _dlcRadarEvents(canvas){
  if (canvas._dlcBound) return;
  canvas._dlcBound=true;
  var tip=document.getElementById(canvas.id+'-tip');
  function getHit(mx,my){
    var best=null,bd=22;
    (canvas._dlcHits||[]).forEach(function(h){
      var d=Math.hypot(h.x-mx,h.y-my);
      if(d<bd){best=h;bd=d;}
    });
    return best;
  }
  function show(ex,ey,hit){
    if(!tip)return;
    tip.innerHTML=hit.html||('<div class="hd-radar-tip-lbl">'+hit.label+'</div><div class="hd-radar-tip-val">'+hit.value+'</div>');
    var wr=tip.parentElement.getBoundingClientRect(), cr=canvas.getBoundingClientRect();
    var tx=ex+(cr.left-wr.left)+14, ty=ey+(cr.top-wr.top)-30;
    if(tx+150>wr.width-4)tx=ex+(cr.left-wr.left)-160;
    tip.style.left=Math.max(4,tx)+'px'; tip.style.top=Math.max(4,ty)+'px';
    tip.style.display='block';
  }
  canvas.addEventListener('mousemove',function(e){
    var r=canvas.getBoundingClientRect();
    var hit=getHit(e.clientX-r.left,e.clientY-r.top);
    canvas.style.cursor=hit?'pointer':'default';
    if(hit)show(e.clientX-r.left,e.clientY-r.top,hit);
    else if(tip)tip.style.display='none';
  });
  canvas.addEventListener('mouseleave',function(){ if(tip)tip.style.display='none'; });
  canvas.addEventListener('touchstart',function(e){
    e.preventDefault();
    var r=canvas.getBoundingClientRect(),t=e.touches[0];
    var hit=getHit(t.clientX-r.left,t.clientY-r.top);
    if(hit)show(t.clientX-r.left,t.clientY-r.top,hit);
    else if(tip)tip.style.display='none';
  },{passive:false});
}

// ── Entity router: any hero/player name anywhere is a link ───

function dlcOpen(type, name){
  if (typeof showPage==='function') showPage('page-data-center');
  if (typeof dcSetTab==='function') dcSetTab(type==='hero'?'metalab':'playerlab');
  setTimeout(function(){
    if (type==='hero' && typeof mlSelectHero==='function') mlSelectHero(name);
    if (type==='player' && typeof plSelectPlayer==='function') plSelectPlayer(name);
  }, 40);
}
function dlcHeroLink(h, inner){
  return '<span class="dlc-link" onclick="event.stopPropagation();dlcOpen(\'hero\',\''+dlcEsc(h).replace(/'/g,"\\'")+'\')">'+(inner||dlcEsc(h))+'</span>';
}
function dlcPlayerLink(p, inner){
  return '<span class="dlc-link" onclick="event.stopPropagation();dlcOpen(\'player\',\''+dlcEsc(p).replace(/'/g,"\\'")+'\')">'+(inner||dlcEsc(p))+'</span>';
}

// ── Compare drawer (shared, hero-vs-hero / player-vs-player) ─

function dlcCmpToggle(type, name){
  if (DLC_CMP.type!==type){ DLC_CMP={type:type, items:[]}; }
  var i=DLC_CMP.items.indexOf(name);
  if (i>=0) DLC_CMP.items.splice(i,1);
  else {
    DLC_CMP.items.push(name);
    if (DLC_CMP.items.length>2) DLC_CMP.items.shift();
  }
  dlcRenderCmp();
  if (typeof mlRenderDetail==='function') mlRenderDetail();
  if (typeof plRenderDetail==='function') plRenderDetail();
}
function dlcCmpClear(){ DLC_CMP={type:null,items:[]}; dlcRenderCmp(); }
function dlcCmpBtn(type, name){
  // Opens the dedicated Compare sub-tab with this entity preloaded as
  // subject A (replaces the old cramped pin-and-drawer flow).
  return '<button class="tier-mode-btn" style="font-size:8px;padding:5px 12px;letter-spacing:1px;" '+
    'onclick="dlcCompareFrom(\''+type+'\',\''+dlcEsc(name).replace(/'/g,"\\'")+'\')">'+
    '⚖ COMPARE '+(type==='hero'?'HERO':'PLAYER')+'</button>';
}

function _dlcCmpStats(type, name, agg){
  var x = type==='hero'?agg.heroes[name]:agg.players[name];
  return dlcDerive(x, agg.total);
}

function dlcRenderCmp(){
  _dlcInjectCss();
  var el=document.getElementById('dlc-cmp');
  if(!el){
    el=document.createElement('div');
    el.id='dlc-cmp';
    document.body.appendChild(el);
  }
  if (!DLC_CMP.type || DLC_CMP.items.length===0){ el.style.display='none'; return; }
  el.style.display='block';
  var tour = DLC_CMP.type==='hero'
    ? (typeof ML_TOUR!=='undefined'?ML_TOUR:'All')
    : (typeof PL_TOUR!=='undefined'?PL_TOUR:'All');
  var agg=dlcAgg(tour);

  if (DLC_CMP.items.length===1){
    el.innerHTML='<div class="dlc-cmp-bar">'+
      '<span class="dlc-cmp-tag">COMPARE</span>'+
      '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">'+dlcEsc(DLC_CMP.items[0])+'</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">pin one more '+DLC_CMP.type+' to compare</span>'+
      '<button class="tier-mode-btn" style="margin-left:auto;" onclick="dlcCmpClear()">✕</button>'+
    '</div>';
    return;
  }

  var A=DLC_CMP.items[0], B=DLC_CMP.items[1];
  var sA=_dlcCmpStats(DLC_CMP.type,A,agg), sB=_dlcCmpStats(DLC_CMP.type,B,agg);
  if(!sA||!sB){ el.style.display='none'; return; }

  var rows=[
    ['WIN RATE', 'wr', dlcPct, true], ['GAMES','games',function(v){return String(v);},true],
    ['KDA','kda',dlcF,true], ['KILLS/MIN','killsPerMin',dlcF,true],
    ['DEATHS/MIN','deathsPerMin',dlcF,false],
    ['DMG/MIN','dmgPerMin',dlcFk,true], ['DTK/MIN','dtkPerMin',dlcFk,true],
    ['KILL PART','kp',function(v){return dlcPct(v/100,1);},true],
    ['MVP RATE','mvpRate',dlcPct,true], ['AVG LENGTH','avgDur',function(v){return dlcF(v,1,'m');},null]
  ];
  if (DLC_CMP.type==='hero'){ rows.splice(2,0,['PRESENCE','presence',dlcPct,true]); }

  var tbl=rows.map(function(r){
    var va=sA[r[1]], vb=sB[r[1]];
    var ca='var(--white)', cb='var(--white)';
    if (r[3]!=null && va!=null && vb!=null && Math.abs(va-vb)>1e-9){
      var aBetter = r[3] ? va>vb : va<vb;
      ca=aBetter?'var(--success)':'var(--grey-5)';
      cb=aBetter?'var(--grey-5)':'var(--success)';
    }
    return '<div class="dlc-cmp-row">'+
      '<div style="color:'+ca+';text-align:right;">'+r[2](va)+'</div>'+
      '<div class="dlc-cmp-stat">'+r[0]+'</div>'+
      '<div style="color:'+cb+';">'+r[2](vb)+'</div>'+
    '</div>';
  }).join('');

  // extra panel: duo synergy (heroes) or common heroes (players)
  var extra='';
  if (DLC_CMP.type==='hero'){
    var key=A<B?A+'|'+B:B+'|'+A;
    var pr=agg.pairs[key];
    if (pr&&pr.g>=5){
      var exp=(sA.shrunkWR+sB.shrunkWR)/2;
      var lift=dlcShrunk(pr.w,pr.g,8)-exp;
      extra='<div class="dlc-cmp-extra">AS A DUO: '+pr.g+'G · '+Math.round(100*pr.w/pr.g)+'% WR · lift '+(lift>=0?'+':'')+Math.round(lift*100)+' vs expected</div>';
    } else {
      extra='<div class="dlc-cmp-extra" style="color:var(--grey-5);">rarely played together ('+(pr?pr.g:0)+'G)</div>';
    }
  } else {
    var common=[];
    var pa=agg.players[A], pb=agg.players[B];
    if (pa&&pb) Object.keys(pa.heroes).forEach(function(h){
      var ha=pa.heroes[h], hb=pb.heroes[h];
      if (ha&&hb&&ha.g>=3&&hb.g>=3) common.push({h:h, a:ha, b:hb});
    });
    common.sort(function(x,y){ return (y.a.g+y.b.g)-(x.a.g+x.b.g); });
    if (common.length){
      extra='<div class="dlc-cmp-extra">SHARED POOL: '+common.slice(0,4).map(function(c){
        return dlcEsc(c.h)+' ('+Math.round(100*c.a.w/c.a.g)+'% vs '+Math.round(100*c.b.w/c.b.g)+'%)';
      }).join(' · ')+'</div>';
    }
  }

  el.innerHTML=
    '<div class="dlc-cmp-bar">'+
      '<span class="dlc-cmp-tag">COMPARE</span>'+
      '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:15px;color:rgba(100,180,255,1);">'+dlcEsc(A)+'</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">vs</span>'+
      '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:15px;color:rgba(255,150,80,1);">'+dlcEsc(B)+'</span>'+
      '<button class="tier-mode-btn" style="margin-left:auto;font-size:7px;" onclick="document.getElementById(\'dlc-cmp\').classList.toggle(\'min\')">▁▔</button>'+
      '<button class="tier-mode-btn" onclick="dlcCmpClear()">✕</button>'+
    '</div>'+
    '<div class="dlc-cmp-body">'+
      '<div class="dlc-cmp-radar"><canvas id="dlc-cmp-canvas" width="260" height="240"></canvas>'+
        '<div class="hd-radar-tip" id="dlc-cmp-canvas-tip"></div></div>'+
      '<div class="dlc-cmp-table">'+tbl+'</div>'+
    '</div>'+extra;

  setTimeout(function(){
    dlcDrawRadar('dlc-cmp-canvas', [
      {name:A, vals:sA, colors:DLC_SERIES_COLORS[0]},
      {name:B, vals:sB, colors:DLC_SERIES_COLORS[1]}
    ]);
  }, 30);
}

// ═════════════════════════════════════════════════════════════
// DEDICATED COMPARE VIEW (full Data Center sub-tab)
// Players-vs-players or heroes-vs-heroes. Two dropdown pickers,
// competition filter, enlarged overlaid radar, diverging delta
// bars + value table, duo-synergy / shared-pool context.
// ═════════════════════════════════════════════════════════════

var DLC_CMP2 = {type:'player', tour:'All', a:null, b:null};
var _DLC_CMP2_CSS = false;
var _DLC_CMP2_Q = {a:'', b:''};   // live search text per picker
var _DLC_CMP2_BOUND = false;      // outside-click handler bound once

// stat rows: [label, key, formatter, dir]  dir: true=higher better,
// false=lower better, null=neutral (no winner highlight)
function _dlcCmp2Rows(type){
  var rows=[
    ['WIN RATE','wr',function(v){return dlcPct(v);},true],
    ['GAMES','games',function(v){return String(v);},null],
    ['KDA','kda',function(v){return dlcF(v);},true],
    ['KILLS / MIN','killsPerMin',function(v){return dlcF(v);},true],
    ['DEATHS / MIN','deathsPerMin',function(v){return dlcF(v);},false],
    ['DMG / MIN','dmgPerMin',dlcFk,true],
    ['DTK / MIN','dtkPerMin',dlcFk,true],
    ['KILL PART','kp',function(v){return dlcF(v,0)+'%';},true],
    ['MVP RATE','mvpRate',function(v){return dlcPct(v);},true],
    ['AVG LENGTH','avgDur',function(v){return dlcF(v,1)+'m';},null]
  ];
  if (type==='hero') rows.splice(2,0,['PRESENCE','presence',function(v){return dlcPct(v);},true]);
  return rows;
}

function _dlcCmp2Label(){ return DLC_CMP2.type==='hero'?'hero':'player'; }

// display label for a key; our players ('@id') resolve to their nick
function _dlcCmp2DisplayName(key, agg){
  return (typeof ourDisplayName==='function') ? ourDisplayName(key, agg) : key;
}

// entities (with >=3 games) for the current type+tour, sorted by games desc.
// For players, our roster (keys starting '@') is grouped first.
function _dlcCmp2Entities(agg){
  var src = DLC_CMP2.type==='hero'?agg.heroes:agg.players;
  return Object.keys(src).filter(function(n){ return n && src[n].g>=3; })
    .sort(function(a,b){
      if (typeof ourIsKey==='function'){
        var ao=ourIsKey(a), bo=ourIsKey(b);
        if (ao!==bo) return ao?-1:1;
      }
      return src[b].g-src[a].g || a.toLowerCase().localeCompare(b.toLowerCase());
    });
}

// agg backing the Compare pickers/table. Players view merges our roster in
// for DISPLAY only (peer-stat code still uses the pure dlcAgg elsewhere).
function _dlcCmp2Agg(){
  return (DLC_CMP2.type==='player' && typeof dlcAggWithOurs==='function')
    ? dlcAggWithOurs(DLC_CMP2.tour, OUR_FILTER)
    : dlcAgg(DLC_CMP2.tour);
}

function dlcCmp2SetType(t){
  if (DLC_CMP2.type===t) return;
  DLC_CMP2={type:t, tour:DLC_CMP2.tour, a:null, b:null};
  dlcCompareRender();
}
function dlcCmp2SetTour(t){ DLC_CMP2.tour=t; dlcCompareRender(); }
function dlcCmp2Pick(side,name){ DLC_CMP2[side]=name||null; _DLC_CMP2_Q[side]=''; dlcCompareRender(); }
function dlcCmp2Swap(){ var a=DLC_CMP2.a; DLC_CMP2.a=DLC_CMP2.b; DLC_CMP2.b=a; dlcCompareRender(); }
function dlcCmp2Clear(){ DLC_CMP2.a=null; DLC_CMP2.b=null; dlcCompareRender(); }

// entry from a detail page's COMPARE button: jump to the tab with
// the entity preselected as side A
function dlcCompareFrom(type, name){
  if (DLC_CMP2.type!==type){ DLC_CMP2={type:type, tour:DLC_CMP2.tour, a:null, b:null}; }
  DLC_CMP2.a=name;
  if (typeof showPage==='function') showPage('page-data-center');
  if (typeof dcSetTab==='function') dcSetTab('compare');
  else dlcCompareInit();
}

function dlcCompareInit(){
  _dlcCmp2Css();
  if (!_DLC_CMP2_BOUND && document.addEventListener){
    _DLC_CMP2_BOUND=true;
    document.addEventListener('mousedown', function(e){
      if (!e.target || !e.target.closest || !e.target.closest('.dlc-c2-combo')) _dlcCmp2CloseLists();
    });
  }
  var root=document.getElementById('dlc-compare-root');
  if (DLC_GAMES){ dlcCompareRender(); return; }
  if (root) root.innerHTML='<div class="dlc-c2-msg">Loading pro data…</div>';
  dlcEnsure(function(err){
    if (err){ if(root) root.innerHTML='<div class="dlc-c2-msg" style="color:var(--danger);">Failed to load data.<br>'+dlcEsc(err.message)+'</div>'; return; }
    dlcCompareRender();
  });
}

// ── Searchable picker (combobox) ─────────────────────────────
function _dlcCmp2Combo(side, sel, ents){
  var col = side==='a'?DLC_SERIES_COLORS[0]:DLC_SERIES_COLORS[1];
  var lbl = side==='a'?'SUBJECT A':'SUBJECT B';
  var ph  = 'Search '+_dlcCmp2Label()+'… ('+ents.length+')';
  var s   = side.replace(/'/g,'');
  return '<div class="dlc-c2-pick">'+
    '<label class="dlc-c2-pick-lbl" style="color:'+col.dot+';">'+lbl+'</label>'+
    '<div class="dlc-c2-combo">'+
      '<input class="input dlc-c2-cinput" id="dlc-c2-cinput-'+s+'" autocomplete="off" '+
        'placeholder="'+ph+'" value="'+(sel?dlcEsc(_dlcCmp2DisplayName(sel)):'')+'" '+
        'onfocus="this.select();dlcCmp2Open(\''+s+'\')" '+
        'oninput="dlcCmp2Filter(\''+s+'\',this.value)" />'+
      (sel?'<button class="dlc-c2-cclear" title="Clear" onmousedown="event.preventDefault();dlcCmp2Pick(\''+s+'\',\'\')">✕</button>'
          :'<span class="dlc-c2-ccaret">▾</span>')+
      '<div class="dlc-c2-clist" id="dlc-c2-clist-'+s+'" style="display:none;"></div>'+
    '</div>'+
  '</div>';
}
function _dlcCmp2RenderList(side){
  var el=document.getElementById('dlc-c2-clist-'+side);
  if(!el) return;
  var agg=_dlcCmp2Agg();
  var src=DLC_CMP2.type==='hero'?agg.heroes:agg.players;
  var other = side==='a'?DLC_CMP2.b:DLC_CMP2.a;
  var sel   = side==='a'?DLC_CMP2.a:DLC_CMP2.b;
  var q=(_DLC_CMP2_Q[side]||'').toLowerCase();
  var list=_dlcCmp2Entities(agg).filter(function(e){
    return e!==other && _dlcCmp2DisplayName(e,agg).toLowerCase().indexOf(q)>=0;
  }).slice(0,80);
  if(!list.length){ el.innerHTML='<div class="dlc-c2-cempty">no match</div>'; el.style.display='block'; return; }
  el.innerHTML=list.map(function(e){
    var nm=dlcEsc(_dlcCmp2DisplayName(e,agg));
    var tag=(typeof ourIsKey==='function'&&ourIsKey(e))?'<span class="dlc-c2-cours">OURS</span>':'';
    return '<div class="dlc-c2-citem'+(e===sel?' on':'')+'" '+
      'onmousedown="event.preventDefault();dlcCmp2Pick(\''+side+'\',\''+dlcEsc(e).replace(/'/g,"\\'")+'\')">'+
      '<span>'+tag+nm+'</span><span class="dlc-c2-cg">'+src[e].g+'g</span></div>';
  }).join('');
  el.style.display='block';
}
function dlcCmp2Open(side){
  ['a','b'].forEach(function(s){ if(s!==side){ var o=document.getElementById('dlc-c2-clist-'+s); if(o)o.style.display='none'; } });
  _DLC_CMP2_Q[side]='';
  _dlcCmp2RenderList(side);
}
function dlcCmp2Filter(side, q){ _DLC_CMP2_Q[side]=q||''; _dlcCmp2RenderList(side); }
function _dlcCmp2CloseLists(){ ['a','b'].forEach(function(s){ var o=document.getElementById('dlc-c2-clist-'+s); if(o)o.style.display='none'; }); }

function dlcCompareRender(){
  _dlcCmp2Css();
  var root=document.getElementById('dlc-compare-root');
  if (!root || !DLC_GAMES) return;
  var agg=_dlcCmp2Agg();           // players view merges our roster (display-only)
  var type=DLC_CMP2.type;
  var ents=_dlcCmp2Entities(agg);
  if (DLC_CMP2.a && ents.indexOf(DLC_CMP2.a)<0) DLC_CMP2.a=null;
  if (DLC_CMP2.b && ents.indexOf(DLC_CMP2.b)<0) DLC_CMP2.b=null;
  var A=DLC_CMP2.a, B=DLC_CMP2.b;

  var COL_A=DLC_SERIES_COLORS[0], COL_B=DLC_SERIES_COLORS[1];

  // ── controls: type toggle + competition filter ──
  var typeToggle=[['player','Players'],['hero','Heroes']].map(function(t){
    return '<button class="tier-mode-btn'+(type===t[0]?' active':'')+'" onclick="dlcCmp2SetType(\''+t[0]+'\')">'+t[1]+'</button>';
  }).join('');
  var tourBtns=DLC_TOURS.map(function(t){
    return '<button class="tier-mode-btn'+(t===DLC_CMP2.tour?' active':'')+'" onclick="dlcCmp2SetTour(\''+dlcEsc(t).replace(/'/g,"\\'")+'\')">'+dlcEsc(t)+'</button>';
  }).join('');

  // ── pickers (searchable, sorted by games) ──
  _DLC_CMP2_Q={a:'',b:''};
  var pickers=
    '<div class="dlc-c2-pickrow">'+
      _dlcCmp2Combo('a', A, ents)+
      '<button class="dlc-c2-swap" title="Swap" onclick="dlcCmp2Swap()">⇄</button>'+
      _dlcCmp2Combo('b', B, ents)+
    '</div>';

  // our-games scope row: only relevant when comparing players and we have data
  var ourRow = (type==='player' && typeof ourScopeControls==='function' && ourHasData())
    ? ourScopeControls('dlcCompareRender') : '';

  var controls=
    '<div class="dlc-c2-controls">'+
      '<div class="dlc-c2-ctl-row">'+
        '<span class="dlc-c2-ctl-lbl">COMPARE</span>'+
        '<div class="dlc-c2-btns">'+typeToggle+'</div>'+
        '<span class="dlc-c2-ctl-lbl" style="margin-left:14px;">COMPETITION</span>'+
        '<div class="dlc-c2-btns">'+tourBtns+'</div>'+
        (A||B?'<button class="tier-mode-btn dlc-c2-reset" onclick="dlcCmp2Clear()">Reset</button>':'')+
      '</div>'+
      ourRow+
      pickers+
    '</div>';

  // ── not-ready states ──
  if (!A || !B){
    var hint = (!A && !B) ? 'Pick two '+_dlcCmp2Label()+'s above to compare them side by side.'
             : 'Pick one more '+_dlcCmp2Label()+' to compare.';
    root.innerHTML=controls+
      '<div class="dlc-c2-empty">'+
        '<div class="dlc-c2-empty-icon">⚖</div>'+
        '<div class="dlc-c2-empty-txt">'+hint+'</div>'+
      '</div>';
    return;
  }

  // ── both selected: full comparison ──
  var sA=dlcDerive(type==='hero'?agg.heroes[A]:agg.players[A], agg.total);
  var sB=dlcDerive(type==='hero'?agg.heroes[B]:agg.players[B], agg.total);
  var rows=_dlcCmp2Rows(type);

  var tbl=rows.map(function(r){
    var key=r[1], fmt=r[2], dir=r[3];
    var va=sA[key], vb=sB[key];
    var mx=Math.max(va||0, vb||0, 1e-9);
    var fa=Math.max(0,Math.min(100,Math.round(100*(va||0)/mx)));
    var fb=Math.max(0,Math.min(100,Math.round(100*(vb||0)/mx)));
    var ca='var(--white)', cb='var(--white)';
    if (dir!=null && va!=null && vb!=null && Math.abs(va-vb)>1e-9){
      var aWins = dir ? va>vb : va<vb;          // winner shown in its OWN colour
      ca=aWins?COL_A.dot:'var(--grey-5)';
      cb=aWins?'var(--grey-5)':COL_B.dot;
    }
    return '<div class="dlc-c2-row">'+
      '<div class="dlc-c2-val" style="color:'+ca+';">'+fmt(va)+'</div>'+
      '<div class="dlc-c2-mid">'+
        '<div class="dlc-c2-rlbl">'+r[0]+'</div>'+
        '<div class="dlc-c2-bars">'+
          '<div class="dlc-c2-bar dlc-c2-bar-l"><span style="width:'+fa+'%;background:'+COL_A.dot+';"></span></div>'+
          '<div class="dlc-c2-bar dlc-c2-bar-r"><span style="width:'+fb+'%;background:'+COL_B.dot+';"></span></div>'+
        '</div>'+
      '</div>'+
      '<div class="dlc-c2-val" style="color:'+cb+';text-align:left;">'+fmt(vb)+'</div>'+
    '</div>';
  }).join('');

  // ── context: duo synergy (heroes) or shared pool (players) ──
  var extra='';
  if (type==='hero'){
    var pkey=A<B?A+'|'+B:B+'|'+A;
    var pr=agg.pairs[pkey];
    if (pr && pr.g>=5){
      var exp=(sA.shrunkWR+sB.shrunkWR)/2;
      var lift=dlcShrunk(pr.w,pr.g,8)-exp;
      extra='<div class="dlc-c2-extra"><span class="dlc-c2-extra-tag">AS A DUO</span>'+
        pr.g+' games · '+Math.round(100*pr.w/pr.g)+'% win rate · '+
        (lift>=0?'+':'')+Math.round(lift*100)+' pts vs expected</div>';
    } else {
      extra='<div class="dlc-c2-extra muted">Rarely drafted together ('+(pr?pr.g:0)+' games) — duo synergy not meaningful.</div>';
    }
  } else {
    var common=[];
    var pa=agg.players[A], pb=agg.players[B];
    if (pa&&pb) Object.keys(pa.heroes).forEach(function(h){
      var ha=pa.heroes[h], hb=pb.heroes[h];
      if (ha&&hb&&ha.g>=3&&hb.g>=3) common.push({h:h,a:ha,b:hb});
    });
    common.sort(function(x,y){ return (y.a.g+y.b.g)-(x.a.g+x.b.g); });
    if (common.length){
      extra='<div class="dlc-c2-extra"><span class="dlc-c2-extra-tag">SHARED POOL</span>'+
        common.slice(0,5).map(function(c){
          return dlcEsc(c.h)+' ('+Math.round(100*c.a.w/c.a.g)+'% vs '+Math.round(100*c.b.w/c.b.g)+'%)';
        }).join(' · ')+'</div>';
    } else {
      extra='<div class="dlc-c2-extra muted">No heroes played 3+ times by both.</div>';
    }
  }

  var nameA=_dlcCmp2DisplayName(A,agg), nameB=_dlcCmp2DisplayName(B,agg);
  var caveat=(typeof ourCaveatBanner==='function')?ourCaveatBanner([A,B]):'';

  root.innerHTML=controls+
    '<div class="dlc-c2-head">'+
      '<span class="dlc-c2-name" style="color:'+COL_A.dot+';">'+dlcEsc(nameA)+'</span>'+
      '<span class="dlc-c2-vs">VS</span>'+
      '<span class="dlc-c2-name" style="color:'+COL_B.dot+';text-align:left;">'+dlcEsc(nameB)+'</span>'+
    '</div>'+
    '<div class="dlc-c2-body">'+
      '<div class="dlc-c2-radar">'+
        '<canvas id="dlc-c2-canvas" width="380" height="360"></canvas>'+
        '<div class="hd-radar-tip" id="dlc-c2-canvas-tip"></div>'+
        '<div class="dlc-c2-legend">'+
          '<span><i style="background:'+COL_A.dot+';"></i>'+dlcEsc(nameA)+'</span>'+
          '<span><i style="background:'+COL_B.dot+';"></i>'+dlcEsc(nameB)+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="dlc-c2-table">'+tbl+'</div>'+
    '</div>'+extra+caveat;

  setTimeout(function(){
    dlcDrawRadar('dlc-c2-canvas', [
      {name:nameA, vals:sA, colors:COL_A},
      {name:nameB, vals:sB, colors:COL_B}
    ], null, {compare:true});
  }, 30);
}

function _dlcCmp2Css(){
  if (_DLC_CMP2_CSS) return;
  _DLC_CMP2_CSS=true;
  var css=
  '#dlc-compare-root{padding:0 0 70px;}'+
  '.dlc-c2-msg{padding:24px;font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:1px;color:var(--grey-5);}'+
  '.dlc-c2-controls{padding:14px 20px;border-bottom:var(--border);}'+
  '.dlc-c2-ctl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'+
  '.dlc-c2-ctl-lbl{font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-5);}'+
  '.dlc-c2-btns{display:flex;gap:3px;flex-wrap:wrap;}'+
  '.dlc-c2-reset{margin-left:auto;}'+
  '.dlc-c2-pickrow{display:flex;align-items:flex-end;gap:14px;margin-top:14px;}'+
  '.dlc-c2-pick{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0;}'+
  '.dlc-c2-pick-lbl{font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;}'+
  '.dlc-c2-select{margin:0;width:100%;font-size:13px;padding:9px 10px;}'+
  '.dlc-c2-combo{position:relative;}'+
  '.dlc-c2-cinput{margin:0;width:100%;font-size:13px;padding:9px 28px 9px 10px;}'+
  '.dlc-c2-ccaret{position:absolute;right:10px;top:10px;color:var(--grey-5);pointer-events:none;font-size:11px;}'+
  '.dlc-c2-cclear{position:absolute;right:5px;top:5px;background:transparent;border:none;color:var(--grey-5);cursor:pointer;font-size:12px;padding:4px 6px;line-height:1;}'+
  '.dlc-c2-cclear:hover{color:var(--white);}'+
  '.dlc-c2-clist{position:absolute;z-index:60;left:0;right:0;top:calc(100% + 3px);max-height:248px;overflow-y:auto;background:#101010;border:var(--border);box-shadow:0 10px 28px rgba(0,0,0,0.65);}'+
  '.dlc-c2-citem{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 11px;cursor:pointer;font-family:\'DM Mono\',monospace;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.04);}'+
  '.dlc-c2-citem:hover{background:rgba(255,255,255,0.07);}'+
  '.dlc-c2-citem.on{background:rgba(100,180,255,0.12);}'+
  '.dlc-c2-cg{color:var(--grey-5);font-size:9px;flex-shrink:0;}'+
  '.dlc-c2-cours{display:inline-block;font-size:7px;letter-spacing:1px;color:var(--warn);background:rgba(255,204,68,0.12);border:1px solid rgba(255,204,68,0.35);padding:1px 4px;margin-right:6px;vertical-align:middle;}'+
  '.dlc-c2-cempty{padding:11px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;}'+
  '.hd-radar-tip-sub{font-family:\'DM Mono\',monospace;font-size:9px;margin-top:1px;opacity:0.9;}'+
  '.dlc-c2-swap{flex-shrink:0;background:var(--grey-2,#1a1a1a);border:var(--border);color:var(--grey-6);width:38px;height:38px;cursor:pointer;font-size:15px;border-radius:2px;}'+
  '.dlc-c2-swap:hover{color:var(--white);border-color:rgba(255,255,255,0.3);}'+
  '.dlc-c2-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:70px 20px;}'+
  '.dlc-c2-empty-icon{font-size:46px;opacity:0.4;}'+
  '.dlc-c2-empty-txt{font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:1px;color:var(--grey-5);text-align:center;max-width:320px;line-height:1.6;}'+
  '.dlc-c2-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:18px 24px 4px;}'+
  '.dlc-c2-name{font-family:\'Bebas Neue\',sans-serif;font-size:26px;letter-spacing:1px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'+
  '.dlc-c2-vs{font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:2px;color:var(--grey-4);}'+
  '.dlc-c2-body{display:flex;gap:28px;padding:10px 24px 4px;flex-wrap:wrap;align-items:flex-start;}'+
  '.dlc-c2-radar{width:380px;max-width:100%;flex-shrink:0;position:relative;}'+
  '.dlc-c2-radar canvas{width:380px;max-width:100%;height:360px;}'+
  '.dlc-c2-legend{display:flex;justify-content:center;gap:18px;margin-top:4px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-6);}'+
  '.dlc-c2-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle;}'+
  '.dlc-c2-table{flex:1;min-width:300px;}'+
  '.dlc-c2-row{display:grid;grid-template-columns:78px 1fr 78px;gap:14px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);}'+
  '.dlc-c2-val{font-family:\'Bebas Neue\',sans-serif;font-size:19px;text-align:right;}'+
  '.dlc-c2-mid{min-width:0;}'+
  '.dlc-c2-rlbl{font-family:\'DM Mono\',monospace;font-size:7.5px;letter-spacing:1.5px;color:var(--grey-5);text-align:center;margin-bottom:4px;}'+
  '.dlc-c2-bars{display:flex;gap:3px;height:7px;}'+
  '.dlc-c2-bar{flex:1;background:rgba(255,255,255,0.05);display:flex;overflow:hidden;}'+
  '.dlc-c2-bar-l{justify-content:flex-end;}'+
  '.dlc-c2-bar span{display:block;height:100%;}'+
  '.dlc-c2-extra{margin:14px 24px 0;padding:11px 14px;border:var(--border);border-left:3px solid var(--warn);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:0.3px;color:var(--grey-6);}'+
  '.dlc-c2-extra.muted{border-left-color:var(--grey-4);color:var(--grey-5);}'+
  '.dlc-c2-extra-tag{font-size:8px;letter-spacing:2px;color:var(--warn);margin-right:10px;}'+
  '@media(max-width:760px){.dlc-c2-body{flex-direction:column;}.dlc-c2-radar,.dlc-c2-radar canvas{width:100%;}.dlc-c2-head{grid-template-columns:1fr auto 1fr;}.dlc-c2-name{font-size:20px;}}';
  var tag=document.createElement('style');
  tag.id='dlc-cmp2-style';
  tag.textContent=css;
  document.head.appendChild(tag);
}

// ── Role-filtered stats (for the role filter in both labs) ───
// Collect {pk,g} entries matching a predicate and derive the
// same stat shape as dlcDerive, including tempo splits.

// match(pk,g) selects pick entries; mvpMode: 'hero' counts g.mvpHero===pk.hero,
// 'player' counts g.mvpPlayer===pk.player.
function dlcStatsWhere(games, match, total, bans, mvpMode){
  var x={g:0,w:0,k:0,d:0,a:0,dmg:0,dtk:0,dur:0,kpSum:0,kpN:0,mvp:0,
         sideA:{g:0,w:0},sideB:{g:0,w:0},snow:{g:0,w:0},late:{g:0,w:0},
         roles:{},bans:bans!=null?bans:undefined};
  games.forEach(function(g){
    var isSnow=g.endType==='SNOWBALL';
    g.picks.forEach(function(pk){
      if(!match(pk,g)) return;
      var won=g.winSide===pk.side;
      x.g++; if(won)x.w++;
      x.k+=pk.k; x.d+=pk.d; x.a+=pk.a; x.dmg+=pk.dmg; x.dtk+=pk.dtk; x.dur+=g.dur;
      var tk=g.teamKills[pk.side];
      if(tk>0){x.kpSum+=Math.min((pk.k+pk.a)/tk,1);x.kpN++;}
      if(pk.role)x.roles[pk.role]=(x.roles[pk.role]||0)+1;
      var sideObj=x[pk.side==='A'?'sideA':'sideB'];
      sideObj.g++; if(won)sideObj.w++;
      var t=x[isSnow?'snow':'late']; t.g++; if(won)t.w++;
      if (mvpMode==='hero'  && g.mvpHero===pk.hero) x.mvp++;
      if (mvpMode==='player'&& pk.player && g.mvpPlayer===pk.player) x.mvp++;
    });
  });
  return dlcDerive(x,total);
}

// ── Data loading (single fetch shared by both labs) ──────────

function dlcEnsure(cb){
  if (DLC_GAMES){ cb&&cb(); return; }
  if (cb) _DLC_LOADCBS.push(cb);
  if (_DLC_LOADCBS.length>1) return;     // fetch already in flight
  fetch('data/game_results_detailed.csv',{cache:'no-store'})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
    .then(function(txt){
      DLC_GAMES=dlcBuildGames(txt);
      DLC_AGGS={};
      var cbs=_DLC_LOADCBS; _DLC_LOADCBS=[];
      cbs.forEach(function(f){ try{f();}catch(e){console.error(e);} });
    })
    .catch(function(err){
      var cbs=_DLC_LOADCBS; _DLC_LOADCBS=[];
      cbs.forEach(function(f){ try{f(err);}catch(e){console.error(e);} });
    });
}

// ── Scout data loader + aggregation ─────────────────────────

function dlcEnsureScout(cb){
  if (DLC_SCOUT_GAMES){ cb&&cb(); return; }
  if (cb) _DLC_SCOUT_LOADCBS.push(cb);
  if (_DLC_SCOUT_LOADCBS.length>1) return;
  fetch('ank_female_scout.csv',{cache:'no-store'})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
    .then(function(txt){
      DLC_SCOUT_GAMES=dlcBuildGames(txt);
      DLC_SCOUT_AGGS={};
      var cbs=_DLC_SCOUT_LOADCBS; _DLC_SCOUT_LOADCBS=[];
      cbs.forEach(function(f){ try{f();}catch(e){console.error(e);} });
    })
    .catch(function(err){
      var cbs=_DLC_SCOUT_LOADCBS; _DLC_SCOUT_LOADCBS=[];
      cbs.forEach(function(f){ try{f(err);}catch(e){console.error(e);} });
    });
}

// Runs dlcAgg() against the scout games by temporarily swapping
// the two globals (JS is single-threaded so no race risk).
function dlcScoutAgg(tour){
  tour=tour||'All';
  if (DLC_SCOUT_AGGS[tour]) return DLC_SCOUT_AGGS[tour];
  var g0=DLC_GAMES, a0=DLC_AGGS;
  DLC_GAMES=DLC_SCOUT_GAMES; DLC_AGGS=DLC_SCOUT_AGGS;
  var agg=dlcAgg(tour);
  DLC_GAMES=g0; DLC_AGGS=a0;
  return agg;
}

// ── core CSS ─────────────────────────────────────────────────

function _dlcInjectCss(){
  if (_DLC_CSS) return;
  _DLC_CSS=true;
  var css=
  '.dlc-link{cursor:pointer;color:rgba(100,180,255,0.92);border-bottom:1px dotted rgba(100,180,255,0.35);}'+
  '.dlc-link:hover{color:rgba(150,205,255,1);}'+
  '.dlc-dbar{position:relative;height:3px;background:rgba(255,255,255,0.07);margin-top:5px;overflow:hidden;}'+
  '.dlc-dbar-mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.3);}'+
  '.dlc-dbar-fill{position:absolute;top:0;bottom:0;}'+
  '.dlc-dbar-avg{font-family:\'DM Mono\',monospace;font-size:6px;color:var(--grey-5);margin-top:2px;}'+
  '.dlc-tempo{display:flex;gap:10px;align-items:center;padding:10px 14px;flex-wrap:wrap;}'+
  '.dlc-tempo-cell{border:var(--border);padding:8px 14px;text-align:center;min-width:110px;}'+
  '.dlc-tempo-wr{font-family:\'Bebas Neue\',sans-serif;font-size:22px;}'+
  '.dlc-tempo-lbl{font-family:\'DM Mono\',monospace;font-size:6.5px;letter-spacing:1px;}'+
  '.dlc-tempo-g{font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);}'+
  '.dlc-tempo-tag{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1.5px;padding:4px 10px;border:1px solid rgba(255,204,68,0.4);color:var(--warn);}'+
  '.dlc-verdict{margin:10px 14px;padding:10px 12px;border:var(--border);border-left-width:3px;}'+
  '.dlc-verdict.good{border-left-color:var(--success);}'+
  '.dlc-verdict.bad{border-left-color:var(--danger);}'+
  '.dlc-verdict.warn{border-left-color:var(--warn);}'+
  '.dlc-verdict.mut{border-left-color:var(--grey-5);}'+
  '.dlc-verdict-label{font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;}'+
  '.dlc-verdict.good .dlc-verdict-label{color:var(--success);}'+
  '.dlc-verdict.bad .dlc-verdict-label{color:var(--danger);}'+
  '.dlc-verdict.warn .dlc-verdict-label{color:var(--warn);}'+
  '.dlc-verdict-ev{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);margin-top:3px;letter-spacing:0.3px;}'+
  '.dlc-trait{display:inline-block;font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1.5px;padding:3px 8px;border:1px solid rgba(100,180,255,0.4);color:rgba(100,180,255,0.95);margin-right:5px;}'+
  '#dlc-cmp{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:min(680px,96vw);background:#0d0d0d;border:var(--border);border-bottom:none;z-index:250;box-shadow:0 -8px 30px rgba(0,0,0,0.6);}'+
  '#dlc-cmp.min .dlc-cmp-body,#dlc-cmp.min .dlc-cmp-extra{display:none;}'+
  '.dlc-cmp-bar{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:var(--border);}'+
  '.dlc-cmp-tag{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:2px;color:var(--grey-5);}'+
  '.dlc-cmp-body{display:flex;gap:8px;padding:8px;max-height:300px;}'+
  '.dlc-cmp-radar{width:260px;flex-shrink:0;position:relative;}'+
  '.dlc-cmp-table{flex:1;overflow-y:auto;font-family:\'DM Mono\',monospace;font-size:9px;}'+
  '.dlc-cmp-row{display:grid;grid-template-columns:1fr 90px 1fr;gap:10px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.05);}'+
  '.dlc-cmp-stat{color:var(--grey-5);font-size:7px;letter-spacing:1px;text-align:center;align-self:center;}'+
  '.dlc-cmp-extra{padding:6px 12px 9px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--warn);letter-spacing:0.3px;border-top:var(--border);}'+
  '.dlc-spark-wrap{display:flex;align-items:center;gap:10px;padding:8px 14px;}'+
  '.dlc-spark-lbl{font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1px;}'+
  '@media(max-width:760px){.dlc-cmp-body{flex-direction:column;max-height:50vh;overflow-y:auto;}.dlc-cmp-radar{width:100%;}}';
  var tag=document.createElement('style');
  tag.id='dlc-style';
  tag.textContent=css;
  document.head.appendChild(tag);
}
