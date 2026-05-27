function getPlayers(){ return _cache.players||[]; }
function savePlayers(arr){ _cache.players=arr; }
let PLAYERS=[];
function loadData(){
  return {
    games: _cache.games||[],
    matches: _cache.matches||[],
    metaTiers: _cache.metaTiers||{},
    masteryTiers: _cache.masteryTiers||{},
    patches: _cache.patches||[],
    customHeroes: _cache.customHeroes||[],
    pfp: _cache.pfp||{},
    heroes: [],
  };
}
// saveData is now a no-op — all writes go through specific sbSave* functions
function saveData(d){
  // Sync any fields written to d back to cache
  if(d.metaTiers) _cache.metaTiers=d.metaTiers;
  if(d.masteryTiers) _cache.masteryTiers=d.masteryTiers;
  if(d.patches) _cache.patches=d.patches;
  if(d.customHeroes) _cache.customHeroes=d.customHeroes;
  if(d.pfp) _cache.pfp=d.pfp;
}

// ══════════════════════════════════════════
// LAYOUT HELPERS
// ══════════════════════════════════════════
function isDesktop(){return window.innerWidth>=768;}
function initLayout(){
  var desktop=isDesktop();
  var logoBlock=document.getElementById('nav-logo-block');
  var spacer=document.getElementById('nav-spacer');
  var settingsBtn=document.getElementById('nav-settings-btn');
  if(logoBlock) logoBlock.style.display=desktop?'block':'none';
  if(spacer) spacer.style.display=desktop?'block':'none';
  if(settingsBtn) settingsBtn.style.display=desktop?'flex':'none';
}
window.addEventListener('resize',initLayout);

// ══════════════════════════════════════════
// ALERT SYSTEM
// ══════════════════════════════════════════
function generateAlerts(games,matches){
  var players=PLAYERS||_cache.players||[];
  var alerts=[];
  var now=new Date();
  var todayIso=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2)+'-'+('0'+now.getDate()).slice(-2);
  var dismissed=_cache.dismissed||{};
  if(!games||games.length<3) return alerts;

  var sorted=games.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);});

  // ── Team: losing streak ──
  var last3=sorted.slice(0,3);
  if(last3.length===3&&last3.every(function(g){return g.result==='Loss';})){
    var k='team_losestreak';
    if(!dismissed[k]) alerts.push({colour:'danger',playerId:null,message:'3-game losing streak — review last session',key:k});
  }

  // ── Team: win streak ──
  if(last3.length===3&&last3.every(function(g){return g.result==='Win';})){
    var k='team_winstreak';
    if(!dismissed[k]) alerts.push({colour:'success',playerId:null,message:'On a 3-game win streak',key:k});
  }

  // ── Team: win rate drop (<40% last 10) ──
  var last10=sorted.slice(0,10);
  if(last10.length>=10){
    var w10=last10.filter(function(g){return g.result==='Win';}).length;
    if(w10<4){
      var k='team_wrdrop';
      if(!dismissed[k]) alerts.push({colour:'warn',playerId:null,message:'Win rate has fallen to '+Math.round(w10/10*100)+'% over last 10 games',key:k});
    }
  }

  // ── Matches past their date with no games linked ──
  (matches||[]).forEach(function(m){
    if(!m.date||m.date>=todayIso) return;
    var linked=games.filter(function(g){return g.matchId===m.id;}).length;
    if(linked===0){
      var k='match_nogames_'+m.id;
      if(!dismissed[k]) alerts.push({colour:'warn',playerId:null,message:'Match vs '+(m.name||'Unknown')+' on '+(_fmtDate?_fmtDate(m.date):m.date)+' has no games logged',key:k});
    }
  });

  // ── Enemy hero pattern (last 6 games) ──
  var last6=sorted.slice(0,6);
  var ehCount={};
  last6.forEach(function(g){(g.enemyPicks||[]).forEach(function(ep){if(ep.hero) ehCount[ep.hero]=(ehCount[ep.hero]||0)+1;});});
  Object.keys(ehCount).forEach(function(hero){
    if(ehCount[hero]>=3){
      var k='enemy_pattern_'+hero.toLowerCase().replace(/\s+/g,'_');
      if(!dismissed[k]) alerts.push({colour:'warn',playerId:null,message:'Enemy has drafted '+hero+' in '+ehCount[hero]+' of your last 6 games — prepare a counter',key:k});
    }
  });

  // ── Player-level alerts ──
  players.filter(function(p){return p.status!=='Inactive';}).forEach(function(p){
    var pid=p.id;
    var role=(p.role||'').toLowerCase();
    var pillars=(typeof PILLAR_MAP!=='undefined'&&PILLAR_MAP[role])||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];

    var pGames=sorted.filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});
    if(pGames.length<3) return;

    function getPillar(g,idx){var s=g.playerScores&&g.playerScores[pid];if(!s||!s.pillar_scores)return null;var v=s.pillar_scores['p'+idx];return(v!=null&&v>0)?v:null;}
    function avgPillars(gList){var vals=gList.reduce(function(acc,g){var s=g.playerScores&&g.playerScores[pid];if(s&&s.pillar_scores) Object.values(s.pillar_scores).forEach(function(v){if(v!=null&&v>0)acc.push(v);});return acc;},[]);return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;}

    var l3=pGames.slice(0,3);
    var l6=pGames.slice(0,6);
    var l10=pGames.slice(0,10);

    // 1. Pillar drop — all 3 below 5.0 on same pillar
    for(var pi=0;pi<4;pi++){
      var s3=l3.map(function(g){return getPillar(g,pi);}).filter(function(v){return v!=null;});
      if(s3.length===3&&s3.every(function(v){return v<5.0;})){
        var pName=pillars[pi]||('Pillar '+(pi+1));
        var k='pillar_drop_'+pid+'_'+pi;
        if(!dismissed[k]) alerts.push({colour:'danger',playerId:pid,message:p.nick+' — '+pName+' below 5 for 3 straight games',key:k});
        break;
      }
    }

    // 2. Overall rating drop — last 3 vs games 4–6
    if(pGames.length>=6){
      var rAvg=avgPillars(pGames.slice(0,3));
      var pAvg=avgPillars(pGames.slice(3,6));
      if(pAvg>0&&rAvg>0&&pAvg-rAvg>=1.5){
        var k='overall_drop_'+pid;
        if(!dismissed[k]) alerts.push({colour:'danger',playerId:pid,message:p.nick+' overall score dropped from '+pAvg.toFixed(1)+' to '+rAvg.toFixed(1)+' this week',key:k});
      }
    }

    // 3. Death spike — last game deaths >40% above personal avg
    var deathHist=pGames.slice(1).map(function(g){var s=g.playerScores&&g.playerScores[pid];return s?+s.deaths:null;}).filter(function(v){return v!=null&&!isNaN(v);});
    var lastDeaths=(function(){var s=pGames[0].playerScores&&pGames[0].playerScores[pid];return s?+s.deaths:null;})();
    if(deathHist.length>=2&&lastDeaths!=null){
      var avgD=deathHist.reduce(function(a,b){return a+b;},0)/deathHist.length;
      if(avgD>0&&lastDeaths>avgD*1.4){
        var pct=Math.round((lastDeaths/avgD-1)*100);
        var k='death_spike_'+pid;
        if(!dismissed[k]) alerts.push({colour:'warn',playerId:pid,message:p.nick+' died '+lastDeaths+' times — '+pct+'% above their usual average',key:k});
      }
    }

    // 4. Improvement streak — same pillar strictly increasing last 3 games
    var improved=false;
    for(var pi2=0;pi2<4&&!improved;pi2++){
      var s0=getPillar(l3[2],pi2),s1=getPillar(l3[1],pi2),s2=getPillar(l3[0],pi2);
      if(s0!=null&&s1!=null&&s2!=null&&s2>s1&&s1>s0){
        var pName2=pillars[pi2]||('Pillar '+(pi2+1));
        var k2='improve_'+pid+'_'+pi2;
        if(!dismissed[k2]) alerts.push({colour:'success',playerId:pid,message:p.nick+'\'s '+pName2+' pillar has improved 3 games in a row',key:k2});
        improved=true;
      }
    }

    // 5. Gold deficit — outgolded by opponent 3 of last 3 games
    var gBehind=l3.filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&s.gold!=null&&s.opp_gold!=null&&+s.gold<+s.opp_gold;}).length;
    if(gBehind===3){
      var k='gold_deficit_'+pid;
      if(!dismissed[k]) alerts.push({colour:'warn',playerId:pid,message:p.nick+' has been out-golded by enemy '+p.role+' 3 games running',key:k});
    }

    // 6. Narrow hero pool — ≤2 distinct heroes in last 10 games
    if(l10.length>=10){
      var heroSet={};
      l10.forEach(function(g){var s=g.playerScores&&g.playerScores[pid];if(s&&s.hero) heroSet[s.hero]=true;});
      var hCount=Object.keys(heroSet).length;
      if(hCount<=2){
        var k='hero_pool_'+pid;
        if(!dismissed[k]) alerts.push({colour:'info',playerId:pid,message:p.nick+' has only played '+hCount+' hero'+(hCount===1?'':'es')+' in the last 10 games — low pool depth',key:k});
      }
    }

    // 7. Low win rate on frequently played hero (<33% with 3+ games)
    var heroWR={};
    pGames.forEach(function(g){var s=g.playerScores&&g.playerScores[pid];if(!s||!s.hero) return;if(!heroWR[s.hero]) heroWR[s.hero]={w:0,n:0};heroWR[s.hero].n++;if(g.result==='Win') heroWR[s.hero].w++;});
    Object.keys(heroWR).forEach(function(hero){
      var h=heroWR[hero];
      if(h.n>=3&&h.w/h.n<0.33){
        var k='hero_wr_'+pid+'_'+hero.toLowerCase().replace(/\s+/g,'_');
        if(!dismissed[k]) alerts.push({colour:'danger',playerId:pid,message:p.nick+' has a '+h.w+'-'+(h.n-h.w)+' record on '+hero+' — consider avoiding in draft',key:k});
      }
    });
  });

  // Sort: danger > warn > success > info
  var order={danger:0,warn:1,success:2,info:3};
  alerts.sort(function(a,b){return(order[a.colour]||99)-(order[b.colour]||99);});
  return alerts;
}

function renderAlertsSection(games,matches){
  var alerts=generateAlerts(games,matches);
  var MAX=6;
  var shown=alerts.slice(0,MAX);
  var extra=alerts.length-shown.length;
  var colMap={danger:'var(--danger)',warn:'var(--warn)',success:'var(--success)',info:'var(--auto)'};

  if(!games||games.length<3){
    return '<section class="hd-card hd-alerts">'+
      '<div class="hd-alerts-head"><div class="hd-label">Form alerts</div></div>'+
      '<div class="hd-placeholder-inner">'+
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" style="opacity:0.35;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"/></svg>'+
        '<div class="ph-title">NOT ENOUGH DATA</div>'+
        '<div class="ph-sub">Log 5+ games to activate alerts</div>'+
      '</div>'+
    '</section>';
  }

  var badge=alerts.length?'<span class="hd-alert-badge">'+alerts.length+'</span>':'';
  var content='';
  if(!shown.length){
    content='<div class="hd-placeholder-inner" style="padding:20px;">'+
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="1.8" style="opacity:0.7;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'+
      '<div class="ph-title" style="color:var(--success);font-size:13px;">ALL CLEAR</div>'+
      '<div class="ph-sub">No active alerts — keep it up</div>'+
    '</div>';
  } else {
    content='<div class="hd-alert-list">'+
      shown.map(function(a){
        var col=colMap[a.colour]||'var(--grey-5)';
        var oc=a.playerId?'onclick="showProfile(\''+a.playerId+'\')"':'';
        return '<div class="hd-alert-item" id="alert-'+a.key+'">'+
          '<span class="hd-alert-dot" style="background:'+col+';box-shadow:0 0 4px '+col+';"></span>'+
          '<div class="hd-alert-msg" '+oc+' style="'+(a.playerId?'cursor:pointer;':'')+'">'+a.message+'</div>'+
          '<button class="alert-banner-dismiss" onclick="dismissAlert(\''+a.key+'\')">&#x2715;</button>'+
        '</div>';
      }).join('')+
    '</div>';
    if(extra>0){
      content+='<div class="hd-alert-more">+'+extra+' more</div>';
    }
  }
  return '<section class="hd-card hd-alerts">'+
    '<div class="hd-alerts-head"><div class="hd-label">Form alerts '+badge+'</div></div>'+
    content+
  '</section>';
}

function renderHome(){
  PLAYERS=getPlayers();
  var data=loadData();
  var games=data.games||[];
  var matches=_cache.matches||[];

  var el=document.getElementById('home-date');
  if(el) el.textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase();

  // ── Quick stats (all from games_v2) ──
  var totalGames=games.length;
  var totalWins=games.filter(function(g){return g.result==='Win';}).length;
  var gEl=document.getElementById('qs-games');if(gEl) gEl.textContent=totalGames;
  var sEl=document.getElementById('qs-sessions');if(sEl) sEl.textContent=matches.length||'--';
  var wEl=document.getElementById('qs-winrate');if(wEl) wEl.textContent=totalGames?Math.round(totalWins/totalGames*100)+'%':'--';

  // ── Win rate by game type: Scrim vs Tournament ──
  function typeStats(type){
    var gs=games.filter(function(g){return (g.type||'Scrim')===type;});
    var w=gs.filter(function(g){return g.result==='Win';}).length;
    return {n:gs.length,w:w,l:gs.length-w,wr:gs.length?Math.round(w/gs.length*100):null};
  }
  function typeCard(label,st,accent){
    var wrTxt=st.wr!=null?st.wr+'%':'--';
    var pct=st.wr!=null?st.wr:0;
    return '<div style="background:var(--grey-1);border:var(--border);padding:14px 16px;">'+
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:'+accent+';">'+label+'</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+st.w+'W – '+st.l+'L</div>'+
      '</div>'+
      '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:26px;">'+wrTxt+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+st.n+' game'+(st.n!==1?'s':'')+'</div></div>'+
      '<div style="height:4px;background:var(--grey-3);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+accent+';border-radius:2px;transition:width 0.4s ease;"></div></div>'+
    '</div>';
  }
  var wt=document.getElementById('home-winrate-type');
  if(wt){
    if(!totalGames){
      wt.innerHTML='<div class="empty" style="padding:20px;"><div class="empty-icon">📊</div><div class="empty-text">No games logged yet</div></div>';
    } else {
      wt.innerHTML='<div style="margin:0 20px 12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
        typeCard('SCRIM',typeStats('Scrim'),'var(--auto)')+
        typeCard('TOURNAMENT',typeStats('Tournament'),'var(--warn)')+
      '</div>';
    }
  }

  // ── Alerts (mobile) ──
  var mobileAlerts=generateAlerts(games,matches).filter(function(a){return a.colour==='danger'||a.colour==='warn';}).slice(0,3);
  var alertsHtml=mobileAlerts.map(function(a){
    var cls=a.colour==='danger'?'alert-banner-danger':'alert-banner-warn';
    var oc=a.playerId?'showProfile(\''+a.playerId+'\')':'';
    return '<div class="alert-banner '+cls+'" id="alert-'+a.key+'"><div style="flex:1;cursor:pointer;" onclick="'+oc+'">'+a.message+'</div><button class="alert-banner-dismiss" onclick="dismissAlert(\''+a.key+'\')">&#x2715;</button></div>';
  }).join('');
  var aEl=document.getElementById('home-alerts');if(aEl) aEl.innerHTML=alertsHtml;

  // ── Recent sessions list ──
  var c=document.getElementById('home-sessions');
  if(c){
    var recentMatches=matches.slice().sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0);}).slice(0,5);
    if(!totalGames&&!recentMatches.length){
      c.innerHTML='<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No sessions logged yet</div></div>';
    } else if(recentMatches.length){
      c.innerHTML=recentMatches.map(function(m){
        var mGames=games.filter(function(g){return g.matchId===m.id;});
        var w=mGames.filter(function(g){return g.result==='Win';}).length;
        var series=mGames.length?w+'–'+(mGames.length-w):'No games';
        var sr=mGames.length?(w>mGames.length-w?'Win':w<mGames.length-w?'Loss':'Tie'):null;
        return '<div class="player-row" onclick="showMatchDetail(\''+m.id+'\')">'+
          '<div style="flex:1;"><div style="font-weight:600;font-size:13px;">'+m.name+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-top:2px;">'+_fmtDate(m.date)+(m.type?' · '+m.type:'')+'</div></div>'+
          (sr&&sr!=='Tie'?'<span class="tag '+(sr==='Win'?'tag-win':'tag-loss')+'">'+series+'</span>':'<span class="tag tag-role" style="font-size:8px;">'+series+'</span>')+
        '</div>';
      }).join('');
    } else {
      c.innerHTML=games.slice().sort(function(a,b){return new Date(b.savedAt||0)-new Date(a.savedAt||0);}).slice(0,5).map(function(g){
        return '<div class="player-row" onclick="openGameDetail(\''+g.id+'\')"><div style="flex:1;"><div style="font-weight:600;font-size:13px;">'+(g.opponent||'Unknown Opponent')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-top:2px;">'+_fmtDate(g.date)+' · '+(g.type||'Scrim')+'</div></div><span class="tag '+(g.result==='Win'?'tag-win':'tag-loss')+'">'+g.result+'</span></div>';
      }).join('');
    }
  }

  renderTeamSummary(data);
  renderHomeDesktop(data);
}

