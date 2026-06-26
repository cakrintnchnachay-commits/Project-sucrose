// ═══════════════════════════════════════════════════════════
// META LAB v2 — pro hero hub, built on datalab-core.js
// Hero list w/ meta score + trend arrows, HEROES/DUOS modes,
// delta-bar stats vs role average, tempo + trend analysis,
// cross-links to Player Lab, shared compare drawer.
// ═══════════════════════════════════════════════════════════

var ML_GAMES    = null;          // kept for draftlab.js compatibility
var ML_TOUR     = 'All';
var ML_SORT     = 'meta';        // meta | presence | winrate | games
var ML_ROLE     = 'All';
var ML_SELECTED = null;
var ML_DETAIL_TAB  = 'overview';
var ML_LIST_MODE   = 'heroes';   // heroes | pairs
var ML_PAIR_SORT   = 'games';    // games | wr | lift
var ML_SELECTED_PAIR = null;
var ML_PLAYERS_EXP = {};

// draftlab.js compatibility alias
function mlBuildGames(txt){ return dlcBuildGames(txt); }

// ── Init ─────────────────────────────────────────────────────

function mlInit(){
  _dlcInjectCss();
  var listEl=document.getElementById('ml-hero-list');
  if (DLC_GAMES){ ML_GAMES=DLC_GAMES; mlRenderBars(); mlRenderList(); mlRenderDetail(); return; }
  if (listEl) listEl.innerHTML='<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;">Loading pro data…</div>';
  dlcEnsure(function(err){
    if (err){
      if (listEl) listEl.innerHTML='<div style="padding:20px;color:var(--danger);font-family:\'DM Mono\',monospace;font-size:10px;">Failed to load data.<br>'+dlcEsc(err.message)+'</div>';
      return;
    }
    ML_GAMES=DLC_GAMES;
    mlRenderBars(); mlRenderList(); mlRenderDetail();
  });
}

// Normalize inconsistent hero name spellings from CSV
function _mlNormalize(name) {
  if (!name) return name;
  if (name === 'FlowbornMarksman') return 'Flowborn Marksman';
  if (name === 'WuKong') return 'Wukong';            // CSV spelling → hero DB / image map
  if (name === 'Diao chan') return 'Diaochan';       // CSV spelling → hero DB / image map
  return name;
}
function mlAgg(){ return dlcAgg(ML_TOUR); }
function mlGames(){ return (DLC_GAMES||[]).filter(function(g){ return ML_TOUR==='All'||g.tour===ML_TOUR; }); }

// role-aware hero stats (overall from agg; role-filtered on demand)
function mlHeroStats(hero){
  var agg=mlAgg();
  var x=agg.heroes[hero];
  if (!x) return null;
  if (ML_ROLE==='All') return dlcDerive(x, agg.total);
  return dlcStatsWhere(mlGames(), function(pk){ return pk.hero===hero&&pk.role===ML_ROLE; }, agg.total, x.bans, 'hero');
}

// ── Bars ─────────────────────────────────────────────────────

function mlRenderBars(){
  var tourEl=document.getElementById('ml-tour-bar');
  if (tourEl) tourEl.innerHTML=DLC_TOURS.map(function(t){
    return '<button class="tier-mode-btn'+(t===ML_TOUR?' active':'')+'" onclick="ML_TOUR=\''+t+'\';mlRenderBars();mlRenderList();mlRenderDetail();dlcRenderCmp();">'+t+'</button>';
  }).join('');

  var sortEl=document.getElementById('ml-sort-bar');
  if (sortEl){
    var modeBtns='<span style="display:inline-flex;gap:2px;margin-right:10px;">'+
      [['heroes','HEROES'],['pairs','DUOS']].map(function(m){
        return '<button class="tier-mode-btn'+(m[0]===ML_LIST_MODE?' active':'')+'" onclick="ML_LIST_MODE=\''+m[0]+'\';mlRenderBars();mlRenderList();">'+m[1]+'</button>';
      }).join('')+'</span>';
    var sorts = ML_LIST_MODE==='heroes'
      ? [['meta','Meta Score'],['presence','Presence'],['winrate','Win Rate'],['games','Games']].map(function(s){
          return '<button class="tier-mode-btn'+(s[0]===ML_SORT?' active':'')+'" onclick="ML_SORT=\''+s[0]+'\';mlRenderList();mlRenderBars();">'+s[1]+'</button>';
        }).join('')
      : [['games','Games'],['wr','Win Rate'],['lift','Synergy']].map(function(s){
          return '<button class="tier-mode-btn'+(s[0]===ML_PAIR_SORT?' active':'')+'" onclick="ML_PAIR_SORT=\''+s[0]+'\';mlRenderList();mlRenderBars();">'+s[1]+'</button>';
        }).join('');
    sortEl.innerHTML=modeBtns+sorts;
  }

  var roleEl=document.getElementById('ml-role-tabs');
  if (roleEl) roleEl.innerHTML=['All'].concat(DLC_ROLES).map(function(r){
    return '<button class="tier-mode-btn'+(r===ML_ROLE?' active':'')+'" onclick="ML_ROLE=\''+r+'\';mlRenderList();mlRenderBars();mlRenderDetail();">'+r+'</button>';
  }).join('');
}

