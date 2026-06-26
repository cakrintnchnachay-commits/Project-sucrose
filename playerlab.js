// ═══════════════════════════════════════════════════════════
// PLAYER LAB v2 — pro player hub, built on datalab-core.js
// Style reads with evidence, delta-bar stats vs role peers,
// tempo + trend, linked hero pool, shared compare drawer.
// ═══════════════════════════════════════════════════════════

var PL_TOUR     = 'All';
var PL_SORT     = 'wr';          // wr | kda | games
var PL_ROLE     = 'All';
var PL_SELECTED = null;
var PL_DETAIL_TAB = 'overview';
var PL_HEROES_EXP = {};

// ── Init ─────────────────────────────────────────────────────

function plInit(){
  _dlcInjectCss();
  var listEl=document.getElementById('pl-player-list');
  if (DLC_GAMES){ plRenderBars(); plRenderList(); plRenderDetail(); return; }
  if (listEl) listEl.innerHTML='<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;">Loading pro data…</div>';
  dlcEnsure(function(err){
    if (err){
      if (listEl) listEl.innerHTML='<div style="padding:20px;color:var(--danger);font-family:\'DM Mono\',monospace;font-size:10px;">Failed to load data.<br>'+dlcEsc(err.message)+'</div>';
      return;
    }
    plRenderBars(); plRenderList(); plRenderDetail();
  });
}

function plAgg(){ return dlcAgg(PL_TOUR); }
function plGames(){ return (DLC_GAMES||[]).filter(function(g){ return PL_TOUR==='All'||g.tour===PL_TOUR; }); }

function plPlayerStats(ign){
  var agg=plAgg();
  var x=agg.players[ign];
  if (!x) return null;
  if (PL_ROLE==='All') return dlcDerive(x, agg.total);
  return dlcStatsWhere(plGames(), function(pk){ return pk.player===ign&&pk.role===PL_ROLE; }, agg.total, null, 'player');
}

// ── Bars ─────────────────────────────────────────────────────

function plRenderBars(){
  var tourEl=document.getElementById('pl-tour-bar');
  if (tourEl) tourEl.innerHTML=DLC_TOURS.map(function(t){
    return '<button class="tier-mode-btn'+(t===PL_TOUR?' active':'')+'" onclick="PL_TOUR=\''+t+'\';plRenderBars();plRenderList();plRenderDetail();dlcRenderCmp();">'+t+'</button>';
  }).join('');
  var sortEl=document.getElementById('pl-sort-bar');
  if (sortEl) sortEl.innerHTML=[['wr','Win Rate'],['kda','KDA'],['games','Games']].map(function(s){
    return '<button class="tier-mode-btn'+(s[0]===PL_SORT?' active':'')+'" onclick="PL_SORT=\''+s[0]+'\';plRenderList();plRenderBars();">'+s[1]+'</button>';
  }).join('');
  var roleEl=document.getElementById('pl-role-tabs');
  if (roleEl) roleEl.innerHTML=['All'].concat(DLC_ROLES).map(function(r){
    return '<button class="tier-mode-btn'+(r===PL_ROLE?' active':'')+'" onclick="PL_ROLE=\''+r+'\';plRenderList();plRenderBars();plRenderDetail();">'+r+'</button>';
  }).join('');
}

// ── Player list ──────────────────────────────────────────────

