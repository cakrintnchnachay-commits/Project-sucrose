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

  // ── Form-drop alerts ──
  var dismissed=_cache.dismissed||{};
  var alertsHtml='';
  PLAYERS.forEach(function(p){
    var st=getPlayerStats(p.id,games);
    if(st.monthAvg>0&&st.weekAvg>0&&st.monthAvg-st.weekAvg>1.5){
      var key='underperf_'+p.id;
      if(!dismissed[key]) alertsHtml+='<div class="alert-banner alert-banner-danger" id="alert-'+key+'"><div style="flex:1;cursor:pointer;" onclick="showProfile(\''+p.id+'\')"><strong>'+p.nick+'</strong> — form drop detected. Week avg '+st.weekAvg.toFixed(1)+' vs month avg '+st.monthAvg.toFixed(1)+'</div><button class="alert-banner-dismiss" onclick="dismissAlert(\''+key+'\')">&#x2715;</button></div>';
    }
  });
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
    var sorted=recent30.slice().sort(function(a,b){return parseDate(a.date)-parseDate(b.date);});
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

  var orderedDesc=games.slice().sort(function(a,b){return parseDate(b.date)-parseDate(a.date);});
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
    var vals=games.slice().sort(function(a,b){return parseDate(b.date)-parseDate(a.date);})
      .map(function(g){var s=g.playerScores&&g.playerScores[pid];if(!s||s.skipped)return null;var v=s.in_game_rating!=null?+s.in_game_rating:(s.gameRating!=null?+s.gameRating:null);return v;})
      .filter(function(v){return v!=null&&!isNaN(v);}).slice(0,5);
    return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:null;
  }
  // avg coach (pillar) score from last 5 games; also returns the 5 scores for chart
  function coachScoresLast5(pid){
    var pl=PLAYERS.find(function(p){return p.id===pid;});
    var role=pl?pl.role:'';
    var vals=games.slice().sort(function(a,b){return parseDate(b.date)-parseDate(a.date);})
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

  var alertsPlaceholder=''+
    '<section class="hd-card hd-alerts">'+
      '<div class="hd-alerts-head"><div class="hd-label">Form alerts</div><span class="hd-coming">COMING SOON</span></div>'+
      '<div class="hd-placeholder-inner">'+
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0-7.036A9.001 9.001 0 003 12c0 4.97 4.03 9 9 9s9-4.03 9-9-4.03-9-9-9zM12 15.75h.008v.008H12v-.008z"/></svg>'+
        '<div class="ph-title">FLAGGING SYSTEM</div>'+
        '<div class="ph-sub">Hot/cold streaks, hero tier shifts<br/>and pool-thinness alerts will surface here.</div>'+
      '</div>'+
    '</section>';

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

function renderRoster(){
  PLAYERS=getPlayers();var data=loadData();
  var sub=document.getElementById('roster-subtitle');
  var activeCount=PLAYERS.filter(function(p){return p.status!=='Inactive';}).length;
  var inactiveCount=PLAYERS.filter(function(p){return p.status==='Inactive';}).length;
  if(sub)sub.textContent=activeCount+' active · '+inactiveCount+' inactive';

  var starters=PLAYERS.filter(function(p){return p.status==='Starter';});
  var subs=PLAYERS.filter(function(p){return p.status==='Substitute';});
  var inactive=PLAYERS.filter(function(p){return p.status==='Inactive';});

  var mode=_rosterMode||'cards';

  // ── Mode toggle bar ──
  var modeBar='<div class="roster-mode-bar">'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:3px;color:var(--grey-5);">VIEW MODE</div>'+
    '<div class="roster-mode-btns">'+
      '<button class="roster-mode-btn'+(mode==='cards'?' active':'')+'" onclick="setRosterMode(\'cards\')">Cards</button>'+
      '<button class="roster-mode-btn'+(mode==='list'?' active':'')+'" onclick="setRosterMode(\'list\')">List</button>'+
      '<button class="roster-mode-btn'+(mode==='compare'?' active':'')+'" onclick="setRosterMode(\'compare\')">Compare</button>'+
    '</div>'+
    '<button class="btn btn-sm btn-muted" style="font-size:9px;padding:7px 12px;" onclick="openPlayerEdit(null)">+ Add Player</button>'+
  '</div>';

  // ── Shared helpers ──
  function getMonthStats(pid){
    var now=new Date(),cutoff=new Date(now-30*24*60*60*1000);
    var pl=PLAYERS.find(function(p){return p.id===pid;});
    var role=pl?pl.role:'';
    var mGames=(data.games||[]).filter(function(g){
      var s=g.playerScores&&g.playerScores[pid];
      return s&&!s.skipped&&parseDate(g.date)>=cutoff;
    });
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
    var coachVals=mGames.slice().sort(function(a,b){return parseDate(b.date)-parseDate(a.date);})
      .map(function(g){var s=g.playerScores[pid];if(!s||s.skipped)return null;var v=calcGameScore(s,role,g,pid);return v>0?v:null;})
      .filter(function(v){return v!=null;});
    var coachAvg=coachVals.length?coachVals.reduce(function(a,b){return a+b;},0)/coachVals.length:null;
    var allGames=(data.games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});
    var chartVals=allGames.slice().sort(function(a,b){return parseDate(b.date)-parseDate(a.date);})
      .map(function(g){var s=g.playerScores[pid];if(!s||s.skipped)return null;var v=calcGameScore(s,role,g,pid);return v>0?v:null;})
      .filter(function(v){return v!=null;}).slice(0,5).reverse();
    return {kda:kda,gpm:gpm,igr:igr,kp:kp,coachAvg:coachAvg,chartVals:chartVals};
  }

  function getTop3Heroes(pid){
    var hMap={};
    (data.games||[]).forEach(function(g){
      var s=g.playerScores&&g.playerScores[pid];
      if(!s||s.skipped||!s.hero)return;
      hMap[s.hero]=(hMap[s.hero]||0)+1;
    });
    return Object.keys(hMap).sort(function(a,b){return hMap[b]-hMap[a];}).slice(0,3);
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
    function starterCard(p,rank){
      var st=getMonthStats(p.id);
      var heroes=getTop3Heroes(p.id);
      var roleCol=ROLE_COL[p.role]||'var(--grey-6)';
      var igrGrade=st.igr!=null?scoreToGrade(st.igr):null;
      var coachGrade=st.coachAvg!=null?scoreToGrade(st.coachAvg):null;
      var heroRow=heroes.length?('<div class="rst-heroes">'+heroes.map(function(h){return heroThumb(h,26,'rst-hero-thumb');}).join('')+'</div>'):'';
      var chartRow=st.chartVals.length?('<div class="rst-chart">'+rBarChart(st.chartVals)+'</div>'):'';
      return '<article class="roster-starter-card" onclick="showProfile(\''+p.id+'\')">'+
        '<div class="rst-role-bar">'+
          '<span class="rst-role-label" style="color:'+roleCol+';">'+p.role+'</span>'+
          '<span class="rst-rank">'+String(rank).padStart(2,'0')+'</span>'+
        '</div>'+
        '<div class="rst-portrait">'+
          pfpImg(p,null)+
          '<div class="rst-grad"></div>'+
          '<div class="rst-sid"></div>'+
          '<div class="rst-name-block">'+
            '<div class="rst-nick">'+p.nick.toUpperCase()+'</div>'+
            '<div class="rst-ign">'+p.ign+'</div>'+
          '</div>'+
        '</div>'+
        heroRow+
        '<div class="rst-stats">'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.kda!=null?st.kda.toFixed(2):'—')+'</div><div class="rst-stat-lbl">KDA</div></div>'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.gpm!=null?Math.round(st.gpm):'—')+'</div><div class="rst-stat-lbl">GPM</div></div>'+
          '<div class="rst-stat"><div class="rst-stat-val">'+(st.kp!=null?Math.round(st.kp)+'%':'—')+'</div><div class="rst-stat-lbl">KP%</div></div>'+
        '</div>'+
        '<div class="rst-footer">'+
          '<div class="rst-footer-half">'+
            '<div class="rst-footer-val">'+(st.igr!=null?st.igr.toFixed(1):'—')+'</div>'+
            '<div class="rst-footer-lbl">IGR · 1M</div>'+
            (igrGrade?'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);letter-spacing:1px;">'+igrGrade.grade+'</div>':'')+
          '</div>'+
          '<div class="rst-footer-half">'+
            '<div class="rst-footer-val">'+(st.coachAvg!=null?st.coachAvg.toFixed(1):'—')+'</div>'+
            '<div class="rst-footer-lbl">Coach · 1M</div>'+
            (coachGrade?'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);letter-spacing:1px;">'+coachGrade.grade+'</div>':'')+
          '</div>'+
        '</div>'+
        chartRow+
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
      var chartRow=st.chartVals.length?('<div style="padding:4px 12px 7px;border-top:var(--border);">'+rBarChart(st.chartVals)+'</div>'):'';
      return '<article class="roster-sub-card" onclick="showProfile(\''+p.id+'\')">'+
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
            (heroes.length?'<div class="rst-sub-heroes">'+heroes.map(function(h){return heroThumb(h,18,'rst-sub-thumb');}).join('')+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0;">'+
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;color:var(--grey-5);line-height:1;">'+(st.igr!=null?st.igr.toFixed(1):'—')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1.5px;">IGR · 1M</div>'+
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;color:var(--grey-4);line-height:1;margin-top:4px;">'+(st.coachAvg!=null?st.coachAvg.toFixed(1):'—')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:1.5px;">Coach</div>'+
          '</div>'+
        '</div>'+
        chartRow+
      '</article>';
    }

    var startersHtml=starters.length?starters.map(function(p,i){return starterCard(p,i+1);}).join(''):
      '<div style="padding:20px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No starters yet</div>';
    var subsSection=subs.length?
      '<div class="roster-subs-rail">'+
        '<div class="rst-rail-head">'+
          '<span class="rst-rail-title">Substitutes</span>'+
          '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);">'+subs.length+' active</span>'+
        '</div>'+
        subs.map(subCard).join('')+
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
    return '<div>'+
      '<div class="rst-cmp-selectors">'+
        '<div class="input-group mb-0"><label class="input-label">Player A</label>'+
          '<select class="input" id="rst-cmp-a" onchange="window._rosterCmpA=this.value;renderRosterCompare()">'+opts+'</select></div>'+
        '<div class="input-group mb-0"><label class="input-label">Player B</label>'+
          '<select class="input" id="rst-cmp-b" onchange="window._rosterCmpB=this.value;renderRosterCompare()">'+opts+'</select></div>'+
      '</div>'+
      '<div id="rst-cmp-content"></div>'+
    '</div>';
  }

  var content;
  if(mode==='list') content=renderList();
  else if(mode==='compare') content=renderCompareView();
  else content=renderCards();

  document.getElementById('roster-list').innerHTML=modeBar+content;

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