// ── DESKTOP HOME (editorial redesign) ─────────────────────
function renderHomeDesktop(data){
  var host=document.getElementById('home-d');if(!host) return;
  PLAYERS=getPlayers();
  var games=(data&&data.games)||[];
  var matches=_cache.matches||[];
  var now=new Date();
  var d30=new Date(now-30*24*60*60*1000);
  var recent30=games.filter(function(g){return parseDate(g.date)>=d30;});
  var wins30=recent30.filter(function(g){return g.result==='Win';}).length;
  var losses30=recent30.length-wins30;
  var wr30=recent30.length?Math.round(wins30/recent30.length*100):0;

  // 12-bucket win-rate sparkline across last 30d
  function buildWrSpark(){
    var buckets=12,out=[];
    if(!recent30.length){for(var k=0;k<buckets;k++)out.push(50);return out;}
    var sorted=recent30.slice().sort(function(a,b){return gameDateTime(a)-gameDateTime(b);});
    for(var i=0;i<buckets;i++){
      var endTs=now.getTime()-(buckets-1-i)*(30/buckets)*24*60*60*1000;
      var slice=sorted.filter(function(g){return parseDate(g.date).getTime()<=endTs;});
      if(!slice.length){out.push(wr30||50);continue;}
      var w=slice.filter(function(g){return g.result==='Win';}).length;
      out.push(Math.round(w/slice.length*100));
    }
    return out;
  }
  var wrSpark=buildWrSpark();

  var sessions=(_cache.matches||[]).length||games.filter(function(g){return g.gameNum==1;}).length||0;

  var orderedDesc=games.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);});
  var last5=orderedDesc.slice(0,5).reverse();
  var streakArr=last5.map(function(g){return g.result==='Win'?'W':'L';});
  var streak=0;
  if(orderedDesc.length){var first=orderedDesc[0].result;for(var j=0;j<orderedDesc.length;j++){if(orderedDesc[j].result===first)streak++;else break;}}
  var streakSide=orderedDesc.length?(orderedDesc[0].result==='Win'?'win streak':'losing streak'):null;
  var streakHtml=streak>=2?'on a <b style="color:'+(streakSide==='win streak'?'var(--success)':'var(--danger)')+';">'+streak+'-game '+streakSide+'</b>':'building rhythm';

  var recent4=orderedDesc.slice(0,4);

  // Matches sorted newest-first for "Recent sessions" panel
  var recentMatches=(_cache.matches||[]).slice().sort(function(a,b){
    var da=parseDate(a.date)||new Date(a.createdAt||0);
    var db=parseDate(b.date)||new Date(b.createdAt||0);
    return db-da;
  }).slice(0,4);

  var activePlayers=PLAYERS.filter(function(p){return p.status!=='Inactive';});

  // avg in-game rating from last 5 games for a player
  function avgIGRLast5(pid){
    var vals=games.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);})
      .map(function(g){var s=g.playerScores&&g.playerScores[pid];if(!s||s.skipped)return null;var v=s.in_game_rating!=null?+s.in_game_rating:(s.gameRating!=null?+s.gameRating:null);return v;})
      .filter(function(v){return v!=null&&!isNaN(v);}).slice(0,5);
    return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:null;
  }
  // avg coach (pillar) score from last 5 games; also returns the 5 scores for chart
  function coachScoresLast5(pid){
    var pl=PLAYERS.find(function(p){return p.id===pid;});
    var role=pl?pl.role:'';
    var vals=games.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);})
      .map(function(g){var s=g.playerScores&&g.playerScores[pid];if(!s||s.skipped)return null;var v=calcGameScore(s,role,g,pid);return v>0?v:null;})
      .filter(function(v){return v!=null;}).slice(0,5);
    var avg=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:null;
    return {avg:avg,vals:vals.reverse()};
  }

  // spotlight = best 7d performer
  var spotlight=null,spotVal=-1;
  activePlayers.forEach(function(p){
    var st=getPlayerStats(p.id,games);
    if(st.weekAvg>spotVal){spotVal=st.weekAvg;spotlight=p;}
  });
  if(!spotlight&&activePlayers.length) spotlight=activePlayers[0];

  var coachName='CHAKARIN';
  var dateStr=now.toLocaleDateString('en-GB',{weekday:'short',month:'short',day:'numeric',year:'numeric'}).toUpperCase();
  var spotNote=spotlight?'<b>'+spotlight.nick+'</b> is your top performer this week.':'';

  function spark(arr,opts){
    opts=opts||{};
    var w=opts.w||60,h=opts.h||20,color=opts.color||'#f4f4f0';
    if(!arr||!arr.length) return '<svg class="hd-spark" width="'+w+'" height="'+h+'"></svg>';
    var min=Math.min.apply(null,arr),max=Math.max.apply(null,arr),range=(max-min)||1;
    var step=arr.length>1?w/(arr.length-1):0;
    var pts=arr.map(function(v,i){return[i*step,h-((v-min)/range)*(h-2)-1];});
    var threshold=opts.threshold;
    var segs='';
    if(threshold!=null){
      for(var i=1;i<pts.length;i++){
        var c=(arr[i]>=threshold&&arr[i-1]>=threshold)?(opts.hi||'#44ff88'):color;
        segs+='<path d="M'+pts[i-1][0].toFixed(1)+','+pts[i-1][1].toFixed(1)+' L'+pts[i][0].toFixed(1)+','+pts[i][1].toFixed(1)+'" stroke="'+c+'" stroke-width="1.5" fill="none" stroke-linecap="round"/>';
      }
    } else {
      var d=pts.map(function(p,i){return(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
      segs='<path d="'+d+'" stroke="'+color+'" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    var lastCol=threshold!=null&&arr[arr.length-1]>=threshold?(opts.hi||'#44ff88'):color;
    return '<svg class="hd-spark" width="'+w+'" height="'+h+'" style="overflow:visible;">'+segs+'<circle cx="'+pts[pts.length-1][0].toFixed(1)+'" cy="'+pts[pts.length-1][1].toFixed(1)+'" r="1.8" fill="'+lastCol+'"/></svg>';
  }

  function pfp(p,size){
    size=size||30;
    var url=data.pfp&&data.pfp[p.id];
    if(url) return '<div class="hd-rp-pic" style="width:'+size+'px;height:'+size+'px;"><img src="'+url+'" alt=""/></div>';
    return '<div class="hd-rp-pic" style="width:'+size+'px;height:'+size+'px;">'+(p.nick||'?').slice(0,2).toUpperCase()+'</div>';
  }

  var weekNum=Math.ceil((now.getDate())/7);
  var greetingHtml=''+
    '<div class="home-d-greeting">'+
      '<div class="home-d-date">'+dateStr+' · WEEK '+weekNum+'</div>'+
      '<h1>GOOD MORNING, COACH <span class="accent">'+coachName+'</span></h1>'+
      '<div class="sub">You\'re '+streakHtml+'. '+spotNote+'</div>'+
    '</div>';

  var wrHero=''+
    '<section class="hd-card hd-wr">'+
      '<div class="hd-wr-row">'+
        '<div class="hd-label">Win rate <span class="sub">· Last 30 days</span></div>'+
      '</div>'+
      '<div class="hd-wr-figure">'+
        '<div class="hd-wr-pct"><div class="n">'+wr30+'</div><div class="pct">%</div></div>'+
        '<div class="hd-wr-spark">'+spark(wrSpark,{w:340,h:50,color:'#44ff88'})+'</div>'+
      '</div>'+
      '<div class="hd-stat-row">'+
        '<div class="hd-stat"><div class="hd-stat-label">Record</div><div class="hd-stat-val mono">'+wins30+'-'+losses30+'</div></div>'+
        '<div class="hd-stat"><div class="hd-stat-label">Games</div><div class="hd-stat-val">'+recent30.length+'</div></div>'+
        '<div class="hd-stat"><div class="hd-stat-label">Sessions</div><div class="hd-stat-val">'+sessions+'</div></div>'+
        '<div class="hd-stat"><div class="hd-stat-label">Form</div><div class="hd-stat-val">'+
          (streakArr.length?streakArr.map(function(r){return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+(r==='W'?'var(--success)':'var(--danger)')+';box-shadow:0 0 5px '+(r==='W'?'rgba(68,255,136,0.5)':'rgba(255,68,68,0.5)')+';"></span>';}).join(' '):'<span style="color:var(--grey-4);font-size:14px;">—</span>')+
        '</div></div>'+
      '</div>'+
    '</section>';

  function recentMatchRowHtml(m,i){
    var mGames=(_cache.games||[]).filter(function(g){return g.matchId===m.id;});
    var wins=mGames.filter(function(g){return g.result==='Win';}).length;
    var losses=mGames.length-wins;
    var result=mGames.length?(wins>losses?'W':losses>wins?'L':'D'):null;
    var scoreStr=mGames.length?(wins+'–'+losses):'—';
    var type=(m.type||'Scrim').toUpperCase();
    var tierStr=m.oppTier?m.oppTier:'';
    var tierHtml=tierStr?'<span style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;padding:1px 5px;background:var(--grey-3);border-radius:1px;color:var(--grey-6);">'+tierStr+'</span>':'';
    var dateLabel=_fmtDate?_fmtDate(m.date):m.date;
    var rbClass=result==='W'?'W':result==='L'?'L':'';
    var rbHtml=result?'<span class="hd-rb '+rbClass+'">'+result+'</span>':'<span class="hd-rb" style="background:var(--grey-3);color:var(--grey-5);">—</span>';
    return '<div class="hd-recent-row'+(i===0?' top':'')+'" style="cursor:pointer;" onclick="showMatchDetail&&showMatchDetail(\''+m.id+'\')">'+
      rbHtml+
      '<div style="min-width:0;">'+
        '<div class="hd-opp" style="display:flex;align-items:center;gap:6px;">'+String(m.name||'UNTITLED').toUpperCase()+(tierHtml?' '+tierHtml:'')+'</div>'+
        '<div class="hd-meta">'+type+' · '+dateLabel+'</div>'+
      '</div>'+
      '<div class="hd-key" style="color:var(--grey-5);font-size:10px;">'+mGames.length+(mGames.length===1?' game':' games')+'</div>'+
      '<div class="hd-score" style="color:'+(result==='W'?'var(--success)':result==='L'?'var(--danger)':'var(--white)')+';">'+scoreStr+'</div>'+
      '<div class="hd-mvp"></div>'+
    '</div>';
  }

  var recentRows=recentMatches.length?recentMatches.map(recentMatchRowHtml).join(''):'<div class="hd-placeholder-inner" style="padding:30px;"><div class="ph-title">NO MATCHES YET</div><div class="ph-sub">Create a match to get started</div></div>';
  var recentSection=''+
    '<section class="hd-card hd-recent">'+
      '<div class="hd-recent-head"><div class="hd-label">Recent matches <span class="sub">· '+(recentMatches[0]?(_fmtDate?_fmtDate(recentMatches[0].date):recentMatches[0].date):'')+'</span></div><div class="hd-link" onclick="showPage(\'page-history\')">VIEW ALL →</div></div>'+
      '<div class="hd-recent-list">'+recentRows+'</div>'+
    '</section>';

  // Roster pulse: player name, position, avg IGR (last 5), avg coach score (last 5, bold), bar chart of last 5 coach scores
  function coachBarChart(vals){
    if(!vals||!vals.length) return '<span style="color:var(--grey-4);font-family:\'DM Mono\',monospace;font-size:9px;">—</span>';
    var w=60,h=22,bw=8,gap=3;
    var total=vals.length,totalW=total*bw+(total-1)*gap;
    var startX=(w-totalW)/2;
    var bars=vals.map(function(v,i){
      var pct=Math.min(Math.max(v/10,0),1);
      var barH=Math.max(Math.round(pct*(h-2))+1,2);
      var x=startX+i*(bw+gap);
      var y=h-barH;
      var col=v>=6.5?'var(--success)':v<5?'var(--danger)':'var(--white)';
      var opacity=v>=6.5?1:v<5?0.9:0.75;
      return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw+'" height="'+barH+'" rx="1" fill="'+col+'" opacity="'+opacity+'"/>';
    }).join('');
    return '<svg width="'+w+'" height="'+h+'" style="overflow:visible;display:block;">'+bars+'</svg>';
  }

  var rpRows=activePlayers.map(function(p){
    var avgIGR=avgIGRLast5(p.id);
    var cs=coachScoresLast5(p.id);
    return '<div class="hd-rp-row" onclick="showProfile(\''+p.id+'\')">'+
      pfp(p,30)+
      '<div style="min-width:0;"><div class="hd-rp-name">'+p.nick+'</div><div class="hd-rp-role">'+p.role+'</div></div>'+
      '<div style="display:flex;align-items:center;justify-content:center;">'+coachBarChart(cs.vals)+'</div>'+
      '<div class="hd-rp-rating"><span class="v">'+(avgIGR!=null?avgIGR.toFixed(1):'—')+'</span><span class="lbl">IGR</span></div>'+
      '<div class="hd-rp-rating coach"><span class="v">'+(cs.avg!=null?cs.avg.toFixed(1):'—')+'</span><span class="lbl">COACH</span></div>'+
    '</div>';
  }).join('');

  var rosterSection=''+
    '<section class="hd-card hd-rp">'+
      '<div class="hd-rp-head"><div class="hd-label">Roster pulse <span class="sub">· Last 5 games</span></div><div class="hd-link" onclick="showPage(\'page-roster\')">OPEN ROSTER →</div></div>'+
      '<div class="hd-rp-list">'+(rpRows||'<div class="hd-placeholder-inner"><div class="ph-sub">No active players</div></div>')+'</div>'+
    '</section>';

  // Find nearest upcoming match (date >= today, no past games that fill the BO)
  var todayIso=(function(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);})();
  var upcomingMatch=null;
  (_cache.matches||[]).slice().sort(function(a,b){return (a.date||'')>(b.date||'')?1:-1;}).forEach(function(m){
    if(upcomingMatch) return;
    if(m.date&&m.date>=todayIso) upcomingMatch=m;
  });
  var nextMatchHtml;
  if(upcomingMatch){
    var um=upcomingMatch;
    var umGames=(_cache.games||[]).filter(function(g){return g.matchId===um.id;});
    var umWins=umGames.filter(function(g){return g.result==='Win';}).length;
    var umType=(um.type||'Scrim').toUpperCase();
    var umTierHtml=um.oppTier?'<span style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;padding:1px 6px;background:var(--grey-3);border-radius:1px;color:var(--grey-6);">'+um.oppTier+'</span>':'';
    var daysOut=Math.max(0,Math.round((parseDate(um.date)-now)/(1000*60*60*24)));
    var scorePreview=umGames.length?'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-top:2px;">'+umWins+' – '+(umGames.length-umWins)+' so far</div>':'';
    nextMatchHtml=''+
      '<section class="hd-card hd-next" style="min-height:108px;cursor:pointer;" onclick="showMatchDetail&&showMatchDetail(\''+um.id+'\')">'+
        '<div class="left">'+
          '<div class="hd-label">Next match'+
            (umTierHtml?' '+umTierHtml:'')+
            '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1.5px;margin-left:6px;">'+umType+'</span>'+
          '</div>'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:28px;letter-spacing:1.5px;margin-top:6px;">VS '+String(um.name||'—').toUpperCase()+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);letter-spacing:1.5px;margin-top:4px;">'+(_fmtDate?_fmtDate(um.date):um.date)+'</div>'+
          scorePreview+
        '</div>'+
        '<div style="text-align:right;">'+
          '<div class="countdown" style="color:var(--success);">'+daysOut+'</div>'+
          '<div class="label">DAYS OUT</div>'+
        '</div>'+
      '</section>';
  } else {
    nextMatchHtml=''+
      '<section class="hd-card hd-next" style="min-height:108px;">'+
        '<div class="left">'+
          '<div class="hd-label">Next match</div>'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:1.5px;margin-top:8px;color:var(--grey-5);">NO UPCOMING MATCHES</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-4);letter-spacing:1.5px;margin-top:4px;">Create a match in History to schedule ahead</div>'+
        '</div>'+
        '<div style="text-align:right;">'+
          '<div class="countdown" style="color:var(--grey-4);">—</div>'+
          '<div class="label">DAYS OUT</div>'+
        '</div>'+
      '</section>';
  }

  var spotlightHtml='';
  if(spotlight){
    var pfpUrl=data.pfp&&data.pfp[spotlight.id];
    var st=getPlayerStats(spotlight.id,games);
    var spotIGR=avgIGRLast5(spotlight.id);
    var grade=scoreToGrade(st.monthAvg);
    spotlightHtml=''+
      '<section class="hd-card hd-spot" onclick="showProfile(\''+spotlight.id+'\')" style="cursor:pointer;">'+
        '<div class="hd-spot-bg">'+(pfpUrl?'<img src="'+pfpUrl+'" alt=""/>':'')+'<div class="grad"></div></div>'+
        '<div class="hd-spot-inner">'+
          '<div>'+
            '<div class="hd-label" style="display:flex;align-items:center;gap:8px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success);"></span> Player spotlight <span class="sub">· 7d top</span></div>'+
            '<div class="hd-spot-name">'+spotlight.nick.toUpperCase()+'</div>'+
            '<div class="hd-spot-sub">'+spotlight.ign+' · '+spotlight.role.toUpperCase()+'</div>'+
          '</div>'+
          '<div class="hd-spot-bottom">'+
            '<div class="hd-spot-stat"><div class="v">'+(spotIGR!=null?spotIGR.toFixed(1):(st.weekAvg>0?st.weekAvg.toFixed(1):'—'))+'<span class="p"> /10</span></div><div class="l">AVG IN-GAME · 7D</div></div>'+
            '<div class="hd-spot-stat" style="text-align:right;"><div class="v" style="color:var(--white);">'+(grade?grade.grade:'—')+'</div><div class="l">FORM</div></div>'+
          '</div>'+
        '</div>'+
      '</section>';
  }

  var alertsPlaceholder=renderAlertsSection(games,matches);

  host.innerHTML=''+
    greetingHtml+
    '<div class="home-d-body">'+
      '<div class="home-d-col">'+
        wrHero+
        '<div class="hd-mid-row">'+recentSection+rosterSection+'</div>'+
        nextMatchHtml+
      '</div>'+
      '<div class="home-d-col">'+
        spotlightHtml+
        alertsPlaceholder+
      '</div>'+
    '</div>';

  updateCoachFab();
}

function updateCoachFab(){
  var fab=document.getElementById('home-coach-fab');if(!fab) return;
  var homeActive=document.getElementById('page-home')&&document.getElementById('page-home').classList.contains('active');
  var isDesktop=window.matchMedia('(min-width:768px)').matches;
  if(homeActive&&isDesktop) fab.classList.add('show'); else fab.classList.remove('show');
  if(!homeActive||!isDesktop) closeCoachMenu();
  var data=(typeof loadData==='function')?loadData():null;
  var picEl=document.getElementById('home-coach-fab-pic');
  if(picEl){
    var pfpU=data&&data.pfp&&(data.pfp.ck||data.pfp.coach);
    picEl.innerHTML=pfpU?'<img src="'+pfpU+'" alt="" style="width:100%;height:100%;object-fit:cover;"/>':'CK';
  }
}
function toggleCoachMenu(e){if(e)e.stopPropagation();var m=document.getElementById('home-coach-menu');if(m)m.classList.toggle('open');}
function closeCoachMenu(){var m=document.getElementById('home-coach-menu');if(m)m.classList.remove('open');}
document.addEventListener('click',function(e){
  var menu=document.getElementById('home-coach-menu');var fab=document.getElementById('home-coach-fab');
  if(!menu||!fab) return;
  if(menu.classList.contains('open')&&!menu.contains(e.target)&&!fab.contains(e.target)) closeCoachMenu();
});
window.addEventListener('resize',function(){if(typeof updateCoachFab==='function') updateCoachFab();});

function renderTeamSummary(data){
  PLAYERS=getPlayers();
  var container=document.getElementById('home-team-summary');if(!container)return;
  var playerStats=PLAYERS.filter(function(p){return p.status!=='Inactive';}).map(function(p){
    var st=getPlayerStats(p.id,data.games);return{p:p,monthAvg:st.monthAvg,weekAvg:st.weekAvg};
  }).filter(function(x){return x.monthAvg>0;});
  if(!playerStats.length){container.innerHTML='<div class="empty" style="padding:20px;"><div class="empty-icon">📊</div><div class="empty-text">No data yet — log some games</div></div>';return;}
  var sorted=playerStats.slice().sort(function(a,b){return b.monthAvg-a.monthAvg;});
  var best=sorted[0],worst=sorted[sorted.length-1];
  var weekStats=PLAYERS.filter(function(p){return p.status!=='Inactive';}).map(function(p){var st=getPlayerStats(p.id,data.games);return{p:p,weekAvg:st.weekAvg};}).filter(function(x){return x.weekAvg>0;}).sort(function(a,b){return b.weekAvg-a.weekAvg;});
  var bestWeek=weekStats[0]||null;
  var teamAvg=playerStats.reduce(function(a,x){return a+x.monthAvg;},0)/playerStats.length;
  var teamGrade=scoreToGrade(teamAvg);
  var tgc=teamGrade?teamGrade.cls:'grade-am',tgv=teamGrade?teamGrade.grade:'--';
  function sAvatar(p,size){var pfp=data.pfp&&data.pfp[p.id];size=size||32;if(pfp)return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid var(--grey-3);"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>';return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:'+Math.floor(size*0.42)+'px;color:var(--grey-6);">'+p.nick[0]+'</div>';}
  var bars=playerStats.map(function(x){var g=scoreToGrade(x.monthAvg);var bc=g&&g.cls==='grade-sp'?'#fff':g&&g.cls==='grade-s'?'#e8e8e8':g&&g.cls==='grade-sm'?'#c8c8c8':g&&g.cls==='grade-ap'?'#aaa':g&&g.cls==='grade-a'?'#888':'#555';return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+sAvatar(x.p,24)+'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);width:44px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+x.p.nick+'</div><div style="flex:1;height:3px;background:var(--grey-3);border-radius:2px;"><div style="height:100%;width:'+x.monthAvg*10+'%;background:'+bc+';border-radius:2px;"></div></div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);width:24px;text-align:right;">'+x.monthAvg.toFixed(1)+'</div></div>';}).join('');
  var bgc=scoreToGrade(best.monthAvg)?.cls||'grade-am',bgv=scoreToGrade(best.monthAvg)?.grade||'--';
  var wgc=scoreToGrade(worst.monthAvg)?.cls||'grade-am',wgv=scoreToGrade(worst.monthAvg)?.grade||'--';
  var bwHtml=bestWeek?'<div style="margin:0 20px 16px;background:var(--grey-1);border:var(--border);padding:12px 16px;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--warn);margin-bottom:10px;">BEST OF THE WEEK</div><div style="display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="showProfile(\''+bestWeek.p.id+'\')">'+sAvatar(bestWeek.p,44)+'<div style="flex:1;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;">'+bestWeek.p.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+bestWeek.p.role+'</div></div><div><div class="grade '+(scoreToGrade(bestWeek.weekAvg)?.cls||'grade-am')+'" style="font-size:24px;">'+(scoreToGrade(bestWeek.weekAvg)?.grade||'--')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);text-align:right;">'+bestWeek.weekAvg.toFixed(1)+'/10</div></div></div></div>':'';
  container.innerHTML=
    '<div style="margin:0 20px 16px;background:var(--grey-1);border:var(--border);padding:14px 16px;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;color:var(--grey-5);">TEAM AVG</div><div style="display:flex;align-items:baseline;gap:6px;"><div class="grade '+tgc+'" style="font-size:22px;">'+tgv+'</div><div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">'+teamAvg.toFixed(1)+'/10</div></div></div>'+bars+
    '</div>'+
    '<div style="margin:0 20px 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
      '<div style="background:var(--grey-1);border:var(--border);padding:12px;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--success);margin-bottom:8px;">TOP PLAYER</div><div style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="showProfile(\''+best.p.id+'\')">'+sAvatar(best.p,36)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;">'+best.p.nick+'</div><div class="grade '+bgc+'" style="font-size:16px;">'+bgv+'</div></div></div></div>'+
      '<div style="background:var(--grey-1);border:var(--border);padding:12px;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--danger);margin-bottom:8px;">NEEDS WORK</div><div style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="showProfile(\''+worst.p.id+'\')">'+sAvatar(worst.p,36)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;">'+worst.p.nick+'</div><div class="grade '+wgc+'" style="font-size:16px;">'+wgv+'</div></div></div></div>'+
    '</div>'+
    bwHtml;
}

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════
function showPage(id){
  // PIN gate for settings
  if(id==='page-settings'&&_cache.settingsPin&&!_cache._pinUnlocked){
    document.getElementById('pin-entry-inp').value='';
    document.getElementById('pin-entry-err').style.display='none';
    document.getElementById('pin-entry-modal').classList.add('open');
    return;
  }
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  var pg=document.getElementById(id);if(pg) pg.classList.add('active');
  // Clear all nav active states
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  // Highlight mobile tab
  var mobileMap={'page-home':'nav-home','page-roster':'nav-roster','page-heroes':'nav-heroes'};
  var drawerMap={'page-log':'drawer-log','page-history':'drawer-history','page-tiers':'drawer-tiers','page-settings':'drawer-settings','page-benchmarks':'drawer-benchmarks'};
  if(mobileMap[id]) document.getElementById(mobileMap[id])?.classList.add('active');
  else if(drawerMap[id]||id==='page-match') document.getElementById('nav-more-btn')?.classList.add('active');
  // Highlight desktop sidebar
  var desktopMap={'page-home':'nav-home-d','page-log':'nav-log','page-roster':'nav-roster-d','page-history':'nav-history','page-tiers':'nav-tiers','page-heroes':'nav-heroes-d','page-benchmarks':'nav-benchmarks-d'};
  if(desktopMap[id]) document.getElementById(desktopMap[id])?.classList.add('active');
  // Highlight drawer items
  document.querySelectorAll('.more-drawer-item').forEach(function(el){el.classList.remove('active-drawer-item');});
  if(drawerMap[id]) document.getElementById(drawerMap[id])?.classList.add('active-drawer-item');
  if(id==='page-home')    renderHome();
  if(id==='page-roster')  renderRoster();
  if(id==='page-history') renderHistory();
  if(id==='page-log')     initLog();
  if(id==='page-compare') renderCompare();
  if(id==='page-tiers')   initTiers();
  if(id==='page-heroes')  renderHeroes();
  if(id==='page-settings'){updateDBStatusCard();}
  if(typeof updateCoachFab==='function') updateCoachFab();
  window.scrollTo(0,0);
}

function openMoreDrawer(){
  document.getElementById('more-drawer').style.display='block';
  document.getElementById('more-drawer-overlay').classList.add('open');
}
function closeMoreDrawer(){
  document.getElementById('more-drawer').style.display='none';
  document.getElementById('more-drawer-overlay').classList.remove('open');
}

function dismissAlert(key){_cache.dismissed[key]=true;localStorage.setItem('ps_dismissed',JSON.stringify(_cache.dismissed));var el=document.getElementById('alert-'+key);if(el)el.remove();}

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
function closeModal(id){document.getElementById(id).classList.remove('open');}
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2200);}


// ══════════════════════════════════════════
// ROSTER
// ══════════════════════════════════════════
// ROSTER
// ══════════════════════════════════════════
var _rosterMode='cards';
function setRosterMode(m){_rosterMode=m;renderRoster();}

// ── Pick mode state ──
var _pickMode=false;
window._pickA=null;
window._pickB=null;

function enterPickMode(){
  _pickMode=true;window._pickA=null;window._pickB=null;
  _rosterMode='cards';renderRoster();
}
function exitPickMode(){
  _pickMode=false;window._pickA=null;window._pickB=null;renderRoster();
}
function cardClick(pid,ev){
  if(!_pickMode){showProfile(pid);return;}
  if(window._pickA===pid){window._pickA=null;_updatePickClasses();return;}
  if(window._pickB===pid){window._pickB=null;_updatePickClasses();return;}
  if(!window._pickA){window._pickA=pid;_updatePickClasses();}
  else if(!window._pickB){window._pickB=pid;_updatePickClasses();setTimeout(startCompareTransition,400);}
}
function _updatePickClasses(){
  var cards=document.querySelectorAll('[data-pid]');
  cards.forEach(function(card){
    var pid=card.getAttribute('data-pid');
    card.classList.remove('pick-sel-a','pick-sel-b','pick-faded');
    if(pid===window._pickA)card.classList.add('pick-sel-a');
    else if(pid===window._pickB)card.classList.add('pick-sel-b');
    else if(window._pickA&&window._pickB)card.classList.add('pick-faded');
  });
}
function startCompareTransition(){
  var cardA=document.querySelector('[data-pid="'+window._pickA+'"]');
  var cardB=document.querySelector('[data-pid="'+window._pickB+'"]');
  if(cardA)cardA.classList.add('pick-fly-left');
  if(cardB)cardB.classList.add('pick-fly-right');
  var pidA=window._pickA,pidB=window._pickB;
  setTimeout(function(){
    window._rosterCmpA=pidA;window._rosterCmpB=pidB;
    _pickMode=false;window._pickA=null;window._pickB=null;
    _rosterMode='compare';renderRoster();
  },500);
}

function renderRoster(){
  PLAYERS=getPlayers();var data=loadData();
  var activeCount=PLAYERS.filter(function(p){return p.status!=='Inactive';}).length;
  var inactiveCount=PLAYERS.filter(function(p){return p.status==='Inactive';}).length;

  var starters=PLAYERS.filter(function(p){return p.status==='Starter';});
  var subs=PLAYERS.filter(function(p){return p.status==='Substitute';});
  var inactive=PLAYERS.filter(function(p){return p.status==='Inactive';});

  var mode=_rosterMode||'cards';

  // ── Build header with title + mode buttons on same line ──
  var hdrEl=document.getElementById('roster-page-header');
  if(hdrEl){
    hdrEl.innerHTML=
      '<div class="roster-hdr-inner">'+
        '<div class="roster-hdr-left">'+
          '<div class="roster-hdr-title">ROSTER</div>'+
          '<div class="roster-mode-btns">'+
            '<button class="roster-mode-btn'+(mode==='cards'?' active':'')+'" onclick="setRosterMode(\'cards\')">Cards</button>'+
            '<button class="roster-mode-btn'+(mode==='list'?' active':'')+'" onclick="setRosterMode(\'list\')">List</button>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">'+
          (_pickMode?
            '<button class="btn btn-sm" style="font-size:9px;padding:7px 14px;background:var(--grey-2);color:var(--grey-5);border:1px solid var(--grey-3);border-radius:3px;cursor:pointer;" onclick="exitPickMode()">Cancel</button>':
            '<button class="btn-compare-pick" onclick="enterPickMode()">⚖ COMPARE</button>')+
          '<button class="btn btn-sm btn-muted" style="font-size:9px;padding:7px 12px;flex-shrink:0;" onclick="openPlayerEdit(null)">+ Add Player</button>'+
        '</div>'+
      '</div>'+
      (_pickMode?'<div class="pick-mode-banner">'+
        (window._pickA&&window._pickB?'Both players selected — transitioning…':window._pickA?'Now click a second player to compare (blue)':'Click a player to select for comparison (green)')+
      '</div>':'')+
      '<div class="roster-hdr-sub" id="roster-subtitle">'+activeCount+' active · '+inactiveCount+' inactive</div>';
  }

  // ── Set compare/normal overflow mode on page and list ──
  var pageEl=document.getElementById('page-roster');
  var listEl=document.getElementById('roster-list');
  if(mode==='compare'){
    if(pageEl)pageEl.classList.add('cmp-active');
    if(listEl)listEl.classList.add('cmp-active');
  }else{
    if(pageEl)pageEl.classList.remove('cmp-active');
    if(listEl){listEl.classList.remove('cmp-active');listEl.style.cssText='';}
  }

  var modeBar='';

  // ── Shared helpers ──
  function getMonthStats(pid){
    var pl=PLAYERS.find(function(p){return p.id===pid;});
    var role=pl?pl.role:'';
    // Last 5 matches this player actually played (non-skipped), ordered newest-first
    var allPlayed=(data.games||[]).filter(function(g){
      var s=g.playerScores&&g.playerScores[pid];
      return s&&!s.skipped;
    }).slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);});
    var mGames=allPlayed.slice(0,5);
    var k=0,d=0,a=0,gpmS=0,gpmN=0,igrS=0,igrN=0,kpS=0,kpN=0;
    mGames.forEach(function(g){
      var s=g.playerScores[pid];
      k+=+(s.kills||0);d+=+(s.deaths||0);a+=+(s.assists||0);
      if(s.gold_per_min!=null){gpmS+=+s.gold_per_min;gpmN++;}
      if(s.in_game_rating!=null){igrS+=+s.in_game_rating;igrN++;}
      var tk=g.team_total_kills;
      if(tk&&tk>0){kpS+=((((s.kills||0)+(s.assists||0))/tk)*100);kpN++;}
    });
    var kda=mGames.length?((k+a)/Math.max(d,1)):null;
    var gpm=gpmN?gpmS/gpmN:null;
    var igr=igrN?igrS/igrN:null;
    var kp=kpN?kpS/kpN:null;
    var coachVals=mGames.map(function(g){var s=g.playerScores[pid];if(!s||s.skipped)return null;var v=calcGameScore(s,role,g,pid);return v>0?v:null;})
      .filter(function(v){return v!=null;});
    var coachAvg=coachVals.length?coachVals.reduce(function(a,b){return a+b;},0)/coachVals.length:null;
    // Chart shows last 5 in chronological order (oldest→newest left→right)
    var chartVals=mGames.slice().reverse().map(function(g){var s=g.playerScores[pid];if(!s||s.skipped)return null;var v=calcGameScore(s,role,g,pid);return v>0?v:null;})
      .filter(function(v){return v!=null;});
    return {kda:kda,gpm:gpm,igr:igr,kp:kp,coachAvg:coachAvg,chartVals:chartVals};
  }

  function getTop3Heroes(pid){
    var hMap={};
    (data.games||[]).forEach(function(g){
      var s=g.playerScores&&g.playerScores[pid];
      if(!s||s.skipped||!s.hero)return;
      hMap[s.hero]=(hMap[s.hero]||0)+1;
    });
    return Object.keys(hMap).sort(function(a,b){return hMap[b]-hMap[a];}).slice(0,5);
  }

  function rBarChart(vals){
    if(!vals||!vals.length)return '';
    var w=60,h=20,bw=7,gap=3,total=vals.length,totalW=total*bw+(total-1)*gap,startX=(w-totalW)/2;
    var bars=vals.map(function(v,i){
      var pct=Math.min(Math.max(v/10,0),1);
      var barH=Math.max(Math.round(pct*(h-2))+1,2);
      var x=startX+i*(bw+gap),y=h-barH;
      var col=v>=6.5?'var(--success)':v<5?'var(--danger)':'var(--white)';
      var op=v>=6.5?1:v<5?0.9:0.75;
      return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw+'" height="'+barH+'" rx="1" fill="'+col+'" opacity="'+op+'"/>';
    }).join('');
    return '<svg width="'+w+'" height="'+h+'" style="overflow:visible;display:block;">'+bars+'</svg>';
  }

  var ROLE_COL={Support:'#bbb',Midlane:'var(--warn)',Carry:'var(--danger)',Offlane:'var(--success)',Jungler:'var(--auto)'};

  function heroThumb(h,size,cls){
    var url=heroImgUrl(h);
    return '<div class="'+cls+'" style="width:'+size+'px;height:'+size+'px;">'+(url?'<img src="'+url+'" alt="" onerror="this.style.display=\'none\'"/>':'')+'</div>';
  }

  function pfpImg(p,size){
    var url=data.pfp&&data.pfp[p.id];
    if(url)return '<img class="rst-photo" src="'+url+'" alt="" onerror="this.style.display=\'none\'"/>';
    return '<div class="rst-photo-init">'+p.nick[0]+'</div>';
  }

  // ─── CARDS VIEW ──────────────────────────────────────────
  function renderCards(){
    // Count games played per player in their designated position
    var gamesCount={};
    (data.games||[]).forEach(function(g){
      if(!g.playerScores)return;
      PLAYERS.forEach(function(p){
        var s=g.playerScores[p.id];
        if(s&&!s.skipped)gamesCount[p.id]=(gamesCount[p.id]||0)+1;
      });
    });
    // Sort starters by games played in their position (desc); role order breaks ties
    var ROLE_ORDER={Carry:0,Jungler:1,Midlane:2,Offlane:3,Support:4};
    var sortedStarters=starters.slice().sort(function(a,b){
      var gDiff=(gamesCount[b.id]||0)-(gamesCount[a.id]||0);
      if(gDiff!==0)return gDiff;
      var rA=ROLE_ORDER[a.role]!==undefined?ROLE_ORDER[a.role]:99;
      var rB=ROLE_ORDER[b.role]!==undefined?ROLE_ORDER[b.role]:99;
      return rA-rB;
    });

    function starterCard(p,rank){
      var st=getMonthStats(p.id);
      var heroes=getTop3Heroes(p.id);
      var roleCol=ROLE_COL[p.role]||'var(--grey-6)';
      var igrGrade=st.igr!=null?scoreToGrade(st.igr):null;
      var coachGrade=st.coachAvg!=null?scoreToGrade(st.coachAvg):null;
      // Heroes overlaid inside portrait shadow
      var heroesOverlay=heroes.length?
        '<div class="rst-heroes-overlay">'+heroes.map(function(h){return heroThumb(h,26,'rst-hero-thumb');}).join('')+'</div>':'';
      var pickCls=window._pickA===p.id?' pick-sel-a':window._pickB===p.id?' pick-sel-b':(_pickMode&&window._pickA&&window._pickB?' pick-faded':'');
      return '<article class="roster-starter-card'+pickCls+'" data-pid="'+p.id+'" onclick="cardClick(\''+p.id+'\',event)">'+
        '<div class="rst-role-bar">'+
          '<span class="rst-role-label" style="color:'+roleCol+';">'+p.role+'</span>'+
          '<span class="rst-rank">'+String(rank).padStart(2,'0')+'</span>'+
        '</div>'+
        '<div class="rst-portrait">'+
          pfpImg(p,null)+
          '<div class="rst-grad"></div>'+
          '<div class="rst-sid"></div>'+
          heroesOverlay+
          '<div class="rst-name-block">'+
            '<div class="rst-nick">'+p.nick.toUpperCase()+'</div>'+
            '<div class="rst-ign">'+p.ign+'</div>'+
          '</div>'+
        '</div>'+
        '<div class="rst-stats">'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.kda!=null?st.kda.toFixed(2):'—')+'</div><div class="rst-stat-lbl">KDA</div></div>'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.gpm!=null?Math.round(st.gpm):'—')+'</div><div class="rst-stat-lbl">GPM</div></div>'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.kp!=null?Math.round(st.kp)+'%':'—')+'</div><div class="rst-stat-lbl">KP%</div></div>'+
        '</div>'+
        '<div class="rst-footer">'+
          '<div class="rst-footer-item">'+
            '<div class="rst-footer-val">'+(st.igr!=null?st.igr.toFixed(1):'—')+'</div>'+
            '<div class="rst-footer-lbl">IGR · L5</div>'+
            (igrGrade?'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);letter-spacing:1px;margin-top:1px;">'+igrGrade.grade+'</div>':'')+
          '</div>'+
          '<div class="rst-footer-item">'+
            '<div class="rst-footer-val">'+(st.coachAvg!=null?st.coachAvg.toFixed(1):'—')+'</div>'+
            '<div class="rst-footer-lbl">Coach · L5</div>'+
            (coachGrade?'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);letter-spacing:1px;margin-top:1px;">'+coachGrade.grade+'</div>':'')+
          '</div>'+
          '<div class="rst-footer-chart">'+rBarChart(st.chartVals)+'</div>'+
        '</div>'+
      '</article>';
    }

    function subCard(p){
      var st=getMonthStats(p.id);
      var heroes=getTop3Heroes(p.id);
      var roleCol=ROLE_COL[p.role]||'var(--grey-6)';
      var url=data.pfp&&data.pfp[p.id];
      var avatarHtml=url?
        '<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid var(--grey-3);"><img src="'+url+'" alt="" style="width:100%;height:100%;object-fit:cover;filter:grayscale(0.25);opacity:0.85;" onerror="this.style.display=\'none\'"/></div>':
        '<div style="width:40px;height:40px;border-radius:50%;background:var(--grey-3);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:17px;color:var(--grey-5);">'+p.nick[0]+'</div>';
      var pickClsSub=window._pickA===p.id?' pick-sel-a':window._pickB===p.id?' pick-sel-b':(_pickMode&&window._pickA&&window._pickB?' pick-faded':'');
      return '<article class="roster-sub-card'+pickClsSub+'" data-pid="'+p.id+'" onclick="cardClick(\''+p.id+'\',event)">'+
        '<div class="rst-sub-top">'+
          '<div style="display:flex;align-items:center;gap:5px;">'+
            '<div style="width:4px;height:4px;border-radius:50%;background:'+roleCol+';"></div>'+
            '<span class="rst-role-label" style="color:var(--grey-6);">'+p.role+'</span>'+
          '</div>'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:2px;">RESERVE</span>'+
        '</div>'+
        '<div class="rst-sub-body">'+
          avatarHtml+
          '<div style="flex:1;min-width:0;">'+
            '<div class="rst-sub-name">'+p.nick.toUpperCase()+'</div>'+
            '<div class="rst-sub-ign">'+p.ign+'</div>'+
            (heroes.length?'<div class="rst-sub-heroes">'+heroes.map(function(h){return heroThumb(h,20,'rst-sub-thumb');}).join('')+'</div>':'')+
          '</div>'+
          '<div style="display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;gap:0;">'+
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;color:var(--grey-5);line-height:1;">'+(st.igr!=null?st.igr.toFixed(1):'—')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1.5px;margin-bottom:4px;">IGR · L5</div>'+
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;color:var(--grey-4);line-height:1;">'+(st.coachAvg!=null?st.coachAvg.toFixed(1):'—')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1.5px;">Coach</div>'+
          '</div>'+
        '</div>'+
        (st.chartVals.length?'<div style="padding:4px 12px 7px;border-top:var(--border);">'+rBarChart(st.chartVals)+'</div>':'')+
      '</article>';
    }

    var startersHtml=sortedStarters.length?sortedStarters.map(function(p,i){return starterCard(p,i+1);}).join(''):
      '<div style="padding:20px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No starters yet</div>';
    var subsSection=subs.length?
      '<div class="roster-subs-section">'+
        '<div class="rst-subs-head">'+
          '<span class="rst-subs-title">Substitutes</span>'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);">'+subs.length+' reserve</span>'+
        '</div>'+
        '<div class="roster-subs-grid">'+subs.map(subCard).join('')+'</div>'+
      '</div>':'';

    return '<div class="roster-cards-layout">'+
      '<div class="roster-starters-grid">'+startersHtml+'</div>'+
      subsSection+
    '</div>';
  }

  // ─── LIST VIEW ───────────────────────────────────────────
  function renderList(){
    function listRow(p,isInactive){
      var st=getMonthStats(p.id);
      var heroes=getTop3Heroes(p.id);
      var url=data.pfp&&data.pfp[p.id];
      var roleCol=ROLE_COL[p.role]||'var(--grey-6)';
      var igrGrade=st.igr!=null?scoreToGrade(st.igr):null;
      var coachGrade=st.coachAvg!=null?scoreToGrade(st.coachAvg):null;
      var avatarHtml=url?
        '<div class="rst-list-avatar"><img src="'+url+'" alt="" onerror="this.style.display=\'none\'"/></div>':
        '<div class="rst-list-avatar">'+p.nick[0]+'</div>';
      var heroesHtml=heroes.length?('<div class="rst-list-heroes">'+heroes.map(function(h){return heroThumb(h,22,'rst-list-hero');}).join('')+'</div>'):'';
      return '<div class="rst-list-row'+(isInactive?' inactive':'')+'" onclick="showProfile(\''+p.id+'\')">'+
        avatarHtml+
        '<div class="rst-list-names">'+
          '<div class="rst-list-nick">'+p.nick.toUpperCase()+'</div>'+
          '<div class="rst-list-sub" style="color:'+roleCol+';">'+p.role+' <span style="color:var(--grey-4);">·</span> <span style="color:var(--grey-5);">'+p.ign+'</span></div>'+
        '</div>'+
        heroesHtml+
        '<div class="rst-list-right">'+
          '<div style="text-align:right;min-width:38px;">'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--white);">'+(st.kda!=null?st.kda.toFixed(2):'—')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1px;">KDA</div>'+
          '</div>'+
          '<div style="text-align:center;min-width:36px;">'+
            '<div class="rst-list-grade" style="color:var(--white);">'+(igrGrade?igrGrade.grade:(st.igr!=null?st.igr.toFixed(1):'—'))+'</div>'+
            '<div class="rst-list-grade-lbl">IGR</div>'+
          '</div>'+
          '<div style="text-align:center;min-width:36px;">'+
            '<div class="rst-list-grade" style="color:var(--white);">'+(coachGrade?coachGrade.grade:(st.coachAvg!=null?st.coachAvg.toFixed(1):'—'))+'</div>'+
            '<div class="rst-list-grade-lbl">Coach</div>'+
          '</div>'+
          (st.chartVals.length?('<div style="display:flex;align-items:center;">'+rBarChart(st.chartVals)+'</div>'):'')+
          '<button class="rst-list-edit" onclick="event.stopPropagation();openPlayerEdit(\''+p.id+'\')"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:12px;height:12px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>'+
        '</div>'+
      '</div>';
    }
    return '<div class="roster-list-themed">'+
      '<div class="rst-list-section">Starters</div>'+
      (starters.length?starters.map(function(p){return listRow(p,false);}).join(''):
        '<div style="padding:12px 20px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No starters</div>')+
      (subs.length?'<div class="rst-list-section" style="margin-top:4px;">Substitutes</div>'+subs.map(function(p){return listRow(p,false);}).join(''):'')+
      (inactive.length?'<div class="rst-list-section" style="margin-top:4px;">Inactive</div>'+inactive.map(function(p){return listRow(p,true);}).join(''):'')+
    '</div>';
  }

  // ─── COMPARE VIEW ────────────────────────────────────────
  function renderCompareView(){
    var opts=PLAYERS.map(function(p){return '<option value="'+p.id+'">'+p.nick+' ('+p.role+')</option>';}).join('');
    return '<div class="cmp-selectors-bar">'+
        '<div class="input-group mb-0"><label class="input-label" style="font-size:7px;">LEFT PLAYER</label>'+
          '<select class="input" id="rst-cmp-a" style="font-size:11px;padding:6px 8px;" onchange="window._rosterCmpA=this.value;renderRosterCompare()">'+opts+'</select></div>'+
        '<div class="input-group mb-0"><label class="input-label" style="font-size:7px;">RIGHT PLAYER</label>'+
          '<select class="input" id="rst-cmp-b" style="font-size:11px;padding:6px 8px;" onchange="window._rosterCmpB=this.value;renderRosterCompare()">'+opts+'</select></div>'+
      '</div>'+
      '<div class="cmp-body">'+
        '<div class="cmp-side-panel" id="cmp-panel-a" style="border-right:var(--border);"></div>'+
        '<div class="cmp-center-panel" id="cmp-center"></div>'+
        '<div class="cmp-side-panel" id="cmp-panel-b"></div>'+
      '</div>';
  }

  var content;
  if(mode==='list') content=renderList();
  else if(mode==='compare') content=renderCompareView();
  else content=renderCards();

  document.getElementById('roster-list').innerHTML=content;

  if(mode==='compare'){
    var aEl=document.getElementById('rst-cmp-a');
    var bEl=document.getElementById('rst-cmp-b');
    if(aEl){if(window._rosterCmpA)aEl.value=window._rosterCmpA;else window._rosterCmpA=aEl.value;}
    if(bEl){
      if(window._rosterCmpB)bEl.value=window._rosterCmpB;
      else if(PLAYERS.length>1){bEl.selectedIndex=1;window._rosterCmpB=bEl.value;}
      else window._rosterCmpB=bEl.value;
    }
    renderRosterCompare();
  }
}