function plRenderList(){
  var listEl=document.getElementById('pl-player-list');
  if (!listEl||!DLC_GAMES) return;
  var agg=plAgg();

  var list=Object.keys(agg.players).map(function(ign){
    var x=agg.players[ign];
    if (PL_ROLE!=='All' && !(x.roles[PL_ROLE]>0)) return null;
    var s=plPlayerStats(ign);
    if (!s||!s.games) return null;
    return {ign:ign, s:s, role:dlcPrimaryRole(x), team:x.team};
  }).filter(Boolean);

  var key=PL_SORT==='kda'?'kda':PL_SORT==='games'?'games':'wr';
  list.sort(function(a,b){
    var aLow=a.s.games<10, bLow=b.s.games<10;
    if (aLow!==bLow) return aLow?1:-1;
    return (b.s[key]||0)-(a.s[key]||0);
  });

  if (!list.length){ listEl.innerHTML='<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;">No players found</div>'; return; }

  listEl.innerHTML=list.map(function(e){
    var s=e.s;
    var wr=Math.round(s.wr*100);
    var wrColor=wr>=60?'var(--success)':wr>=50?'var(--white)':'var(--danger)';
    var isSel=e.ign===PL_SELECTED;
    var safe=e.ign.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var logo=DLC_TEAM_LOGOS[e.team]||'';
    var avatar=logo?'<img src="'+logo+'" style="width:34px;height:34px;object-fit:contain;background:var(--grey-8);padding:2px;box-sizing:border-box;" onerror="this.style.display=\'none\'">'
      :'<div style="width:34px;height:34px;background:var(--grey-8);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--grey-5);">'+(e.ign[0]||'?')+'</div>';
    return '<div class="hp-item'+(isSel?' active':'')+'" onclick="plSelectPlayer(\''+safe+'\')">'+
      '<div class="hp-item-img" style="display:flex;align-items:center;justify-content:center;">'+avatar+'</div>'+
      '<div class="hp-item-body">'+
        '<div class="hp-item-name">'+dlcEsc(e.ign).toUpperCase()+
          (s.games<10?'<span style="font-size:7px;color:var(--warn);margin-left:5px;letter-spacing:0;font-family:\'DM Mono\',monospace;vertical-align:middle;">LOW N</span>':'')+
        '</div>'+
        '<div class="hp-item-meta">'+s.games+'G · '+(e.role||'')+(e.team?' · '+dlcEsc(e.team):'')+'</div>'+
      '</div>'+
      '<div class="hp-item-wr-col">'+
        '<div class="hp-item-wr" style="color:'+wrColor+';">'+wr+'%</div>'+
        '<div class="hp-item-wr-lbl">WR</div>'+
      '</div>'+
      '<div class="hp-item-rtg">'+
        '<div class="hp-item-rtg-val" style="font-size:13px;">'+dlcF(s.kda,1)+'</div>'+
        '<div class="hp-item-rtg-lbl">KDA</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── Selection ────────────────────────────────────────────────

function plSelectPlayer(ign){
  PL_SELECTED=ign;
  PL_DETAIL_TAB='overview';
  PL_HEROES_EXP={};
  plRenderList(); plRenderDetail();
}

// ── Detail ───────────────────────────────────────────────────

function plRenderDetail(){
  var el=document.getElementById('pl-detail');
  if (!el) return;
  if (!PL_SELECTED){
    el.innerHTML='<div class="hd-placeholder-inner" style="min-height:300px;">'+
      '<div class="ph-title">PLAYER LAB</div>'+
      '<div class="ph-sub">SELECT A PLAYER FROM THE LIST</div></div>';
    return;
  }
  var agg=plAgg();
  var x=agg.players[PL_SELECTED];
  var s=plPlayerStats(PL_SELECTED);
  if (!x||!s||!s.games){ el.innerHTML='<div class="hd-placeholder-inner" style="min-height:300px;"><div class="ph-sub">NO DATA IN THIS FILTER</div></div>'; return; }

  var role=PL_ROLE!=='All'?PL_ROLE:dlcPrimaryRole(x);
  var style=dlcStyleRead(agg, PL_SELECTED);
  var init=PL_SELECTED.slice(0,2).toUpperCase();
  var wr=Math.round(s.wr*100);
  var wrColor=wr>=60?'var(--success)':wr>=50?'var(--white)':'var(--danger)';
  var logo=DLC_TEAM_LOGOS[x.team]||'';

  function mini(lbl,val,col){
    return '<div><div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1.5px;color:var(--grey-5);">'+lbl+'</div>'+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+(col||'var(--white)')+';">'+val+'</div></div>';
  }

  var refVals=null;
  if (role){
    refVals={};
    DLC_RADAR_AXES.forEach(function(ax){ refVals[ax.key]=dlcRoleAvg(agg,'player',role,ax.key,10); });
  }
  var series=[{name:PL_SELECTED, vals:s, colors:DLC_SERIES_COLORS[0]}];
  if (refVals) series.push({name:(role||'Role')+' avg', vals:refVals, colors:DLC_SERIES_COLORS[2]});

  var radarHtml=
    '<div class="hd-radar-section-hdr"><span class="hd-radar-section-title">STYLE PROFILE</span>'+
      (role?'<span class="hd-radar-section-sub"> · vs '+role+' pros</span>':'')+'</div>'+
    '<div class="hd-radar-canvas-wrap" style="flex:1;min-height:220px;position:relative;">'+
      '<canvas id="pl-player-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;display:block;margin:0 auto;"></canvas>'+
      '<div class="hd-radar-tip" id="pl-player-radar-canvas-tip"></div>'+
    '</div>'+
    '<div class="hd-radar-legend">'+
      '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(100,180,255,0.9);"></div>'+dlcEsc(PL_SELECTED)+'</div>'+
      (refVals?'<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(80,220,140,0.7);"></div>'+(role||'Role')+' Avg</div>':'')+
    '</div>';

  var traitBadges=(style.traits||[]).map(function(t){ return '<span class="dlc-trait">'+t.label+'</span>'; }).join('');

  var topHtml=
    '<div class="hd-top-layout">'+
      '<div class="hd-top-left">'+
        '<div class="hd-square-portrait">'+
          '<div class="hd-square-portrait-fallback">'+dlcEsc(init)+'</div>'+
          (logo?'<img class="hd-square-portrait-img" src="'+logo+'" alt="" loading="lazy" style="object-fit:contain;padding:14px;box-sizing:border-box;" onerror="this.style.display=\'none\'"/>':'')+
        '</div>'+
        '<div class="hd-top-hero-name">'+dlcEsc(PL_SELECTED).toUpperCase()+'</div>'+
        '<div class="hd-hdr-meta">'+s.games+' games · '+(role||'')+(x.team?' · '+dlcEsc(x.team):'')+'</div>'+
        '<div class="hd-top-badges">'+
          (role?'<span class="hd-badge-pool">'+role+'</span>':'')+
          (s.games<10?'<span class="hd-badge-main" style="color:var(--warn);background:rgba(255,204,68,0.1);border-color:rgba(255,204,68,0.35);">LOW SAMPLE</span>':'')+
        '</div>'+
        '<div style="margin-top:6px;">'+traitBadges+'</div>'+
        '<div style="margin-top:6px;">'+dlcCmpBtn('player', PL_SELECTED)+'</div>'+
        '<div style="margin-top:auto;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;">'+
          mini('WIN RATE',wr+'%',wrColor)+
          mini('KDA',dlcF(s.kda,2))+
          mini('MVP RATE',Math.round(s.mvpRate*100)+'%')+
          mini('AVG LENGTH',dlcF(s.avgDur,1)+'M')+
        '</div>'+
      '</div>'+
      '<div class="hd-top-right" style="padding:10px 12px;display:flex;flex-direction:column;">'+radarHtml+'</div>'+
    '</div>';

  var tabs={overview:'Overview',stats:'Stats',tempo:'Tempo & Trend',heropool:'Hero Pool',matchups:'Matchups'};
  var tabBar='<div class="hero-role-tabs">'+Object.keys(tabs).map(function(t){
    return '<button class="hero-role-tab'+(t===PL_DETAIL_TAB?' active':'')+'" onclick="PL_DETAIL_TAB=\''+t+'\';plRenderDetail();">'+tabs[t]+'</button>';
  }).join('')+'</div>';

  var body='';
  if (PL_DETAIL_TAB==='overview') body=_plOverview(s, style, x, agg);
  else if (PL_DETAIL_TAB==='stats') body=_plStats(s, agg, role);
  else if (PL_DETAIL_TAB==='tempo') body=_plTempo(s, x, agg);
  else if (PL_DETAIL_TAB==='heropool') body=_plHeroPool(x, agg);
  else if (PL_DETAIL_TAB==='matchups') body=_plMatchups();

  el.innerHTML=topHtml+tabBar+body;
  setTimeout(function(){ dlcDrawRadar('pl-player-radar-canvas', series); },30);
}

// ── Tabs ─────────────────────────────────────────────────────

function _plBox(lbl,val,sub){
  return '<div class="hd-stat-box"><div class="hd-stat-box-val">'+val+'</div>'+
    '<div class="hd-stat-box-lbl">'+lbl+'</div>'+
    (sub?'<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-4);margin-top:2px;">'+sub+'</div>':'')+'</div>';
}
function _plHdr(title,sub){
  return '<div class="hd-alltime-header"><span class="hd-alltime-title">'+title+'</span>'+
    (sub?'<span class="hd-alltime-sub"> · '+sub+'</span>':'')+'</div>';
}
function _plCell(lbl,val){
  return '<div class="hd-alltime-cell"><div class="hd-alltime-val">'+val+'</div><div class="hd-alltime-lbl">'+lbl+'</div></div>';
}

function _plOverview(s, style, x, agg){
  var styleHtml=(style.traits||[]).map(function(t){
    return '<div class="dlc-verdict good" style="margin:8px 14px;">'+
      '<div class="dlc-verdict-label">'+t.label+'</div>'+
      '<div class="dlc-verdict-ev">'+t.ev+'</div>'+
    '</div>';
  }).join('');
  var trend=dlcTrend(x, agg, false);
  return _plHdr('STYLE READ', style.role?'computed vs other '+style.role+' pros — evidence shown, judge for yourself':null)+
    styleHtml+
    '<div class="hd-stat-boxes">'+
      _plBox('WIN RATE',dlcPct(s.wr,1),s.wins+'/'+s.games+' games')+
      _plBox('KDA',dlcF(s.kda,2),'')+
      _plBox('GAMES',String(s.games),s.games<10?'low sample':'')+
      _plBox('MVP RATE',dlcPct(s.mvpRate,1),'')+
      _plBox('KILL PART',dlcPct(s.kp/100,1),'')+
      _plBox('AVG LENGTH',dlcF(s.avgDur,1,'m'),'')+
    '</div>'+
    (trend.pts.length>=3?
      '<div class="dlc-spark-wrap"><span class="dlc-spark-lbl">GAMES SHARE BY WEEK '+trend.arrow+'</span>'+
        dlcSpark(trend.pts,180,30)+'</div>':'');
}

function _plStats(s, agg, role){
  function avgOf(key){ return role?dlcRoleAvg(agg,'player',role,key,10):null; }
  return _plHdr('COMBAT', role?'green/red bars = vs '+role+' pros':null)+
    '<div class="hd-alltime-grid">'+
      dlcDeltaCell('KDA',s.kda,avgOf('kda'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('KILLS / MIN',s.killsPerMin,avgOf('killsPerMin'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('DEATHS / MIN',s.deathsPerMin,avgOf('deathsPerMin'),function(v){return dlcF(v,2);},false)+
      dlcDeltaCell('MIN / DEATH',s.minPerDeath,avgOf('minPerDeath'),function(v){return dlcF(v,2);},true)+
      dlcDeltaCell('DMG / MIN',s.dmgPerMin,avgOf('dmgPerMin'),dlcFk,true)+
      dlcDeltaCell('DTK / MIN',s.dtkPerMin,avgOf('dtkPerMin'),dlcFk,true)+
    '</div>'+
    _plHdr('IMPACT')+
    '<div class="hd-alltime-grid">'+
      dlcDeltaCell('KILL PART',s.kp,avgOf('kp'),function(v){return dlcPct(v/100,1);},true)+
      dlcDeltaCell('MVP RATE',s.mvpRate,avgOf('mvpRate'),function(v){return dlcPct(v,1);},true)+
      dlcDeltaCell('WIN RATE',s.wr,avgOf('wr'),function(v){return dlcPct(v,1);},true)+
    '</div>'+
    _plHdr('CONTEXT')+
    '<div class="hd-alltime-grid">'+
      _plCell('WR (BLUE)',s.wrBlue!=null?dlcPct(s.wrBlue,1):'—')+
      _plCell('WR (RED)',s.wrRed!=null?dlcPct(s.wrRed,1):'—')+
      _plCell('AVG LENGTH',dlcF(s.avgDur,1,'m'))+
    '</div>';
}

function _plTempo(s, x, agg){
  var trend=dlcTrend(x, agg, false);
  return _plHdr('GAME TEMPO','win rate by how games end')+
    dlcTempoHtml(s)+
    _plHdr('SIDE SPLIT')+
    '<div class="dlc-tempo">'+
      '<div class="dlc-tempo-cell"><div class="dlc-tempo-wr" style="color:'+(s.wrBlue==null?'var(--grey-5)':s.wrBlue>=0.55?'var(--success)':s.wrBlue<0.45?'var(--danger)':'var(--white)')+';">'+(s.wrBlue==null?'—':Math.round(s.wrBlue*100)+'%')+'</div><div class="dlc-tempo-lbl" style="color:rgba(100,180,255,0.9);">BLUE SIDE</div><div class="dlc-tempo-g">'+x.sideA.g+'G</div></div>'+
      '<div class="dlc-tempo-cell"><div class="dlc-tempo-wr" style="color:'+(s.wrRed==null?'var(--grey-5)':s.wrRed>=0.55?'var(--success)':s.wrRed<0.45?'var(--danger)':'var(--white)')+';">'+(s.wrRed==null?'—':Math.round(s.wrRed*100)+'%')+'</div><div class="dlc-tempo-lbl" style="color:rgba(255,110,110,0.9);">RED SIDE</div><div class="dlc-tempo-g">'+x.sideB.g+'G</div></div>'+
    '</div>'+
    _plHdr('ACTIVITY TREND','share of games per week')+
    (trend.pts.length>=3?
      '<div class="dlc-spark-wrap">'+dlcSpark(trend.pts,260,40)+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);line-height:1.7;">'+
        trend.pts.map(function(p){return p.b+' '+Math.round(p.v*100)+'%';}).join(' · ')+
      '</div></div>'
      :'<div style="padding:14px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">Not enough weekly data in this filter</div>');
}

function _plHeroPool(x, agg){
  var rows=Object.keys(x.heroes).map(function(h){ return {h:h, st:x.heroes[h]}; })
    .sort(function(a,b){ return b.st.g-a.st.g; });
  if (!rows.length) return '<div style="padding:14px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No heroes found</div>';

  return _plHdr('HERO POOL', rows.length+' heroes · tap a name to open it in Meta Lab')+
    rows.map(function(r,idx){
      var expanded=PL_HEROES_EXP[idx];
      var wr=r.st.g?r.st.w/r.st.g:0;
      var wrColor=wr>=0.6?'var(--success)':wr>=0.5?'var(--white)':'var(--danger)';
      var expBody='';
      if (expanded){
        var hs=dlcStatsWhere(plGames(), function(pk){return pk.player===PL_SELECTED&&pk.hero===r.h;}, agg.total, null, 'player');
        expBody='<div class="hd-alltime-grid" style="border-top:var(--border);margin:0;">'+
          _plCell('WR',dlcPct(hs.wr,1))+
          _plCell('KDA',dlcF(hs.kda,2))+
          _plCell('KILLS/MIN',dlcF(hs.killsPerMin,2))+
          _plCell('DMG/MIN',dlcFk(hs.dmgPerMin))+
          _plCell('DTK/MIN',dlcFk(hs.dtkPerMin))+
          _plCell('KP%',dlcPct(hs.kp/100,1))+
          _plCell('MVP RATE',dlcPct(hs.mvpRate,1))+
          _plCell('AVG LEN',dlcF(hs.avgDur,1,'m'))+
        '</div>';
      }
      return '<div style="border-bottom:var(--border);">'+
        '<div class="hd-player-row" style="padding:9px 14px;cursor:pointer;" onclick="PL_HEROES_EXP['+idx+']=!PL_HEROES_EXP['+idx+'];plRenderDetail();">'+
          '<div style="margin-right:10px;flex-shrink:0;">'+heroPortraitHtml(r.h,28,false)+'</div>'+
          '<div style="flex:1;min-width:0;">'+
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">'+dlcHeroLink(r.h)+'</div>'+
            '<div class="hd-wl">'+r.st.g+' games · '+r.st.w+'W / '+(r.st.g-r.st.w)+'L</div>'+
          '</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:'+wrColor+';margin-right:10px;">'+Math.round(wr*100)+'%</div>'+
          '<div style="color:var(--grey-5);font-size:10px;">'+(expanded?'▲':'▼')+'</div>'+
        '</div>'+expBody+
      '</div>';
    }).join('');
}

function _plMatchups(){
  var allyMap={}, enemyMap={};
  plGames().forEach(function(g){
    var my=null;
    g.picks.forEach(function(pk){ if(pk.player===PL_SELECTED) my=pk; });
    if (!my) return;
    var won=g.winSide===my.side;
    g.picks.forEach(function(pk){
      if (pk===my||!pk.hero) return;
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
    col('PLAYED WITH','var(--success)',allies,true)+col('PLAYED AGAINST','var(--danger)',enemies,false)+'</div>';
}