function renderRosterCompare(){
  var cc=document.getElementById('rst-cmp-content');
  if(!cc)return;
  PLAYERS=getPlayers();var data=loadData();
  var aId=window._rosterCmpA,bId=window._rosterCmpB;
  if(!aId||!bId){cc.innerHTML='<div class="empty"><div class="empty-icon">⚖️</div><div class="empty-text">Select two players</div></div>';return;}
  var pA=PLAYERS.find(function(p){return p.id===aId;}),pB=PLAYERS.find(function(p){return p.id===bId;});
  if(!pA||!pB){cc.innerHTML='<div class="empty"><div class="empty-icon">⚖️</div><div class="empty-text">Select two players</div></div>';return;}
  var COL_A='rgba(100,180,255,1)',COL_B='rgba(80,220,140,1)';
  var roleA=(pA.role||'').toLowerCase(),roleB=(pB.role||'').toLowerCase();
  var pillarsA=PILLAR_MAP[roleA]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var pillarsB=PILLAR_MAP[roleB]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  function pGames(pid){return (data.games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});}
  var gamesA=pGames(aId),gamesB=pGames(bId);
  function avgPillar(pid,gs,idx){
    var vals=gs.map(function(g){var ps=g.playerScores[pid].pillar_scores;return ps?ps['p'+idx]:null;}).filter(function(v){return v!=null&&v>0;});
    return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
  }
  var stA=getPlayerStats(aId,data.games),stB=getPlayerStats(bId,data.games);
  function avHtml(p,pfp,bc){
    if(pfp)return '<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:1.5px solid '+bc+';flex-shrink:0;"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\'"/></div>';
    return '<div style="width:40px;height:40px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:17px;color:var(--grey-6);border:1.5px solid '+bc+';">'+p.nick[0]+'</div>';
  }
  var pfpA=data.pfp&&data.pfp[aId],pfpB=data.pfp&&data.pfp[bId];
  var header='<div style="display:flex;gap:20px;align-items:center;justify-content:center;padding:16px 20px;border-bottom:var(--border);">'+
    '<div style="display:flex;align-items:center;gap:10px;">'+avHtml(pA,pfpA,COL_A)+
      '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:'+COL_A+';">'+pA.nick+'</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pA.role||'')+'</div></div></div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);letter-spacing:2px;">VS</div>'+
    '<div style="display:flex;align-items:center;gap:10px;">'+avHtml(pB,pfpB,COL_B)+
      '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:'+COL_B+';">'+pB.nick+'</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pB.role||'')+'</div></div></div>'+
  '</div>';
  function gradeTxt(v){var g=v>0?scoreToGrade(v):null;return g?g.grade:'';}
  function barRow(lbl,val,col){
    var pct=val>0?Math.max(val/10*100,3):0;
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+
      '<div style="width:96px;flex-shrink:0;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:0.5px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+lbl+'</div>'+
      '<div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:'+pct+'%;background:'+col+';"></div></div>'+
      '<div style="width:58px;flex-shrink:0;font-family:\'DM Mono\',monospace;font-size:10px;text-align:right;">'+(val>0?val.toFixed(1):'--')+' <span style="color:var(--grey-5);font-size:8px;">'+gradeTxt(val)+'</span></div>'+
    '</div>';
  }
  function aspectBlock(title,la,va,lb,vb){
    return '<div class="cmp-aspect">'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--grey-5);margin-bottom:6px;text-transform:uppercase;">'+title+'</div>'+
      barRow(la,va,COL_A)+barRow(lb,vb,COL_B)+'</div>';
  }
  var graded='<div class="section-label" style="padding:16px 20px 8px;">Graded Performance <span style="color:var(--grey-4);">· avg of logged games</span></div>';
  graded+=aspectBlock('30-Day Overall',pA.nick,stA.monthAvg,pB.nick,stB.monthAvg);
  [0,1,2,3].forEach(function(i){
    graded+=aspectBlock('Aspect '+(i+1),pillarsA[i]||('Pillar '+(i+1)),avgPillar(aId,gamesA,i),pillarsB[i]||('Pillar '+(i+1)),avgPillar(bId,gamesB,i));
  });
  function rawAgg(pid,gs){
    var r={g:gs.length,k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0};
    gs.forEach(function(g){var s=g.playerScores[pid];
      r.k+=s.kills||0;r.d+=s.deaths||0;r.a+=s.assists||0;
      if(s.gold_per_min!=null){r.gpmS+=s.gold_per_min;r.gpmN++;}
      if(s.in_game_rating!=null){r.rS+=s.in_game_rating;r.rN++;}
      if(s.dmg_dealt_pct!=null){r.ddS+=s.dmg_dealt_pct;r.ddN++;}
      if(s.dmg_taken_pct!=null){r.dtS+=s.dmg_taken_pct;r.dtN++;}
    });
    r.kda=r.g?((r.k+r.a)/Math.max(r.d,1)):null;r.gpm=r.gpmN?r.gpmS/r.gpmN:null;
    r.rating=r.rN?r.rS/r.rN:null;r.dd=r.ddN?r.ddS/r.ddN:null;r.dt=r.dtN?r.dtS/r.dtN:null;
    return r;
  }
  var rA=rawAgg(aId,gamesA),rB=rawAgg(bId,gamesB);
  function rawRow(lbl,a,b,aN,bN){
    var aWin=aN!=null&&bN!=null&&aN>bN,bWin=aN!=null&&bN!=null&&bN>aN;
    return '<div class="compare-table-row">'+
      '<div class="compare-table-cell">'+lbl+'</div>'+
      '<div class="compare-table-cell mono '+(aWin?'compare-winner':bWin?'compare-loser':'')+'">'+a+'</div>'+
      '<div class="compare-table-cell mono '+(bWin?'compare-winner':aWin?'compare-loser':'')+'">'+b+'</div>'+
    '</div>';
  }
  function f1(v){return v!=null?v.toFixed(1):'--';}
  var rawWin='<div class="section-label" style="padding:18px 20px 8px;">Raw Stats <span style="color:var(--grey-4);">· informational · not scored</span></div>'+
    '<div class="compare-table">'+
      '<div class="compare-table-row compare-table-header"><div class="compare-table-cell header-cell">Metric</div>'+
      '<div class="compare-table-cell header-cell" style="color:'+COL_A+';">'+pA.nick+'</div>'+
      '<div class="compare-table-cell header-cell" style="color:'+COL_B+';">'+pB.nick+'</div></div>'+
      rawRow('Games',rA.g,rB.g,rA.g,rB.g)+
      rawRow('KDA',f1(rA.kda),f1(rB.kda),rA.kda,rB.kda)+
      rawRow('Gold / Min',rA.gpm!=null?Math.round(rA.gpm):'--',rB.gpm!=null?Math.round(rB.gpm):'--',rA.gpm,rB.gpm)+
      rawRow('Avg Rating',f1(rA.rating),f1(rB.rating),rA.rating,rB.rating)+
      rawRow('Dmg Dealt %',rA.dd!=null?rA.dd.toFixed(1)+'%':'--',rB.dd!=null?rB.dd.toFixed(1)+'%':'--',rA.dd,rB.dd)+
      rawRow('Dmg Taken %',rA.dt!=null?rA.dt.toFixed(1)+'%':'--',rB.dt!=null?rB.dt.toFixed(1)+'%':'--',rA.dt,rB.dt)+
    '</div>';
  cc.innerHTML=header+graded+rawWin+'<div style="height:24px;"></div>';
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
  var games=_profilePlayerGames(playerId).slice().sort(function(a,b){return parseDate(a.date)-parseDate(b.date);});
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
function _ptrendDefault(){return {preset:'all',from:'',to:'',series:{p0:1,p1:1,p2:1,p3:1,ment:1,hp:1,overall:1}};}
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
function setPtrendAllSeries(pid,on){var st=_ptrendState();Object.keys(st.series).forEach(function(k){st.series[k]=on?1:0;});renderPtrend(pid);}
function showProfile(playerId){
  PLAYERS=getPlayers();var player=PLAYERS.find(function(p){return p.id===playerId;});var data=loadData();
  if(!player){showPage('page-roster');return;}
  var stats=getPlayerStats(playerId,data.games);var pfp=data.pfp&&data.pfp[playerId]||null;
  var hp=calcHeroPoolScore(playerId);
  var monthGrade=stats.monthAvg>0?scoreToGrade(stats.monthAvg):null;
  var weekGrade=stats.weekAvg>0?scoreToGrade(stats.weekAvg):null;
  var hpGrade=hp.pct>0?scoreToGrade(hp.pct/10):null;
  var sBg=player.status==='Starter'?'rgba(68,255,136,0.1)':'var(--grey-3)';
  var sTxt=player.status==='Starter'?'var(--success)':'var(--grey-5)';
  var sBorder=player.status==='Starter'?'rgba(68,255,136,0.3)':'var(--grey-3)';
  var photoHtml=pfp?'<div class="profile-photo"><img src="'+pfp+'" alt="'+player.nick+'"/></div>':'<div class="profile-photo">'+player.nick[0]+'</div>';

  // ── Role selection: default to the player's designated role; toggle covers all roles played ──
  if(window._profilePid!==playerId){window._profilePid=playerId;window._profileRole=null;window._ptrend=null;}
  var roleInfo=_profileRoleInfo(playerId);
  var selRole=(window._profileRole&&roleInfo.roles.indexOf(window._profileRole)>=0)?window._profileRole:roleInfo.def;
  window._profileRole=selRole;
  var allGames=_profilePlayerGames(playerId);

  // ── Role-aware 6-axis radar (4 role pillars + Mentality + Hero Pool) + starter avg overlay ──
  var radarAxes=_profileRadarAxes(playerId,selRole);
  var radarData=radarAxes.labels.map(function(lbl,idx){return {label:lbl,value:radarAxes.values[idx]};});
  var pLabels=PILLAR_MAP[selRole]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var starterAvg=_starterAvgRadar(selRole);

  // ── Task 3: raw stats across ALL logged games ──
  var rs={k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0};
  allGames.forEach(function(g){var s=g.playerScores[playerId];
    rs.k+=s.kills||0;rs.d+=s.deaths||0;rs.a+=s.assists||0;
    if(s.gold_per_min!=null){rs.gpmS+=s.gold_per_min;rs.gpmN++;}
    if(s.in_game_rating!=null){rs.rS+=s.in_game_rating;rs.rN++;}
    if(s.dmg_dealt_pct!=null){rs.ddS+=s.dmg_dealt_pct;rs.ddN++;}
    if(s.dmg_taken_pct!=null){rs.dtS+=s.dmg_taken_pct;rs.dtN++;}
  });
  var rawKDA=allGames.length?((rs.k+rs.a)/Math.max(rs.d,1)):null;
  function rsCell(label,val){return '<div style="background:var(--black);padding:12px 8px;text-align:center;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;">'+(val!=null?val:'—')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:0.5px;margin-top:2px;">'+label+'</div></div>';}
  var rawStatsHtml=allGames.length?
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:1px;background:var(--grey-3);border:var(--border);margin:0 20px 8px;">'+
      rsCell('KDA',rawKDA!=null?rawKDA.toFixed(2):null)+
      rsCell('GOLD / MIN',rs.gpmN?Math.round(rs.gpmS/rs.gpmN):null)+
      rsCell('AVG RATING',rs.rN?(rs.rS/rs.rN).toFixed(1):null)+
      rsCell('DMG DEALT %',rs.ddN?(rs.ddS/rs.ddN).toFixed(1)+'%':null)+
      rsCell('DMG TAKEN %',rs.dtN?(rs.dtS/rs.dtN).toFixed(1)+'%':null)+
    '</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);padding:0 20px 4px;letter-spacing:1px;">INFORMATIONAL · NOT SCORED · '+allGames.length+' GAME'+(allGames.length!==1?'S':'')+'</div>'
    :'<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">No games logged yet</div></div>';

  // ── Task 4: hero stats across ALL logged games ──
  var hMap={};
  allGames.forEach(function(g){var s=g.playerScores[playerId];if(!s.hero)return;
    var h=hMap[s.hero]||(hMap[s.hero]={hero:s.hero,games:0,wins:0,k:0,d:0,a:0,rS:0,rN:0});
    h.games++;if(g.result==='Win')h.wins++;
    h.k+=s.kills||0;h.d+=s.deaths||0;h.a+=s.assists||0;
    if(s.in_game_rating!=null){h.rS+=s.in_game_rating;h.rN++;}
  });
  var heroList=Object.keys(hMap).map(function(k){return hMap[k];}).sort(function(a,b){return b.games-a.games;});
  var heroStatsHtml=heroList.length?heroList.map(function(h){
    var wr=Math.round(h.wins/h.games*100);
    var wrCol=wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)';
    var hkda=((h.k+h.a)/Math.max(h.d,1)).toFixed(2);
    var hr=h.rN?(h.rS/h.rN).toFixed(1):'--';
    return '<div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:var(--border);">'+
      heroPortraitHtml(h.hero,40,false)+
      '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">'+h.hero+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+h.games+' game'+(h.games!==1?'s':'')+'</div></div>'+
      '<div style="text-align:center;min-width:46px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;color:'+wrCol+';">'+wr+'%</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">WR</div></div>'+
      '<div style="text-align:center;min-width:42px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;">'+hr+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">RATING</div></div>'+
      '<div style="text-align:center;min-width:46px;"><div style="font-family:\'DM Mono\',monospace;font-size:13px;">'+hkda+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">KDA</div></div>'+
    '</div>';
  }).join(''):'<div class="empty"><div class="empty-icon">⭐</div><div class="empty-text">No heroes played yet</div></div>';

  var roleToggleHtml=roleInfo.roles.length>1?
    '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:0 20px 12px;">'+
      roleInfo.roles.map(function(r){
        var lbl=r.charAt(0).toUpperCase()+r.slice(1);
        return '<button class="tier-mode-btn'+(r===selRole?' active':'')+'" onclick="setProfileRole(\''+playerId+'\',\''+r+'\')">'+lbl+'</button>';
      }).join('')+
    '</div>':'';
  var roleLabel=selRole?selRole.charAt(0).toUpperCase()+selRole.slice(1):'—';
  var radarLegend='<div style="display:flex;gap:16px;justify-content:center;padding:6px 20px 8px;">'+
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
  window._currentProfileId=playerId;
  setTimeout(function(){
    drawRadar(playerId,radarData,{overlayData:starterAvg,colour1:'rgba(100,180,255,1)',colour2:'rgba(80,220,140,1)',showLabels:true,showGrades:true});
    renderPtrend(playerId);
  },60);
}
// ── Pillar trend: timeframe + per-series checkboxes ──
function renderPtrend(playerId){
  var box=document.getElementById('ptrend-block-'+playerId);if(!box)return;
  var role=window._profileRole;
  var pl=PILLAR_MAP[role]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var st=_ptrendState();
  var defs=[{k:'p0',l:pl[0]},{k:'p1',l:pl[1]},{k:'p2',l:pl[2]},{k:'p3',l:pl[3]},{k:'ment',l:'Mentality'},{k:'hp',l:'Hero Pool'},{k:'overall',l:'Overall'}];
  var presets=[['all','All'],['1w','1W'],['2w','2W'],['1m','1M']];
  var inpStyle='background:var(--grey-1);border:var(--border);color:var(--white);font-family:inherit;font-size:10px;padding:4px 6px;border-radius:2px;';
  var html=''+
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
  }).sort(function(a,b){return parseDate(a.date)-parseDate(b.date);});
  var dpr=window.devicePixelRatio||1;var dW=canvas.offsetWidth||canvas.width||600;var dH=canvas.offsetHeight||200;
  canvas.width=dW*dpr;canvas.height=dH*dpr;canvas.style.height=dH+'px';
  var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,dW,dH);
  var padL=26,padR=12,padT=12,padB=22;
  var plotW=dW-padL-padR,plotH=dH-padT-padB;
  function yPos(v){return padT+plotH-((Math.max(1,Math.min(v,10))-1)/9)*plotH;}
  function xPos(i){return games.length<=1?padL+plotW/2:padL+(i/(games.length-1))*plotW;}
  ctx.textBaseline='middle';ctx.font='9px DM Mono,monospace';
  [2,4,6,8,10].forEach(function(gv){var y=yPos(gv);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(dW-padR,y);ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='right';ctx.fillText(gv,padL-6,y);});
  if(!games.length){ctx.fillStyle='rgba(255,255,255,0.3)';ctx.textAlign='center';ctx.font='10px DM Mono,monospace';ctx.fillText('No games in range',dW/2,dH/2);return;}
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
  ['p0','p1','p2','p3','ment','hp','overall'].forEach(function(key,si){
    if(!st.series[key])return;
    var pts=[];
    games.forEach(function(g,i){var v=valFor(key,g);if(v!=null&&v>0)pts.push({x:xPos(i),y:yPos(v)});});
    if(!pts.length)return;
    ctx.strokeStyle=PTREND_COLORS[si];ctx.lineWidth=key==='overall'?2.5:2;ctx.beginPath();
    pts.forEach(function(p,idx){idx===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.stroke();
    ctx.fillStyle=PTREND_COLORS[si];pts.forEach(function(p){ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();});
  });
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
  var W=dW,H=dH,cx=W/2,cy=H/2,R=Math.min(W,H)/2-52,n=radarData.length;
  ctx.clearRect(0,0,W,H);
  function ang(i){return(Math.PI*2*i/n)-Math.PI/2;}
  function pt(i,r){return{x:cx+r*Math.cos(ang(i)),y:cy+r*Math.sin(ang(i))};}
  [0.2,0.4,0.6,0.8,1].forEach(function(f){ctx.beginPath();for(var i=0;i<n;i++){var p=pt(i,R*f);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();ctx.strokeStyle=f===1?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.05)';ctx.lineWidth=1;ctx.stroke();});
  for(var i=0;i<n;i++){var p=pt(i,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p.x,p.y);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.stroke();}
  function drawPoly(values,fillCol,strokeCol,dotCol){var hasData=values.some(function(v){return v>0;});ctx.beginPath();values.forEach(function(v,i){var frac=hasData?Math.min(v/10,1):0.12;var p=pt(i,R*frac);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.closePath();ctx.fillStyle=fillCol;ctx.fill();ctx.strokeStyle=strokeCol;ctx.lineWidth=2;ctx.stroke();if(hasData)values.forEach(function(v,i){if(v<=0)return;var p=pt(i,R*Math.min(v/10,1));ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle=dotCol;ctx.fill();});}
  if(overlayData) drawPoly(overlayData,colour2.replace('1)','0.08)'),colour2.replace('1)','0.5)'),colour2.replace('1)','0.7)'));
  drawPoly(radarData.map(function(d){return d.value;}),colour1.replace('1)','0.12)'),colour1.replace('1)','0.9)'),colour1);
  if(showLabels){radarData.forEach(function(d,i){var lR=R+28;var p=pt(i,lR);var g=d.value>0?scoreToGrade(d.value):null;var short=d.label.replace('Survival & Positioning','Survival').replace('Protection & Peel','Protection').replace('Resource Efficiency','Resources').replace('Role Fulfillment','Role Fulfil.').replace('Lane Resilience','Lane Resil.');ctx.textAlign='center';ctx.font='500 10px DM Sans,sans-serif';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(short,p.x,p.y+3);if(showGrades&&g){var gc=g.cls==='grade-sp'?'rgba(255,255,255,0.95)':g.cls==='grade-s'?'rgba(232,232,232,0.9)':g.cls==='grade-sm'?'rgba(200,200,200,0.85)':g.cls==='grade-ap'?'rgba(170,170,170,0.8)':g.cls==='grade-a'?'rgba(136,136,136,0.8)':'rgba(100,100,100,0.7)';ctx.font='bold 11px "Bebas Neue",sans-serif';ctx.fillStyle=gc;ctx.fillText(g.grade,p.x,p.y+17);}});}
}

// ══════════════════════════════════════════
// PLAYER EDIT
// ══════════════════════════════════════════
function openPlayerEdit(playerId){PLAYERS=getPlayers();var data=loadData();var isNew=!playerId;var player=isNew?null:PLAYERS.find(function(p){return p.id===playerId;});var pfp=isNew?null:data.pfp&&data.pfp[playerId]||null;document.getElementById('player-edit-modal-title').textContent=isNew?'ADD PLAYER':'EDIT PLAYER';var prevHtml=pfp?'<div class="pfp-preview"><img id="pfp-preview-img" src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>':'<div class="pfp-preview" id="pfp-preview-fallback">'+(player?player.nick[0]:'?')+'</div>';document.getElementById('player-edit-modal-body').innerHTML='<div class="pfp-upload-wrap">'+prevHtml+'<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--grey-5);margin-bottom:8px;">PROFILE PHOTO</div><label class="btn btn-sm btn-muted" style="cursor:pointer;display:inline-flex;">Upload Photo<input type="file" accept="image/*" style="display:none;" onchange="handlePfpUpload(event)"/></label>'+(pfp?'<button class="btn btn-sm" style="margin-left:8px;color:var(--danger);border-color:var(--danger);" onclick="removePfp()">Remove</button>':'')+'<div style="font-size:10px;color:var(--grey-5);margin-top:6px;">Auto-compressed to 300x300</div></div></div><div class="row"><div class="input-group mb-0"><label class="input-label">Nick</label><input class="input" id="pe-nick" value="'+(player&&player.nick||'')+'" placeholder="e.g. Gun"/></div><div class="input-group mb-0"><label class="input-label">IGN</label><input class="input" id="pe-ign" value="'+(player&&player.ign||'')+'" placeholder="e.g. Sutthiphat"/></div></div><div class="row mt-16"><div class="input-group mb-0"><label class="input-label">Role</label><select class="input" id="pe-role">'+GAME_ROLES.map(function(r){return '<option value="'+r+'"'+(player&&player.role===r?' selected':'')+'>'+r+'</option>';}).join('')+'</select></div><div class="input-group mb-0"><label class="input-label">Status</label><select class="input" id="pe-status">'+['Starter','Substitute','Inactive'].map(function(s){return '<option value="'+s+'"'+(player&&player.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div></div><div style="display:flex;gap:10px;margin-top:20px;">'+(isNew?'':'<button class="btn btn-danger btn-sm" onclick="showInlineDeletePlayer(\''+playerId+'\')">Delete</button>')+'<button class="btn btn-primary" style="flex:1;" onclick="savePlayerEdit(\''+(playerId||'')+'\','+isNew+')">'+(isNew?'Add Player':'Save Changes')+'</button></div>'+(isNew?'':'<div class="inline-confirm" id="inline-del-player-'+playerId+'"><div class="inline-confirm-text">Remove this player?</div><div class="inline-confirm-btns"><button class="btn btn-sm btn-muted" onclick="document.getElementById(\'inline-del-player-'+playerId+'\').classList.remove(\'open\')">Cancel</button><button class="btn btn-sm btn-danger" onclick="deletePlayer(\''+playerId+'\')">Yes, Remove</button></div></div>');window._pendingPfp=null;window._removePfp=false;document.getElementById('player-edit-modal').classList.add('open');}
function showInlineDeletePlayer(id){document.getElementById('inline-del-player-'+id)?.classList.add('open');}
function handlePfpUpload(event){var file=event.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(e){var img=new Image();img.onload=function(){var canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;var ctx=canvas.getContext('2d');var scale=Math.max(300/img.width,300/img.height);var sw=300/scale,sh=300/scale;var sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.drawImage(img,sx,sy,sw,sh,0,0,300,300);var compressed=canvas.toDataURL('image/jpeg',0.82);window._pendingPfp=compressed;window._removePfp=false;var prev=document.getElementById('pfp-preview-img');var fallback=document.getElementById('pfp-preview-fallback');if(prev){prev.src=compressed;}else if(fallback){fallback.style.fontSize='0';fallback.innerHTML='<img id="pfp-preview-img" src="'+compressed+'" style="width:100%;height:100%;object-fit:cover;"/>';}};img.src=e.target.result;};reader.readAsDataURL(file);}
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