// ── Current compare stat mode (overall / statistics) ──
var _cmpStatMode = 'overall';
function setCmpStatMode(m){
  _cmpStatMode=m;
  var btnO=document.getElementById('cmp-mode-btn-overall');
  var btnS=document.getElementById('cmp-mode-btn-stats');
  if(btnO){btnO.classList.toggle('active',m==='overall');}
  if(btnS){btnS.classList.toggle('active',m==='statistics');}
  _renderCmpCenter();
}

// ── Shared compare data (set in renderRosterCompare, read in _renderCmpCenter) ──
var _cmpCtx={};

function renderRosterCompare(){
  var panA=document.getElementById('cmp-panel-a');
  var panB=document.getElementById('cmp-panel-b');
  var center=document.getElementById('cmp-center');
  if(!panA||!panB||!center)return;

  PLAYERS=getPlayers();var data=loadData();
  var aId=window._rosterCmpA,bId=window._rosterCmpB;
  var empty='<div class="empty" style="padding:30px 10px;"><div class="empty-icon" style="font-size:24px;">⚖️</div><div class="empty-text" style="font-size:10px;">Select players</div></div>';
  if(!aId||!bId){panA.innerHTML=empty;panB.innerHTML=empty;center.innerHTML='';return;}
  var pA=PLAYERS.find(function(p){return p.id===aId;}),pB=PLAYERS.find(function(p){return p.id===bId;});
  if(!pA||!pB){panA.innerHTML=empty;panB.innerHTML=empty;center.innerHTML='';return;}

  var COL_A='rgba(68,255,136,1)'; // green for left
  var COL_B='rgba(100,180,255,1)'; // blue for right

  function pGames(pid){return (data.games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});}
  var gamesA=pGames(aId),gamesB=pGames(bId);

  // ── Store shared context for center re-render ──
  _cmpCtx={pA:pA,pB:pB,aId:aId,bId:bId,gamesA:gamesA,gamesB:gamesB,COL_A:COL_A,COL_B:COL_B,data:data};

  // ── Build player profile panels ──
  panA.innerHTML=_buildCmpProfile(pA,aId,gamesA,COL_A,data,'left');
  panB.innerHTML=_buildCmpProfile(pB,bId,gamesB,COL_B,data,'right');

  // ── Build center panel ──
  center.innerHTML=
    '<div class="cmp-mode-toggle">'+
      '<button class="cmp-mode-btn'+(_cmpStatMode==='overall'?' active':'')+'" id="cmp-mode-btn-overall" onclick="setCmpStatMode(\'overall\')">Overall</button>'+
      '<button class="cmp-mode-btn'+(_cmpStatMode==='statistics'?' active':'')+'" id="cmp-mode-btn-stats" onclick="setCmpStatMode(\'statistics\')">Statistics</button>'+
    '</div>'+
    '<div id="cmp-stat-content"></div>';

  _renderCmpCenter();
  // Animate panels in
  setTimeout(function(){
    if(panA)panA.classList.add('cmp-panel-visible');
    if(panB)panB.classList.add('cmp-panel-visible');
    if(center)center.classList.add('cmp-center-visible');
  },30);
}

