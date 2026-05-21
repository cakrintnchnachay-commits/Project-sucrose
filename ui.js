function getPlayers(){ return App.cache.players||[]; }
function savePlayers(arr){ App.cache.players=arr; }
App.players=[];
function loadData(){
  return {
    games: App.cache.games||[],
    matches: App.cache.matches||[],
    metaTiers: App.cache.metaTiers||{},
    masteryTiers: App.cache.masteryTiers||{},
    patches: App.cache.patches||[],
    customHeroes: App.cache.customHeroes||[],
    pfp: App.cache.pfp||{},
    heroes: [],
  };
}
// saveData is now a no-op — all writes go through specific sbSave* functions
function saveData(d){
  // Sync any fields written to d back to cache
  if(d.metaTiers) App.cache.metaTiers=d.metaTiers;
  if(d.masteryTiers) App.cache.masteryTiers=d.masteryTiers;
  if(d.patches) App.cache.patches=d.patches;
  if(d.customHeroes) App.cache.customHeroes=d.customHeroes;
  if(d.pfp) App.cache.pfp=d.pfp;
}

// ══════════════════════════════════════════
// LAYOUT HELPERS
// ══════════════════════════════════════════
function isDesktop(){return window.innerWidth>=768;}
function initLayout(){
  const desktop=isDesktop();
  const logoBlock=document.getElementById('nav-logo-block');
  const spacer=document.getElementById('nav-spacer');
  const settingsBtn=document.getElementById('nav-settings-btn');
  if(logoBlock) logoBlock.style.display=desktop?'block':'none';
  if(spacer) spacer.style.display=desktop?'block':'none';
  if(settingsBtn) settingsBtn.style.display=desktop?'flex':'none';
}
window.addEventListener('resize',initLayout);