// ── Hero list ────────────────────────────────────────────────

function mlRenderList(){
  if (ML_LIST_MODE==='pairs'){ _mlRenderPairList(); return; }
  var listEl=document.getElementById('ml-hero-list');
  if (!listEl||!DLC_GAMES) return;
  var agg=mlAgg();
  var sq=((document.getElementById('ml-search')||{}).value||'').trim().toLowerCase();

  var list=Object.keys(agg.heroes).map(function(h){
    var x=agg.heroes[h];
    if (ML_ROLE!=='All' && !(x.roles[ML_ROLE]>0)) return null;
    var s=mlHeroStats(h);
    if (!s) return null;
    var trend=dlcTrend(x, agg, true);
    return {hero:h, s:s, trend:trend, score:dlcMetaScore(s,trend)};
  }).filter(Boolean);

  if (sq) list=list.filter(function(e){ return e.hero.toLowerCase().indexOf(sq)>=0; });

  var key=ML_SORT==='winrate'?'wr':ML_SORT==='games'?'games':ML_SORT==='presence'?'presence':null;
  list.sort(function(a,b){
    var aLow=a.s.games<10, bLow=b.s.games<10;
    if (aLow!==bLow) return aLow?1:-1;
    if (key) return (b.s[key]||0)-(a.s[key]||0);
    return b.score-a.score;
  });

  if (!list.length){ listEl.innerHTML='<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;">No heroes found</div>'; return; }

  listEl.innerHTML=list.map(function(e){
    var s=e.s;
    var wr=Math.round(s.wr*100);
    var wrColor=s.games>0?(wr>=60?'var(--success)':wr>=50?'var(--white)':'var(--danger)'):'var(--grey-5)';
    var isSel=e.hero===ML_SELECTED;
    var safe=e.hero.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var arrCol=e.trend.arrow==='▲'?'var(--success)':e.trend.arrow==='▼'?'var(--danger)':'var(--grey-5)';
    var presPct=Math.min((s.presence||0)*100,100);
    return '<div class="hp-item'+(isSel?' active':'')+'" onclick="mlSelectHero(\''+safe+'\')">'+
      '<div class="hp-item-img">'+heroPortraitHtml(e.hero,44,false)+'</div>'+
      '<div class="hp-item-body">'+
        '<div class="hp-item-name">'+e.hero.toUpperCase()+
          ' <span style="font-size:9px;color:'+arrCol+';vertical-align:middle;">'+e.trend.arrow+'</span>'+
          (s.games<10?'<span style="font-size:7px;color:var(--warn);margin-left:5px;letter-spacing:0;font-family:\'DM Mono\',monospace;vertical-align:middle;">LOW N</span>':'')+
        '</div>'+
        '<div class="hp-item-meta">'+s.games+'G · '+Math.round((s.presence||0)*100)+'% PRES</div>'+
        '<div style="height:2px;background:rgba(255,255,255,0.07);margin-top:3px;"><div style="height:2px;width:'+presPct+'%;background:rgba(100,180,255,0.6);"></div></div>'+
      '</div>'+
      '<div class="hp-item-wr-col">'+
        '<div class="hp-item-wr" style="color:'+wrColor+';">'+wr+'%</div>'+
        '<div class="hp-item-wr-lbl">WR</div>'+
      '</div>'+
      '<div class="hp-item-rtg">'+
        '<div class="hp-item-rtg-val" style="font-size:13px;color:'+(e.score>=60?'var(--success)':e.score>=45?'var(--white)':'var(--grey-5)')+';">'+e.score+'</div>'+
        '<div class="hp-item-rtg-lbl">META</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── Duo (pair) list ──────────────────────────────────────────

function _mlPairEntries(minG){
  var agg=mlAgg();
  return Object.keys(agg.pairs).map(function(k){
    var p=agg.pairs[k];
    if (p.g<(minG||8)) return null;
    var hs=k.split('|');
    var a=agg.heroes[hs[0]], b=agg.heroes[hs[1]];
    if (!a||!b) return null;
    var exp=(dlcShrunk(a.w,a.g)+dlcShrunk(b.w,b.g))/2;
    var lift=dlcShrunk(p.w,p.g,8)-exp;
    var roleCombo=Object.keys(p.roles).sort(function(x,y){return p.roles[y]-p.roles[x];})[0]||'';
    return {key:k, a:hs[0], b:hs[1], g:p.g, wr:p.w/p.g, lift:lift, roles:roleCombo};
  }).filter(Boolean);
}

function _mlRenderPairList(){
  var listEl=document.getElementById('ml-hero-list');
  if (!listEl||!DLC_GAMES) return;
  var sq=((document.getElementById('ml-search')||{}).value||'').trim().toLowerCase();
  var list=_mlPairEntries(8);
  if (ML_ROLE!=='All') list=list.filter(function(e){ return e.roles.indexOf(ML_ROLE)>=0; });
  if (sq) list=list.filter(function(e){ return (e.a+' '+e.b).toLowerCase().indexOf(sq)>=0; });
  list.sort(function(x,y){
    if (ML_PAIR_SORT==='wr') return y.wr-x.wr;
    if (ML_PAIR_SORT==='lift') return y.lift-x.lift;
    return y.g-x.g;
  });
  if (!list.length){ listEl.innerHTML='<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;">No duos with 8+ games</div>'; return; }

  listEl.innerHTML=list.map(function(e){
    var isSel=ML_SELECTED_PAIR===e.key;
    var wr=Math.round(e.wr*100);
    var wrColor=wr>=60?'var(--success)':wr>=50?'var(--white)':'var(--danger)';
    var liftStr=(e.lift>=0?'+':'')+Math.round(e.lift*100);
    var liftCol=e.lift>=0.05?'var(--success)':e.lift<=-0.05?'var(--danger)':'var(--grey-5)';
    var safe=e.key.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<div class="hp-item'+(isSel?' active':'')+'" onclick="mlSelectPair(\''+safe+'\')">'+
      '<div style="display:flex;flex-shrink:0;margin-right:8px;">'+heroPortraitHtml(e.a,34,false)+
        '<div style="margin-left:-10px;">'+heroPortraitHtml(e.b,34,false)+'</div></div>'+
      '<div class="hp-item-body">'+
        '<div class="hp-item-name" style="font-size:12px;">'+e.a.toUpperCase()+' + '+e.b.toUpperCase()+'</div>'+
        '<div class="hp-item-meta">'+e.g+'G · '+e.roles+'</div>'+
      '</div>'+
      '<div class="hp-item-wr-col">'+
        '<div class="hp-item-wr" style="color:'+wrColor+';">'+wr+'%</div>'+
        '<div class="hp-item-wr-lbl">WR</div>'+
      '</div>'+
      '<div class="hp-item-rtg">'+
        '<div class="hp-item-rtg-val" style="font-size:13px;color:'+liftCol+';">'+liftStr+'</div>'+
        '<div class="hp-item-rtg-lbl">LIFT</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── Selection ────────────────────────────────────────────────

function mlSelectHero(hero){
  ML_LIST_MODE='heroes';
  ML_SELECTED=hero;
  ML_SELECTED_PAIR=null;
  ML_DETAIL_TAB='overview';
  ML_PLAYERS_EXP={};
  mlRenderBars(); mlRenderList(); mlRenderDetail();
}
function mlSelectPair(key){
  ML_SELECTED_PAIR=key;
  ML_SELECTED=null;
  mlRenderList(); mlRenderDetail();
}

// ── Detail panel ─────────────────────────────────────────────

function mlRenderDetail(){
  var el=document.getElementById('ml-detail');
  if (!el) return;
  if (ML_SELECTED_PAIR){ el.innerHTML=_mlPairDetail(ML_SELECTED_PAIR); return; }
  if (!ML_SELECTED){
    el.innerHTML='<div class="hd-placeholder-inner" style="min-height:300px;">'+
      '<div class="ph-title">META LAB</div>'+
      '<div class="ph-sub">SELECT A HERO OR DUO FROM THE LIST</div></div>';
    return;
  }
  var agg=mlAgg();
  var x=agg.heroes[ML_SELECTED];
  var s=mlHeroStats(ML_SELECTED);
  if (!x||!s){ el.innerHTML='<div class="hd-placeholder-inner" style="min-height:300px;"><div class="ph-sub">NO DATA IN THIS FILTER</div></div>'; return; }

  var role=ML_ROLE!=='All'?ML_ROLE:dlcPrimaryRole(x);
  var trend=dlcTrend(x, agg, true);
  var verdict=dlcHeroVerdict(s, trend);
  var score=dlcMetaScore(s, trend);
  var init=ML_SELECTED.split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
  var wr=Math.round(s.wr*100);
  var wrColor=s.games>0?(wr>=60?'var(--success)':wr>=50?'var(--white)':'var(--danger)'):'var(--grey-5)';

  function mini(lbl,val,col){
    return '<div><div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1.5px;color:var(--grey-5);">'+lbl+'</div>'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+(col||'var(--white)')+';">'+val+'</div></div>';
  }

  var refVals=null;
  if (role){
    refVals={};
    DLC_RADAR_AXES.forEach(function(ax){ refVals[ax.key]=dlcRoleAvg(agg,'hero',role,ax.key,5); });
  }
  var series=[{name:ML_SELECTED, vals:s, colors:DLC_SERIES_COLORS[0]}];
  if (refVals) series.push({name:(role||'Role')+' avg', vals:refVals, colors:DLC_SERIES_COLORS[2]});

  var radarHtml = s.games>0 ?
    '<div class="hd-radar-section-hdr"><span class="hd-radar-section-title">STYLE PROFILE</span>'+
      (role?'<span class="hd-radar-section-sub"> · vs '+role+' average</span>':'')+'</div>'+
    '<div class="hd-radar-canvas-wrap" style="flex:1;min-height:220px;position:relative;">'+
      '<canvas id="ml-hero-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;display:block;margin:0 auto;"></canvas>'+
      '<div class="hd-radar-tip" id="ml-hero-radar-canvas-tip"></div>'+
    '</div>'+
    '<div class="hd-radar-legend">'+
      '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(100,180,255,0.9);"></div>'+dlcEsc(ML_SELECTED.split(' ')[0])+'</div>'+
      (refVals?'<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(80,220,140,0.7);"></div>'+(role||'Role')+' Avg</div>':'')+
    '</div>'
    : '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:9px;">NO GAMES IN FILTER</div>';

  var topHtml=
    '<div class="hd-top-layout">'+
      '<div class="hd-top-left">'+
        '<div class="hd-square-portrait">'+
          '<div class="hd-square-portrait-fallback">'+init+'</div>'+
          (heroImgUrl(ML_SELECTED)?'<img class="hd-square-portrait-img" src="'+heroImgUrl(ML_SELECTED)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>':'')+
        '</div>'+
        '<div class="hd-top-hero-name">'+ML_SELECTED.toUpperCase()+'</div>'+
        '<div class="hd-hdr-meta">'+s.games+' games · '+Math.round((s.presence||0)*100)+'% presence · trend '+trend.arrow+'</div>'+
        '<div class="hd-top-badges">'+
          '<span class="hd-badge-pool">META '+score+'</span>'+
          (role?'<span class="hd-badge-pool">'+role+'</span>':'')+
          (s.games<10?'<span class="hd-badge-main" style="color:var(--warn);background:rgba(255,204,68,0.1);border-color:rgba(255,204,68,0.35);">LOW SAMPLE</span>':'')+
        '</div>'+
        '<div style="margin-top:6px;">'+dlcCmpBtn('hero', ML_SELECTED)+'</div>'+
        '<div style="margin-top:auto;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;">'+
          mini('WIN RATE',wr+'%',wrColor)+
          mini('PRESENCE',Math.round((s.presence||0)*100)+'%')+
          mini('KDA',s.games?s.kda.toFixed(2):'—')+
          mini('MVP RATE',Math.round(s.mvpRate*100)+'%')+
        '</div>'+
      '</div>'+
      '<div class="hd-top-right" style="padding:10px 12px;display:flex;flex-direction:column;">'+radarHtml+'</div>'+
    '</div>';

  var tabs={overview:'Overview',stats:'Stats',tempo:'Tempo & Trend',players:'Players',matchups:'Matchups',duos:'Duos'};
  var tabBar='<div class="hero-role-tabs">'+Object.keys(tabs).map(function(t){
    return '<button class="hero-role-tab'+(t===ML_DETAIL_TAB?' active':'')+'" onclick="ML_DETAIL_TAB=\''+t+'\';mlRenderDetail();">'+tabs[t]+'</button>';
  }).join('')+'</div>';

  var body='';
  if (ML_DETAIL_TAB==='overview') body=_mlOverview(s, verdict, trend);
  else if (ML_DETAIL_TAB==='stats') body=_mlStats(s, agg, role);
  else if (ML_DETAIL_TAB==='tempo') body=_mlTempo(s, x, trend);
  else if (ML_DETAIL_TAB==='players') body=_mlPlayers(x, agg);
  else if (ML_DETAIL_TAB==='matchups') body=_mlMatchups();
  else if (ML_DETAIL_TAB==='duos') body=_mlDuos(ML_SELECTED);

  el.innerHTML=topHtml+tabBar+body;
  if (s.games>0) setTimeout(function(){ dlcDrawRadar('ml-hero-radar-canvas', series); },30);
}

// ── Shared cell builders ─────────────────────────────────────

function _mlStatBox(lbl,val,sub){
  return '<div class="hd-stat-box"><div class="hd-stat-box-val">'+val+'</div>'+
    '<div class="hd-stat-box-lbl">'+lbl+'</div>'+
    (sub?'<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-4);margin-top:2px;">'+sub+'</div>':'')+'</div>';
}
function _mlSectionHdr(title,sub){
  return '<div class="hd-alltime-header"><span class="hd-alltime-title">'+title+'</span>'+
    (sub?'<span class="hd-alltime-sub"> · '+sub+'</span>':'')+'</div>';
}
function _mlPlainCell(lbl,val){
  return '<div class="hd-alltime-cell"><div class="hd-alltime-val">'+val+'</div><div class="hd-alltime-lbl">'+lbl+'</div></div>';
}

// ── Tabs ─────────────────────────────────────────────────────

function _mlOverview(s, verdict, trend){
  return '<div class="dlc-verdict '+verdict.cls+'">'+
      '<div class="dlc-verdict-label">'+verdict.label+'</div>'+
      '<div class="dlc-verdict-ev">'+verdict.ev+'</div>'+
    '</div>'+
    '<div class="hd-stat-boxes">'+
      _mlStatBox('WIN RATE',dlcPct(s.wr,1),s.wins+'/'+s.games+' games')+
      _mlStatBox('PRESENCE',dlcPct(s.presence,1),'pick + ban')+
      _mlStatBox('PICK RATE',dlcPct(s.pickRate,1),s.games+' picks')+
      _mlStatBox('BAN RATE',dlcPct(s.banRate,1),(s.bans||0)+' bans')+
      _mlStatBox('MVP RATE',dlcPct(s.mvpRate,1),'')+
      _mlStatBox('AVG LENGTH',dlcF(s.avgDur,1,'m'),'')+
    '</div>'+
    (trend.pts.length>=3?
      '<div class="dlc-spark-wrap"><span class="dlc-spark-lbl">PRESENCE BY WEEK '+trend.arrow+'</span>'+
        dlcSpark(trend.pts,180,30)+
        '<span class="dlc-spark-lbl">'+trend.pts[0].b+' → '+trend.pts[trend.pts.length-1].b+'</span>'+
      '</div>':'');
}

function _mlStats(s, agg, role){
  function avgOf(key){ return role?dlcRoleAvg(agg,'hero',role,key,5):null; }
  return _mlSectionHdr('COMBAT', role?'green/red bars = vs '+role+' average':null)+
    '<div class="hd-alltime-grid">'+
      dlcDeltaCell('KDA',s.kda,avgOf('kda'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('KILLS / MIN',s.killsPerMin,avgOf('killsPerMin'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('DEATHS / MIN',s.deathsPerMin,avgOf('deathsPerMin'),function(v){return dlcF(v,2);},false)+
      dlcDeltaCell('MIN / DEATH',s.minPerDeath,avgOf('minPerDeath'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('DMG / MIN',s.dmgPerMin,avgOf('dmgPerMin'),dlcFk,true)+
      dlcDeltaCell('DTK / MIN',s.dtkPerMin,avgOf('dtkPerMin'),dlcFk,true)+
    '</div>'+
    _mlSectionHdr('IMPACT')+
    '<div class="hd-alltime-grid">'+
      dlcDeltaCell('KILL PART',s.kp,avgOf('kp'),function(v){return dlcPct(v/100,1);},true)+
      dlcDeltaCell('MVP RATE',s.mvpRate,avgOf('mvpRate'),function(v){return dlcPct(v,1);},true)+
      dlcDeltaCell('WIN RATE',s.wr,avgOf('wr'),function(v){return dlcPct(v,1);},true)+
    '</div>'+
    _mlSectionHdr('CONTEXT')+
    '<div class="hd-alltime-grid">'+
      _mlPlainCell('WR (BLUE)',s.wrBlue!=null?dlcPct(s.wrBlue,1):'—')+
      _mlPlainCell('WR (RED)',s.wrRed!=null?dlcPct(s.wrRed,1):'—')+
      _mlPlainCell('AVG LENGTH',dlcF(s.avgDur,1,'m'))+
      _mlPlainCell('PICK RATE',dlcPct(s.pickRate,1))+
      _mlPlainCell('BAN RATE',dlcPct(s.banRate,1))+
      _mlPlainCell('PRESENCE',dlcPct(s.presence,1))+
    '</div>';
}

function _mlTempo(s, x, trend){
  var sideHtml=
    '<div class="dlc-tempo">'+
      '<div class="dlc-tempo-cell"><div class="dlc-tempo-wr" style="color:'+(s.wrBlue==null?'var(--grey-5)':s.wrBlue>=0.55?'var(--success)':s.wrBlue<0.45?'var(--danger)':'var(--white)')+';">'+(s.wrBlue==null?'—':Math.round(s.wrBlue*100)+'%')+'</div><div class="dlc-tempo-lbl" style="color:rgba(100,180,255,0.9);">BLUE SIDE</div><div class="dlc-tempo-g">'+x.sideA.g+'G</div></div>'+
      '<div class="dlc-tempo-cell"><div class="dlc-tempo-wr" style="color:'+(s.wrRed==null?'var(--grey-5)':s.wrRed>=0.55?'var(--success)':s.wrRed<0.45?'var(--danger)':'var(--white)')+';">'+(s.wrRed==null?'—':Math.round(s.wrRed*100)+'%')+'</div><div class="dlc-tempo-lbl" style="color:rgba(255,110,110,0.9);">RED SIDE</div><div class="dlc-tempo-g">'+x.sideB.g+'G</div></div>'+
    '</div>';
  return _mlSectionHdr('GAME TEMPO','win rate by how games end')+
    dlcTempoHtml(s)+
    _mlSectionHdr('SIDE SPLIT')+
    sideHtml+
    _mlSectionHdr('META TREND','presence per week · '+(ML_TOUR==='All'?'all tournaments':ML_TOUR))+
    (trend.pts.length>=3?
      '<div class="dlc-spark-wrap">'+dlcSpark(trend.pts,260,40)+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);line-height:1.7;">'+
        trend.pts.map(function(p){return p.b+' '+Math.round(p.v*100)+'%';}).join(' · ')+
      '</div></div>'
      :'<div style="padding:14px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">Not enough weekly data in this filter</div>');
}

function _mlPlayers(x, agg){
  var rows=Object.keys(x.players).map(function(p){ return {p:p, st:x.players[p]}; })
    .sort(function(a,b){ return b.st.g-a.st.g; });
  if (!rows.length) return '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding:14px;">No picks found</div>';

  return rows.map(function(r,idx){
    var expanded=ML_PLAYERS_EXP[idx];
    var wr=r.st.g?r.st.w/r.st.g:0;
    var wrColor=wr>=0.6?'var(--success)':wr>=0.5?'var(--white)':'var(--danger)';
    var logo=DLC_TEAM_LOGOS[r.st.team]||'';
    var avatar=logo?'<img src="'+logo+'" style="width:28px;height:28px;object-fit:contain;background:var(--grey-8);padding:2px;box-sizing:border-box;margin-right:10px;flex-shrink:0;" onerror="this.style.display=\'none\'">'
      :'<div style="width:28px;height:28px;background:var(--grey-8);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--grey-5);margin-right:10px;flex-shrink:0;">'+(r.p[0]||'?')+'</div>';
    var expBody='';
    if (expanded){
      var ps=dlcStatsWhere(mlGames(), function(pk){return pk.hero===ML_SELECTED&&pk.player===r.p;}, agg.total, null, 'player');
      expBody='<div class="hd-alltime-grid" style="border-top:var(--border);margin:0;">'+
        _mlPlainCell('WR',dlcPct(ps.wr,1))+
        _mlPlainCell('KDA',dlcF(ps.kda,2))+
        _mlPlainCell('DMG/MIN',dlcFk(ps.dmgPerMin))+
        _mlPlainCell('DTK/MIN',dlcFk(ps.dtkPerMin))+
        _mlPlainCell('KP%',dlcPct(ps.kp/100,1))+
        _mlPlainCell('AVG LEN',dlcF(ps.avgDur,1,'m'))+
      '</div>';
    }
    return '<div style="border-bottom:var(--border);">'+
      '<div class="hd-player-row" style="padding:10px 14px;cursor:pointer;" onclick="ML_PLAYERS_EXP['+idx+']=!ML_PLAYERS_EXP['+idx+'];mlRenderDetail();">'+
        avatar+
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">'+dlcPlayerLink(r.p)+'</div>'+
          '<div class="hd-wl">'+r.st.g+' games · '+r.st.w+'W / '+(r.st.g-r.st.w)+'L · '+dlcEsc(r.st.team||'')+'</div>'+
        '</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:'+wrColor+';margin-right:10px;">'+Math.round(wr*100)+'%</div>'+
        '<div style="color:var(--grey-5);font-size:10px;">'+(expanded?'▲':'▼')+'</div>'+
      '</div>'+expBody+
    '</div>';
  }).join('');
}

function _mlMatchups(){
  var allyMap={}, enemyMap={};
  mlGames().forEach(function(g){
    var my=null;
    g.picks.forEach(function(pk){ if(pk.hero===ML_SELECTED) my=pk; });
    if (!my) return;
    var won=g.winSide===my.side;
    g.picks.forEach(function(pk){
      if (pk.hero===ML_SELECTED||!pk.hero) return;
      var map=pk.side===my.side?allyMap:enemyMap;
      if (!map[pk.hero]) map[pk.hero]={g:0,w:0};
      map[pk.hero].g++; if(won)map[pk.hero].w++;
    });
  });
  function toList(m){
    return Object.keys(m).map(function(h){ return {hero:h,g:m[h].g,wr:m[h].g?m[h].w/m[h].g:0}; })
      .sort(function(a,b){return b.g-a.g;});
  }
  function renderRow(m){
    var pwr=Math.round(m.wr*100);
    var pc=m.wr>=0.55?'var(--success)':m.wr<=0.45?'var(--danger)':'var(--grey-5)';
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:var(--border);">'+
      '<div style="flex-shrink:0;">'+heroPortraitHtml(m.hero,28,false)+'</div>'+
      '<div style="flex:1;font-family:\'Bebas Neue\',sans-serif;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+dlcHeroLink(m.hero)+'</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);flex-shrink:0;">'+m.g+'G</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:'+pc+';flex-shrink:0;min-width:28px;text-align:right;">'+pwr+'%</div>'+
    '</div>';
  }
  var allies=toList(allyMap), enemies=toList(enemyMap);
  function col(title,color,list,rightBorder){
    return '<div'+(rightBorder?' style="border-right:var(--border);"':'')+'>'+
      '<div style="padding:7px 10px;border-bottom:var(--border);display:flex;align-items:center;gap:6px;">'+
        '<span style="width:6px;height:6px;border-radius:50%;background:'+color+';flex-shrink:0;"></span>'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1.5px;color:'+color+';">'+title+'</span>'+
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);margin-left:auto;">'+list.length+' heroes</span>'+
      '</div>'+
      (list.length?list.map(renderRow).join(''):'<div style="padding:12px 10px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">No data</div>')+
    '</div>';
  }
  return '<div style="display:grid;grid-template-columns:1fr 1fr;">'+
    col('ALLIES','var(--success)',allies,true)+col('ENEMIES','var(--danger)',enemies,false)+'</div>';
}

function _mlDuos(hero){
  var list=_mlPairEntries(6).filter(function(e){ return e.a===hero||e.b===hero; });
  list.sort(function(x,y){ return y.lift-x.lift; });
  if (!list.length) return '<div style="padding:14px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No duos with 6+ games together</div>';
  return _mlSectionHdr('DUOS','pairs with '+dlcEsc(hero)+' · sorted by synergy lift')+
    list.map(function(e){
      var partner=e.a===hero?e.b:e.a;
      var liftStr=(e.lift>=0?'+':'')+Math.round(e.lift*100);
      var liftCol=e.lift>=0.05?'var(--success)':e.lift<=-0.05?'var(--danger)':'var(--grey-5)';
      var wr=Math.round(e.wr*100);
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:var(--border);">'+
        heroPortraitHtml(partner,32,false)+
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;">'+dlcHeroLink(partner)+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);">'+e.roles+' · '+e.g+'G together</div>'+
        '</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:'+(wr>=55?'var(--success)':wr<=45?'var(--danger)':'var(--white)')+';">'+wr+'%</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:'+liftCol+';min-width:34px;text-align:right;" title="WR lift vs what the two heroes\' individual win rates predict">'+liftStr+'</div>'+
      '</div>';
    }).join('');
}

// ── Duo detail panel ─────────────────────────────────────────

function _mlPairDetail(key){
  var agg=mlAgg();
  var p=agg.pairs[key];
  if (!p) return '<div class="hd-placeholder-inner" style="min-height:300px;"><div class="ph-sub">NO DATA</div></div>';
  var hs=key.split('|'), A=hs[0], B=hs[1];
  var a=agg.heroes[A], b=agg.heroes[B];
  var exp=(dlcShrunk(a.w,a.g)+dlcShrunk(b.w,b.g))/2;
  var lift=dlcShrunk(p.w,p.g,8)-exp;
  var wr=p.w/p.g;
  var roleCombo=Object.keys(p.roles).sort(function(x,y){return p.roles[y]-p.roles[x];});

  var teams={}, weekPts={};
  mlGames().forEach(function(g){
    ['A','B'].forEach(function(S){
      var hsOn=g.picks.filter(function(pk){return pk.side===S;}).map(function(pk){return pk.hero;});
      if (hsOn.indexOf(A)>=0&&hsOn.indexOf(B)>=0){
        var t=g.teams[S];
        if (t){ if(!teams[t])teams[t]={g:0,w:0}; teams[t].g++; if(g.winSide===S)teams[t].w++; }
        var bk=dlcWeekBucket(g.week);
        if (bk) weekPts[bk]=(weekPts[bk]||0)+1;
      }
    });
  });
  var teamRows=Object.keys(teams).sort(function(x,y){return teams[y].g-teams[x].g;}).map(function(t){
    var logo=DLC_TEAM_LOGOS[t]||'';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:var(--border);">'+
      (logo?'<img src="'+logo+'" style="width:22px;height:22px;object-fit:contain;" onerror="this.style.display=\'none\'">':'')+
      '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:13px;flex:1;">'+dlcEsc(t)+'</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+teams[t].g+'G</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:'+(teams[t].w/teams[t].g>=0.55?'var(--success)':'var(--white)')+';min-width:32px;text-align:right;">'+Math.round(100*teams[t].w/teams[t].g)+'%</span>'+
    '</div>';
  }).join('');
  var sparkPts=DLC_WEEK_BUCKETS.map(function(bk){
    var tot=agg.bucketTotals[bk]||0;
    return tot?{b:bk,v:(weekPts[bk]||0)/tot}:null;
  }).filter(Boolean);

  function heroCard(h){
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;" onclick="dlcOpen(\'hero\',\''+dlcEsc(h).replace(/'/g,"\\'")+'\')">'+
      heroPortraitHtml(h,64,false)+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:15px;color:rgba(100,180,255,0.95);">'+dlcEsc(h)+'</div>'+
    '</div>';
  }
  var liftStr=(lift>=0?'+':'')+Math.round(lift*100);
  var liftCol=lift>=0.05?'var(--success)':lift<=-0.05?'var(--danger)':'var(--white)';
  return '<div style="padding:18px 14px;display:flex;align-items:center;gap:18px;border-bottom:var(--border);flex-wrap:wrap;">'+
      heroCard(A)+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:var(--grey-5);">+</div>'+
      heroCard(B)+
      '<div style="flex:1;min-width:160px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:2px;color:var(--grey-5);">DUO · '+(roleCombo[0]||'')+'</div>'+
        '<div style="display:flex;gap:18px;margin-top:6px;">'+
          '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;color:'+(wr>=0.55?'var(--success)':wr<0.45?'var(--danger)':'var(--white)')+';">'+Math.round(wr*100)+'%</div><div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;color:var(--grey-5);">WIN RATE ('+p.g+'G)</div></div>'+
          '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;color:'+liftCol+';">'+liftStr+'</div><div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;color:var(--grey-5);">LIFT VS EXPECTED '+Math.round(exp*100)+'%</div></div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    _mlSectionHdr('WHO RUNS IT')+
    (teamRows||'<div style="padding:12px 14px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">No team data</div>')+
    _mlSectionHdr('USAGE TREND','share of games per week')+
    (sparkPts.length>=3?'<div class="dlc-spark-wrap">'+dlcSpark(sparkPts,260,36)+'</div>':'<div style="padding:12px 14px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">Not enough weekly data</div>');
}