function _buildCmpProfile(p,pid,games,col,data,side){
  var pfp=data.pfp&&data.pfp[pid];
  var avatarHtml=pfp?
    '<img src="'+pfp+'" alt="" onerror="this.style.display=\'none\'" style="width:100%;height:100%;object-fit:cover;"/>':
    '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;color:var(--grey-6);">'+p.nick[0]+'</span>';

  // Top 5 heroes
  var hMap={};
  games.forEach(function(g){var s=g.playerScores[pid];if(s&&s.hero)hMap[s.hero]=(hMap[s.hero]||0)+1;});
  var top5=Object.keys(hMap).sort(function(a,b){return hMap[b]-hMap[a];}).slice(0,5);
  var heroesHtml=top5.map(function(h){
    var url=heroImgUrl(h);
    return '<div class="cmp-profile-hero-th">'+(url?'<img src="'+url+'" alt="" onerror="this.style.display=\'none\'"/>':'')+'</div>';
  }).join('');

  // Last 5 game stats
  var last5=games.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);}).slice(0,5);
  var k=0,d=0,a=0,gpmS=0,gpmN=0,igrS=0,igrN=0,kpS=0,kpN=0,coachS=0,coachN=0;
  last5.forEach(function(g){
    var s=g.playerScores[pid];
    k+=+(s.kills||0);d+=+(s.deaths||0);a+=+(s.assists||0);
    if(s.gold_per_min!=null){gpmS+=+s.gold_per_min;gpmN++;}
    if(s.in_game_rating!=null){igrS+=+s.in_game_rating;igrN++;}
    var tk=g.team_total_kills;
    if(tk&&tk>0){kpS+=((+(s.kills||0)+(+(s.assists||0)))/tk*100);kpN++;}
    var cv=calcGameScore(s,p.role,g,pid);if(cv>0){coachS+=cv;coachN++;}
  });
  var kda=last5.length?((k+a)/Math.max(d,1)):null;
  var gpm=gpmN?gpmS/gpmN:null;
  var igr=igrN?igrS/igrN:null;
  var kp=kpN?kpS/kpN:null;
  var coach=coachN?coachS/coachN:null;

  // Form bar (last 5 coach scores in chronological order)
  var chartVals=last5.slice().reverse().map(function(g){var s=g.playerScores[pid];var v=calcGameScore(s,p.role,g,pid);return v>0?v:null;}).filter(function(v){return v!=null;});
  function formBar(vals){
    if(!vals||!vals.length)return '';
    var w=70,h=22,bw=8,gap=3,total=vals.length,totalW=total*bw+(total-1)*gap,startX=(w-totalW)/2;
    var bars=vals.map(function(v,i){
      var pct=Math.min(Math.max(v/10,0),1);
      var barH=Math.max(Math.round(pct*(h-2))+1,2);
      var x=startX+i*(bw+gap),y=h-barH;
      var c=v>=6.5?'var(--success)':v<5?'var(--danger)':'var(--white)';
      return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw+'" height="'+barH+'" rx="1" fill="'+c+'" opacity="'+(v>=6.5?1:v<5?0.9:0.75)+'"/>';
    }).join('');
    return '<svg width="'+w+'" height="'+h+'" style="overflow:visible;display:block;">'+bars+'</svg>';
  }

  var roleCol=({Support:'#bbb',Midlane:'var(--warn)',Carry:'var(--danger)',Offlane:'var(--success)',Jungler:'var(--auto)'})[p.role]||'var(--grey-6)';

  return '<div class="cmp-profile">'+
    '<div class="cmp-profile-avatar" style="border-color:'+col+';">'+avatarHtml+'</div>'+
    '<div class="cmp-profile-name" style="color:'+col+';">'+p.nick.toUpperCase()+'</div>'+
    '<div class="cmp-profile-ign">'+p.ign+'</div>'+
    '<div class="cmp-profile-role"><span class="tag tag-role" style="font-size:7px;color:'+roleCol+';">'+p.role+'</span></div>'+
    '<hr class="cmp-profile-divider"/>'+
    '<div class="cmp-profile-section-lbl">Top Heroes</div>'+
    '<div class="cmp-profile-heroes">'+(heroesHtml||'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">—</span>')+'</div>'+
    '<hr class="cmp-profile-divider"/>'+
    '<div class="cmp-profile-scores">'+
      '<div class="cmp-profile-score-cell">'+
        '<div class="cmp-profile-score-val" style="color:'+col+';">'+(igr!=null?igr.toFixed(1):'—')+'</div>'+
        '<div class="cmp-profile-score-lbl">IGR L5</div>'+
      '</div>'+
      '<div class="cmp-profile-score-cell">'+
        '<div class="cmp-profile-score-val" style="color:'+col+';">'+(coach!=null?coach.toFixed(1):'—')+'</div>'+
        '<div class="cmp-profile-score-lbl">Coach L5</div>'+
      '</div>'+
    '</div>'+
    '<div class="cmp-profile-stats" style="border-top:var(--border);">'+
      '<div class="cmp-profile-stat"><div class="cmp-profile-stat-val">'+(kda!=null?kda.toFixed(2):'—')+'</div><div class="cmp-profile-stat-lbl">KDA</div></div>'+
      '<div class="cmp-profile-stat"><div class="cmp-profile-stat-val">'+(gpm!=null?Math.round(gpm):'—')+'</div><div class="cmp-profile-stat-lbl">GPM</div></div>'+
      '<div class="cmp-profile-stat"><div class="cmp-profile-stat-val">'+(kp!=null?Math.round(kp)+'%':'—')+'</div><div class="cmp-profile-stat-lbl">KP%</div></div>'+
    '</div>'+
    '<div class="cmp-profile-form">'+(chartVals.length?formBar(chartVals):'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">No form data</span>')+'</div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1px;text-align:center;padding-bottom:8px;">FORM · LAST 5</div>'+
  '</div>';
}

function _renderCmpCenter(){
  var box=document.getElementById('cmp-stat-content');if(!box)return;
  var ctx=_cmpCtx;if(!ctx||!ctx.pA)return;
  if(_cmpStatMode==='statistics'){
    box.innerHTML=_buildCmpStatistics(ctx);
  }else{
    box.innerHTML=_buildCmpOverall(ctx);
    setTimeout(function(){_drawCmpRadar(ctx);},60);
  }
}

function _buildCmpOverall(ctx){
  var pA=ctx.pA,pB=ctx.pB,aId=ctx.aId,bId=ctx.bId,gamesA=ctx.gamesA,gamesB=ctx.gamesB,COL_A=ctx.COL_A,COL_B=ctx.COL_B;
  var roleA=(pA.role||'').toLowerCase();
  var pl=PILLAR_MAP[roleA]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var axisLabels=pl.concat(['Mentality','Hero Pool']);

  // Pre-compute radar values for each player
  var radarA=_profileRadarAxes(aId,roleA);
  var valuesA=radarA.values;
  var labelsUsed=radarA.labels;

  // Player B axes (may differ by role but we plot on A's axes)
  var roleB=(pB.role||'').toLowerCase();
  var radarB=_profileRadarAxes(bId,roleB);
  var valuesB=radarB.values;

  // Build pillar breakdown rows using advantage bars
  var bdRows=labelsUsed.map(function(lbl,i){
    var vA=valuesA[i]||0,vB=valuesB[i]||0;
    var maxV=Math.max(vA,vB,0.001);
    var pctA=(vA/maxV*100).toFixed(1);
    var pctB=(vB/maxV*100).toFixed(1);
    var aWin=vA>vB,bWin=vB>vA;
    var diff=Math.abs(vA-vB);
    var diffStr=diff>0?diff.toFixed(1):'';
    var diffCol=aWin?COL_A:bWin?COL_B:'var(--grey-5)';
    var colA=aWin?COL_A:'var(--grey-6)';var colB=bWin?COL_B:'var(--grey-6)';
    return '<div class="adv-row">'+
      '<div class="adv-val adv-val-a" style="color:'+colA+';">'+(vA>0?vA.toFixed(1):'—')+'</div>'+
      '<div class="adv-bar-col">'+
        '<div class="adv-bar-inner">'+
          '<div class="adv-half adv-half-left"><div class="adv-fill-a" style="width:'+pctA+'%;background:'+COL_A+';"></div></div>'+
          '<div class="adv-center-badge" style="color:'+diffCol+';">'+diffStr+'</div>'+
          '<div class="adv-half adv-half-right"><div class="adv-fill-b" style="width:'+pctB+'%;background:'+COL_B+';"></div></div>'+
        '</div>'+
        '<div class="adv-metric-name">'+lbl+'</div>'+
      '</div>'+
      '<div class="adv-val adv-val-b" style="color:'+colB+';">'+(vB>0?vB.toFixed(1):'—')+'</div>'+
    '</div>';
  }).join('');

  return '<div class="cmp-radar-wrap"><canvas id="cmp-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;"></canvas></div>'+
    '<div class="cmp-radar-legend">'+
      '<div class="cmp-radar-legend-item"><div class="cmp-radar-legend-dot" style="background:'+COL_A+';"></div>'+pA.nick+'</div>'+
      '<div class="cmp-radar-legend-item"><div class="cmp-radar-legend-dot" style="background:'+COL_B+';"></div>'+pB.nick+'</div>'+
    '</div>'+
    '<div class="adv-section-lbl" style="border-top:var(--border);">Pillar Breakdown</div>'+
    '<div>'+bdRows+'</div>'+
    '<div style="height:16px;"></div>';
}

function _drawCmpRadar(ctx){
  var canvas=document.getElementById('cmp-radar-canvas');if(!canvas)return;
  var pA=ctx.pA,pB=ctx.pB,aId=ctx.aId,bId=ctx.bId,COL_A=ctx.COL_A,COL_B=ctx.COL_B;
  var roleA=(pA.role||'').toLowerCase(),roleB=(pB.role||'').toLowerCase();
  var radarA=_profileRadarAxes(aId,roleA);
  var radarB=_profileRadarAxes(bId,roleB);
  var labels=radarA.labels;
  var valsA=radarA.values,valsB=radarB.values;
  var n=labels.length;

  var dpr=window.devicePixelRatio||1;
  var dW=canvas.offsetWidth||canvas.width;var dH=canvas.offsetHeight||canvas.height;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.width=dW+'px';canvas.style.height=dH+'px';
  var ctx2=canvas.getContext('2d');ctx2.scale(dpr,dpr);
  var W=dW,H=dH,cx=W/2,cy=H/2,R=Math.min(W,H)/2-42;
  ctx2.clearRect(0,0,W,H);

  function ang(i){return(Math.PI*2*i/n)-Math.PI/2;}
  function pt(i,r){return{x:cx+r*Math.cos(ang(i)),y:cy+r*Math.sin(ang(i))};}

  // Grid rings
  [0.2,0.4,0.6,0.8,1].forEach(function(f){
    ctx2.beginPath();
    for(var i=0;i<n;i++){var p=pt(i,R*f);i===0?ctx2.moveTo(p.x,p.y):ctx2.lineTo(p.x,p.y);}
    ctx2.closePath();ctx2.strokeStyle=f===1?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.05)';ctx2.lineWidth=1;ctx2.stroke();
  });
  for(var i=0;i<n;i++){var p=pt(i,R);ctx2.beginPath();ctx2.moveTo(cx,cy);ctx2.lineTo(p.x,p.y);ctx2.strokeStyle='rgba(255,255,255,0.1)';ctx2.lineWidth=1;ctx2.stroke();}

  function drawPoly(vals,fillCol,strokeCol){
    var hasData=vals.some(function(v){return v>0;});
    ctx2.beginPath();
    vals.forEach(function(v,i){var frac=hasData?Math.min(v/10,1):0.1;var p=pt(i,R*frac);i===0?ctx2.moveTo(p.x,p.y):ctx2.lineTo(p.x,p.y);});
    ctx2.closePath();ctx2.fillStyle=fillCol;ctx2.fill();ctx2.strokeStyle=strokeCol;ctx2.lineWidth=2;ctx2.stroke();
    if(hasData)vals.forEach(function(v,i){if(v<=0)return;var p=pt(i,R*Math.min(v/10,1));ctx2.beginPath();ctx2.arc(p.x,p.y,3,0,Math.PI*2);ctx2.fillStyle=strokeCol;ctx2.fill();});
  }

  drawPoly(valsB,COL_B.replace('1)','0.10)'),COL_B.replace('1)','0.85)'));
  drawPoly(valsA,COL_A.replace('1)','0.10)'),COL_A.replace('1)','0.85)'));

  // Labels
  labels.forEach(function(lbl,i){
    var lR=R+26;var p=pt(i,lR);
    var short=lbl.replace('Survival & Positioning','Survival').replace('Protection & Peel','Protection').replace('Resource Efficiency','Resources').replace('Role Fulfillment','Role Ful.').replace('Lane Resilience','Lane Res.');
    ctx2.textAlign='center';ctx2.textBaseline='middle';
    ctx2.font='500 9px DM Sans,sans-serif';ctx2.fillStyle='rgba(255,255,255,0.5)';
    ctx2.fillText(short,p.x,p.y);
  });
}