function renderHome(){
  App.players=getPlayers();
  const data=loadData();
  const games=data.games||[];
  const matches=App.cache.matches||[];

  const el=document.getElementById('home-date');
  if(el) el.textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase();

  // ── Quick stats (all from games_v2) ──
  const totalGames=games.length;
  const totalWins=games.filter(function(g){return g.result==='Win';}).length;
  const gEl=document.getElementById('qs-games');if(gEl) gEl.textContent=totalGames;
  const sEl=document.getElementById('qs-sessions');if(sEl) sEl.textContent=matches.length||'--';
  const wEl=document.getElementById('qs-winrate');if(wEl) wEl.textContent=totalGames?Math.round(totalWins/totalGames*100)+'%':'--';

  // ── Win rate by game type: Scrim vs Tournament ──
  function typeStats(type){
    const gs=games.filter(function(g){return (g.type||'Scrim')===type;});
    const w=gs.filter(function(g){return g.result==='Win';}).length;
    return {n:gs.length,w:w,l:gs.length-w,wr:gs.length?Math.round(w/gs.length*100):null};
  }
  function typeCard(label,st,accent){
    const wrTxt=st.wr!=null?st.wr+'%':'--';
    const pct=st.wr!=null?st.wr:0;
    return '<div style="background:var(--grey-1);border:var(--border);padding:14px 16px;">'+
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:'+accent+';">'+label+'</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+st.w+'W – '+st.l+'L</div>'+
      '</div>'+
      '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:26px;">'+wrTxt+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+st.n+' game'+(st.n!==1?'s':'')+'</div></div>'+
      '<div style="height:4px;background:var(--grey-3);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+accent+';border-radius:2px;transition:width 0.4s ease;"></div></div>'+
    '</div>';
  }
  const wt=document.getElementById('home-winrate-type');
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

  // ── Form-drop alerts ──
  const dismissed=App.cache.dismissed||{};
  let alertsHtml='';
  App.players.forEach(function(p){
    const st=getPlayerStats(p.id,games);
    if(st.monthAvg>0&&st.weekAvg>0&&st.monthAvg-st.weekAvg>1.5){
      const key='underperf_'+p.id;
      if(!dismissed[key]) alertsHtml+='<div class="alert-banner alert-banner-danger" id="alert-'+key+'"><div style="flex:1;cursor:pointer;" onclick="showProfile(\''+p.id+'\')"><strong>'+p.nick+'</strong> — form drop detected. Week avg '+st.weekAvg.toFixed(1)+' vs month avg '+st.monthAvg.toFixed(1)+'</div><button class="alert-banner-dismiss" onclick="dismissAlert(\''+key+'\')">&#x2715;</button></div>';
    }
  });
  const aEl=document.getElementById('home-alerts');if(aEl) aEl.innerHTML=alertsHtml;

  // ── Recent sessions list ──
  const c=document.getElementById('home-sessions');
  if(c){
    const recentMatches=matches.slice().sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0);}).slice(0,5);
    if(!totalGames&&!recentMatches.length){
      c.innerHTML='<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No sessions logged yet</div></div>';
    } else if(recentMatches.length){
      c.innerHTML=recentMatches.map(function(m){
        const mGames=games.filter(function(g){return g.matchId===m.id;});
        const w=mGames.filter(function(g){return g.result==='Win';}).length;
        const series=mGames.length?w+'–'+(mGames.length-w):'No games';
        const sr=mGames.length?(w>mGames.length-w?'Win':w<mGames.length-w?'Loss':'Tie'):null;
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
}

function renderTeamSummary(data){
  App.players=getPlayers();
  const container=document.getElementById('home-team-summary');if(!container)return;
  const playerStats=App.players.filter(function(p){return p.status!=='Inactive';}).map(function(p){
    const st=getPlayerStats(p.id,data.games);return{p:p,monthAvg:st.monthAvg,weekAvg:st.weekAvg};
  }).filter(function(x){return x.monthAvg>0;});
  if(!playerStats.length){container.innerHTML='<div class="empty" style="padding:20px;"><div class="empty-icon">📊</div><div class="empty-text">No data yet — log some games</div></div>';return;}
  const sorted=playerStats.slice().sort(function(a,b){return b.monthAvg-a.monthAvg;});
  const best=sorted[0],worst=sorted[sorted.length-1];
  const weekStats=App.players.filter(function(p){return p.status!=='Inactive';}).map(function(p){const st=getPlayerStats(p.id,data.games);return{p:p,weekAvg:st.weekAvg};}).filter(function(x){return x.weekAvg>0;}).sort(function(a,b){return b.weekAvg-a.weekAvg;});
  const bestWeek=weekStats[0]||null;
  const teamAvg=playerStats.reduce(function(a,x){return a+x.monthAvg;},0)/playerStats.length;
  const teamGrade=scoreToGrade(teamAvg);
  const tgc=teamGrade?teamGrade.cls:'grade-am',tgv=teamGrade?teamGrade.grade:'--';
  function sAvatar(p,size){const pfp=data.pfp&&data.pfp[p.id];size=size||32;if(pfp)return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid var(--grey-3);"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>';return '<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:'+Math.floor(size*0.42)+'px;color:var(--grey-6);">'+p.nick[0]+'</div>';}
  const bars=playerStats.map(function(x){const g=scoreToGrade(x.monthAvg);const bc=g&&g.cls==='grade-sp'?'#fff':g&&g.cls==='grade-s'?'#e8e8e8':g&&g.cls==='grade-sm'?'#c8c8c8':g&&g.cls==='grade-ap'?'#aaa':g&&g.cls==='grade-a'?'#888':'#555';return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+sAvatar(x.p,24)+'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);width:44px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+x.p.nick+'</div><div style="flex:1;height:3px;background:var(--grey-3);border-radius:2px;"><div style="height:100%;width:'+x.monthAvg*10+'%;background:'+bc+';border-radius:2px;"></div></div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);width:24px;text-align:right;">'+x.monthAvg.toFixed(1)+'</div></div>';}).join('');
  const bgc=scoreToGrade(best.monthAvg)?.cls||'grade-am',bgv=scoreToGrade(best.monthAvg)?.grade||'--';
  const wgc=scoreToGrade(worst.monthAvg)?.cls||'grade-am',wgv=scoreToGrade(worst.monthAvg)?.grade||'--';
  const bwHtml=bestWeek?'<div style="margin:0 20px 16px;background:var(--grey-1);border:var(--border);padding:12px 16px;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--warn);margin-bottom:10px;">BEST OF THE WEEK</div><div style="display:flex;align-items:center;gap:12px;cursor:pointer;" onclick="showProfile(\''+bestWeek.p.id+'\')">'+sAvatar(bestWeek.p,44)+'<div style="flex:1;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;">'+bestWeek.p.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+bestWeek.p.role+'</div></div><div><div class="grade '+(scoreToGrade(bestWeek.weekAvg)?.cls||'grade-am')+'" style="font-size:24px;">'+(scoreToGrade(bestWeek.weekAvg)?.grade||'--')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);text-align:right;">'+bestWeek.weekAvg.toFixed(1)+'/10</div></div></div></div>':'';
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
  if(id==='page-settings'&&App.cache.settingsPin&&!App.cache._pinUnlocked){
    document.getElementById('pin-entry-inp').value='';
    document.getElementById('pin-entry-err').style.display='none';
    document.getElementById('pin-entry-modal').classList.add('open');
    return;
  }
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  const pg=document.getElementById(id);if(pg) pg.classList.add('active');
  // Clear all nav active states
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  // Highlight mobile tab
  const mobileMap={'page-home':'nav-home','page-roster':'nav-roster','page-heroes':'nav-heroes'};
  const drawerMap={'page-log':'drawer-log','page-history':'drawer-history','page-tiers':'drawer-tiers','page-settings':'drawer-settings','page-benchmarks':'drawer-benchmarks'};
  if(mobileMap[id]) document.getElementById(mobileMap[id])?.classList.add('active');
  else if(drawerMap[id]||id==='page-match') document.getElementById('nav-more-btn')?.classList.add('active');
  // Highlight desktop sidebar
  const desktopMap={'page-home':'nav-home-d','page-log':'nav-log','page-roster':'nav-roster-d','page-history':'nav-history','page-tiers':'nav-tiers','page-heroes':'nav-heroes-d','page-benchmarks':'nav-benchmarks-d'};
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

function dismissAlert(key){App.cache.dismissed[key]=true;localStorage.setItem('ps_dismissed',JSON.stringify(App.cache.dismissed));const el=document.getElementById('alert-'+key);if(el)el.remove();}

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
function closeModal(id){document.getElementById(id).classList.remove('open');}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2200);}


// ══════════════════════════════════════════
// ROSTER
// ══════════════════════════════════════════
// ROSTER
// ══════════════════════════════════════════
function renderRoster(){
  App.players=getPlayers();const data=loadData();
  const sub=document.getElementById('roster-subtitle');
  if(sub)sub.textContent=App.players.filter(function(p){return p.status!=='Inactive';}).length+' active · '+App.players.filter(function(p){return p.status==='Inactive';}).length+' inactive';
  function pAvatar(p,size,fs){const pfp=data.pfp&&data.pfp[p.id];size=size||38;fs=fs||16;if(pfp)return '<div class="player-avatar" style="width:'+size+'px;height:'+size+'px;border-radius:50%;overflow:hidden;flex-shrink:0;border:1px solid var(--grey-3);"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>';return '<div class="player-avatar" style="width:'+size+'px;height:'+size+'px;font-size:'+fs+'px;">'+p.nick[0]+'</div>';}
  function makeRow(p,inactive){const st=getPlayerStats(p.id,data.games);const g=st.monthAvg>0?scoreToGrade(st.monthAvg):null;const hp=calcHeroPoolScore(p.id);return '<div class="player-row'+(inactive?' roster-section-inactive':'')+'" style="'+(inactive?'opacity:0.5;':'')+'" onclick="showProfile(\''+p.id+'\')">'+pAvatar(p)+'<div class="player-info"><div class="player-ign">'+p.ign+'</div><div class="player-nick">'+p.nick+' · <span style="color:var(--grey-4);">'+p.role+'</span></div></div><div style="display:flex;align-items:center;gap:10px;"><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;"><span class="grade '+(g?g.cls:'grade-am')+'" style="font-size:16px;">'+(g?g.grade:'--')+'</span><span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">HP '+hp.pct+'%</span></div><button class="btn btn-sm btn-muted" style="flex-shrink:0;" onclick="event.stopPropagation();openPlayerEdit(\''+p.id+'\')"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:12px;height:12px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button></div></div>';}
  const starters=App.players.filter(function(p){return p.status==='Starter';});
  const subs=App.players.filter(function(p){return p.status==='Substitute';});
  const inactive=App.players.filter(function(p){return p.status==='Inactive';});
  document.getElementById('roster-list').innerHTML=
    '<div class="section-label">Starters</div>'+starters.map(function(p){return makeRow(p);}).join('')+
    '<div class="section-label" style="margin-top:8px;">Substitutes</div>'+(subs.length?subs.map(function(p){return makeRow(p);}).join(''):'<div style="padding:12px 20px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-4);">No substitutes</div>')+
    (inactive.length?'<div class="section-label" style="margin-top:8px;">Inactive</div>'+inactive.map(function(p){return makeRow(p,true);}).join(''):'')+
    '<div style="padding:16px 20px;border-top:var(--border);margin-top:4px;display:flex;gap:10px;">'+
      '<button class="btn btn-full" onclick="showPage(\'page-compare\')"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>Compare</button>'+
      '<button class="btn btn-full btn-muted" onclick="openPlayerEdit(null)"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>Add Player</button>'+
    '</div>';
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════
var PTREND_COLORS=['rgba(100,180,255,1)','rgba(80,220,140,1)','rgba(255,180,80,1)','rgba(200,130,255,1)','rgba(240,210,90,1)','rgba(90,210,220,1)','rgba(235,235,235,1)'];
function _profilePlayerGames(playerId){
  const data=loadData();
  return (data.games||[]).filter(function(g){const s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped;});
}
function _profileRoleOf(g,playerId,player){
  const s=g.playerScores&&g.playerScores[playerId];
  return ((s&&s.role)||(player&&player.role)||'').toLowerCase();
}
function _profileRoleInfo(playerId){
  const player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  const desig=(player&&player.role||'').toLowerCase();
  const games=_profilePlayerGames(playerId).slice().sort(function(a,b){return parseDate(a.date)-parseDate(b.date);});
  const played=[];
  games.forEach(function(g){const r=_profileRoleOf(g,playerId,player);if(r&&played.indexOf(r)<0)played.push(r);});
  const roles=[];
  if(desig)roles.push(desig);
  played.forEach(function(r){if(roles.indexOf(r)<0)roles.push(r);});
  if(!roles.length)roles.push('');
  return {roles:roles, def: desig||roles[0]||''};
}
function _profileMentalityForGame(g,playerId){
  let mo=null;
  if(g.matchMentality&&g.matchMentality[playerId])mo=g.matchMentality[playerId];
  else if(g.matchId){const m=(App.cache.matches||[]).find(function(x){return x.id===g.matchId;});if(m&&m.mentality&&m.mentality[playerId])mo=m.mentality[playerId];}
  return mo?calcMentality(null,mo):null;
}
// Role-aware 6-axis radar: 4 role pillars + Mentality + Hero Pool
function _profileRadarAxes(playerId,role){
  const player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  const games=_profilePlayerGames(playerId).filter(function(g){return _profileRoleOf(g,playerId,player)===role;});
  const pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  function avgKey(k){const v=games.map(function(g){const ps=g.playerScores[playerId].pillar_scores;return ps?ps[k]:null;}).filter(function(x){return x!=null&&x>0;});return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:0;}
  const mv=games.map(function(g){return _profileMentalityForGame(g,playerId);}).filter(function(x){return x!=null&&x>0;});
  const ment=mv.length?mv.reduce(function(a,b){return a+b;},0)/mv.length:0;
  const hp=calcHeroPoolScore(playerId);const hpv=Math.min((hp&&hp.pct||0)/10,10);
  return {labels:pl.concat(['Mentality','Hero Pool']),
          values:[avgKey('p0'),avgKey('p1'),avgKey('p2'),avgKey('p3'),ment,hpv]};
}
function _starterAvgRadar(role){
  const starters=(getPlayers()||[]).filter(function(p){return p.status==='Starter';});
  if(!starters.length)return null;
  const sums=[0,0,0,0,0,0],cnt=[0,0,0,0,0,0];
  starters.forEach(function(p){
    const ax=_profileRadarAxes(p.id,role);
    ax.values.forEach(function(v,i){if(v>0){sums[i]+=v;cnt[i]++;}});
  });
  return sums.map(function(s,i){return cnt[i]?s/cnt[i]:0;});
}
function setProfileRole(playerId,role){App.ui.profileRole=role;showProfile(playerId);}
// Pillar trend timeframe + series-toggle state
function _ptrendDefault(){return {preset:'all',from:'',to:'',series:{p0:1,p1:1,p2:1,p3:1,ment:1,hp:1,overall:1}};}
function _ptrendState(){if(!App.ui.ptrend)App.ui.ptrend=_ptrendDefault();return App.ui.ptrend;}
function _ptrendIso(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function _ptrendRange(){
  const st=_ptrendState();
  return {from:st.from?new Date(st.from+'T00:00:00'):null,to:st.to?new Date(st.to+'T23:59:59'):null};
}
function setPtrendPreset(pid,preset){
  const st=_ptrendState();st.preset=preset;
  if(preset==='all'){st.from='';st.to='';}
  else{const days=preset==='1w'?7:preset==='2w'?14:30;const now=new Date();st.from=_ptrendIso(new Date(now.getTime()-days*864e5));st.to=_ptrendIso(now);}
  renderPtrend(pid);
}
function setPtrendCustom(pid){
  const st=_ptrendState();
  const fe=document.getElementById('ptrend-from-'+pid),te=document.getElementById('ptrend-to-'+pid);
  st.from=fe?fe.value:'';st.to=te?te.value:'';st.preset='custom';
  renderPtrend(pid);
}
function togglePtrendSeries(pid,key){const st=_ptrendState();st.series[key]=st.series[key]?0:1;renderPtrend(pid);}
function setPtrendAllSeries(pid,on){const st=_ptrendState();Object.keys(st.series).forEach(function(k){st.series[k]=on?1:0;});renderPtrend(pid);}
function showProfile(playerId){
  App.players=getPlayers();const player=App.players.find(function(p){return p.id===playerId;});const data=loadData();
  if(!player){showPage('page-roster');return;}
  const stats=getPlayerStats(playerId,data.games);const pfp=data.pfp&&data.pfp[playerId]||null;
  const hp=calcHeroPoolScore(playerId);
  const monthGrade=stats.monthAvg>0?scoreToGrade(stats.monthAvg):null;
  const weekGrade=stats.weekAvg>0?scoreToGrade(stats.weekAvg):null;
  const hpGrade=hp.pct>0?scoreToGrade(hp.pct/10):null;
  const sBg=player.status==='Starter'?'rgba(68,255,136,0.1)':'var(--grey-3)';
  const sTxt=player.status==='Starter'?'var(--success)':'var(--grey-5)';
  const sBorder=player.status==='Starter'?'rgba(68,255,136,0.3)':'var(--grey-3)';
  const photoHtml=pfp?'<div class="profile-photo"><img src="'+pfp+'" alt="'+player.nick+'"/></div>':'<div class="profile-photo">'+player.nick[0]+'</div>';

  // ── Role selection: default to the player's designated role; toggle covers all roles played ──
  if(App.ui.profilePid!==playerId){App.ui.profilePid=playerId;App.ui.profileRole=null;App.ui.ptrend=null;}
  const roleInfo=_profileRoleInfo(playerId);
  const selRole=(App.ui.profileRole&&roleInfo.roles.indexOf(App.ui.profileRole)>=0)?App.ui.profileRole:roleInfo.def;
  App.ui.profileRole=selRole;
  const allGames=_profilePlayerGames(playerId);

  // ── Role-aware 6-axis radar (4 role pillars + Mentality + Hero Pool) + starter avg overlay ──
  const radarAxes=_profileRadarAxes(playerId,selRole);
  const radarData=radarAxes.labels.map(function(lbl,idx){return {label:lbl,value:radarAxes.values[idx]};});
  const pLabels=PILLAR_MAP[selRole]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  const starterAvg=_starterAvgRadar(selRole);

  // ── Task 3: raw stats across ALL logged games ──
  const rs={k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0};
  allGames.forEach(function(g){const s=g.playerScores[playerId];
    rs.k+=s.kills||0;rs.d+=s.deaths||0;rs.a+=s.assists||0;
    if(s.gold_per_min!=null){rs.gpmS+=s.gold_per_min;rs.gpmN++;}
    if(s.in_game_rating!=null){rs.rS+=s.in_game_rating;rs.rN++;}
    if(s.dmg_dealt_pct!=null){rs.ddS+=s.dmg_dealt_pct;rs.ddN++;}
    if(s.dmg_taken_pct!=null){rs.dtS+=s.dmg_taken_pct;rs.dtN++;}
  });
  const rawKDA=allGames.length?((rs.k+rs.a)/Math.max(rs.d,1)):null;
  function rsCell(label,val){return '<div style="background:var(--black);padding:12px 8px;text-align:center;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;">'+(val!=null?val:'—')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:0.5px;margin-top:2px;">'+label+'</div></div>';}
  const rawStatsHtml=allGames.length?
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:1px;background:var(--grey-3);border:var(--border);margin:0 20px 8px;">'+
      rsCell('KDA',rawKDA!=null?rawKDA.toFixed(2):null)+
      rsCell('GOLD / MIN',rs.gpmN?Math.round(rs.gpmS/rs.gpmN):null)+
      rsCell('AVG RATING',rs.rN?(rs.rS/rs.rN).toFixed(1):null)+
      rsCell('DMG DEALT %',rs.ddN?(rs.ddS/rs.ddN).toFixed(1)+'%':null)+
      rsCell('DMG TAKEN %',rs.dtN?(rs.dtS/rs.dtN).toFixed(1)+'%':null)+
    '</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);padding:0 20px 4px;letter-spacing:1px;">INFORMATIONAL · NOT SCORED · '+allGames.length+' GAME'+(allGames.length!==1?'S':'')+'</div>'
    :'<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">No games logged yet</div></div>';

  // ── Task 4: hero stats across ALL logged games ──
  const hMap={};
  allGames.forEach(function(g){const s=g.playerScores[playerId];if(!s.hero)return;
    const h=hMap[s.hero]||(hMap[s.hero]={hero:s.hero,games:0,wins:0,k:0,d:0,a:0,rS:0,rN:0});
    h.games++;if(g.result==='Win')h.wins++;
    h.k+=s.kills||0;h.d+=s.deaths||0;h.a+=s.assists||0;
    if(s.in_game_rating!=null){h.rS+=s.in_game_rating;h.rN++;}
  });
  const heroList=Object.keys(hMap).map(function(k){return hMap[k];}).sort(function(a,b){return b.games-a.games;});
  const heroStatsHtml=heroList.length?heroList.map(function(h){
    const wr=Math.round(h.wins/h.games*100);
    const wrCol=wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)';
    const hkda=((h.k+h.a)/Math.max(h.d,1)).toFixed(2);
    const hr=h.rN?(h.rS/h.rN).toFixed(1):'--';
    return '<div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:var(--border);">'+
      heroPortraitHtml(h.hero,40,false)+
      '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">'+h.hero+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+h.games+' game'+(h.games!==1?'s':'')+'</div></div>'+
      '<div style="text-align:center;min-width:46px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;color:'+wrCol+';">'+wr+'%</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">WR</div></div>'+
      '<div style="text-align:center;min-width:42px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;">'+hr+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">RATING</div></div>'+
      '<div style="text-align:center;min-width:46px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;">'+hkda+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">KDA</div></div>'+
    '</div>';
  }).join(''):'<div class="empty"><div class="empty-icon">⭐</div><div class="empty-text">No heroes played yet</div></div>';

  const roleToggleHtml=roleInfo.roles.length>1?
    '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:0 20px 12px;">'+
      roleInfo.roles.map(function(r){
        const lbl=r.charAt(0).toUpperCase()+r.slice(1);
        return '<button class="tier-mode-btn'+(r===selRole?' active':'')+'" onclick="setProfileRole(\''+playerId+'\',\''+r+'\')">'+lbl+'</button>';
      }).join('')+
    '</div>':'';
  const roleLabel=selRole?selRole.charAt(0).toUpperCase()+selRole.slice(1):'—';
  const radarLegend='<div style="display:flex;gap:16px;justify-content:center;padding:6px 20px 8px;">'+
    '<div style="display:flex;align-items:center;gap:6px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);"><div style="width:20px;height:2px;background:rgba(100,180,255,0.9);border-radius:1px;"></div>'+player.nick+'</div>'+
    '<div style="display:flex;align-items:center;gap:6px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);"><div style="width:20px;height:2px;background:rgba(80,220,140,0.7);border-radius:1px;"></div>Starter Avg</div>'+
  '</div>';

  document.getElementById('profile-content').innerHTML=
    '<button class="back-btn" onclick="showPage(\'page-roster\')">&#x2190; Back to Roster</button>'+
    '<div class="profile-hero">'+photoHtml+
      '<div class="profile-info-col"><div>'+
        '<div class="profile-name">'+player.nick+'</div>'+
        '<div class="profile-ign">'+player.ign+'</div>'+
        '<div class="profile-meta"><span class="tag tag-role">'+player.role+'</span><span class="tag" style="background:'+sBg+';color:'+sTxt+';border:1px solid '+sBorder+';">'+player.status+'</span></div>'+
      '</div><div class="profile-side-stats">'+
        '<div class="profile-side-stat"><span class="profile-side-stat-label">Ability</span><span class="profile-side-stat-val '+(monthGrade?monthGrade.cls:'grade-am')+'">'+(monthGrade?monthGrade.grade:'--')+'</span></div>'+
        '<div class="profile-side-stat"><span class="profile-side-stat-label">Form</span><span class="profile-side-stat-val '+(weekGrade?weekGrade.cls:'grade-am')+'">'+(weekGrade?weekGrade.grade:'--')+'</span></div>'+
        '<div class="profile-side-stat" style="cursor:pointer;" onclick="showPage(\'page-tiers\');setTimeout(function(){setTierMode(\'mastery\');setMasteryPlayer(\''+playerId+'\');},200);"><span class="profile-side-stat-label">Hero Pool</span><span class="profile-side-stat-val '+(hpGrade?hpGrade.cls:'grade-am')+'">'+(hpGrade?hpGrade.grade:'--')+' <span style="font-size:11px;opacity:0.6;">'+hp.pct+'%</span></span></div>'+
      '</div></div>'+
      '<button class="btn btn-sm btn-muted" style="align-self:flex-start;flex-shrink:0;" onclick="openPlayerEdit(\''+playerId+'\')"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:12px;height:12px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>Edit</button>'+
    '</div>'+
    '<div class="section-label">Pillar Radar <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· '+roleLabel.toUpperCase()+' · AVG OF ALL GAMES</span></div>'+
    roleToggleHtml+
    '<div class="radar-wrap"><canvas id="radar-'+playerId+'" width="440" height="440" style="width:100%;max-width:440px;"></canvas></div>'+
    radarLegend+
    '<div class="section-label">Pillar Trend <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· '+roleLabel.toUpperCase()+' · SCORE OVER TIME</span></div>'+
    '<div id="ptrend-block-'+playerId+'"></div>'+
    '<div class="section-label">Raw Stats <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· ALL GAMES</span></div>'+
    rawStatsHtml+
    '<div style="height:12px;"></div>'+
    '<div class="section-label">Hero Stats <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· ALL GAMES</span></div>'+
    heroStatsHtml+
    '<div style="height:24px;"></div>';
  showPage('page-profile');
  App.ui.currentProfileId=playerId;
  setTimeout(function(){
    drawRadar(playerId,radarData,{overlayData:starterAvg,colour1:'rgba(100,180,255,1)',colour2:'rgba(80,220,140,1)',showLabels:true,showGrades:true});
    renderPtrend(playerId);
  },60);
}
// ── Pillar trend: timeframe + per-series checkboxes ──
function renderPtrend(playerId){
  const box=document.getElementById('ptrend-block-'+playerId);if(!box)return;
  const role=App.ui.profileRole;
  const pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  const st=_ptrendState();
  const defs=[{k:'p0',l:pl[0]},{k:'p1',l:pl[1]},{k:'p2',l:pl[2]},{k:'p3',l:pl[3]},{k:'ment',l:'Mentality'},{k:'hp',l:'Hero Pool'},{k:'overall',l:'Overall'}];
  const presets=[['all','All'],['1w','1W'],['2w','2W'],['1m','1M']];
  const inpStyle='background:var(--grey-1);border:var(--border);color:var(--white);font-family:inherit;font-size:10px;padding:4px 6px;border-radius:2px;';
  const html=''+
    '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:0 20px 8px;">'+
      presets.map(function(p){return '<button class="tier-mode-btn'+(st.preset===p[0]?' active':'')+'" onclick="setPtrendPreset(\''+playerId+'\',\''+p[0]+'\')">'+p[1]+'</button>';}).join('')+
    '</div>'+
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 20px 10px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">'+
      '<span>FROM</span><input type="date" id="ptrend-from-'+playerId+'" value="'+(st.from||'')+'" onchange="setPtrendCustom(\''+playerId+'\')" style="'+inpStyle+'"/>'+
      '<span>TO</span><input type="date" id="ptrend-to-'+playerId+'" value="'+(st.to||'')+'" onchange="setPtrendCustom(\''+playerId+'\')" style="'+inpStyle+'"/>'+
    '</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 8px;">'+
      '<button class="tier-mode-btn" onclick="setPtrendAllSeries(\''+playerId+'\',true)">Show all</button>'+
      '<button class="tier-mode-btn" onclick="setPtrendAllSeries(\''+playerId+'\',false)">Hide all</button>'+
    '</div>'+
    '<div style="display:flex;gap:8px 16px;flex-wrap:wrap;padding:0 20px 10px;">'+
      defs.map(function(s,i){return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);"><input type="checkbox" '+(st.series[s.k]?'checked':'')+' onchange="togglePtrendSeries(\''+playerId+'\',\''+s.k+'\')" style="accent-color:'+PTREND_COLORS[i]+';margin:0;"/><span style="display:inline-block;width:14px;height:2px;background:'+PTREND_COLORS[i]+';border-radius:1px;"></span>'+s.l+'</label>';}).join('')+
    '</div>'+
    '<div style="padding:0 20px 20px;"><canvas id="ptrend-'+playerId+'" style="width:100%;height:200px;display:block;"></canvas></div>';
  box.innerHTML=html;
  drawPillarTrend(playerId);
}
function drawPillarTrend(playerId){
  const canvas=document.getElementById('ptrend-'+playerId);if(!canvas)return;
  const role=App.ui.profileRole;
  const player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  const st=_ptrendState(),rg=_ptrendRange();
  const games=_profilePlayerGames(playerId).filter(function(g){
    if(_profileRoleOf(g,playerId,player)!==role)return false;
    const d=parseDate(g.date);
    if(rg.from&&d<rg.from)return false;
    if(rg.to&&d>rg.to)return false;
    return true;
  }).sort(function(a,b){return parseDate(a.date)-parseDate(b.date);});
  const dpr=window.devicePixelRatio||1;const dW=canvas.offsetWidth||canvas.width||600;const dH=canvas.offsetHeight||200;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.height=dH+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,dW,dH);
  const padL=26,padR=12,padT=12,padB=22;
  const plotW=dW-padL-padR,plotH=dH-padT-padB;
  function yPos(v){return padT+plotH-((Math.max(1,Math.min(v,10))-1)/9)*plotH;}
  function xPos(i){return games.length<=1?padL+plotW/2:padL+(i/(games.length-1))*plotW;}
  ctx.textBaseline='middle';ctx.font='9px DM Mono,monospace';
  [2,4,6,8,10].forEach(function(gv){const y=yPos(gv);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(dW-padR,y);ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='right';ctx.fillText(gv,padL-6,y);});
  if(!games.length){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.font='10px DM Mono,monospace';ctx.fillText('No games in range',dW/2,dH/2);return;}
  ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='8px DM Mono,monospace';ctx.textBaseline='top';
  ctx.textAlign='left';ctx.fillText(games[0].date,padL,dH-padB+5);
  if(games.length>1){ctx.textAlign='right';ctx.fillText(games[games.length-1].date,dW-padR,dH-padB+5);}
  function valFor(key,g){
    const s=g.playerScores[playerId];
    if(key==='ment')return _profileMentalityForGame(g,playerId);
    if(key==='hp')return null;
    if(key==='overall')return calcGameScore(s,role,g,playerId);
    const ps=s.pillar_scores;return ps?ps[key]:null;
  }
  ['p0','p1','p2','p3','ment','hp','overall'].forEach(function(key,si){
    if(!st.series[key])return;
    const pts=[];
    games.forEach(function(g,i){const v=valFor(key,g);if(v!=null&&v>0)pts.push({x:xPos(i),y:yPos(v)});});
    if(!pts.length)return;
    ctx.strokeStyle=PTREND_COLORS[si];ctx.lineWidth=key==='overall'?2.5:2;ctx.beginPath();
    pts.forEach(function(p,idx){idx===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.stroke();
    ctx.fillStyle=PTREND_COLORS[si];pts.forEach(function(p){ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();});
  });
}
// RADAR
// ══════════════════════════════════════════
function getStarterAvgRadar(games){App.players=getPlayers();const starters=App.players.filter(function(p){return p.status==='Starter';});if(!starters.length)return null;const sums=Array(6).fill(0),counts=Array(6).fill(0);starters.forEach(function(p){const rd=getRadarValues(p.id,games);const hp=calcHeroPoolScore(p.id);rd[5].value=Math.min(hp.pct/10,10);rd.forEach(function(d,i){if(d.value>0){sums[i]+=d.value;counts[i]++;}});});return sums.map(function(s,i){return counts[i]?s/counts[i]:0;});}
function drawRadar(canvasId,radarData,options){
  options=options||{};const overlayData=options.overlayData||null,colour1=options.colour1||'rgba(100,180,255,1)',colour2=options.colour2||'rgba(80,220,140,1)',showLabels=options.showLabels!==false,showGrades=options.showGrades!==false;
  const canvas=document.getElementById('radar-'+canvasId);if(!canvas)return;
  const dpr=window.devicePixelRatio||1;const dW=canvas.offsetWidth||canvas.width;const dH=canvas.offsetHeight||canvas.height;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.width=dW+'px';canvas.style.height=dH+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const W=dW,H=dH,cx=W/2,cy=H/2,R=Math.min(W,H)/2-52,n=radarData.length;
  ctx.clearRect(0,0,W,H);
  function ang(i){return(Math.PI*2*i/n)-Math.PI/2;}
  function pt(i,r){return{x:cx+r*Math.cos(ang(i)),y:cy+r*Math.sin(ang(i))};}
  [0.2,0.4,0.6,0.8,1].forEach(function(f){ctx.beginPath();for(let i=0;i<n;i++){const p=pt(i,R*f);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();ctx.strokeStyle=f===1?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.05)';ctx.lineWidth=1;ctx.stroke();});
  for(let i=0;i<n;i++){const p=pt(i,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p.x,p.y);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.stroke();}
  function drawPoly(values,fillCol,strokeCol,dotCol){const hasData=values.some(function(v){return v>0;});ctx.beginPath();values.forEach(function(v,i){const frac=hasData?Math.min(v/10,1):0.12;const p=pt(i,R*frac);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.closePath();ctx.fillStyle=fillCol;ctx.fill();ctx.strokeStyle=strokeCol;ctx.lineWidth=2;ctx.stroke();if(hasData)values.forEach(function(v,i){if(v<=0)return;const p=pt(i,R*Math.min(v/10,1));ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle=dotCol;ctx.fill();});}
  if(overlayData) drawPoly(overlayData,colour2.replace('1)','0.08)'),colour2.replace('1)','0.5)'),colour2.replace('1)','0.7)'));
  drawPoly(radarData.map(function(d){return d.value;}),colour1.replace('1)','0.12)'),colour1.replace('1)','0.9)'),colour1);
  if(showLabels){radarData.forEach(function(d,i){const lR=R+28;const p=pt(i,lR);const g=d.value>0?scoreToGrade(d.value):null;const short=d.label.replace('Survival & Positioning','Survival').replace('Protection & Peel','Protection').replace('Resource Efficiency','Resources').replace('Role Fulfillment','Role Fulfil.').replace('Lane Resilience','Lane Resil.');ctx.textAlign='center';ctx.font='500 10px DM Sans,sans-serif';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(short,p.x,p.y+3);if(showGrades&&g){const gc=g.cls==='grade-sp'?'rgba(255,255,255,0.95)':g.cls==='grade-s'?'rgba(232,232,232,0.9)':g.cls==='grade-sm'?'rgba(200,200,200,0.85)':g.cls==='grade-ap'?'rgba(170,170,170,0.8)':g.cls==='grade-a'?'rgba(136,136,136,0.8)':'rgba(100,100,100,0.7)';ctx.font='bold 11px "Bebas Neue",sans-serif';ctx.fillStyle=gc;ctx.fillText(g.grade,p.x,p.y+17);}});}
}

// ══════════════════════════════════════════
// PLAYER EDIT
// ══════════════════════════════════════════
function openPlayerEdit(playerId){App.players=getPlayers();const data=loadData();const isNew=!playerId;const player=isNew?null:App.players.find(function(p){return p.id===playerId;});const pfp=isNew?null:data.pfp&&data.pfp[playerId]||null;document.getElementById('player-edit-modal-title').textContent=isNew?'ADD PLAYER':'EDIT PLAYER';const prevHtml=pfp?'<div class="pfp-preview"><img id="pfp-preview-img" src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>':'<div class="pfp-preview" id="pfp-preview-fallback">'+(player?player.nick[0]:'?')+'</div>';document.getElementById('player-edit-modal-body').innerHTML='<div class="pfp-upload-wrap">'+prevHtml+'<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--grey-5);margin-bottom:8px;">PROFILE PHOTO</div><label class="btn btn-sm btn-muted" style="cursor:pointer;display:inline-flex;">Upload Photo<input type="file" accept="image/*" style="display:none;" onchange="handlePfpUpload(event)"/></label>'+(pfp?'<button class="btn btn-sm" style="margin-left:8px;color:var(--danger);border-color:var(--danger);" onclick="removePfp()">Remove</button>':'')+'<div style="font-size:10px;color:var(--grey-5);margin-top:6px;">Auto-compressed to 300x300</div></div></div><div class="row"><div class="input-group mb-0"><label class="input-label">Nick</label><input class="input" id="pe-nick" value="'+(player&&player.nick||'')+'" placeholder="e.g. Gun"/></div><div class="input-group mb-0"><label class="input-label">IGN</label><input class="input" id="pe-ign" value="'+(player&&player.ign||'')+'" placeholder="e.g. Sutthiphat"/></div></div><div class="row mt-16"><div class="input-group mb-0"><label class="input-label">Role</label><select class="input" id="pe-role">'+GAME_ROLES.map(function(r){return '<option value="'+r+'"'+(player&&player.role===r?' selected':'')+'>'+r+'</option>';}).join('')+'</select></div><div class="input-group mb-0"><label class="input-label">Status</label><select class="input" id="pe-status">'+['Starter','Substitute','Inactive'].map(function(s){return '<option value="'+s+'"'+(player&&player.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div></div><div style="display:flex;gap:10px;margin-top:20px;">'+(isNew?'':'<button class="btn btn-danger btn-sm" onclick="showInlineDeletePlayer(\''+playerId+'\')">Delete</button>')+'<button class="btn btn-primary" style="flex:1;" onclick="savePlayerEdit(\''+(playerId||'')+'\','+isNew+')">'+(isNew?'Add Player':'Save Changes')+'</button></div>'+(isNew?'':'<div class="inline-confirm" id="inline-del-player-'+playerId+'"><div class="inline-confirm-text">Remove this player?</div><div class="inline-confirm-btns"><button class="btn btn-sm btn-muted" onclick="document.getElementById(\'inline-del-player-'+playerId+'\').classList.remove(\'open\')">Cancel</button><button class="btn btn-sm btn-danger" onclick="deletePlayer(\''+playerId+'\')">Yes, Remove</button></div></div>');App.ui.pendingPfp=null;App.ui.removePfp=false;document.getElementById('player-edit-modal').classList.add('open');}
function showInlineDeletePlayer(id){document.getElementById('inline-del-player-'+id)?.classList.add('open');}
function handlePfpUpload(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){const img=new Image();img.onload=function(){const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;const ctx=canvas.getContext('2d');const scale=Math.max(300/img.width,300/img.height);const sw=300/scale,sh=300/scale;const sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.drawImage(img,sx,sy,sw,sh,0,0,300,300);const compressed=canvas.toDataURL('image/jpeg',0.82);App.ui.pendingPfp=compressed;App.ui.removePfp=false;const prev=document.getElementById('pfp-preview-img');const fallback=document.getElementById('pfp-preview-fallback');if(prev){prev.src=compressed;}else if(fallback){fallback.style.fontSize='0';fallback.innerHTML='<img id="pfp-preview-img" src="'+compressed+'" style="width:100%;height:100%;object-fit:cover;"/>';}};img.src=e.target.result;};reader.readAsDataURL(file);}
function removePfp(){App.ui.pendingPfp=null;App.ui.removePfp=true;const prev=document.getElementById('pfp-preview-img');const wrap=document.querySelector('.pfp-preview');if(prev)prev.remove();if(wrap){wrap.textContent='?';wrap.style.fontSize='26px';}}
async function savePlayerEdit(playerId,isNew){
  const nick=document.getElementById('pe-nick').value.trim();
  const ign=document.getElementById('pe-ign').value.trim();
  const role=document.getElementById('pe-role').value;
  const status=document.getElementById('pe-status').value;
  if(!nick||!ign){showToast('Name fields required');return;}
  App.players=getPlayers();
  if(isNew){
    const newId='p_'+Date.now();
    const newP={id:newId,ign:ign,nick:nick,role:role,status:status};
    App.players.push(newP);
    if(App.ui.pendingPfp){App.cache.pfp[newId]=App.ui.pendingPfp;await sbSaveSetting('pfp',App.cache.pfp);}
    await sbSavePlayer(newP);
  }else{
    const idx=App.players.findIndex(function(p){return p.id===playerId;});
    if(idx>-1) App.players[idx]=Object.assign({},App.players[idx],{ign,nick,role,status});
    if(App.ui.pendingPfp){App.cache.pfp[playerId]=App.ui.pendingPfp;await sbSaveSetting('pfp',App.cache.pfp);}
    if(App.ui.removePfp){delete App.cache.pfp[playerId];await sbSaveSetting('pfp',App.cache.pfp);}
    await sbSavePlayer(App.players[idx]);
  }
  savePlayers(App.players);
  App.ui.pendingPfp=null;App.ui.removePfp=false;
  closeModal('player-edit-modal');showToast(isNew?'Player added':'Player updated');renderRoster();
}
async function deletePlayer(playerId){
  await sbDeletePlayer(playerId);
  const updated=getPlayers().filter(function(p){return p.id!==playerId;});
  savePlayers(updated);App.players=updated;
  closeModal('player-edit-modal');showToast('Player removed');showPage('page-roster');
}