function _buildCmpStatistics(ctx){
  var pA=ctx.pA,pB=ctx.pB,aId=ctx.aId,bId=ctx.bId,gamesA=ctx.gamesA,gamesB=ctx.gamesB,COL_A=ctx.COL_A,COL_B=ctx.COL_B;

  function agg(pid,gs){
    var r={g:gs.length,wins:0,k:0,d:0,a:0,gpmS:0,gpmN:0,igrS:0,igrN:0,coachS:0,coachN:0,
           ddS:0,ddN:0,dtS:0,dtN:0,kpS:0,kpN:0,
           ddpmS:0,ddpmN:0,dtpmS:0,dtpmN:0,kpmS:0,kpmN:0};
    var player=PLAYERS.find(function(p){return p.id===pid;});
    gs.forEach(function(g){
      var s=g.playerScores[pid];
      if(g.result==='Win')r.wins++;
      r.k+=+(s.kills||0);r.d+=+(s.deaths||0);r.a+=+(s.assists||0);
      if(s.gold_per_min!=null){r.gpmS+=+s.gold_per_min;r.gpmN++;}
      if(s.in_game_rating!=null){r.igrS+=+s.in_game_rating;r.igrN++;}
      var cv=calcGameScore(s,player?player.role:'',g,pid);if(cv>0){r.coachS+=cv;r.coachN++;}
      if(s.dmg_dealt_pct!=null){r.ddS+=+s.dmg_dealt_pct;r.ddN++;}
      if(s.dmg_taken_pct!=null){r.dtS+=+s.dmg_taken_pct;r.dtN++;}
      var tk=g.team_total_kills;
      if(tk&&tk>0){r.kpS+=(((s.kills||0)+(s.assists||0))/tk*100);r.kpN++;}
      var durMin=g.duration_seconds?g.duration_seconds/60:null;
      if(durMin&&durMin>0){
        if(s.dmg_dealt_raw!=null){r.ddpmS+=+s.dmg_dealt_raw/durMin;r.ddpmN++;}
        if(s.dmg_taken_raw!=null){r.dtpmS+=+s.dmg_taken_raw/durMin;r.dtpmN++;}
        r.kpmS+=+(s.kills||0)/durMin;r.kpmN++;
      }
    });
    r.winRate=r.g?r.wins/r.g*100:null;
    r.kda=r.g?((r.k+r.a)/Math.max(r.d,1)):null;
    r.avgDeaths=r.g?r.d/r.g:null;
    r.igr=r.igrN?r.igrS/r.igrN:null;
    r.coach=r.coachN?r.coachS/r.coachN:null;
    r.dd=r.ddN?r.ddS/r.ddN:null;
    r.dt=r.dtN?r.dtS/r.dtN:null;
    r.kp=r.kpN?r.kpS/r.kpN:null;
    r.ddpm=r.ddpmN?r.ddpmS/r.ddpmN:null;
    r.dtpm=r.dtpmN?r.dtpmS/r.dtpmN:null;
    r.kpm=r.kpmN?r.kpmS/r.kpmN:null;
    return r;
  }
  var rA=agg(aId,gamesA),rB=agg(bId,gamesB);

  function f1(v){return v!=null?v.toFixed(1):'—';}
  function f2(v){return v!=null?v.toFixed(2):'—';}
  function pct(v){return v!=null?v.toFixed(1)+'%':'—';}
  function rnd(v){return v!=null?Math.round(v).toString():'—';}

  // FM-style horizontal advantage bar row
  function advRow(lbl,vA,vB,rawA,rawB,lowerIsBetter,diffFmt){
    if(rawA==null&&rawB==null)return '';
    var aWin=false,bWin=false;
    if(rawA!=null&&rawB!=null){
      if(lowerIsBetter){aWin=rawA<rawB;bWin=rawB<rawA;}
      else{aWin=rawA>rawB;bWin=rawB>rawA;}
    }
    var absA=Math.abs(rawA||0),absB=Math.abs(rawB||0);
    var maxV=Math.max(absA,absB,0.001);
    var pA2=rawA!=null?(absA/maxV*100).toFixed(1):'0';
    var pB2=rawB!=null?(absB/maxV*100).toFixed(1):'0';
    var diff=(rawA!=null&&rawB!=null)?Math.abs(rawA-rawB):null;
    var diffStr=diff!=null?(diffFmt?diffFmt(diff):(diff<10?diff.toFixed(1):Math.round(diff).toString())):'';
    var diffCol=aWin?COL_A:bWin?COL_B:'var(--grey-5)';
    var colA=aWin?COL_A:rawA!=null?'var(--grey-6)':'var(--grey-4)';
    var colB=bWin?COL_B:rawB!=null?'var(--grey-6)':'var(--grey-4)';
    return '<div class="adv-row">'+
      '<div class="adv-val adv-val-a" style="color:'+colA+';">'+vA+'</div>'+
      '<div class="adv-bar-col">'+
        '<div class="adv-bar-inner">'+
          '<div class="adv-half adv-half-left"><div class="adv-fill-a" style="width:'+pA2+'%;background:'+COL_A+';"></div></div>'+
          '<div class="adv-center-badge" style="color:'+diffCol+';">'+diffStr+'</div>'+
          '<div class="adv-half adv-half-right"><div class="adv-fill-b" style="width:'+pB2+'%;background:'+COL_B+';"></div></div>'+
        '</div>'+
        '<div class="adv-metric-name">'+lbl+'</div>'+
      '</div>'+
      '<div class="adv-val adv-val-b" style="color:'+colB+';">'+vB+'</div>'+
    '</div>';
  }

  return '<div class="adv-section-lbl">General</div>'+
    advRow('Win Rate',pct(rA.winRate),pct(rB.winRate),rA.winRate,rB.winRate,false,function(d){return d.toFixed(1)+'%';})+
    advRow('KDA Ratio',f2(rA.kda),f2(rB.kda),rA.kda,rB.kda,false,function(d){return d.toFixed(2);})+
    advRow('In-Game Rating',f1(rA.igr),f1(rB.igr),rA.igr,rB.igr,false,function(d){return d.toFixed(1);})+
    advRow('Death Avg',f1(rA.avgDeaths),f1(rB.avgDeaths),rA.avgDeaths,rB.avgDeaths,true,function(d){return d.toFixed(1);})+
    advRow('Coach Score',f1(rA.coach),f1(rB.coach),rA.coach,rB.coach,false,function(d){return d.toFixed(1);})+
    '<div class="adv-section-lbl" style="margin-top:2px;">Positional</div>'+
    advRow('DMG %',pct(rA.dd),pct(rB.dd),rA.dd,rB.dd,false,function(d){return d.toFixed(1)+'%';})+
    advRow('DMG Taken %',pct(rA.dt),pct(rB.dt),rA.dt,rB.dt,false,function(d){return d.toFixed(1)+'%';})+
    advRow('DMG / Min',rnd(rA.ddpm),rnd(rB.ddpm),rA.ddpm,rB.ddpm,false,function(d){return Math.round(d).toString();})+
    advRow('DMG Taken / Min',rnd(rA.dtpm),rnd(rB.dtpm),rA.dtpm,rB.dtpm,false,function(d){return Math.round(d).toString();})+
    advRow('Kill / Min',f2(rA.kpm),f2(rB.kpm),rA.kpm,rB.kpm,false,function(d){return d.toFixed(2);})+
    advRow('Kill Participation',pct(rA.kp),pct(rB.kp),rA.kp,rB.kp,false,function(d){return d.toFixed(1)+'%';})+
    '<div style="height:16px;"></div>';
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════
var PTREND_COLORS=['rgba(100,180,255,1)','rgba(80,220,140,1)','rgba(255,180,80,1)','rgba(200,130,255,1)','rgba(240,210,90,1)','rgba(90,210,220,1)','rgba(235,235,235,1)'];
function _profilePlayerGames(playerId){
  var data=loadData();
  return (data.games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped;});
}
function _profileRoleOf(g,playerId,player){
  var s=g.playerScores&&g.playerScores[playerId];
  return ((s&&s.role)||(player&&player.role)||'').toLowerCase();
}
function _profileRoleInfo(playerId){
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var desig=(player&&player.role||'').toLowerCase();
  var games=_profilePlayerGames(playerId).slice().sort(function(a,b){return gameDateTime(a)-gameDateTime(b);});
  var played=[];
  games.forEach(function(g){var r=_profileRoleOf(g,playerId,player);if(r&&played.indexOf(r)<0)played.push(r);});
  var roles=[];
  if(desig)roles.push(desig);
  played.forEach(function(r){if(roles.indexOf(r)<0)roles.push(r);});
  if(!roles.length)roles.push('');
  return {roles:roles, def: desig||roles[0]||''};
}
function _profileMentalityForGame(g,playerId){
  var mo=null;
  if(g.matchMentality&&g.matchMentality[playerId])mo=g.matchMentality[playerId];
  else if(g.matchId){var m=(_cache.matches||[]).find(function(x){return x.id===g.matchId;});if(m&&m.mentality&&m.mentality[playerId])mo=m.mentality[playerId];}
  return mo?calcMentality(null,mo):null;
}
// Role-aware 6-axis radar: 4 role pillars + Mentality + Hero Pool
function _profileRadarAxes(playerId,role){
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var games=_profilePlayerGames(playerId).filter(function(g){return _profileRoleOf(g,playerId,player)===role;});
  var pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  function avgKey(k){var v=games.map(function(g){var ps=g.playerScores[playerId].pillar_scores;return ps?ps[k]:null;}).filter(function(x){return x!=null&&x>0;});return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:0;}
  var mv=games.map(function(g){return _profileMentalityForGame(g,playerId);}).filter(function(x){return x!=null&&x>0;});
  var ment=mv.length?mv.reduce(function(a,b){return a+b;},0)/mv.length:0;
  var hp=calcHeroPoolScore(playerId);var hpv=Math.min((hp&&hp.pct||0)/10,10);
  return {labels:pl.concat(['Mentality','Hero Pool']),
          values:[avgKey('p0'),avgKey('p1'),avgKey('p2'),avgKey('p3'),ment,hpv]};
}
function _starterAvgRadar(role){
  var starters=(getPlayers()||[]).filter(function(p){return p.status==='Starter';});
  if(!starters.length)return null;
  var sums=[0,0,0,0,0,0],cnt=[0,0,0,0,0,0];
  starters.forEach(function(p){
    var ax=_profileRadarAxes(p.id,role);
    ax.values.forEach(function(v,i){if(v>0){sums[i]+=v;cnt[i]++;}});
  });
  return sums.map(function(s,i){return cnt[i]?s/cnt[i]:0;});
}
function setProfileRole(playerId,role){window._profileRole=role;showProfile(playerId);}
// Pillar trend timeframe + series-toggle state
function _ptrendRawDefs(){
  return [
    {k:'kills',  l:'Kills',       color:'rgba(255,120,120,1)', fmt:function(v){return Math.round(v);}},
    {k:'deaths', l:'Deaths',      color:'rgba(255,80,80,1)',   fmt:function(v){return Math.round(v);}},
    {k:'assists',l:'Assists',     color:'rgba(150,255,150,1)', fmt:function(v){return Math.round(v);}},
    {k:'kda',    l:'KDA',         color:'rgba(100,180,255,1)', fmt:function(v){return v.toFixed(2);}},
    {k:'gpm',    l:'Gold/Min',    color:'rgba(80,220,140,1)',  fmt:function(v){return Math.round(v);}},
    {k:'igr',    l:'In-Game Rtg', color:'rgba(255,180,80,1)',  fmt:function(v){return v.toFixed(1);}},
    {k:'kp',     l:'KP%',         color:'rgba(200,130,255,1)',fmt:function(v){return v.toFixed(1)+'%';}},
    {k:'dd',     l:'Dmg Dealt%',  color:'rgba(240,210,90,1)', fmt:function(v){return v.toFixed(1)+'%';}},
    {k:'dt',     l:'Dmg Taken%',  color:'rgba(90,210,220,1)', fmt:function(v){return v.toFixed(1)+'%';}},
    {k:'ddraw',  l:'Dmg Dealt',   color:'rgba(255,160,80,1)', fmt:function(v){return Math.round(v);}},
    {k:'dtraw',  l:'Dmg Taken',   color:'rgba(100,200,255,1)',fmt:function(v){return Math.round(v);}},
    {k:'ddr',    l:'Dmg Ratio',   color:'rgba(180,255,180,1)',fmt:function(v){return v.toFixed(2);}},
    {k:'mpd',    l:'Min/Death',   color:'rgba(255,255,100,1)',fmt:function(v){return v.toFixed(1);}},
    {k:'oppgpm', l:'Opp GPM',     color:'rgba(180,180,180,1)',fmt:function(v){return Math.round(v);}},
  ];
}
function _ptrendRawVal(key,g,playerId){
  var s=g.playerScores&&g.playerScores[playerId];if(!s)return null;
  if(key==='kills')return s.kills;if(key==='deaths')return s.deaths;if(key==='assists')return s.assists;
  if(key==='kda')return s.kda;if(key==='gpm')return s.gold_per_min;if(key==='igr')return s.in_game_rating;
  if(key==='kp')return s.kill_contribution_pct;if(key==='dd')return s.dmg_dealt_pct;if(key==='dt')return s.dmg_taken_pct;
  if(key==='ddraw')return s.dmg_dealt_raw;if(key==='dtraw')return s.dmg_taken_raw;
  if(key==='ddr')return s.dmg_per_dmg_taken;if(key==='mpd')return s.min_per_death;if(key==='oppgpm')return s.opp_gold_per_min;
  return null;
}
function _niceAxisBounds(minV,maxV){
  var range=maxV-minV||1;
  var mag=Math.pow(10,Math.floor(Math.log10(range/4)));
  var step=[1,2,2.5,5,10].reduce(function(best,s){return(s*mag*4>=range&&s*mag<best)?s*mag:best;},Infinity);
  if(!isFinite(step))step=mag;
  var lo=Math.floor(minV/step)*step,hi=Math.ceil(maxV/step)*step;
  var ticks=[];for(var v=lo;v<=hi+step*0.001;v+=step)ticks.push(Math.round(v*1e6)/1e6);
  return {min:lo,max:hi,ticks:ticks};
}
function _ptrendHideTooltip(playerId){
  var tip=document.getElementById('ptrend-tip-'+playerId);
  if(tip){tip.style.display='none';tip._lastHit=null;}
}
function _ptrendShowTooltip(playerId,cx,cy,hit){
  var tip=document.getElementById('ptrend-tip-'+playerId);if(!tip)return;
  var g=hit.game,s=g.playerScores&&g.playerScores[playerId];
  var role=window._profileRole||'';
  var heroName=(s&&s.hero)||'';
  var kills=s&&s.kills!=null?s.kills:'?',deaths=s&&s.deaths!=null?s.deaths:'?',assists=s&&s.assists!=null?s.assists:'?';
  var gpm=s&&s.gold_per_min!=null?Math.round(s.gold_per_min):'—';
  var igr=s&&s.in_game_rating!=null?s.in_game_rating.toFixed(1):'—';
  var coach=calcGameScore(s,role,g,playerId);var coachStr=coach>0?coach.toFixed(1):'—';
  var tipHtml=
    '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:6px;">'+
      heroPortraitHtml(heroName,24,false)+
      '<div><div style="color:rgba(255,255,255,0.9);font-size:9px;line-height:1.3;max-width:95px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(heroName||'Unknown')+'</div>'+
      '<div style="color:rgba(255,255,255,0.35);font-size:8px;">'+g.date+'</div></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;line-height:1.6;">'+
      '<span style="color:rgba(255,255,255,0.4);">K/D/A</span><span style="color:rgba(255,255,255,0.85);">'+kills+'/'+deaths+'/'+assists+'</span>'+
      '<span style="color:rgba(255,255,255,0.4);">GPM</span><span style="color:rgba(255,255,255,0.85);">'+gpm+'</span>'+
      '<span style="color:rgba(255,255,255,0.4);">Rating</span><span style="color:rgba(255,255,255,0.85);">'+igr+'</span>'+
      '<span style="color:rgba(255,255,255,0.4);">Coach</span><span style="color:rgba(255,255,255,0.85);">'+coachStr+'</span>'+
    '</div>';
  if(hit.label&&hit.fmtVal!=null){
    tipHtml+='<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;gap:6px;">'+
      '<span style="display:inline-block;width:10px;height:2px;background:'+hit.color+';border-radius:1px;flex-shrink:0;"></span>'+
      '<span style="color:rgba(255,255,255,0.45);">'+hit.label+'</span>'+
      '<span style="color:rgba(255,255,255,0.9);margin-left:auto;font-weight:500;">'+hit.fmtVal+'</span>'+
    '</div>';
  }
  tip.innerHTML=tipHtml;tip._lastHit=hit;
  var pw=tip.parentElement.offsetWidth||300,ph=tip.parentElement.offsetHeight||200;
  var tw=160,th=130;
  var tx=cx+14,ty=cy-40;
  if(tx+tw>pw-4)tx=cx-tw-14;if(tx<4)tx=4;
  if(ty<4)ty=4;if(ty+th>ph-4)ty=Math.max(4,ph-th-4);
  tip.style.left=tx+'px';tip.style.top=ty+'px';tip.style.display='block';
}
function _ptrendSetupCanvasEvents(playerId){
  var canvas=document.getElementById('ptrend-'+playerId);if(!canvas)return;
  function getHit(cx,cy){
    var hits=(window._ptrendHits&&window._ptrendHits[playerId])||[];
    var best=null,bestD=Infinity;
    hits.forEach(function(h){var d=Math.hypot(h.x-cx,h.y-cy);if(d<bestD&&d<16){best=h;bestD=d;}});
    return best;
  }
  canvas.addEventListener('mousemove',function(e){
    var r=canvas.getBoundingClientRect();var hit=getHit(e.clientX-r.left,e.clientY-r.top);
    if(hit)_ptrendShowTooltip(playerId,e.clientX-r.left,e.clientY-r.top,hit);else _ptrendHideTooltip(playerId);
  });
  canvas.addEventListener('mouseleave',function(){_ptrendHideTooltip(playerId);});
  canvas.addEventListener('click',function(e){
    var r=canvas.getBoundingClientRect();var cx=e.clientX-r.left,cy=e.clientY-r.top;var hit=getHit(cx,cy);
    var tip=document.getElementById('ptrend-tip-'+playerId);
    if(hit){if(tip&&tip.style.display!=='none'&&tip._lastHit===hit)_ptrendHideTooltip(playerId);else _ptrendShowTooltip(playerId,cx,cy,hit);}
    else _ptrendHideTooltip(playerId);
  });
  canvas.addEventListener('touchstart',function(e){
    e.preventDefault();var r=canvas.getBoundingClientRect();var t=e.touches[0];
    var cx=t.clientX-r.left,cy=t.clientY-r.top;var hit=getHit(cx,cy);
    var tip=document.getElementById('ptrend-tip-'+playerId);
    if(hit){if(tip&&tip.style.display!=='none'&&tip._lastHit===hit)_ptrendHideTooltip(playerId);else _ptrendShowTooltip(playerId,cx,cy,hit);}
    else _ptrendHideTooltip(playerId);
  },{passive:false});
}
function drawRawStatsTrend(playerId){
  var canvas=document.getElementById('ptrend-'+playerId);if(!canvas)return;
  var role=window._profileRole;
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var st=_ptrendState(),rg=_ptrendRange();
  var games=_profilePlayerGames(playerId).filter(function(g){
    if(_profileRoleOf(g,playerId,player)!==role)return false;
    var d=parseDate(g.date);
    if(rg.from&&d<rg.from)return false;if(rg.to&&d>rg.to)return false;
    return true;
  }).sort(function(a,b){return gameDateTime(a)-gameDateTime(b);});
  var activeDefs=_ptrendRawDefs().filter(function(d){return st.rawSeries[d.k];});
  window._ptrendHits=window._ptrendHits||{};window._ptrendHits[playerId]=[];
  var dpr=window.devicePixelRatio||1;var dW=canvas.offsetWidth||canvas.width||600;var dH=canvas.offsetHeight||200;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.height=dH+'px';
  var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,dW,dH);
  var padL=38,padR=12,padT=12,padB=22;
  var plotW=dW-padL-padR,plotH=dH-padT-padB;
  if(!games.length){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.font='10px DM Mono,monospace';ctx.textBaseline='middle';ctx.fillText('No games in range',dW/2,dH/2);_ptrendSetupCanvasEvents(playerId);return;}
  var allVals=[];
  activeDefs.forEach(function(def){games.forEach(function(g){var v=_ptrendRawVal(def.k,g,playerId);if(v!=null)allVals.push(v);});});
  if(!allVals.length){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.font='10px DM Mono,monospace';ctx.textBaseline='middle';ctx.fillText('No stats selected',dW/2,dH/2);_ptrendSetupCanvasEvents(playerId);return;}
  var minV=Math.min.apply(null,allVals),maxV=Math.max.apply(null,allVals);
  var bounds=_niceAxisBounds(Math.max(0,minV*0.92),maxV*1.08);
  var axMin=bounds.min,axMax=bounds.max;
  function yPos(v){return padT+plotH-((Math.max(axMin,Math.min(v,axMax))-axMin)/(axMax-axMin||1))*plotH;}
  function xPos(i){return games.length<=1?padL+plotW/2:padL+(i/(games.length-1))*plotW;}
  ctx.textBaseline='middle';ctx.font='9px DM Mono,monospace';ctx.textAlign='right';
  bounds.ticks.forEach(function(gv){
    if(gv<axMin-0.001||gv>axMax+0.001)return;
    var y=yPos(gv);
    ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(dW-padR,y);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.3)';
    var lbl=Math.abs(gv)>=10000?Math.round(gv/1000)+'k':Math.abs(gv)>=1000?(Math.round(gv/100)/10)+'k':gv%1===0?String(Math.round(gv)):gv.toFixed(1);
    ctx.fillText(lbl,padL-4,y);
  });
  ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='8px DM Mono,monospace';ctx.textBaseline='top';
  ctx.textAlign='left';ctx.fillText(games[0].date,padL,dH-padB+5);
  if(games.length>1){ctx.textAlign='right';ctx.fillText(games[games.length-1].date,dW-padR,dH-padB+5);}
  activeDefs.forEach(function(def){
    var pts=[];
    games.forEach(function(g,i){
      var v=_ptrendRawVal(def.k,g,playerId);
      if(v!=null){var px=xPos(i),py=yPos(v);pts.push({x:px,y:py,v:v});window._ptrendHits[playerId].push({x:px,y:py,game:g,key:def.k,label:def.l,color:def.color,value:v,fmtVal:def.fmt(v)});}
    });
    if(!pts.length)return;
    ctx.strokeStyle=def.color;ctx.lineWidth=2;ctx.beginPath();
    pts.forEach(function(p,idx){idx===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.stroke();
    ctx.fillStyle=def.color;pts.forEach(function(p){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();});
  });
  _ptrendSetupCanvasEvents(playerId);
}
function _ptrendDefault(){
  var rs={};_ptrendRawDefs().forEach(function(d){rs[d.k]=1;});
  return {preset:'all',from:'',to:'',series:{p0:1,p1:1,p2:1,p3:1,ment:1,hp:1,overall:1},mode:'pillar',rawSeries:rs};
}
function _ptrendState(){if(!window._ptrend)window._ptrend=_ptrendDefault();return window._ptrend;}
function _ptrendIso(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function _ptrendRange(){
  var st=_ptrendState();
  return {from:st.from?new Date(st.from+'T00:00:00'):null,to:st.to?new Date(st.to+'T23:59:59'):null};
}
function setPtrendPreset(pid,preset){
  var st=_ptrendState();st.preset=preset;
  if(preset==='all'){st.from='';st.to='';}
  else{var days=preset==='1w'?7:preset==='2w'?14:30;var now=new Date();st.from=_ptrendIso(new Date(now.getTime()-days*864e5));st.to=_ptrendIso(now);}
  renderPtrend(pid);
}
function setPtrendCustom(pid){
  var st=_ptrendState();
  var fe=document.getElementById('ptrend-from-'+pid),te=document.getElementById('ptrend-to-'+pid);
  st.from=fe?fe.value:'';st.to=te?te.value:'';st.preset='custom';
  renderPtrend(pid);
}
function togglePtrendSeries(pid,key){var st=_ptrendState();st.series[key]=st.series[key]?0:1;renderPtrend(pid);}
function setPtrendAllSeries(pid,on){var st=_ptrendState();var tgt=st.mode==='raw'?st.rawSeries:st.series;Object.keys(tgt).forEach(function(k){tgt[k]=on?1:0;});renderPtrend(pid);}
function setPtrendMode(pid,mode){var st=_ptrendState();st.mode=mode;renderPtrend(pid);}
function togglePtrendRawSeries(pid,key){var st=_ptrendState();st.rawSeries[key]=st.rawSeries[key]?0:1;renderPtrend(pid);}
// ── Profile AFC cell (Ability / Form / Hero Pool) ──
function _profAfcCell(label,grade,val){
  var gc=grade?(grade.cls==='grade-sp'?'rgba(255,255,255,0.95)':grade.cls==='grade-s'?'rgba(232,232,232,0.9)':grade.cls==='grade-sm'?'rgba(200,200,200,0.85)':grade.cls==='grade-ap'?'rgba(255,204,68,0.95)':grade.cls==='grade-a'?'rgba(68,255,136,0.9)':'rgba(136,136,136,0.7)'):'rgba(136,136,136,0.7)';
  return '<div class="prof-afc-cell">'+
    '<div class="prof-afc-label">'+label+'</div>'+
    '<div class="prof-afc-grade" style="color:'+gc+';">'+(grade?grade.grade:'—')+'</div>'+
    '<div class="prof-afc-val">'+(val>0?val.toFixed(2):'—')+'</div>'+
  '</div>';
}
// ── Profile tab switcher ──
function setProfileTab(playerId,tab){
  window._profileTab=tab;
  ['overall','statistic','heroes','games'].forEach(function(p){
    var panel=document.getElementById('prof-panel-'+p+'-'+playerId);
    if(panel)panel.style.display=p===tab?'block':'none';
  });
  document.querySelectorAll('.prof-tab-btn').forEach(function(btn){
    var oc=btn.getAttribute('onclick')||'';
    btn.classList.toggle('active',oc.indexOf("'"+tab+"'")>=0);
  });
  setTimeout(function(){
    if(tab==='overall'){
      var radarAxes=_profileRadarAxes(playerId,window._profileRole);
      var radarData=radarAxes.labels.map(function(lbl,idx){return{label:lbl,value:radarAxes.values[idx]};});
      var starterAvg=_starterAvgRadar(window._profileRole);
      drawRadar(playerId,radarData,{overlayData:starterAvg,colour1:'rgba(100,180,255,1)',colour2:'rgba(80,220,140,1)',showLabels:true,showGrades:true});
    }else if(tab==='statistic'){
      renderPtrend(playerId);
      _renderProfileRawStats(playerId);
    }else if(tab==='heroes'){
      renderProfileHeroesTab(playerId);
    }else if(tab==='games'){
      renderProfileGamesTab(playerId);
    }
  },60);
}
// ── SELECT VIEW toggle ──
function toggleSelectView(playerId){
  var dd=document.getElementById('sv-dd-'+playerId);
  if(!dd)return;
  dd.style.display=dd.style.display==='none'?'block':'none';
}
function closeSelectView(playerId){
  var dd=document.getElementById('sv-dd-'+playerId);
  if(dd)dd.style.display='none';
}
// ── Fixed raw stats for statistic tab ──
function _renderProfileRawStats(playerId){
  var box=document.getElementById('prof-rawstats-'+playerId);if(!box)return;
  var allGames=_profilePlayerGames(playerId);
  var rs={k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0,kpS:0,kpN:0};
  allGames.forEach(function(g){
    var s=g.playerScores[playerId];
    rs.k+=s.kills||0;rs.d+=s.deaths||0;rs.a+=s.assists||0;
    if(s.gold_per_min!=null){rs.gpmS+=+s.gold_per_min;rs.gpmN++;}
    if(s.in_game_rating!=null){rs.rS+=+s.in_game_rating;rs.rN++;}
    if(s.dmg_dealt_pct!=null){rs.ddS+=+s.dmg_dealt_pct;rs.ddN++;}
    if(s.dmg_taken_pct!=null){rs.dtS+=+s.dmg_taken_pct;rs.dtN++;}
    if(s.kill_contribution_pct!=null){rs.kpS+=+s.kill_contribution_pct;rs.kpN++;}
  });
  var rawKDA=allGames.length?((rs.k+rs.a)/Math.max(rs.d,1)):null;
  function rCell(label,val){return '<div class="rsfg-cell"><div class="rsfg-val">'+(val!=null?val:'—')+'</div><div class="rsfg-label">'+label+'</div></div>';}
  box.innerHTML=allGames.length?
    '<div class="section-label">RAW STATS <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· ALL '+allGames.length+' GAMES · INFORMATIONAL</span></div>'+
    '<div class="raw-stats-fixed-grid">'+
      rCell('KDA',rawKDA!=null?rawKDA.toFixed(2):null)+
      rCell('GOLD / MIN',rs.gpmN?Math.round(rs.gpmS/rs.gpmN):null)+
      rCell('IN-GAME RATING',rs.rN?(rs.rS/rs.rN).toFixed(1):null)+
      rCell('KILL PARTICIP.',rs.kpN?(rs.kpS/rs.kpN).toFixed(1)+'%':null)+
      rCell('DMG DEALT %',rs.ddN?(rs.ddS/rs.ddN).toFixed(1)+'%':null)+
      rCell('DMG TAKEN %',rs.dtN?(rs.dtS/rs.dtN).toFixed(1)+'%':null)+
    '</div>':
    '<div class="empty" style="padding:20px 20px;"><div class="empty-text">No games logged yet</div></div>';
}
function showProfile(playerId){
  PLAYERS=getPlayers();var player=PLAYERS.find(function(p){return p.id===playerId;});var data=loadData();
  if(!player){showPage('page-roster');return;}
  var pfp=data.pfp&&data.pfp[playerId]||null;
  var hp=calcHeroPoolScore(playerId);
  var hpGrade=hp.pct>0?scoreToGrade(hp.pct/10):null;

  // ── Role setup ──
  if(window._profilePid!==playerId){window._profilePid=playerId;window._profileRole=null;window._ptrend=null;window._profileTab='overall';}
  var roleInfo=_profileRoleInfo(playerId);
  var selRole=(window._profileRole&&roleInfo.roles.indexOf(window._profileRole)>=0)?window._profileRole:roleInfo.def;
  window._profileRole=selRole;
  var roleLabel=selRole?selRole.charAt(0).toUpperCase()+selRole.slice(1):'—';
  var tabState=window._profileTab||'overall';

  // ── All games ──
  var allGames=_profilePlayerGames(playerId);
  var sortedGames=allGames.slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);});

  // ── Ability = avg coach score last 3 months (90 days) ──
  var now=new Date();
  var threeMonthDate=new Date(now.getTime()-90*24*60*60*1000);
  var threeMonthGames=allGames.filter(function(g){return parseDate(g.date)>=threeMonthDate;});
  var threeMonthAvg=threeMonthGames.length?threeMonthGames.reduce(function(acc,g){return acc+calcGameScore(g.playerScores[playerId],player.role,g,playerId);},0)/threeMonthGames.length:0;
  var abilityGrade=threeMonthAvg>0?scoreToGrade(threeMonthAvg):null;

  // ── Form = avg coach score last 5 games ──
  var last5Games=sortedGames.slice(0,5);
  var last5Avg=last5Games.length?last5Games.reduce(function(acc,g){return acc+calcGameScore(g.playerScores[playerId],player.role,g,playerId);},0)/last5Games.length:0;
  var formGrade=last5Avg>0?scoreToGrade(last5Avg):null;

  // ── Peak = highest individual game score ──
  var peakScore=0;
  allGames.forEach(function(g){var v=calcGameScore(g.playerScores[playerId],player.role,g,playerId);if(v>peakScore)peakScore=v;});
  var peakGrade=peakScore>0?scoreToGrade(peakScore):null;

  // ── Avg KDA ──
  var kdaS=0,kdaN=0;
  allGames.forEach(function(g){var s=g.playerScores[playerId];
    if(s.kills!=null&&s.deaths!=null&&s.assists!=null){kdaS+=((s.kills+s.assists)/Math.max(s.deaths,1));kdaN++;}
    else if(s.kda!=null){kdaS+=s.kda;kdaN++;}
  });
  var avgKDA=kdaN?kdaS/kdaN:null;

  // ── Top 5 heroes in last 3 months ──
  var hMap3M={};
  threeMonthGames.forEach(function(g){var s=g.playerScores[playerId];if(!s.hero)return;hMap3M[s.hero]=(hMap3M[s.hero]||0)+1;});
  var top5Heroes=Object.keys(hMap3M).sort(function(a,b){return hMap3M[b]-hMap3M[a];}).slice(0,5);

  // ── Radar data ──
  var radarAxes=_profileRadarAxes(playerId,selRole);
  var radarData=radarAxes.labels.map(function(lbl,idx){return{label:lbl,value:radarAxes.values[idx]};});
  var starterAvg=_starterAvgRadar(selRole);

  // ── Overall avg from radar values ──
  var overallVals=radarAxes.values.filter(function(v){return v>0;});
  var overallAvg=overallVals.length?overallVals.reduce(function(a,b){return a+b;},0)/overallVals.length:0;
  var overallGrade=overallAvg>0?scoreToGrade(overallAvg):null;

  // ── Player switcher tabs ──
  var activePlayers=PLAYERS.filter(function(p){return p.status!=='Inactive';});
  var playerTabsHtml=activePlayers.map(function(p){
    return '<button class="prof-player-tab'+(p.id===playerId?' active':'')+'" onclick="showProfile(\''+p.id+'\')">'+p.nick+'</button>';
  }).join('');

  // ── Photo HTML ──
  var photoHtml=pfp?'<img src="'+pfp+'" alt="'+player.nick+'" style="width:100%;height:100%;object-fit:cover;object-position:top center;"/>':'<div class="prof-photo-initials">'+player.nick[0]+'</div>';
  var isStarter=player.status==='Starter';
  var statusColor=isStarter?'rgba(68,255,136,0.9)':'rgba(136,136,136,0.7)';
  var statusBorder=isStarter?'rgba(68,255,136,0.4)':'rgba(80,80,80,0.6)';

  // ── Signature heroes HTML ──
  var sigHtml=top5Heroes.length?top5Heroes.map(function(h){var url=heroImgUrl(h);return'<div class="prof-sig-hero">'+(url?'<img src="'+url+'" alt="'+h+'" onerror="this.style.display=\'none\'"/>':'')+'</div>';}).join(''):'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No data for last 3 months</div>';

  // ── Role toggle ──
  var roleToggleHtml=roleInfo.roles.length>1?'<div style="display:flex;gap:4px;flex-wrap:wrap;padding:0 20px 12px;">'+roleInfo.roles.map(function(r){var lbl=r.charAt(0).toUpperCase()+r.slice(1);return'<button class="tier-mode-btn'+(r===selRole?' active':'')+'" onclick="setProfileRole(\''+playerId+'\',\''+r+'\')">'+lbl+'</button>';}).join('')+'</div>':'';

  // ── Radar legend ──
  var radarLegend='<div style="display:flex;gap:16px;justify-content:center;padding:6px 20px 8px;">'+
    '<div style="display:flex;align-items:center;gap:6px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);"><div style="width:20px;height:2px;background:rgba(100,180,255,0.9);border-radius:1px;"></div>'+player.nick+'</div>'+
    '<div style="display:flex;align-items:center;gap:6px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);"><div style="width:20px;height:2px;background:rgba(80,220,140,0.7);border-radius:1px;"></div>Role-Aware 6-Axis</div>'+
  '</div>';

  // ── Pillar breakdown cards ──
  var pillarCardsHtml=radarAxes.labels.map(function(lbl,i){
    var v=radarAxes.values[i];var g=v>0?scoreToGrade(v):null;
    var pct=v>0?Math.min(v/10*100,100):0;
    var barCol=i===4?'rgba(80,220,140,1)':i===5?'rgba(255,255,255,0.4)':'rgba(100,180,255,1)';
    var gc=g?(g.cls==='grade-sp'?'rgba(255,255,255,0.95)':g.cls==='grade-s'?'rgba(232,232,232,0.9)':g.cls==='grade-sm'?'rgba(200,200,200,0.85)':g.cls==='grade-ap'?'rgba(255,204,68,0.95)':g.cls==='grade-a'?'rgba(68,255,136,0.9)':'rgba(136,136,136,0.7)'):'rgba(136,136,136,0.5)';
    var shortLbl=lbl.replace('Survival & Positioning','Survival').replace('Protection & Peel','Protection').replace('Resource Efficiency','Resources').replace('Role Fulfillment','Role Fulfil.').replace('Lane Resilience','Lane Resil.');
    return '<div class="pillar-card">'+
      '<div class="pc-name">'+shortLbl.toUpperCase()+'</div>'+
      '<div class="pc-val-row">'+
        '<div class="pc-val">'+(v>0?v.toFixed(1):'—')+'</div>'+
        (g?'<div class="pc-grade" style="color:'+gc+';">'+g.grade+'</div>':'')+
      '</div>'+
      '<div class="pc-bar-wrap"><div class="pc-bar"><div class="pc-bar-fill" style="width:'+pct+'%;background:'+barCol+';"></div></div><div class="pc-of">/ 10</div></div>'+
    '</div>';
  }).join('');

  // ── Overall tab content ──
  var overallContent=
    '<div class="overall-split">'+
      '<div class="overall-radar-col">'+
        '<div class="section-label">PILLAR RADAR <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· '+roleLabel.toUpperCase()+' · 6-AXIS</span></div>'+
        roleToggleHtml+
        '<div class="radar-wrap"><canvas id="radar-'+playerId+'" width="440" height="440" style="width:100%;max-width:440px;"></canvas></div>'+
        radarLegend+
      '</div>'+
      '<div class="overall-breakdown-col">'+
        '<div class="section-label">PILLAR BREAKDOWN <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· GRADED 0–10</span></div>'+
        '<div class="prof-overall-header">'+
          '<div class="prof-overall-label">OVERALL</div>'+
          '<div class="prof-overall-grade '+(overallGrade?overallGrade.cls:'')+'">'+(overallGrade?overallGrade.grade:'—')+'</div>'+
          '<div class="prof-overall-val">'+(overallAvg>0?overallAvg.toFixed(2):'—')+'</div>'+
        '</div>'+
        '<div class="pillar-cards-grid">'+pillarCardsHtml+'</div>'+
      '</div>'+
    '</div>';

  // ── Statistic tab content (chart + fixed raw stats) ──
  var statisticContent='<div id="ptrend-block-'+playerId+'"></div><div id="prof-rawstats-'+playerId+'"></div>';

  // ── Left sidebar ──
  var sidebarHtml=
    '<div class="prof-photo-area">'+photoHtml+
      '<div class="prof-photo-overlay">'+
        '<div class="prof-photo-ign">#'+player.ign.toUpperCase()+' · '+(player.role||'').toUpperCase()+'</div>'+
        '<div class="prof-photo-status" style="color:'+statusColor+';border-color:'+statusBorder+';">'+(player.status||'').toUpperCase()+'</div>'+
      '</div>'+
    '</div>'+
    '<div class="prof-name-block">'+
      '<div class="prof-big-name">'+player.nick.toUpperCase()+'</div>'+
      '<div class="prof-sub-line">'+player.ign+' · '+(player.role||'')+'</div>'+
    '</div>'+
    '<div class="prof-afc-box">'+
      _profAfcCell('ABILITY',abilityGrade,threeMonthAvg)+
      _profAfcCell('FORM',formGrade,last5Avg)+
      _profAfcCell('HERO POOL',hpGrade,hp.pct/10)+
    '</div>'+
    '<div class="prof-quick-stats">'+
      '<div class="prof-qs-cell"><div class="prof-qs-val">'+allGames.length+'</div><div class="prof-qs-label">Games</div></div>'+
      '<div class="prof-qs-cell"><div class="prof-qs-val '+(peakGrade?peakGrade.cls:'')+'">'+(peakGrade?peakGrade.grade:'—')+'</div><div class="prof-qs-label">Peak</div></div>'+
      '<div class="prof-qs-cell"><div class="prof-qs-val">'+(avgKDA!=null?avgKDA.toFixed(1):'—')+'</div><div class="prof-qs-label">Avg KDA</div></div>'+
    '</div>'+
    '<div class="prof-signature">'+
      '<div class="prof-sig-label">Signature</div>'+
      '<div class="prof-sig-heroes">'+sigHtml+'</div>'+
    '</div>'+
    '<div class="prof-sidebar-footer">'+
      'PROJECT SUCROSE · S2-26 ·&nbsp;<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--success);"></span>&nbsp;TRACKED'+
    '</div>';

  // ── Right panel ──
  var rightHtml=
    '<div class="prof-topbar">'+
      '<div class="prof-breadcrumb" onclick="showPage(\'page-roster\')">← ROSTER / PROFILE</div>'+
      '<div class="prof-player-tabs">'+playerTabsHtml+'<button class="prof-player-tab edit-tab" onclick="openPlayerEdit(\''+playerId+'\')">EDIT</button></div>'+
    '</div>'+
    '<div class="prof-tabs-nav">'+
      '<button class="prof-tab-btn'+(tabState==='overall'?' active':'')+'" onclick="setProfileTab(\''+playerId+'\',\'overall\')"><div class="ptab-main">OVERALL</div><div class="ptab-sub">PILLARS & RADAR</div></button>'+
      '<button class="prof-tab-btn'+(tabState==='statistic'?' active':'')+'" onclick="setProfileTab(\''+playerId+'\',\'statistic\')"><div class="ptab-main">STATISTIC</div><div class="ptab-sub">TREND & RAW</div></button>'+
      '<button class="prof-tab-btn'+(tabState==='heroes'?' active':'')+'" onclick="setProfileTab(\''+playerId+'\',\'heroes\')"><div class="ptab-main">HEROES</div><div class="ptab-sub">POOL & MASTERY</div></button>'+
      '<button class="prof-tab-btn'+(tabState==='games'?' active':'')+'" onclick="setProfileTab(\''+playerId+'\',\'games\')"><div class="ptab-main">GAMES</div><div class="ptab-sub">MATCH HISTORY</div></button>'+
    '</div>'+
    '<div class="prof-tab-panel" id="prof-panel-overall-'+playerId+'" style="display:'+(tabState==='overall'?'block':'none')+';">'+overallContent+'</div>'+
    '<div class="prof-tab-panel" id="prof-panel-statistic-'+playerId+'" style="display:'+(tabState==='statistic'?'block':'none')+';">'+statisticContent+'</div>'+
    '<div class="prof-tab-panel" id="prof-panel-heroes-'+playerId+'" style="display:'+(tabState==='heroes'?'block':'none')+';"></div>'+
    '<div class="prof-tab-panel" id="prof-panel-games-'+playerId+'" style="display:'+(tabState==='games'?'block':'none')+';"></div>';

  document.getElementById('profile-content').innerHTML=
    '<div class="profile-shell">'+
      '<div class="profile-sidebar">'+sidebarHtml+'</div>'+
      '<div class="profile-main">'+rightHtml+'</div>'+
    '</div>';

  showPage('page-profile');
  window._currentProfileId=playerId;
  setTimeout(function(){
    if(tabState==='overall'){
      drawRadar(playerId,radarData,{overlayData:starterAvg,colour1:'rgba(100,180,255,1)',colour2:'rgba(80,220,140,1)',showLabels:true,showGrades:true});
    }else if(tabState==='statistic'){
      renderPtrend(playerId);
      _renderProfileRawStats(playerId);
    }else if(tabState==='heroes'){
      renderProfileHeroesTab(playerId);
    }else if(tabState==='games'){
      renderProfileGamesTab(playerId);
    }
  },60);
}
// ── Pillar trend: SELECT VIEW + date presets ──
function renderPtrend(playerId){
  var box=document.getElementById('ptrend-block-'+playerId);if(!box)return;
  // Preserve SELECT VIEW open state across re-renders
  var existingDd=document.getElementById('sv-dd-'+playerId);
  var svWasOpen=existingDd&&existingDd.style.display!=='none';
  var role=window._profileRole;
  var pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var st=_ptrendState();
  var isPillar=st.mode!=='raw';
  var pillarDefs=[{k:'p0',l:pl[0]},{k:'p1',l:pl[1]},{k:'p2',l:pl[2]},{k:'p3',l:pl[3]},{k:'ment',l:'Mentality'},{k:'hp',l:'Hero Pool'},{k:'overall',l:'Overall'}];
  var rawDefs=_ptrendRawDefs();
  var seriesDefs=isPillar?pillarDefs:rawDefs;
  var seriesColors=isPillar?PTREND_COLORS:rawDefs.map(function(d){return d.color;});
  var seriesState=isPillar?st.series:st.rawSeries;
  var presets=[['all','All'],['1w','1W'],['2w','2W'],['1m','1M']];
  var inpStyle='background:var(--grey-1);border:var(--border);color:var(--white);font-family:inherit;font-size:10px;padding:4px 6px;border-radius:2px;';
  var tipStyle='display:none;position:absolute;pointer-events:none;background:rgba(14,14,18,0.97);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;min-width:145px;max-width:195px;font-family:\'DM Mono\',monospace;font-size:9px;z-index:10;line-height:1.4;';

  // ── SELECT VIEW counts ──
  var pillarSel=Object.keys(st.series).filter(function(k){return st.series[k];}).length;
  var pillarTot=Object.keys(st.series).length;
  var rawSel=Object.keys(st.rawSeries).filter(function(k){return st.rawSeries[k];}).length;
  var rawTot=Object.keys(st.rawSeries).length;
  var svCount=pillarSel+'/'+pillarTot+' · '+rawSel+'/'+rawTot;

  // ── SELECT VIEW dropdown items ──
  var svPillarItems=pillarDefs.map(function(s,i){
    var col=PTREND_COLORS[i]||'rgba(255,255,255,0.5)';
    return '<label class="sv-item">'+
      '<input type="checkbox" '+(st.series[s.k]?'checked':'')+' onchange="togglePtrendSeries(\''+playerId+'\',\''+s.k+'\')" style="accent-color:'+col+';margin:0;"/>'+
      '<span class="sv-color-line" style="background:'+col+';"></span>'+s.l+'</label>';
  }).join('');
  var svRawItems=rawDefs.map(function(s){
    return '<label class="sv-item">'+
      '<input type="checkbox" '+(st.rawSeries[s.k]?'checked':'')+' onchange="togglePtrendRawSeries(\''+playerId+'\',\''+s.k+'\')" style="accent-color:'+s.color+';margin:0;"/>'+
      '<span class="sv-color-line" style="background:'+s.color+';"></span>'+s.l+'</label>';
  }).join('');

  // ── Game count subtitle ──
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var rg=_ptrendRange();
  var filteredCount=_profilePlayerGames(playerId).filter(function(g){
    if(_profileRoleOf(g,playerId,player)!==role)return false;
    var d=parseDate(g.date);
    if(rg.from&&d<rg.from)return false;
    if(rg.to&&d>rg.to)return false;
    return true;
  }).length;
  var roleLabel=(role||'').charAt(0).toUpperCase()+(role||'').slice(1);

  // ── Legend for visible series ──
  var legendHtml='<div style="display:flex;gap:8px 16px;flex-wrap:wrap;padding:6px 20px 16px;">'+
    seriesDefs.map(function(s,i){
      if(!seriesState[s.k])return'';
      var col=seriesColors[i]||'rgba(255,255,255,0.5)';
      return'<div style="display:flex;align-items:center;gap:5px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+
        '<span style="display:inline-block;width:14px;height:2px;background:'+col+';border-radius:1px;"></span>'+s.l+'</div>';
    }).join('')+
  '</div>';

  var html=
    '<div style="padding:16px 20px 0;">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">'+
        '<div>'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1px;line-height:1;">PILLAR TREND</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1px;margin-top:4px;">'+roleLabel.toUpperCase()+' · LAST '+filteredCount+' GAMES</div>'+
        '</div>'+
        '<div class="select-view-wrap">'+
          '<button class="select-view-btn" onclick="toggleSelectView(\''+playerId+'\')">'+
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'+
            ' SELECT VIEW <span class="select-view-count">'+svCount+'</span>'+
          '</button>'+
          '<div class="select-view-dropdown" id="sv-dd-'+playerId+'" style="display:none;">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px 6px;border-bottom:var(--border);">'+
              '<div style="display:flex;gap:5px;">'+
                '<button class="tier-mode-btn" style="padding:4px 8px;font-size:8px;" onclick="setPtrendAllSeries(\''+playerId+'\',true)">All</button>'+
                '<button class="tier-mode-btn" style="padding:4px 8px;font-size:8px;" onclick="setPtrendAllSeries(\''+playerId+'\',false)">None</button>'+
              '</div>'+
              '<button onclick="closeSelectView(\''+playerId+'\')" style="background:none;border:none;color:var(--grey-5);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;" title="Close">&times;</button>'+
            '</div>'+
            '<div class="sv-section-header">PILLAR</div>'+svPillarItems+
            '<div class="sv-section-header">RAW STATS</div>'+svRawItems+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">'+
        '<button class="tier-mode-btn'+(isPillar?' active':'')+'" onclick="setPtrendMode(\''+playerId+'\',\'pillar\')">Pillar</button>'+
        '<button class="tier-mode-btn'+(!isPillar?' active':'')+'" onclick="setPtrendMode(\''+playerId+'\',\'raw\')">Raw Stats</button>'+
      '</div>'+
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">'+
        presets.map(function(p){return'<button class="tier-mode-btn'+(st.preset===p[0]?' active':'')+'" onclick="setPtrendPreset(\''+playerId+'\',\''+p[0]+'\')">'+p[1]+'</button>';}).join('')+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">'+
        '<span>FROM</span><input type="date" id="ptrend-from-'+playerId+'" value="'+(st.from||'')+'" onchange="setPtrendCustom(\''+playerId+'\')" style="'+inpStyle+'"/>'+
        '<span>TO</span><input type="date" id="ptrend-to-'+playerId+'" value="'+(st.to||'')+'" onchange="setPtrendCustom(\''+playerId+'\')" style="'+inpStyle+'"/>'+
      '</div>'+
    '</div>'+
    '<div style="padding:0 20px 4px;position:relative;">'+
      '<canvas id="ptrend-'+playerId+'" style="width:100%;height:220px;display:block;cursor:crosshair;"></canvas>'+
      '<div id="ptrend-tip-'+playerId+'" style="'+tipStyle+'"></div>'+
    '</div>'+
    legendHtml;
  box.innerHTML=html;
  // Restore SELECT VIEW open state
  if(svWasOpen){var newDd=document.getElementById('sv-dd-'+playerId);if(newDd)newDd.style.display='block';}
  if(isPillar)drawPillarTrend(playerId);else drawRawStatsTrend(playerId);
}
function drawPillarTrend(playerId){
  var canvas=document.getElementById('ptrend-'+playerId);if(!canvas)return;
  var role=window._profileRole;
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var st=_ptrendState(),rg=_ptrendRange();
  var games=_profilePlayerGames(playerId).filter(function(g){
    if(_profileRoleOf(g,playerId,player)!==role)return false;
    var d=parseDate(g.date);
    if(rg.from&&d<rg.from)return false;
    if(rg.to&&d>rg.to)return false;
    return true;
  }).sort(function(a,b){return gameDateTime(a)-gameDateTime(b);});
  var dpr=window.devicePixelRatio||1;var dW=canvas.offsetWidth||canvas.width||600;var dH=canvas.offsetHeight||200;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.height=dH+'px';
  var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,dW,dH);
  var padL=26,padR=12,padT=12,padB=22;
  var plotW=dW-padL-padR,plotH=dH-padT-padB;
  function yPos(v){return padT+plotH-((Math.max(1,Math.min(v,10))-1)/9)*plotH;}
  function xPos(i){return games.length<=1?padL+plotW/2:padL+(i/(games.length-1))*plotW;}
  ctx.textBaseline='middle';ctx.font='9px DM Mono,monospace';
  [2,4,6,8,10].forEach(function(gv){var y=yPos(gv);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(dW-padR,y);ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='right';ctx.fillText(gv,padL-6,y);});
  if(!games.length){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.font='10px DM Mono,monospace';ctx.fillText('No games in range',dW/2,dH/2);_ptrendSetupCanvasEvents(playerId);return;}
  ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='8px DM Mono,monospace';ctx.textBaseline='top';
  ctx.textAlign='left';ctx.fillText(games[0].date,padL,dH-padB+5);
  if(games.length>1){ctx.textAlign='right';ctx.fillText(games[games.length-1].date,dW-padR,dH-padB+5);}
  function valFor(key,g){
    var s=g.playerScores[playerId];
    if(key==='ment')return _profileMentalityForGame(g,playerId);
    if(key==='hp')return null;
    if(key==='overall')return calcGameScore(s,role,g,playerId);
    var ps=s.pillar_scores;return ps?ps[key]:null;
  }
  var pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var pillarLabels={p0:pl[0],p1:pl[1],p2:pl[2],p3:pl[3],ment:'Mentality',hp:'Hero Pool',overall:'Overall'};
  window._ptrendHits=window._ptrendHits||{};window._ptrendHits[playerId]=[];
  ['p0','p1','p2','p3','ment','hp','overall'].forEach(function(key,si){
    if(!st.series[key])return;
    var pts=[];
    games.forEach(function(g,i){
      var v=valFor(key,g);
      if(v!=null&&v>0){
        var px=xPos(i),py=yPos(v);pts.push({x:px,y:py,v:v});
        window._ptrendHits[playerId].push({x:px,y:py,game:g,key:key,label:pillarLabels[key],color:PTREND_COLORS[si],value:v,fmtVal:v.toFixed(1)});
      }
    });
    if(!pts.length)return;
    ctx.strokeStyle=PTREND_COLORS[si];ctx.lineWidth=key==='overall'?2.5:2;ctx.beginPath();
    pts.forEach(function(p,idx){idx===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.stroke();
    ctx.fillStyle=PTREND_COLORS[si];pts.forEach(function(p){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();});
  });
  _ptrendSetupCanvasEvents(playerId);
}
// RADAR
// ══════════════════════════════════════════
function getStarterAvgRadar(games){PLAYERS=getPlayers();var starters=PLAYERS.filter(function(p){return p.status==='Starter';});if(!starters.length)return null;var sums=Array(6).fill(0),counts=Array(6).fill(0);starters.forEach(function(p){var rd=getRadarValues(p.id,games);var hp=calcHeroPoolScore(p.id);rd[5].value=Math.min(hp.pct/10,10);rd.forEach(function(d,i){if(d.value>0){sums[i]+=d.value;counts[i]++;}});});return sums.map(function(s,i){return counts[i]?s/counts[i]:0;});}
function drawRadar(canvasId,radarData,options){
  options=options||{};var overlayData=options.overlayData||null,colour1=options.colour1||'rgba(100,180,255,1)',colour2=options.colour2||'rgba(80,220,140,1)',showLabels=options.showLabels!==false,showGrades=options.showGrades!==false;
  var canvas=document.getElementById('radar-'+canvasId);if(!canvas)return;
  var dpr=window.devicePixelRatio||1;var dW=canvas.offsetWidth||canvas.width;var dH=canvas.offsetHeight||canvas.height;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.width=dW+'px';canvas.style.height=dH+'px';
  var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  var W=dW,H=dH,cx=W/2,cy=H/2,R=Math.min(W,H)/2-74,n=radarData.length;
  ctx.clearRect(0,0,W,H);
  function ang(i){return(Math.PI*2*i/n)-Math.PI/2;}
  function pt(i,r){return{x:cx+r*Math.cos(ang(i)),y:cy+r*Math.sin(ang(i))};}
  [0.2,0.4,0.6,0.8,1].forEach(function(f){ctx.beginPath();for(var i=0;i<n;i++){var p=pt(i,R*f);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();ctx.strokeStyle=f===1?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.05)';ctx.lineWidth=1;ctx.stroke();});
  for(var i=0;i<n;i++){var p=pt(i,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p.x,p.y);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.stroke();}
  function drawPoly(values,fillCol,strokeCol,dotCol){var hasData=values.some(function(v){return v>0;});ctx.beginPath();values.forEach(function(v,i){var frac=hasData?Math.min(v/10,1):0.12;var p=pt(i,R*frac);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.closePath();ctx.fillStyle=fillCol;ctx.fill();ctx.strokeStyle=strokeCol;ctx.lineWidth=2;ctx.stroke();if(hasData)values.forEach(function(v,i){if(v<=0)return;var p=pt(i,R*Math.min(v/10,1));ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle=dotCol;ctx.fill();});}
  if(overlayData) drawPoly(overlayData,colour2.replace('1)','0.08)'),colour2.replace('1)','0.5)'),colour2.replace('1)','0.7)'));
  drawPoly(radarData.map(function(d){return d.value;}),colour1.replace('1)','0.12)'),colour1.replace('1)','0.9)'),colour1);
  if(showLabels){radarData.forEach(function(d,i){
    var lR=R+40;var p=pt(i,lR);
    var g=d.value>0?scoreToGrade(d.value):null;
    var short=d.label.replace('Survival & Positioning','Survival').replace('Protection & Peel','Protection').replace('Resource Efficiency','Resources').replace('Role Fulfillment','Role Fulfil.').replace('Lane Resilience','Lane Resil.');
    ctx.textAlign='center';
    // Label name — larger
    ctx.font='600 13px DM Sans,sans-serif';
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillText(short,p.x,p.y);
    if(d.value>0){
      // Numeric value
      ctx.font='bold 12px "Bebas Neue",sans-serif';
      ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.fillText(d.value.toFixed(1),p.x,p.y+16);
      // Letter grade
      if(showGrades&&g){
        var gc=g.cls==='grade-sp'?'rgba(255,255,255,0.95)':g.cls==='grade-s'?'rgba(232,232,232,0.9)':g.cls==='grade-sm'?'rgba(200,200,200,0.85)':g.cls==='grade-ap'?'rgba(255,204,68,0.95)':g.cls==='grade-a'?'rgba(68,255,136,0.9)':'rgba(136,136,136,0.7)';
        ctx.font='bold 11px "Bebas Neue",sans-serif';
        ctx.fillStyle=gc;
        ctx.fillText(g.grade,p.x,p.y+30);
      }
    }
  });}
}

// ══════════════════════════════════════════
// PLAYER EDIT
// ══════════════════════════════════════════
function openPlayerEdit(playerId){PLAYERS=getPlayers();var data=loadData();var isNew=!playerId;var player=isNew?null:PLAYERS.find(function(p){return p.id===playerId;});var pfp=isNew?null:data.pfp&&data.pfp[playerId]||null;document.getElementById('player-edit-modal-title').textContent=isNew?'ADD PLAYER':'EDIT PLAYER';var prevHtml=pfp?'<div class="pfp-preview"><img id="pfp-preview-img" src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>':'<div class="pfp-preview" id="pfp-preview-fallback">'+(player?player.nick[0]:'?')+'</div>';document.getElementById('player-edit-modal-body').innerHTML='<div class="pfp-upload-wrap">'+prevHtml+'<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--grey-5);margin-bottom:8px;">PROFILE PHOTO</div><label class="btn btn-sm btn-muted" style="cursor:pointer;display:inline-flex;">Upload Photo<input type="file" accept="image/*" style="display:none;" onchange="handlePfpUpload(event)"/></label>'+(pfp?'<button class="btn btn-sm" style="margin-left:8px;color:var(--danger);border-color:var(--danger);" onclick="removePfp()">Remove</button>':'')+'<div style="font-size:10px;color:var(--grey-5);margin-top:6px;">Auto-compressed to 1000x1000</div></div></div><div class="row"><div class="input-group mb-0"><label class="input-label">Nick</label><input class="input" id="pe-nick" value="'+(player&&player.nick||'')+'" placeholder="e.g. Gun"/></div><div class="input-group mb-0"><label class="input-label">IGN</label><input class="input" id="pe-ign" value="'+(player&&player.ign||'')+'" placeholder="e.g. Sutthiphat"/></div></div><div class="row mt-16"><div class="input-group mb-0"><label class="input-label">Role</label><select class="input" id="pe-role">'+GAME_ROLES.map(function(r){return '<option value="'+r+'"'+(player&&player.role===r?' selected':'')+'>'+r+'</option>';}).join('')+'</select></div><div class="input-group mb-0"><label class="input-label">Status</label><select class="input" id="pe-status">'+['Starter','Substitute','Inactive'].map(function(s){return '<option value="'+s+'"'+(player&&player.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div></div><div style="display:flex;gap:10px;margin-top:20px;">'+(isNew?'':'<button class="btn btn-danger btn-sm" onclick="showInlineDeletePlayer(\''+playerId+'\')">Delete</button>')+'<button class="btn btn-primary" style="flex:1;" onclick="savePlayerEdit(\''+(playerId||'')+'\','+isNew+')">'+(isNew?'Add Player':'Save Changes')+'</button></div>'+(isNew?'':'<div class="inline-confirm" id="inline-del-player-'+playerId+'"><div class="inline-confirm-text">Remove this player?</div><div class="inline-confirm-btns"><button class="btn btn-sm btn-muted" onclick="document.getElementById(\'inline-del-player-'+playerId+'\').classList.remove(\'open\')">Cancel</button><button class="btn btn-sm btn-danger" onclick="deletePlayer(\''+playerId+'\')">Yes, Remove</button></div></div>');window._pendingPfp=null;window._removePfp=false;document.getElementById('player-edit-modal').classList.add('open');}
function showInlineDeletePlayer(id){document.getElementById('inline-del-player-'+id)?.classList.add('open');}
function handlePfpUpload(event){var file=event.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(e){var img=new Image();img.onload=function(){var canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1000;var ctx=canvas.getContext('2d');var scale=Math.max(1000/img.width,1000/img.height);var sw=1000/scale,sh=1000/scale;var sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.drawImage(img,sx,sy,sw,sh,0,0,1000,1000);var compressed=canvas.toDataURL('image/jpeg',0.82);window._pendingPfp=compressed;window._removePfp=false;var prev=document.getElementById('pfp-preview-img');var fallback=document.getElementById('pfp-preview-fallback');if(prev){prev.src=compressed;}else if(fallback){fallback.style.fontSize='0';fallback.innerHTML='<img id="pfp-preview-img" src="'+compressed+'" style="width:100%;height:100%;object-fit:cover;"/>';}};img.src=e.target.result;};reader.readAsDataURL(file);}
function removePfp(){window._pendingPfp=null;window._removePfp=true;var prev=document.getElementById('pfp-preview-img');var wrap=document.querySelector('.pfp-preview');if(prev)prev.remove();if(wrap){wrap.textContent='?';wrap.style.fontSize='26px';}}
async function savePlayerEdit(playerId,isNew){
  var nick=document.getElementById('pe-nick').value.trim();
  var ign=document.getElementById('pe-ign').value.trim();
  var role=document.getElementById('pe-role').value;
  var status=document.getElementById('pe-status').value;
  if(!nick||!ign){showToast('Name fields required');return;}
  PLAYERS=getPlayers();
  if(isNew){
    var newId='p_'+Date.now();
    var newP={id:newId,ign:ign,nick:nick,role:role,status:status};
    PLAYERS.push(newP);
    if(window._pendingPfp){_cache.pfp[newId]=window._pendingPfp;await sbSaveSetting('pfp',_cache.pfp);}
    await sbSavePlayer(newP);
  }else{
    var idx=PLAYERS.findIndex(function(p){return p.id===playerId;});
    if(idx>-1) PLAYERS[idx]=Object.assign({},PLAYERS[idx],{ign,nick,role,status});
    if(window._pendingPfp){_cache.pfp[playerId]=window._pendingPfp;await sbSaveSetting('pfp',_cache.pfp);}
    if(window._removePfp){delete _cache.pfp[playerId];await sbSaveSetting('pfp',_cache.pfp);}
    await sbSavePlayer(PLAYERS[idx]);
  }
  savePlayers(PLAYERS);
  window._pendingPfp=null;window._removePfp=false;
  closeModal('player-edit-modal');showToast(isNew?'Player added':'Player updated');renderRoster();
}
async function deletePlayer(playerId){
  await sbDeletePlayer(playerId);
  var updated=getPlayers().filter(function(p){return p.id!==playerId;});
  savePlayers(updated);PLAYERS=updated;
  closeModal('player-edit-modal');showToast('Player removed');showPage('page-roster');
}

// ══════════════════════════════════════════
// PROFILE HEROES TAB
// ══════════════════════════════════════════
window._profileHeroSelected=window._profileHeroSelected||{};

function _heroPoolData(playerId){
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var allGames=_profilePlayerGames(playerId);
  var heroMap={};
  var totalGames=allGames.length;
  allGames.forEach(function(g){
    var s=g.playerScores&&g.playerScores[playerId];
    if(!s||!s.hero)return;
    var h=s.hero;
    if(!heroMap[h])heroMap[h]={games:0,wins:0,coachS:0,coachN:0,igrS:0,igrN:0};
    heroMap[h].games++;
    if(g.result==='Win')heroMap[h].wins++;
    var cv=calcGameScore(s,player?player.role:'',g,playerId);
    if(cv>0){heroMap[h].coachS+=cv;heroMap[h].coachN++;}
    if(s.in_game_rating!=null){heroMap[h].igrS+=+s.in_game_rating;heroMap[h].igrN++;}
  });
  return Object.keys(heroMap).sort(function(a,b){return heroMap[b].games-heroMap[a].games;}).map(function(h){
    var d=heroMap[h];
    return{hero:h,games:d.games,wins:d.wins,winRate:d.games?d.wins/d.games*100:0,
           avgCoach:d.coachN?d.coachS/d.coachN:null,avgIGR:d.igrN?d.igrS/d.igrN:null,
           poolPct:totalGames?d.games/totalGames*100:0};
  });
}

function _heroDetailStats(playerId,heroName){
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var games=_profilePlayerGames(playerId).filter(function(g){
    var s=g.playerScores&&g.playerScores[playerId];return s&&s.hero===heroName;
  });
  var k=0,d=0,a=0,gpmS=0,gpmN=0,igrS=0,igrN=0;
  var ddS=0,ddN=0,dtS=0,dtN=0,kpS=0,kpN=0,coachS=0,coachN=0;
  var ddpmS=0,ddpmN=0,dtpmS=0,dtpmN=0,wins=0;
  games.forEach(function(g){
    var s=g.playerScores[playerId];
    if(g.result==='Win')wins++;
    k+=+(s.kills||0);d+=+(s.deaths||0);a+=+(s.assists||0);
    if(s.gold_per_min!=null){gpmS+=+s.gold_per_min;gpmN++;}
    if(s.in_game_rating!=null){igrS+=+s.in_game_rating;igrN++;}
    if(s.dmg_dealt_pct!=null){ddS+=+s.dmg_dealt_pct;ddN++;}
    if(s.dmg_taken_pct!=null){dtS+=+s.dmg_taken_pct;dtN++;}
    var tk=g.team_total_kills;
    if(tk&&tk>0){kpS+=((+(s.kills||0))+(+(s.assists||0)))/tk*100;kpN++;}
    var cv=calcGameScore(s,player?player.role:'',g,playerId);
    if(cv>0){coachS+=cv;coachN++;}
    var durMin=g.duration_seconds?g.duration_seconds/60:null;
    if(durMin&&durMin>0){
      if(s.dmg_dealt_raw!=null){ddpmS+=+s.dmg_dealt_raw/durMin;ddpmN++;}
      if(s.dmg_taken_raw!=null){dtpmS+=+s.dmg_taken_raw/durMin;dtpmN++;}
    }
  });
  return{games:games.length,wins:wins,winRate:games.length?wins/games.length*100:0,
    kda:games.length?(k+a)/Math.max(d,1):null,
    gpm:gpmN?gpmS/gpmN:null,igr:igrN?igrS/igrN:null,
    dd:ddN?ddS/ddN:null,dt:dtN?dtS/dtN:null,kp:kpN?kpS/kpN:null,
    coach:coachN?coachS/coachN:null,
    ddpm:ddpmN?ddpmS/ddpmN:null,dtpm:dtpmN?dtpmS/dtpmN:null};
}

function _heroSynergies(playerId,heroName){
  var games=_profilePlayerGames(playerId).filter(function(g){
    var s=g.playerScores&&g.playerScores[playerId];return s&&s.hero===heroName;
  });
  var withMap={},againstMap={};
  games.forEach(function(g){
    var win=g.result==='Win';
    Object.keys(g.playerScores||{}).forEach(function(pid){
      if(pid===playerId)return;
      var ts=g.playerScores[pid];
      if(!ts||ts.skipped||!ts.hero)return;
      var h=ts.hero;
      if(!withMap[h])withMap[h]={games:0,wins:0};
      withMap[h].games++;if(win)withMap[h].wins++;
    });
    (g.enemyPicks||[]).forEach(function(ep){
      if(!ep.hero)return;
      var h=ep.hero;
      if(!againstMap[h])againstMap[h]={games:0,wins:0};
      againstMap[h].games++;if(win)againstMap[h].wins++;
    });
  });
  function toArr(map){
    return Object.keys(map).sort(function(a,b){return map[b].games-map[a].games;}).slice(0,5)
      .map(function(h){return{hero:h,games:map[h].games,wins:map[h].wins,wr:map[h].games?map[h].wins/map[h].games*100:0};});
  }
  return{with:toArr(withMap),against:toArr(againstMap)};
}

function selectHeroPoolItem(playerId,heroName){
  window._profileHeroSelected=window._profileHeroSelected||{};
  window._profileHeroSelected[playerId]=heroName;
  _renderHeroDetail(playerId);
  document.querySelectorAll('.hp-item').forEach(function(el){
    el.classList.toggle('active',el.getAttribute('data-hero')===heroName);
  });
}

function toggleHeroStats(playerId){
  var moreEl=document.getElementById('hd-more-'+playerId);
  var btnEl=document.getElementById('hd-showmore-btn-'+playerId);
  if(!moreEl)return;
  var isOpen=moreEl.style.display!=='none';
  moreEl.style.display=isOpen?'none':'block';
  if(btnEl)btnEl.textContent=isOpen?'SHOW MORE ▾':'SHOW LESS ▴';
}

function _renderHeroDetail(playerId){
  var box=document.getElementById('prof-hero-detail-'+playerId);
  if(!box)return;
  var heroName=(window._profileHeroSelected||{})[playerId];
  if(!heroName){
    box.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:220px;gap:10px;">'+
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.2;"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:2px;">SELECT A HERO FROM THE POOL</div>'+
    '</div>';
    return;
  }
  var pool=_heroPoolData(playerId);
  var heroData=pool.find(function(h){return h.hero===heroName;});
  var stats=_heroDetailStats(playerId,heroName);
  var syn=_heroSynergies(playerId,heroName);
  var isMain=pool.length>0&&pool[0].hero===heroName;
  var poolPct=heroData?heroData.poolPct:0;
  var heroUrl=heroImgUrl(heroName);

  // Portrait
  var portraitHtml='<div class="hd-hero-portrait">'+
    '<div class="hd-hero-portrait-img" style="background-image:url(\''+heroUrl+'\');"></div>'+
    '<div class="hd-hero-portrait-grad"></div>'+
    '<div class="hd-hero-badge">'+
      (isMain?'<span class="hd-badge-main">▲ MAIN PICK</span>':'')+
      '<span class="hd-badge-pct">'+poolPct.toFixed(0)+'% OF POOL</span>'+
    '</div>'+
    '<div class="hd-hero-name">'+heroName.toUpperCase()+'</div>'+
  '</div>';

  // 3 stat boxes
  var wrColor=stats.winRate>=60?'var(--success)':stats.winRate>=50?'var(--white)':stats.games>0?'var(--danger)':'var(--grey-5)';
  var boxesHtml='<div class="hd-stat-boxes">'+
    '<div class="hd-stat-box"><div class="hd-stat-box-val">'+stats.games+'</div><div class="hd-stat-box-lbl">GAMES PICKED</div></div>'+
    '<div class="hd-stat-box"><div class="hd-stat-box-val" style="color:'+wrColor+';">'+(stats.games?stats.winRate.toFixed(0)+'%':'—')+'</div><div class="hd-stat-box-lbl">WIN RATE</div></div>'+
    '<div class="hd-stat-box"><div class="hd-stat-box-val">'+(stats.coach!=null?stats.coach.toFixed(1):'—')+'</div><div class="hd-stat-box-lbl">AVG COACH SCORE</div></div>'+
  '</div>';

  // Synergy rows
  function synRow(item,idx){
    var wrCol=item.wr>=60?'var(--success)':item.wr>=50?'var(--white)':'var(--danger)';
    return '<div class="hd-syn-row">'+
      '<div class="hd-syn-rank">'+(idx+1)+'</div>'+
      heroPortraitHtml(item.hero,32,false)+
      '<div class="hd-syn-name">'+item.hero+'</div>'+
      '<div class="hd-syn-stats">'+
        '<span class="hd-syn-games">'+item.games+'G</span>'+
        '<span class="hd-syn-wr" style="color:'+wrCol+';">'+item.wr.toFixed(0)+'%</span>'+
      '</div>'+
    '</div>';
  }
  var withHtml=syn.with.length?syn.with.map(synRow).join(''):'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);padding:12px 10px;">No data</div>';
  var vsHtml=syn.against.length?syn.against.map(synRow).join(''):'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);padding:12px 10px;">No data</div>';

  var synHtml='<div class="hd-syn-wrap">'+
    '<div class="hd-syn-col"><div class="hd-syn-label">PLAYED WITH</div>'+withHtml+'</div>'+
    '<div class="hd-syn-col"><div class="hd-syn-label">PLAYED AGAINST</div>'+vsHtml+'</div>'+
  '</div>';

  // All time stats
  function sCell(val,lbl){return '<div class="hd-alltime-cell"><div class="hd-alltime-val">'+(val!=null?val:'—')+'</div><div class="hd-alltime-lbl">'+lbl+'</div></div>';}
  var allTimeHtml='<div class="hd-alltime-header">'+
    '<span class="hd-alltime-title">ALL TIME STATISTICS</span>'+
    '<span class="hd-alltime-sub">· '+stats.games+' GAMES</span>'+
  '</div>'+
  '<div class="hd-alltime-grid">'+
    sCell(stats.kda!=null?stats.kda.toFixed(2):null,'KDA')+
    sCell(stats.gpm!=null?Math.round(stats.gpm):null,'GOLD / MIN')+
    sCell(stats.igr!=null?stats.igr.toFixed(1):null,'IN-GAME RTG')+
    sCell(stats.dd!=null?stats.dd.toFixed(1)+'%':null,'DMG %')+
    sCell(stats.dt!=null?stats.dt.toFixed(1)+'%':null,'DMG TAKEN %')+
    sCell(stats.kp!=null?stats.kp.toFixed(1)+'%':null,'KILL PART.')+
  '</div>';

  var moreId='hd-more-'+playerId;
  var moreHtml='<div id="'+moreId+'" class="hd-more-section" style="display:none;">'+
    '<div class="hd-alltime-grid" style="margin:0 0 0 0;">'+
      sCell(stats.ddpm!=null?Math.round(stats.ddpm):null,'DMG / MIN')+
      sCell(stats.dtpm!=null?Math.round(stats.dtpm):null,'DMG TAKEN / MIN')+
    '</div>'+
  '</div>'+
  '<button class="hd-show-more-btn" id="hd-showmore-btn-'+playerId+'" onclick="toggleHeroStats(\''+playerId+'\')">SHOW MORE ▾</button>';

  box.innerHTML=portraitHtml+boxesHtml+synHtml+allTimeHtml+moreHtml;
}

function renderProfileHeroesTab(playerId){
  var box=document.getElementById('prof-panel-heroes-'+playerId);
  if(!box)return;
  var pool=_heroPoolData(playerId);
  window._profileHeroSelected=window._profileHeroSelected||{};
  if(!window._profileHeroSelected[playerId]&&pool.length>0){
    window._profileHeroSelected[playerId]=pool[0].hero;
  }
  var selectedHero=window._profileHeroSelected[playerId];
  var totalGames=_profilePlayerGames(playerId).length;
  var poolSummary=pool.length+' HEROES · CLICK TO INSPECT';
  var poolWins=0,poolGames=0;
  pool.forEach(function(h){poolGames+=h.games;poolWins+=h.wins;});
  var poolWR=poolGames?Math.round(poolWins/poolGames*100):0;

  var poolItemsHtml=pool.map(function(h){
    var wrColor=h.winRate>=60?'var(--success)':h.winRate>=50?'var(--white)':h.winRate>0?'var(--danger)':'var(--grey-5)';
    var isSelected=h.hero===selectedHero;
    return '<div class="hp-item'+(isSelected?' active':'')+'" data-hero="'+h.hero+'" onclick="selectHeroPoolItem(\''+playerId+'\',\''+h.hero+'\')" style="cursor:pointer;">'+
      '<div class="hp-item-img">'+heroPortraitHtml(h.hero,44,false)+'</div>'+
      '<div class="hp-item-body">'+
        '<div class="hp-item-name">'+h.hero.toUpperCase()+'</div>'+
        '<div class="hp-item-meta">'+h.wins+'W · '+(h.games-h.wins)+'L</div>'+
      '</div>'+
      '<div class="hp-item-wr-col">'+
        '<div class="hp-item-wr" style="color:'+wrColor+';">'+h.winRate.toFixed(0)+'%</div>'+
        '<div class="hp-item-wr-lbl">WR</div>'+
      '</div>'+
      '<div class="hp-item-rtg">'+
        '<div class="hp-item-rtg-val">'+(h.avgCoach!=null?h.avgCoach.toFixed(1):'—')+'</div>'+
        '<div class="hp-item-rtg-lbl">RTG</div>'+
      '</div>'+
    '</div>';
  }).join('');

  if(!pool.length){
    poolItemsHtml='<div style="padding:20px 14px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No games logged yet</div>';
  }

  box.innerHTML='<div class="prof-heroes-split">'+
    '<div class="prof-hero-detail" id="prof-hero-detail-'+playerId+'"></div>'+
    '<div class="prof-hero-pool">'+
      '<div class="hp-header">'+
        '<div class="hp-header-title">HERO POOL</div>'+
        '<div class="hp-header-sub">'+poolSummary+'</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-top:6px;">'+totalGames+' GAMES · '+poolWR+'% WR</div>'+
      '</div>'+
      '<div class="hp-list">'+poolItemsHtml+'</div>'+
    '</div>'+
  '</div>';

  _renderHeroDetail(playerId);
}

// ══════════════════════════════════════════
// PROFILE GAMES TAB
// ══════════════════════════════════════════
function renderProfileGamesTab(playerId){
  var box=document.getElementById('prof-panel-games-'+playerId);
  if(!box)return;
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  var allGames=_profilePlayerGames(playerId).slice().sort(function(a,b){return gameDateTime(b)-gameDateTime(a);});
  if(!allGames.length){
    box.innerHTML='<div class="empty"><div class="empty-icon">🎮</div><div class="empty-text">No games logged yet</div></div>';
    return;
  }
  var wins=allGames.filter(function(g){return g.result==='Win';}).length;
  var rowsHtml=allGames.map(function(g){
    var s=g.playerScores[playerId];
    var heroName=s.hero||'—';
    var k=s.kills!=null?s.kills:'?';var d=s.deaths!=null?s.deaths:'?';var a=s.assists!=null?s.assists:'?';
    var igr=s.in_game_rating!=null?(+s.in_game_rating).toFixed(1):'—';
    var coach=calcGameScore(s,player?player.role:'',g,playerId);
    var coachStr=coach>0?coach.toFixed(1):'—';
    var coachColor=coach>=7?'var(--success)':coach>=5?'var(--white)':coach>0?'var(--danger)':'var(--grey-5)';
    var isWin=g.result==='Win';
    var durStr='';
    if(g.duration_seconds){var m=Math.floor(g.duration_seconds/60);var sec=g.duration_seconds%60;durStr=' · '+m+':'+(sec<10?'0':'')+sec;}
    return '<div class="pgame-row" onclick="openGameDetail(\''+g.id+'\')" style="cursor:pointer;">'+
      '<div class="pgame-result '+(isWin?'pgame-win':'pgame-loss')+'">'+(isWin?'W':'L')+'</div>'+
      '<div class="pgame-hero">'+heroPortraitHtml(heroName,36,false)+'</div>'+
      '<div class="pgame-info">'+
        '<div class="pgame-hero-name">'+heroName+'</div>'+
        '<div class="pgame-meta">'+(g.opponent||'Unknown')+' · '+_fmtDate(g.date)+durStr+'</div>'+
      '</div>'+
      '<div class="pgame-kda">'+k+'/'+d+'/'+a+'</div>'+
      '<div class="pgame-ratings">'+
        '<div class="pgame-rating-cell"><div class="pgame-rating-val">'+igr+'</div><div class="pgame-rating-lbl">IGR</div></div>'+
        '<div class="pgame-rating-cell"><div class="pgame-rating-val" style="color:'+coachColor+';">'+coachStr+'</div><div class="pgame-rating-lbl">COACH</div></div>'+
      '</div>'+
    '</div>';
  }).join('');
  box.innerHTML='<div class="pgames-header">'+
    '<div class="section-label">MATCH HISTORY '+
      '<span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· '+allGames.length+' GAMES · '+wins+'W '+(allGames.length-wins)+'L</span>'+
    '</div>'+
  '</div>'+
  '<div class="pgames-list">'+rowsHtml+'</div>';
}
