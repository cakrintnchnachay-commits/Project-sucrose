// ── DAY-2 NOTE ─────────────────────────────────────────────────────────────
// To populate player_id on each player_scores_v2 row, use:
//   findPlayerByIgn(ignString)   →  returns player object (with .id uuid)
// findPlayerByIgn is defined inside the scanner module below.
// Call it in Day 2's save function when writing player_scores_v2 rows:
//   const player = findPlayerByIgn(entry.ign);
//   const playerId = player ? player.id : null;
// ───────────────────────────────────────────────────────────────────────────

// ── LOG SESSION STATE ───────────────────────────────────────────────────────
var LS = {
  matchInfo: {},   // result, date, type, opponent, duration, duration_seconds, team_total_kills
  scores:    {},   // keyed by player id
  draft:     null,
  scanData:  null,
  enemyRoles: null,       // [{hero, role, gold}] confirmed by coach
  scanEnemy:  null,       // [{hero, role, gold}] durable scanned enemy lineup (survives modal skip)
  _pendingOppTeam: null,  // raw oppTeam entries waiting for role confirmation
};
// ───────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════
// HERO DATABASE + LOOKUP FUNCTIONS
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// HERO DATABASE (Supabase-backed, cache reads)
// ══════════════════════════════════════════
function getHeroDB(){ return _cache.heroes; }
function saveHeroDB(arr){ _cache.heroes=arr; sbSaveHeroes(arr); }
function getHeroOverrides(){ return _cache.heroOverrides||{}; }
function saveHeroOverrides(obj){ _cache.heroOverrides=obj; sbSaveSetting('hero_overrides',obj); }

function getLiveHeroes(){
  const db=getHeroDB();
  const overrides=getHeroOverrides();
  return db.map(function(h){
    const ov=overrides[h.name];
    if(!ov) return h;
    return Object.assign({},h,ov);
  });
}

function getHeroList(){
  const db=getLiveHeroes();
  const custom=_cache.customHeroes||[];
  const names=[...db,...custom].map(function(h){return h.name;});
  Object.keys(HERO_IMG_MAP).forEach(function(n){if(!names.includes(n))names.push(n);});
  return [...new Set(names)].sort();
}

function addHeroToList(name){ /* heroes managed via DB import */ }

// ══════════════════════════════════════════
// HERO CSV IMPORT (saves to Supabase)
// ══════════════════════════════════════════
function importFromSheet(){
  const url=(document.getElementById('sheet-url-input')?.value||'').trim();
  if(!url){showToast('Paste your Google Sheets CSV URL first');return;}
  const statusEl=document.getElementById('import-status');
  if(statusEl) statusEl.textContent='Fetching...';
  function tryFetch(fetchUrl,onSuccess,onFail){
    fetch(fetchUrl,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text();}).then(onSuccess).catch(onFail);
  }
  async function handleCSV(csv){
    const heroes=parseHeroCSV(csv);
    if(!heroes.length){if(statusEl)statusEl.textContent='No heroes parsed. Check columns: Name, Class, Roles.';return;}
    try{
      await sbSaveHeroes(heroes);
      _cache.heroes=heroes;
      _cache.sheetUrl=url;
      _cache.lastSync=new Date().toISOString();
      await sbSaveSetting('sheet_url',url);
      await sbSaveSetting('last_sync',_cache.lastSync);
      updateDBStatusCard();
      if(statusEl) statusEl.textContent='Imported '+heroes.length+' heroes.';
      showToast(heroes.length+' heroes imported');
    }catch(e){if(statusEl)statusEl.textContent='Supabase save failed: '+e.message;}
  }
  function handleError(err){if(statusEl)statusEl.textContent='Fetch failed: '+err.message;showToast('Import failed');}
  tryFetch(url,handleCSV,function(){tryFetch('https://corsproxy.io/?'+encodeURIComponent(url),handleCSV,handleError);});
}

function importFromFile(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  const statusEl=document.getElementById('import-status');
  if(statusEl) statusEl.textContent='Reading file...';
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const heroes=parseHeroCSV(e.target.result);
      if(!heroes.length) throw new Error('No heroes parsed — check columns: Name, Class, Roles (pipe-separated)');
      await sbSaveHeroes(heroes);
      _cache.heroes=heroes;
      _cache.lastSync=new Date().toISOString();
      _cache.sheetUrl='local:'+file.name;
      await sbSaveSetting('last_sync',_cache.lastSync);
      await sbSaveSetting('sheet_url','local:'+file.name);
      updateDBStatusCard();
      if(statusEl) statusEl.textContent='Imported '+heroes.length+' heroes from '+file.name;
      showToast(heroes.length+' heroes imported');
    }catch(err){
      if(statusEl) statusEl.textContent='Failed: '+err.message;
      showToast('Import failed');
    }
    input.value='';
  };
  reader.onerror=function(){if(statusEl)statusEl.textContent='Failed to read file.';input.value='';};
  reader.readAsText(file);
}

function parseHeroCSV(csv){
  // Normalize line endings
  const lines=csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim().split('\n');
  if(lines.length<2) return [];
  const heroes=[];
  // Skip header row (row 0)
  for(let i=1;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line) continue;
    // Simple CSV split respecting quoted fields
    const cols=[];
    let cur='',inQ=false;
    for(let j=0;j<line.length;j++){
      const ch=line[j];
      if(ch==='"'&&!inQ){inQ=true;}
      else if(ch==='"'&&inQ){inQ=false;}
      else if(ch===','&&!inQ){cols.push(cur.trim());cur='';}
      else{cur+=ch;}
    }
    cols.push(cur.trim());
    const name=(cols[0]||'').replace(/^"|"$/g,'').trim();
    const cls=(cols[1]||'').replace(/^"|"$/g,'').trim();
    const rolesRaw=(cols[2]||'').replace(/^"|"$/g,'').trim();
    if(!name||!cls) continue;
    const roles=rolesRaw.split('|').map(function(r){return r.trim();}).filter(Boolean);
    if(!roles.length) continue;
    heroes.push({name:name,cls:cls,roles:roles});
  }
  return heroes;
}

async function clearHeroDB(){
  await sb.from('heroes').delete().neq('id','00000000-0000-0000-0000-000000000000'); // delete all
  _cache.heroes=[];
  _cache.heroOverrides={};
  _cache.sheetUrl='';
  _cache.lastSync='';
  await sbSaveSetting('hero_overrides',{});
  await sbSaveSetting('sheet_url','');
  await sbSaveSetting('last_sync','');
  updateDBStatusCard();
  showToast('Hero database cleared');
}

function updateDBStatusCard(){
  const heroes=getLiveHeroes();
  const countEl=document.getElementById('db-hero-count');
  const syncEl=document.getElementById('db-last-sync');
  const srcEl=document.getElementById('db-source-url');
  if(countEl) countEl.textContent=heroes.length;
  if(syncEl) syncEl.textContent=_cache.lastSync?new Date(_cache.lastSync).toLocaleString('en-GB'):'Never';
  if(srcEl) srcEl.textContent=_cache.sheetUrl||'Not set';
  const urlInput=document.getElementById('sheet-url-input');
  if(urlInput&&_cache.sheetUrl&&!urlInput.value) urlInput.value=_cache.sheetUrl;
  const keyInput=document.getElementById('anthropic-key-input');
  if(keyInput&&_cache.anthropicKey&&!keyInput.value) keyInput.value=_cache.anthropicKey;
}

// ══════════════════════════════════════════
// HERO ROLE/CLASS EDITING
// ══════════════════════════════════════════
const GAME_ROLES=['Support','Midlane','Carry','Offlane','Jungler'];
const ALL_CLASSES=['Warrior','Tank','Support','Marksman','Mage','Assassin'];

function openHeroEditModal(heroName){
  const heroes=getLiveHeroes();
  const h=heroes.find(function(x){return x.name===heroName;})||{name:heroName,cls:'',roles:[]};
  const ov=getHeroOverrides();
  const storedImg=(ov[heroName]&&ov[heroName].img)||'';
  document.getElementById('hero-edit-title').textContent='EDIT: '+heroName;
  document.getElementById('hero-edit-body').innerHTML=
    '<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;padding-bottom:16px;border-bottom:var(--border);">'+
      '<div id="he-img-preview">'+heroPortraitHtml(heroName,80,false)+'</div>'+
      '<div style="flex:1;">'+
        '<div class="input-label" style="margin-bottom:6px;">Image URL <span style="color:var(--grey-5);font-weight:400;">(override)</span></div>'+
        '<input class="input" id="he-img" placeholder="Leave blank to use auto-loaded image" value="'+storedImg+'" oninput="previewHeroImg()" style="font-size:11px;"/>'+
      '</div>'+
    '</div>'+
    '<div class="input-group"><label class="input-label">Class</label>'+
    '<select class="input" id="he-class">'+
      ALL_CLASSES.map(function(c){return '<option value="'+c+'"'+(h.cls===c?' selected':'')+'>'+c+'</option>';}).join('')+
    '</select></div>'+
    '<div class="input-group"><label class="input-label">Roles (select all that apply)</label>'+
    '<div style="display:flex;flex-wrap:wrap;gap:8px;">'+
      GAME_ROLES.map(function(r){
        return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">'+
          '<input type="checkbox" value="'+r+'"'+(h.roles.includes(r)?' checked':'')+'/> '+r+'</label>';
      }).join('')+
    '</div></div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-bottom:12px;">Changes saved locally — won\'t be overwritten on re-sync.</div>'+
    '<div style="display:flex;gap:10px;">'+
      '<button class="btn btn-danger btn-sm" onclick="resetHeroOverride(\''+heroName.replace(/'/g,"\\'")+'\')" >Reset</button>'+
      '<button class="btn btn-primary" style="flex:1;" onclick="saveHeroEdit(\''+heroName.replace(/'/g,"\\'")+'\')">Save</button>'+
    '</div>';
  document.getElementById('hero-edit-modal').classList.add('open');
}

function previewHeroImg(){
  var url=(document.getElementById('he-img')?.value||'').trim();
  var prev=document.getElementById('he-img-preview');
  if(!prev) return;
  if(url){
    prev.innerHTML='<div class="hero-img-wrap" style="width:80px;height:80px;">'+
      '<img class="hero-img" src="'+url+'" alt="" loading="eager" onerror="this.style.display=\'none\'"/>'+
    '</div>';
  } else {
    var name=(document.getElementById('hero-edit-title')?.textContent||'').replace('EDIT: ','');
    prev.innerHTML=heroPortraitHtml(name,80,false);
  }
}

function saveHeroEdit(heroName){
  const cls=document.getElementById('he-class').value;
  const roles=[...document.querySelectorAll('#hero-edit-body input[type=checkbox]:checked')].map(function(cb){return cb.value;});
  if(!roles.length){showToast('Select at least one role');return;}
  const imgUrl=(document.getElementById('he-img')?.value||'').trim();
  const overrides=getHeroOverrides();
  overrides[heroName]={cls:cls,roles:roles};
  if(imgUrl) overrides[heroName].img=imgUrl;
  saveHeroOverrides(overrides);
  closeModal('hero-edit-modal');
  showToast('Hero updated');
  renderTierMode();
  renderHeroes();
}

function resetHeroOverride(heroName){
  const overrides=getHeroOverrides();
  delete overrides[heroName];
  saveHeroOverrides(overrides);
  closeModal('hero-edit-modal');
  showToast('Reset to sheet default');
  renderTierMode();
}

// ══════════════════════════════════════════
// ══════════════════════════════════════════
// HERO IMAGE HELPERS
// ══════════════════════════════════════════
const HERO_IMG_BASE='https://res.cloudinary.com/dtzdhbllb/image/upload/';
const HERO_IMG_MAP={
  "Azzen'Ka":'AzzenKa',"D'Arcy":'Darcy','Diaochan':'Diao_Chan',
  "Eland'orr":'Elandorr',"Kil'Groth":'Kil_Groth',"Tel'Annas":'Tel_Annas',
  'Wukong':'Wu_Kong','The Flash':'The_Flash','Brunhilda':'Celica',
  'Arthur':'Mortos','Jinnar':'Jinna','Lu Bu':'Lu_Bu',
  'Wonder Woman':'Wonder_Woman','Bolt Baron':'Bolt_Baron',"Y'bneth":'Y_bneth',
  'Flowborn':'v1775747198/Flowborn.png'
};

function heroImgUrl(name){
  var ov=getHeroOverrides();
  if(ov[name]&&ov[name].img) return ov[name].img;
  if(!name) return '';
  var mapped=HERO_IMG_MAP[name];
  if(mapped) return HERO_IMG_BASE+(mapped.includes('/')?mapped:mapped+'.jpg');
  return HERO_IMG_BASE+name+'.jpg';
}

function heroPortraitHtml(name,px,showName){
  var url=heroImgUrl(name);
  var init=(name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase()||'?';
  var fs=Math.max(9,Math.round(px*0.36));
  var wrap='<div class="hero-img-wrap" style="width:'+px+'px;height:'+px+'px;">'+
    '<span class="hero-img-fallback" style="font-size:'+fs+'px;">'+init+'</span>'+
    (url?'<img class="hero-img" src="'+url+'" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>':'')+
  '</div>';
  if(showName) wrap+='<div style="font-family:\'DM Mono\',monospace;font-size:9px;text-align:center;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:'+px+'px;">'+name+'</div>';
  return wrap;
}

// ══════════════════════════════════════════
// ══════════════════════════════════════════
// TIER CONSTANTS
// ══════════════════════════════════════════
const META_LEVELS=[
  {key:'S+',label:'S+',cls:'t-sp',desc:'Dominant -- must-ban/must-pick'},
  {key:'S', label:'S', cls:'t-s', desc:'Strong meta pick'},
  {key:'A', label:'A', cls:'t-a', desc:'Solid -- good in right comp'},
  {key:'B', label:'B', cls:'t-b', desc:'Situational'},
  {key:'C', label:'C', cls:'t-c', desc:'Below meta'},
  {key:'D', label:'D', cls:'t-d', desc:'Avoid'},
];
const MASTERY_LEVELS=[
  {key:'S',label:'S',cls:'t-s',desc:'Specialist -- signature hero'},
  {key:'A',label:'A',cls:'t-a',desc:'Comfortable -- reliable pick'},
  {key:'B',label:'B',cls:'t-b',desc:'Practised -- can play if needed'},
  {key:'C',label:'C',cls:'t-c',desc:'Familiar -- limited reps'},
  {key:'D',label:'D',cls:'t-d',desc:'Learning -- not match-ready'},
];
const META_WEIGHTS={'S+':1.0,'S':0.9,'A':0.7,'B':0.5,'C':0.3,'D':0.1};
const MASTERY_WEIGHTS={'S':1.0,'A':0.8,'B':0.6,'C':0.4,'D':0.2};

// ══════════════════════════════════════════
// ══════════════════════════════════════════
// HERO POOL SCORE
// ══════════════════════════════════════════
function calcHeroPoolScore(playerId){
  const data=loadData();
  const metaTiers=data.metaTiers||{};
  const playerMastery=(data.masteryTiers||{})[playerId]||{};
  const player=PLAYERS.find(function(p){return p.id===playerId;});
  if(!player) return {pct:0,topSlice:[],scored:[],flagged:[],benchmarkCount:0,N:0,heroCount:0};
  const allHeroes=getLiveHeroes().concat(data.customHeroes||[]);
  const roleHeroes=allHeroes.filter(function(h){return h.roles.includes(player.role);});
  const metaRatedForRole=roleHeroes.filter(function(h){return metaTiers[h.name]&&metaTiers[h.name][player.role];});
  const N=metaRatedForRole.length;
  const benchmarkCount=N>0?Math.round(N*0.70):0;
  const scored=[];
  const flagged=[];
  metaRatedForRole.forEach(function(h){
    const metaTier=metaTiers[h.name][player.role];
    const masteryTier=playerMastery[h.name];
    if(metaTier&&masteryTier){
      const heroScore=(META_WEIGHTS[metaTier]||0)*(MASTERY_WEIGHTS[masteryTier]||0)*100;
      scored.push({hero:h.name,heroScore:heroScore,metaTier:metaTier,masteryTier:masteryTier});
    } else if(metaTier&&!masteryTier){
      flagged.push({hero:h.name,metaTier:metaTier});
    }
  });
  scored.sort(function(a,b){return b.heroScore-a.heroScore;});
  const topSlice=scored.slice(0,benchmarkCount);
  // Max = top benchmark heroes sorted by meta weight, each scored at S mastery
  const benchmarkHeroes=metaRatedForRole.slice().sort(function(a,b){
    return (META_WEIGHTS[metaTiers[b.name][player.role]]||0)-(META_WEIGHTS[metaTiers[a.name][player.role]]||0);
  }).slice(0,benchmarkCount);
  const maxPossible=benchmarkHeroes.reduce(function(s,h){
    return s+(META_WEIGHTS[metaTiers[h.name][player.role]]||0)*MASTERY_WEIGHTS['S']*100;
  },0);
  const totalScore=topSlice.reduce(function(s,h){return s+h.heroScore;},0);
  const pct=(benchmarkCount>0&&maxPossible>0)?Math.round((totalScore/maxPossible)*100):0;
  return {pct:pct,topSlice:topSlice,scored:scored,flagged:flagged,benchmarkCount:benchmarkCount,N:N,heroCount:scored.length};
}

// ══════════════════════════════════════════
// ══════════════════════════════════════════
// HERO SEARCH
// ══════════════════════════════════════════
function buildHeroInput(wrapId,inputId,dropId,val){var el=document.getElementById(wrapId);if(!el)return;el.innerHTML='<label class="input-label">Hero Played</label><div class="hero-search-wrap"><input class="input" id="'+inputId+'" placeholder="Type to search..." autocomplete="off" value="'+(val||'')+'" oninput="filterHeroes(\''+inputId+'\',\''+dropId+'\')" onfocus="filterHeroes(\''+inputId+'\',\''+dropId+'\')"/><div class="hero-dropdown" id="'+dropId+'"></div></div>';}
function filterHeroes(inputId,dropId){var inp=document.getElementById(inputId);var drop=document.getElementById(dropId);if(!inp||!drop)return;var val=inp.value.trim().toLowerCase();var heroes=getHeroList();var filtered=val?heroes.filter(function(h){return h.toLowerCase().includes(val);}):heroes;var html=filtered.slice(0,10).map(function(h){return '<div class="hero-option" ontouchstart="" onclick="selectHero(\''+inputId+'\',\''+dropId+'\',\''+h.replace(/'/g,"\\'")+'\')">'+h+'</div>';}).join('');var raw=inp.value.trim();if(raw&&!heroes.find(function(h){return h.toLowerCase()===raw.toLowerCase();})) html+='<div class="hero-option new-hero" ontouchstart="" onclick="selectHero(\''+inputId+'\',\''+dropId+'\',\''+raw.replace(/'/g,"\\'")+'\')">+ Add "'+raw+'"</div>';if(!html) html='<div class="hero-option new-hero" style="cursor:default;">Type a hero name</div>';drop.innerHTML=html;drop.classList.add('open');}
function selectHero(inputId,dropId,name){var inp=document.getElementById(inputId);var drop=document.getElementById(dropId);if(inp)inp.value=name;if(drop)drop.classList.remove('open');}


// ══════════════════════════════════════════
// HEROES TAB — V7
// ══════════════════════════════════════════
var _heroState={role:'All',sort:'picks',window:'All'};
var HERO_WINDOWS=[
  {k:'1M',l:'1 Month',days:30},
  {k:'2M',l:'2 Months',days:60},
  {k:'6M',l:'6 Months',days:180},
  {k:'1Y',l:'1 Year',days:365},
  {k:'All',l:'All Time',days:null}
];
function setHeroWindow(w){_heroState.window=w;renderHeroes();}
function setHeroRole(r){_heroState.role=r;renderHeroes();}
function setHeroSort(k){_heroState.sort=k;renderHeroes();}
function getHeroCutoff(){var wDays=(HERO_WINDOWS.find(function(w){return w.k===_heroState.window;})||{}).days||null;return wDays?new Date(Date.now()-wDays*24*60*60*1000):null;}

// ── SCORING UTILITIES (ported from index.html; adapted for v2 pillar_scores format) ──
function parseDate(str){
  if(!str)return new Date(0);
  // Handle YYYY-MM-DD (ISO) and DD/MM/YYYY (legacy)
  if(str.includes('-')&&str.length>=10){var d=new Date(str+'T00:00:00');return isNaN(d.getTime())?new Date(0):d;}
  var p=str.split('/');
  return new Date(+p[2],+p[1]-1,+p[0]);
}
// Like parseDate but incorporates the game's wall-clock end time for same-day ordering.
function gameDateTime(g){
  var d=new Date(parseDate(g.date).getTime());
  if(g.endedAt){
    var p=String(g.endedAt).split(':');
    if(p.length===2){d.setHours(parseInt(p[0],10)||0,parseInt(p[1],10)||0,0,0);}
  }
  return d;
}
var GRADE_SCALE=[{grade:'S+',min:9.0,cls:'grade-sp'},{grade:'S',min:8.0,cls:'grade-s'},{grade:'S-',min:7.0,cls:'grade-sm'},{grade:'A+',min:6.0,cls:'grade-ap'},{grade:'A',min:5.0,cls:'grade-a'},{grade:'A-',min:0,cls:'grade-am'}];
function scoreToGrade(score){if(!score||score<=0)return null;for(var i=0;i<GRADE_SCALE.length;i++){if(score>=GRADE_SCALE[i].min)return GRADE_SCALE[i];}return GRADE_SCALE[GRADE_SCALE.length-1];}
var MENTALITY_CRITERIA=[];
var GAME_SENSE_CRITERIA=[];
var ROLE_CRITERIA={Support:[],Midlane:[],Carry:[],Offlane:[],Jungler:[]};
function calcMentality(s,mentObj){var m=mentObj||s;var c=m.communication||0,d=m.discipline||0,t=m.team_contribution||0;if(c+d+t===0)return 0;return(c*0.5+d*0.25+t*0.25)*2;}
function calcGameScore(s,role,game,pid){
  if(!s)return 0;
  if(s.pillar_scores){
    var ps=s.pillar_scores;
    var vals=Object.values(ps).filter(function(v){return v!=null&&v>0;});
    var avg=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
    var mentality=0,matchId=game&&game.matchId;
    if(matchId&&pid){var pm=(_cache.matches||[]).find(function(m){return m.id===matchId;});var mo=pm&&pm.mentality&&pm.mentality[pid]?pm.mentality[pid]:null;if(mo)mentality=calcMentality(null,mo);}
    var parts=(mentality>0?[mentality]:[]).concat(vals.length?[avg]:[]).filter(function(v){return v>0;});
    return parts.length?parts.reduce(function(a,b){return a+b;},0)/parts.length:0;
  }
  return 0;
}
function getPlayerStats(playerId,games){
  var player=(PLAYERS||[]).find(function(p){return p.id===playerId;})||(_cache.players||[]).find(function(p){return p.id===playerId;});
  var now=new Date(),oneMonth=new Date(now-30*24*60*60*1000),oneWeek=new Date(now-7*24*60*60*1000);
  var played=(games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped;});
  var monthGames=played.filter(function(g){return parseDate(g.date)>=oneMonth;});
  var weekGames=played.filter(function(g){return parseDate(g.date)>=oneWeek;});
  function avg(list){return list.length?list.reduce(function(acc,g){return acc+calcGameScore(g.playerScores[playerId],player?player.role:'',g,playerId);},0)/list.length:0;}
  return{games:played.length,monthAvg:avg(monthGames),weekAvg:avg(weekGames),playerGames:played};
}
function getRadarValues(playerId,games){
  var player=(PLAYERS||[]).find(function(p){return p.id===playerId;})||(_cache.players||[]).find(function(p){return p.id===playerId;});
  var empty=[{label:'Mentality',value:0},{label:'Pillar 1',value:0},{label:'Pillar 2',value:0},{label:'Pillar 3',value:0},{label:'Pillar 4',value:0},{label:'Hero Pool',value:0}];
  if(!player)return empty;
  var roleKey=(player.role||'').toLowerCase();
  var pLabels=PILLAR_MAP[roleKey]||[];
  var now=new Date(),cutoff=new Date(now-30*24*60*60*1000);
  var monthGames=(games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped&&parseDate(g.date)>=cutoff;});
  function avgPillar(idx){var key='p'+idx;var vals=monthGames.map(function(g){var s=g.playerScores&&g.playerScores[playerId];return s&&s.pillar_scores?s.pillar_scores[key]:null;}).filter(function(v){return v!=null&&v>0;});return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;}
  function avgMentality(){var vals=monthGames.map(function(g){var pm=g.matchId?(_cache.matches||[]).find(function(m){return m.id===g.matchId;}):null;var mo=pm&&pm.mentality&&pm.mentality[playerId]?pm.mentality[playerId]:null;return mo?calcMentality(null,mo):null;}).filter(function(v){return v!==null&&v>0;});return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;}
  return[{label:'Mentality',value:avgMentality()},{label:pLabels[0]||'Pillar 1',value:avgPillar(0)},{label:pLabels[1]||'Pillar 2',value:avgPillar(1)},{label:pLabels[2]||'Pillar 3',value:avgPillar(2)},{label:pLabels[3]||'Pillar 4',value:avgPillar(3)},{label:'Hero Pool',value:0}];
}

function buildHeroStats(cutoff){
  var games=(_cache.games||[]).filter(function(g){return !cutoff||parseDate(g.date)>=cutoff;});
  var totalGames=games.length;
  var heroMap={};
  var players=_cache.players||[];
  games.forEach(function(g){
    if(!g.playerScores) return;
    var isWin=g.result==='Win';
    var teamHeroes=[];
    players.forEach(function(p){
      var s=g.playerScores[p.id];
      if(s&&!s.skipped&&s.hero) teamHeroes.push({pid:p.id,hero:s.hero});
    });
    players.forEach(function(p){
      var s=g.playerScores[p.id];
      if(!s||s.skipped||!s.hero) return;
      var hname=s.hero;
      var allH=getLiveHeroes().concat(_cache.customHeroes||[]);
      var hobj=allH.find(function(h){return h.name===hname;})||{name:hname,cls:'Custom',roles:[]};
      if(!heroMap[hname]){
        heroMap[hname]={name:hname,cls:hobj.cls,roles:hobj.roles,picks:0,wins:0,losses:0,scores:[],players:{},pairsWith:{},
          rawKills:[],rawDeaths:[],rawAssists:[],rawGpm:[],rawRating:[],rawDmgDealt:[],rawDmgTaken:[]};
      }
      var entry=heroMap[hname];
      entry.picks++;
      if(isWin) entry.wins++; else entry.losses++;
      var score=calcGameScore(s,p.role,g,p.id);
      if(score>0) entry.scores.push(score);
      if(s.kills!=null) entry.rawKills.push(+s.kills);
      if(s.deaths!=null) entry.rawDeaths.push(+s.deaths);
      if(s.assists!=null) entry.rawAssists.push(+s.assists);
      if(s.gold_per_min!=null) entry.rawGpm.push(+s.gold_per_min);
      if(s.in_game_rating!=null) entry.rawRating.push(+s.in_game_rating);
      if(s.dmg_dealt_pct!=null) entry.rawDmgDealt.push(+s.dmg_dealt_pct);
      if(s.dmg_taken_pct!=null) entry.rawDmgTaken.push(+s.dmg_taken_pct);
      if(!entry.players[p.id]){
        entry.players[p.id]={nick:p.nick,role:p.role,picks:0,wins:0,losses:0,scores:[]};
      }
      var pe=entry.players[p.id];
      pe.picks++;
      if(isWin) pe.wins++; else pe.losses++;
      if(score>0) pe.scores.push(score);
      teamHeroes.forEach(function(th){
        if(th.pid===p.id||th.hero===hname) return;
        if(!entry.pairsWith[th.hero]) entry.pairsWith[th.hero]={hero:th.hero,picks:0,wins:0};
        entry.pairsWith[th.hero].picks++;
        if(isWin) entry.pairsWith[th.hero].wins++;
      });
    });
  });
  // Include all DB heroes so the full roster is visible even before any games are logged
  getLiveHeroes().concat(_cache.customHeroes||[]).forEach(function(hobj){
    if(!heroMap[hobj.name]){
      heroMap[hobj.name]={name:hobj.name,cls:hobj.cls||'Unknown',roles:hobj.roles||[],picks:0,wins:0,losses:0,scores:[],players:{},pairsWith:{},
        rawKills:[],rawDeaths:[],rawAssists:[],rawGpm:[],rawRating:[],rawDmgDealt:[],rawDmgTaken:[]};
    }
  });
  var result=Object.values(heroMap);
  result.totalGames=totalGames;
  return result;
}

function renderHeroes(){
  var cutoff=getHeroCutoff();
  var heroes=buildHeroStats(cutoff);
  var totalGames=heroes.totalGames||0;
  var role=_heroState.role||'All';
  var sort=_heroState.sort||'picks';
  var q=(document.getElementById('hero-search-inp')?.value||'').trim().toLowerCase();
  // Role tabs
  var roles=['All'].concat(GAME_ROLES);
  document.getElementById('heroes-role-tabs').innerHTML=roles.map(function(r){
    return '<button class="hero-role-tab '+(role===r?'active':'')+'" onclick="setHeroRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  // Sort bar
  var sorts=[{k:'picks',l:'Pick Rate'},{k:'wr',l:'Win Rate'},{k:'score',l:'Avg Score'},{k:'name',l:'Name'}];
  document.getElementById('heroes-sort-bar').innerHTML=sorts.map(function(s){
    return '<button class="hero-sort-btn '+(sort===s.k?'active':'')+'" onclick="setHeroSort(\''+s.k+'\')">'+s.l+'</button>';
  }).join('');
  // Date window bar
  var win=_heroState.window||'All';
  document.getElementById('heroes-window-bar').innerHTML=HERO_WINDOWS.map(function(w){
    return '<button class="hero-sort-btn '+(win===w.k?'active':'')+'" onclick="setHeroWindow(\''+w.k+'\')">'+w.l+'</button>';
  }).join('');
  // Filter
  var filtered=heroes.filter(function(h){
    if(q&&!h.name.toLowerCase().includes(q)) return false;
    if(role!=='All'&&!h.roles.includes(role)) return false;
    return true;
  });
  // Sort — heroes with picks always come before 0-pick ones within same sort
  filtered.sort(function(a,b){
    if(sort==='name') return a.name.localeCompare(b.name);
    if(sort==='wr'){
      if(!a.picks&&!b.picks) return a.name.localeCompare(b.name);
      if(!a.picks) return 1; if(!b.picks) return -1;
      var wa=a.wins/a.picks,wb=b.wins/b.picks;
      return wb-wa||b.picks-a.picks;
    }
    if(sort==='score'){
      var sa=a.scores.length?a.scores.reduce(function(x,y){return x+y;},0)/a.scores.length:0;
      var sb=b.scores.length?b.scores.reduce(function(x,y){return x+y;},0)/b.scores.length:0;
      if(!sa&&!sb) return a.name.localeCompare(b.name);
      return sb-sa;
    }
    // picks (default)
    if(b.picks!==a.picks) return b.picks-a.picks;
    return a.name.localeCompare(b.name);
  });
  if(!filtered.length){
    document.getElementById('heroes-list').innerHTML='<div class="empty"><div class="empty-icon">⭐</div><div class="empty-text">No heroes match</div></div>';
    return;
  }
  document.getElementById('heroes-list').innerHTML=filtered.map(function(h){
    var wr=h.picks?Math.round(h.wins/h.picks*100):null;
    var pr=totalGames?Math.round(h.picks/totalGames*100):null;
    var avgScore=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
    var grade=avgScore>0?scoreToGrade(avgScore):null;
    var wrCol=wr!=null?(wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)'):'var(--grey-5)';
    var lowConf=h.picks>0&&h.picks<3?'<span class="low-conf">·</span>':'';
    return '<div class="hero-row" onclick="openHeroDetail(decodeURIComponent(\''+_encHero(h.name)+'\'))">'+
      heroPortraitHtml(h.name,44,false)+
      '<div style="flex:1;min-width:0;margin-left:10px;">'+
        '<div class="hero-row-name">'+h.name+lowConf+'</div>'+
        '<div class="hero-row-cls">'+h.cls+(h.roles.length?' · '+h.roles.join(', '):'')+'</div>'+
      '</div>'+
      '<div class="hero-stat-col" style="margin-right:8px;">'+
        '<div class="hero-stat-val">'+(pr!=null?pr+'%':'0%')+'</div>'+
        '<div class="hero-stat-label">'+h.picks+'G picked</div>'+
      '</div>'+
      '<div class="hero-stat-col" style="margin-right:8px;">'+
        (h.picks?'<div class="hero-stat-val" style="color:'+wrCol+';">'+(wr!=null?wr+'%':'--')+'</div>'+
        '<div class="hero-wr-bar"><div class="hero-wr-fill" style="width:'+(wr||0)+'%;background:'+wrCol+';"></div></div>':
        '<div class="hero-stat-val" style="color:var(--grey-4);">--</div><div class="hero-wr-bar"></div>')+
      '</div>'+
      '<div class="hero-stat-col">'+
        '<div class="grade '+(grade?grade.cls:'grade-am')+'" style="font-size:18px;">'+(grade?grade.grade:'--')+'</div>'+
      '</div>'+
      '<div style="color:var(--grey-4);font-size:16px;margin-left:6px;">›</div>'+
    '</div>';
  }).join('');
}

function openHeroDetail(heroName){
  var cutoff=getHeroCutoff();
  var heroes=buildHeroStats(cutoff);
  var totalGames=heroes.totalGames||0;
  var h=heroes.find(function(x){return x.name===heroName;});
  if(!h){showToast('Hero not found');return;}
  var wr=h.picks?Math.round(h.wins/h.picks*100):null;
  var pr=totalGames?Math.round(h.picks/totalGames*100):null;
  var wrCol=wr!=null?(wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)'):'var(--grey-5)';
  var avgScore=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
  var grade=avgScore>0?scoreToGrade(avgScore):null;
  var lowWarn=h.picks>0&&h.picks<3?'<div style="background:rgba(255,204,68,0.1);border:1px solid rgba(255,204,68,0.3);border-radius:2px;padding:8px 12px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--warn);margin-bottom:12px;">⚠ Low sample (&lt;3 games) — data may not be reliable</div>':'';
  var playerRows=Object.values(h.players).sort(function(a,b){return b.picks-a.picks;}).map(function(pe){
    var pwr=pe.picks?Math.round(pe.wins/pe.picks*100):0;
    var pavgScore=pe.scores.length?pe.scores.reduce(function(a,b){return a+b;},0)/pe.scores.length:0;
    var pgr=pavgScore>0?scoreToGrade(pavgScore):null;
    return '<div class="hd-player-row">'+
      '<div style="flex:1;"><div style="font-size:12px;font-weight:600;">'+pe.nick+'</div><div class="hd-wl">'+pe.wins+'W / '+pe.losses+'L · '+pwr+'% WR · '+pe.picks+' game'+(pe.picks!==1?'s':'')+'</div></div>'+
      '<div class="grade '+(pgr?pgr.cls:'grade-am')+'" style="font-size:18px;">'+(pgr?pgr.grade:'--')+'</div>'+
    '</div>';
  }).join('');
  // Pair synergy
  var pairs=Object.values(h.pairsWith||{}).filter(function(p){return p.picks>=2;}).sort(function(a,b){
    var wa=a.picks?a.wins/a.picks:0,wb=b.picks?b.wins/b.picks:0;return wb-wa;
  });
  var topPairs=pairs.slice(0,5);
  var pairsHtml=topPairs.length?topPairs.map(function(p){
    var pwr=p.picks?Math.round(p.wins/p.picks*100):0;
    var pc=pwr>=60?'var(--success)':pwr>=50?'var(--warn)':'var(--danger)';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:var(--border);">'+
      '<div style="flex:1;font-size:12px;font-weight:600;">'+p.hero+'</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+p.picks+'G</div>'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:12px;color:'+pc+';">'+pwr+'%</div>'+
    '</div>';
  }).join('')+
  '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);padding-top:6px;">Win rate when picked together (min 2 games)</div>'
  :'<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">Need 2+ games together to show synergy</div>';
  // Raw stats section
  function _avg(arr){return arr.length?arr.reduce(function(a,b){return a+b;},0)/arr.length:null;}
  var avgK=_avg(h.rawKills),avgD=_avg(h.rawDeaths),avgA=_avg(h.rawAssists);
  var kdaVal=avgK!=null&&avgD!=null&&avgA!=null?((avgK+avgA)/(avgD||1)).toFixed(2):null;
  var kdaLine=kdaVal?kdaVal+' ('+avgK.toFixed(1)+' / '+avgD.toFixed(1)+' / '+avgA.toFixed(1)+')':null;
  var avgGpm=_avg(h.rawGpm),avgRating=_avg(h.rawRating),avgDmgDealt=_avg(h.rawDmgDealt),avgDmgTaken=_avg(h.rawDmgTaken);
  function rawStatRow(label,val,suffix,decimals){
    var disp=val!=null?val.toFixed(decimals||0)+(suffix||''):'—';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:var(--border);font-family:\'DM Mono\',monospace;">'+
      '<div style="font-size:9px;color:var(--grey-5);">'+label+'</div>'+
      '<div style="font-size:12px;color:var(--text);">'+disp+'</div>'+
    '</div>';
  }
  var rawStatsHtml=h.picks>0?
    rawStatRow('KDA',null,null,2).replace('—',kdaLine||'—')+
    rawStatRow('Avg Gold / Min',avgGpm,'',0)+
    rawStatRow('Avg In-Game Rating',avgRating,'',1)+
    rawStatRow('Avg DMG Dealt %',avgDmgDealt,'%',1)+
    rawStatRow('Avg DMG Taken %',avgDmgTaken,'%',1):
    '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No games logged with this hero yet</div>';
  var winLabel=(HERO_WINDOWS.find(function(w){return w.k===_heroState.window;})||{l:'All Time'}).l;
  document.getElementById('hd-title').textContent=heroName.toUpperCase();
  document.getElementById('hd-body').innerHTML=
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);text-align:center;padding:8px 0 0;letter-spacing:1px;">'+winLabel.toUpperCase()+'</div>'+
    '<div style="display:flex;flex-direction:column;align-items:center;padding:16px 0 8px;">'+
      heroPortraitHtml(heroName,160,false)+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;margin-top:10px;">'+heroName+'</div>'+
      (function(){var hdb=getLiveHeroes().find(function(x){return x.name===heroName;});return hdb?'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-top:2px;">'+hdb.cls+(hdb.roles.length?' · '+hdb.roles.join(', '):'')+'</div>':'';})() +
    '</div>'+
    lowWarn+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--grey-3);border:var(--border);margin-bottom:16px;">'+
      '<div style="background:var(--black);padding:12px;text-align:center;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:28px;">'+h.picks+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">PICKS'+(pr!=null?' ('+pr+'%)':'')+'</div></div>'+
      '<div style="background:var(--black);padding:12px;text-align:center;"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:28px;color:'+wrCol+';">'+(wr!=null?wr+'%':'--')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">WIN RATE</div></div>'+
      '<div style="background:var(--black);padding:12px;text-align:center;"><div class="grade '+(grade?grade.cls:'grade-am')+'" style="font-size:28px;">'+(grade?grade.grade:'--')+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">GRADE</div></div>'+
    '</div>'+
    (h.picks?'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:2px;margin-bottom:8px;">BY PLAYER</div>'+
    (playerRows||'<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No player breakdown</div>')+
    '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:2px;margin:16px 0 8px;">🤝 PAIRS WELL WITH</div>'+
    pairsHtml:'<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-4);padding:8px 0 16px;">No games logged with this hero in the selected window</div>')+
    '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:2px;margin:16px 0 8px;">📊 RAW STATS</div>'+
    rawStatsHtml+
    '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:2px;margin:16px 0 8px;">⚔ COUNTERS / COUNTER-PICKS</div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-4);line-height:1.6;">Counter data requires opponent draft logging — coming when draft input is added to the game log.</div>';
  document.getElementById('hero-detail-modal').classList.add('open');
}

// ══════════════════════════════════════════
// ══════════════════════════════════════════
// TOP 3 HEROES IN PLAYER PROFILE — V7
// ══════════════════════════════════════════
function buildTop3HeroesHtml(playerId,games){
  var heroMap={};
  var player=(_cache.players||[]).find(function(p){return p.id===playerId;});
  if(!player) return '';
  games.forEach(function(g){
    var s=g.playerScores&&g.playerScores[playerId];
    if(!s||s.skipped||!s.hero) return;
    var hname=s.hero;
    if(!heroMap[hname]) heroMap[hname]={name:hname,picks:0,wins:0,scores:[]};
    heroMap[hname].picks++;
    if(g.result==='Win') heroMap[hname].wins++;
    var sc=calcGameScore(s,player.role,g,player.id);
    if(sc>0) heroMap[hname].scores.push(sc);
  });
  // Top 3 by avg score, but only from the top 10 most-played heroes
  var byPlays=Object.values(heroMap).filter(function(h){return h.picks>0;}).sort(function(a,b){return b.picks-a.picks;}).slice(0,10);
  var top3=byPlays.slice().sort(function(a,b){
    var sa=a.scores.length?a.scores.reduce(function(x,y){return x+y;},0)/a.scores.length:0;
    var sb=b.scores.length?b.scores.reduce(function(x,y){return x+y;},0)/b.scores.length:0;
    return sb-sa;
  }).slice(0,3);
  if(!top3.length) return '<div style="padding:8px 20px 12px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No hero data yet</div>';
  var medals=['🥇','🥈','🥉'];
  var chips=top3.map(function(h,i){
    var wr=h.picks?Math.round(h.wins/h.picks*100):0;
    var avgSc=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
    var gr=avgSc>0?scoreToGrade(avgSc):null;
    return '<div class="top3-chip" onclick="openHeroDetail(decodeURIComponent(\''+_encHero(h.name)+'\'))" style="display:flex;flex-direction:column;align-items:center;padding:8px 10px;min-width:80px;">'+
      '<div class="top3-medal" style="margin-bottom:5px;">'+medals[i]+'</div>'+
      heroPortraitHtml(h.name,56,false)+
      '<div class="top3-hero" style="text-align:center;margin-top:6px;">'+h.name+'</div>'+
      '<div class="top3-meta" style="text-align:center;">'+wr+'% WR · '+h.picks+'G · '+(gr?gr.grade:'--')+'</div>'+
    '</div>';
  }).join('');
  return '<div class="top3-row">'+chips+'</div>';
}

// ══════════════════════════════════════════

// ══════════════════════════════════════════
// SCREENSHOT SCANNER (verbatim — integrate Day 3)
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// SCREENSHOT SCANNER
// ══════════════════════════════════════════

// Scan modal state
var _scanState = 'upload'; // 'upload' | 'scanning' | 'review'
var _scanFiles = []; // [{file, dataUrl, base64, mimeType, label}]
var _scanResult = null; // {ourTeam, oppTeam, raw, _editMode?}
var _scanChecked = {}; // fieldId → bool
var _scanCancelled = false;
var _scanPlayerOverrides = {}; // ign → playerId, for unrecognized substitute players

var SHOT_LABELS = ['RESULT','DAMAGE','BUILD'];
var SCAN_FIELDS_LIST = [
  ['Player names','Hero played'],
  ['KDA scores','Gold per player'],
  ['In-game rating','MVP (our side)'],
  ['Game duration','Total kills'],
  ['DMG dealt %','DMG taken %']
];

const SCAN_PROMPT = `Analyze these AOV (Arena of Valor) screenshots. Extract all data as JSON only, no explanation.

Return this exact shape:
{
  "result": "Win or Loss",
  "duration": "MM:SS game length shown next to the clock icon on the result screen, or null",
  "endedAt": "HH:MM real-world wall-clock time when the match ended (NOT the game timer), shown on the result screen without a clock icon, e.g. '21:34', or null",
  "mvpIgn": "exact IGN of the MVP on OUR team (the left/blue side) - never an enemy - or null",
  "ourKills": 0,
  "enemyKills": 0,
  "ourTeam": [
    {"ign":"exact name as shown","hero":"hero name","kills":0,"deaths":0,"assists":0,"gold":0,"gameRating":0.0,"dmgDealtPct":null,"dmgTakenPct":null,"dmgDealt":null,"dmgTaken":null,"mvp":false}
  ],
  "oppTeam": [
    {"ign":"exact name as shown","hero":"hero name","kills":0,"deaths":0,"assists":0,"gold":0}
  ]
}

Rules:
- ourTeam = LEFT column (blue side). oppTeam = RIGHT column (red side).
- "VICTORY" text means result "Win". "DEFEAT" means result "Loss".
- duration is the game length (MM:SS) shown next to the small CLOCK ICON on the result screen, e.g. "18:22". AOV matches almost always last between 8 and 35 minutes.
- endedAt is the real-world wall-clock time of day (24-hour HH:MM) shown on the result screen — this is NOT the match timer next to the clock icon. It may appear as a small time display (e.g. "21:34") elsewhere on the result screen. Return null if not visible.
- mvpIgn is the MVP player on OUR team only — the LEFT/blue column. Even when our team lost, return our side's MVP. Never return a right-side (enemy) player.
- hero is the character name shown beside the hero portrait (e.g. "Keera", "Eland'orr", "TeeMee").
- ign is the player handle exactly as shown (e.g. "NOR.Pennii", "wildMutt").
- gold is the numeric value (e.g. 12859). gameRating is the numeric score (e.g. 7.4).
- oppTeam gold IS shown on the result screen, directly behind/next to each enemy player's K/D/A score. Read it for every enemy row — only use null if it is genuinely not visible anywhere.
- ourKills and enemyKills are the large per-side TOTAL kill tallies shown at the top of the result screen (one number per side). Use null only if not visible.
- dmgDealtPct and dmgTakenPct are percentage numbers (0-100) from a damage tab screenshot if provided.
- dmgDealt and dmgTaken are the absolute damage numbers shown in the bars on the damage tab (e.g. dmgDealt: 45230, dmgTaken: 18000). These are NOT the percentages.
- If a field is not visible in any screenshot, use null.
- Return ONLY valid JSON, no markdown fences.`;

function saveAnthropicKey(){
  var val=(document.getElementById('anthropic-key-input')?.value||'').replace(/\s+/g,'');
  var statusEl=document.getElementById('anthropic-key-status');
  if(!val){if(statusEl)statusEl.textContent='Key is empty — not saved.';return;}
  if(statusEl)statusEl.textContent='Verifying key…';
  fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'x-api-key':val,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
      'content-type':'application/json'
    },
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1,messages:[{role:'user',content:'hi'}]})
  }).then(function(r){
    if(r.status===401){
      if(statusEl)statusEl.textContent='⚠ Key rejected by Anthropic — check it is correct and active.';
      return;
    }
    _cache.anthropicKey=val;
    sbSaveSetting('anthropic_key',val).then(function(){
      if(statusEl)statusEl.textContent='✓ Key verified and saved.';
      setTimeout(function(){if(statusEl)statusEl.textContent='';},3000);
    }).catch(function(){
      if(statusEl)statusEl.textContent='⚠ Key valid but could not save to database.';
    });
  }).catch(function(){
    _cache.anthropicKey=val;
    sbSaveSetting('anthropic_key',val).then(function(){
      if(statusEl)statusEl.textContent='✓ Saved (could not verify — check network).';
      setTimeout(function(){if(statusEl)statusEl.textContent='';},3000);
    });
  });
}

// ── SCAN MODAL FUNCTIONS ─────────────────────────────────────────────────────

function openScanModal(){
  if(!_cache.anthropicKey){showToast('Set your Anthropic API key in Settings first');return;}
  _scanState='upload';
  _scanFiles=[];
  _scanResult=null;
  _scanChecked={};
  _scanCancelled=false;
  _scanPlayerOverrides={};
  renderScanModal();
  document.getElementById('scan-modal').classList.add('open');
}

function closeScanModal(){
  document.getElementById('scan-modal').classList.remove('open');
  _scanCancelled=true;
  _scanResult=null;
}

function renderScanModal(){
  var body=document.getElementById('scan-modal-body');
  var sec=document.getElementById('scan-btn-secondary');
  var prim=document.getElementById('scan-btn-primary');
  if(!body)return;
  if(_scanState==='upload'){
    body.innerHTML=buildScanUploadHtml();
    sec.textContent='CANCEL'; sec.disabled=false;
    var n=_scanFiles.length;
    prim.textContent='SCAN '+(n||1)+' SHOT'+(n!==1?'S →':'→');
    prim.disabled=(n===0);
  } else if(_scanState==='scanning'){
    body.innerHTML=buildScanScanningHtml();
    sec.textContent='CANCEL SCAN'; sec.disabled=false;
    prim.textContent='PLEASE WAIT…'; prim.disabled=true;
  } else {
    body.innerHTML=buildScanReviewHtml();
    sec.textContent='DISCARD'; sec.disabled=false;
    var cnt=countCheckedScanFields();
    prim.textContent='APPLY '+cnt+' FIELDS →'; prim.disabled=(cnt===0);
    // wire checkboxes
    document.querySelectorAll('[data-scan-field]').forEach(function(el){
      el.addEventListener('click',function(){
        var fid=el.dataset.scanField;
        _scanChecked[fid]=!_scanChecked[fid];
        renderCheckbox(el,!!_scanChecked[fid]);
        var cnt=countCheckedScanFields();
        prim.textContent='APPLY '+cnt+' FIELDS →'; prim.disabled=(cnt===0);
      });
    });
  }
}

function renderCheckbox(el,on){
  el.style.background=on?'var(--white)':'transparent';
  el.style.borderColor=on?'var(--white)':'var(--grey-3)';
  el.innerHTML=on?'<svg width="9" height="6" fill="none" stroke="var(--black)" stroke-width="2"><path d="M1 3l2.5 2.5L8 1"/></svg>':'';
}

function scanSecondaryAction(){
  if(_scanState==='scanning'){_scanCancelled=true;_scanState='upload';renderScanModal();}
  else closeScanModal();
}

function scanPrimaryAction(){
  if(_scanState==='upload')startScan();
  else if(_scanState==='review')applyScannedData();
}

function buildScanUploadHtml(){
  var html='<div style="background:rgba(255,204,68,0.06);border:1px solid rgba(255,204,68,0.2);border-radius:4px;padding:10px 12px;display:flex;gap:10px;margin-bottom:14px;font-size:11.5px;color:var(--grey-6);line-height:1.5;">'
    +'<span style="font-size:14px;">ℹ</span><div>Drop up to <b style="color:var(--white)">3 screenshots</b> per game. Sucrose will extract player names, KDA, gold, in-game rating, MVP, and damage stats.</div></div>';
  // drop zone
  html+='<div style="border:1.5px dashed var(--grey-3);border-radius:4px;padding:18px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.01);" onclick="document.getElementById(\'scan-file-input\').click()">'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:2px;color:var(--grey-6);margin-bottom:4px;">DROP SCREENSHOTS HERE</div>'
    +'<div style="font-size:11px;color:var(--grey-4);">PNG or JPG · or <b style="color:var(--grey-5)">tap to browse</b><br/>Result · Damage tab · Build tab</div>'
    +'</div>';
  // shot thumbnails
  if(_scanFiles.length>0){
    html+='<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;color:var(--grey-5);margin:14px 0 8px;">DETECTED · '+_scanFiles.length+' OF '+_scanFiles.length+'</div>';
    html+='<div style="display:grid;grid-template-columns:repeat('+Math.min(_scanFiles.length+(_scanFiles.length<3?1:0),3)+',1fr);gap:8px;">';
    _scanFiles.forEach(function(sf,i){
      html+='<div style="position:relative;aspect-ratio:9/16;border-radius:4px;border:var(--border);background:var(--grey-2);overflow:hidden;">'
        +'<img src="'+sf.dataUrl+'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.65;"/>'
        +'<div style="position:absolute;left:5px;top:5px;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;padding:2px 6px;border-radius:99px;background:var(--warn);color:var(--black);font-weight:700;">'+sf.label+'</div>'
        +'<button onclick="removeScanFile('+i+')" style="position:absolute;right:4px;top:4px;width:18px;height:18px;border-radius:99px;background:rgba(0,0,0,0.7);border:none;color:#fff;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;">×</button>'
        +'</div>';
    });
    if(_scanFiles.length<3){
      html+='<div onclick="document.getElementById(\'scan-file-input\').click()" style="aspect-ratio:9/16;border-radius:4px;border:1.5px dashed var(--grey-3);background:transparent;display:flex;align-items:center;justify-content:center;color:var(--grey-4);font-size:24px;cursor:pointer;">+</div>';
    }
    html+='</div>';
    html+='<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--grey-4);margin-top:8px;">AUTO-CLASSIFIED · ORDER: RESULT FIRST, DAMAGE SECOND</div>';
  }
  // fields list
  html+='<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;color:var(--grey-5);margin:14px 0 8px;">WILL BE SCANNED</div>';
  html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;padding:12px;">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;font-size:11.5px;color:var(--grey-6);">';
  SCAN_FIELDS_LIST.forEach(function(row){html+='<div>· '+row[0]+'</div><div>· '+row[1]+'</div>';});
  html+='</div></div>';
  return html;
}

function removeScanFile(idx){
  _scanFiles.splice(idx,1);
  _scanFiles.forEach(function(sf,i){sf.label=SHOT_LABELS[i]||SHOT_LABELS[0];});
  renderScanModal();
}

function buildScanScanningHtml(){
  var n=_scanFiles.length||1;
  return '<div style="padding:32px 12px;text-align:center;">'
    +'<div style="width:56px;height:56px;border-radius:50%;border:3px solid var(--grey-3);border-top-color:var(--warn);animation:scanSpin 1s linear infinite;margin:0 auto 16px;"></div>'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:12px;letter-spacing:2px;color:var(--grey-6);margin-bottom:6px;">ANALYZING '+n+' SCREENSHOT'+(n!==1?'S':'')+'</div>'
    +'<div style="font-size:11px;color:var(--grey-4);">Claude Vision · extracting fields per player</div>'
    +'<div style="margin-top:24px;text-align:left;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--grey-6);line-height:1.9;" id="scan-progress-list">'
    +'<div style="color:var(--grey-4);">· connecting to API…</div>'
    +'</div>'
    +'</div>';
}

function updateScanProgress(lines){
  var el=document.getElementById('scan-progress-list');
  if(el)el.innerHTML=lines.join('');
}

function scanProgressLine(state,text){
  var colors={done:'var(--success)',active:'var(--warn)',pending:'var(--grey-4)'};
  var icons={done:'✓ ',active:'▸ ',pending:'· '};
  return '<div style="color:'+colors[state]+';">'+icons[state]+text+'</div>';
}

function buildScanReviewHtml(){
  if(!_scanResult)return '<div style="color:var(--grey-4);text-align:center;padding:20px;">No scan data</div>';
  var raw=_scanResult.raw;
  var ourTeam=_scanResult.ourTeam;

  // build match-level rows
  var matchRows=[];
  if(raw.endedAt)matchRows.push({id:'endedAt',label:'MATCH END · CLOCK ICON',val:''+raw.endedAt,badge:'NEW',badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)'});
  var _revDur=_validScannedDuration(raw.duration,raw.endedAt);
  if(_revDur)matchRows.push({id:'duration',label:'GAME DURATION',val:''+_revDur,badge:'NEW',badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)'});
  if(raw.mvpIgn){
    var mvpP=findPlayerByIgn(raw.mvpIgn);
    matchRows.push({id:'mvp',label:'MVP (WIN SIDE)',val:(mvpP?mvpP.nick+' · ':'')+raw.mvpIgn,badge:'MVP',badgeColor:'var(--warn)',badgeBg:'rgba(255,204,68,0.1)',badgeBorder:'rgba(255,204,68,0.3)'});
  }

  // count fields & init checked
  // In edit mode, load existing game scores to detect already-filled fields
  var editMode=!!(_scanResult&&_scanResult._editMode);
  var editGameIdx=editMode?_cache.games.findIndex(function(g){return g.id===window._editGameId;}):-1;
  var editScores=(editGameIdx>=0&&_cache.games[editGameIdx].playerScores)||{};

  var coexistCount=0;
  matchRows.forEach(function(r){
    if(!(r.id in _scanChecked)){
      // In edit mode, default OFF if the field already has a value on the game
      if(editMode&&r.id==='endedAt'&&_cache.games[editGameIdx]&&_cache.games[editGameIdx].endedAt)_scanChecked[r.id]=false;
      else if(editMode&&r.id==='duration'&&_cache.games[editGameIdx]&&_cache.games[editGameIdx].duration)_scanChecked[r.id]=false;
      else if(editMode&&r.id==='mvp'&&_cache.games[editGameIdx]&&_cache.games[editGameIdx].mvpPlayerId)_scanChecked[r.id]=false;
      else _scanChecked[r.id]=true;
    }
  });
  ourTeam.forEach(function(e){
    if(!e.player)return;
    var pid=e.player.id;
    var ex=e.extracted;
    var sc=editScores[pid]||{};
    ['kda','gold','gameRating','dmgDealtPct','dmgTakenPct','dmgDealt','dmgTaken'].forEach(function(f){
      var fid=pid+'_'+f;
      if(!(fid in _scanChecked)&&getScanFieldVal(ex,f)!==null){
        // In edit mode, default OFF for fields already present in the saved game
        var alreadyFilled=editMode&&(
          (f==='kda'&&sc.kills!=null)||(f==='gold'&&sc.gold!=null)||
          (f==='gameRating'&&sc.gameRating!=null)||
          (f==='dmgDealtPct'&&sc.dmgDealtPct!=null)||(f==='dmgTakenPct'&&sc.dmgTakenPct!=null)||
          (f==='dmgDealt'&&sc.dmgDealt!=null)||(f==='dmgTaken'&&sc.dmgTaken!=null)
        );
        _scanChecked[fid]=!alreadyFilled;
      }
    });
    // Coexist: in log mode use LS.scores; in edit mode use saved scores
    var coachRating=editMode?(sc.coachRating!=null?sc.coachRating:null):(LS.scores&&LS.scores[pid]&&LS.scores[pid].coachRating!=null?LS.scores[pid].coachRating:null);
    if(coachRating!=null&&ex.gameRating!=null)coexistCount++;
  });
  var totalFields=Object.keys(_scanChecked).length;
  var shotCount=_scanFiles.length||1;

  var html='';
  // summary stats
  html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">';
  [{n:shotCount,l:'SHOTS'},{n:totalFields,l:'FIELDS'},{n:coexistCount,l:'COEXIST'}].forEach(function(s){
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;padding:10px 8px;text-align:center;">'
      +'<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;">'+s.n+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--grey-5);margin-top:2px;">'+s.l+'</div>'
      +'</div>';
  });
  html+='</div>';

  // duration tip
  html+='<div style="background:rgba(255,204,68,0.06);border:1px solid rgba(255,204,68,0.2);border-radius:4px;padding:10px 12px;display:flex;gap:10px;margin-bottom:12px;font-size:11.5px;color:var(--grey-6);line-height:1.5;">'
    +'<span style="font-size:14px;">ℹ</span><div><b style="color:var(--white)">Game duration</b> is the timer next to the clock icon on the result screen. Confirm if the value looks off.</div></div>';

  // match-level section
  if(matchRows.length>0){
    html+=scanSectionLabel('MATCH-LEVEL');
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;overflow:hidden;margin-bottom:4px;">';
    matchRows.forEach(function(r,i){
      var ck=_scanChecked[r.id]!==false;
      html+=scanDiffRow(r.id,ck,r.label,r.val,r.badge,r.badgeColor,r.badgeBg,r.badgeBorder,i<matchRows.length-1,null,null,null);
    });
    html+='</div>';
  }

  // player-level section
  html+=scanSectionLabel('PLAYER-LEVEL · OUR SIDE');
  ourTeam.forEach(function(e){
    var p=e.player;var ex=e.extracted;
    var prows=buildPlayerScanRows(e,raw);
    var heroName=(e.hero&&e.hero.name)||(ex.hero||'');
    // Unrecognized player (substitute): show assign-to UI even if prows is empty
    if(!p){
      var rosterPlayers=getPlayers()||[];
      var escapedIgn=(ex.ign||'').replace(/'/g,"\\'");
      var playerOpts='<option value="">— select player —</option>'+
        rosterPlayers.map(function(rp){return '<option value="'+rp.id+'">'+rp.nick+' ('+rp.role+')</option>';}).join('');
      html+='<div style="background:var(--grey-1);border:1px solid rgba(255,204,68,0.4);border-radius:2px;margin-bottom:8px;overflow:hidden;">';
      html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,204,68,0.06);border-bottom:1px solid rgba(255,204,68,0.25);">'
        +'<div style="width:28px;height:28px;border-radius:4px;background:rgba(255,204,68,0.15);display:grid;place-items:center;font-family:\'DM Mono\',monospace;font-size:10px;font-weight:600;color:var(--warn);">?</div>'
        +'<div style="flex:1;">'
          +'<div style="font-weight:600;font-size:13px;color:var(--warn);">'+(ex.ign||'Unknown IGN')+'</div>'
          +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-top:2px;">NOT IN ROSTER · ASSIGN BELOW TO FILL DATA</div>'
        +'</div>'
        +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+heroName.toUpperCase()+'</div>'
      +'</div>';
      html+='<div style="padding:10px 12px;display:flex;align-items:center;gap:8px;">'
        +'<label style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--grey-5);white-space:nowrap;">ASSIGN TO</label>'
        +'<select class="input" style="flex:1;font-size:11px;padding:4px 8px;" onchange="assignScanPlayer(\''+escapedIgn+'\',this.value)">'+playerOpts+'</select>'
      +'</div>';
      if(prows.length>0){
        prows.forEach(function(r,i){
          var ck=_scanChecked[r.id]!==false;
          html+=scanDiffRow(r.id,ck,r.label,r.val,r.badge,r.badgeColor,r.badgeBg,r.badgeBorder,i<prows.length-1,r.note,r.coachVal,r.gameVal);
        });
      }
      html+='</div>';
      return;
    }
    if(prows.length===0)return;
    var init=(p.nick||p.ign||'?').substring(0,2).toUpperCase();
    var name=p.nick;
    var isMvp=raw.mvpIgn&&findPlayerByIgn(raw.mvpIgn)&&findPlayerByIgn(raw.mvpIgn).id===p.id;
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;margin-bottom:8px;overflow:hidden;">';
    html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--grey-2);border-bottom:var(--border);">'
      +'<div style="width:28px;height:28px;border-radius:4px;background:var(--grey-3);display:grid;place-items:center;font-family:\'DM Mono\',monospace;font-size:10px;font-weight:600;color:var(--grey-6);">'+init+'</div>'
      +'<div style="font-weight:600;font-size:13px;">'+name+(isMvp?' <span style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;background:rgba(255,204,68,0.12);color:var(--warn);border:1px solid rgba(255,204,68,0.3);padding:1px 6px;border-radius:2px;margin-left:4px;vertical-align:middle;">MVP</span>':'')+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-left:auto;">'+p.role+' · '+(heroName.toUpperCase())+'</div>'
      +'</div>';
    prows.forEach(function(r,i){
      var ck=_scanChecked[r.id]!==false;
      html+=scanDiffRow(r.id,ck,r.label,r.val,r.badge,r.badgeColor,r.badgeBg,r.badgeBorder,i<prows.length-1,r.note,r.coachVal,r.gameVal);
    });
    html+='</div>';
  });

  // late-binding tip
  html+='<div style="background:rgba(255,204,68,0.04);border:1px solid rgba(255,204,68,0.15);border-radius:4px;padding:10px 12px;display:flex;gap:10px;margin-top:4px;margin-bottom:16px;font-size:11.5px;color:var(--grey-6);line-height:1.5;">'
    +'<span style="font-size:14px;">ℹ</span><div>Got the damage screenshot later? <b style="color:var(--white)">Re-open this game and scan again.</b> Sucrose fills only the empty fields.</div></div>';
  return html;
}

function scanSectionLabel(text){
  return '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;color:var(--grey-5);margin:14px 0 8px;display:flex;align-items:center;gap:8px;">'
    +'<span style="flex:0 0 10px;height:1px;background:var(--grey-3);display:inline-block;"></span>'+text
    +'<span style="flex:1;height:1px;background:var(--grey-2);display:inline-block;"></span></div>';
}

// Called when coach manually assigns an unrecognized scanned IGN to a roster player
function assignScanPlayer(ign, playerId){
  if(!_scanResult)return;
  var player=(getPlayers()||[]).find(function(p){return p.id===playerId;});
  if(!player)return;
  _scanResult.ourTeam.forEach(function(entry){
    if((entry.extracted.ign||'').toLowerCase()===ign.toLowerCase()){
      entry.player=player;
    }
  });
  // Re-render review so new player's rows/checkboxes use the real player ID
  renderScanModal();
}

function getScanFieldVal(ex,field){
  if(field==='kda')return(ex.kills!=null)?ex.kills+'/'+ex.deaths+'/'+ex.assists:null;
  if(field==='gold')return ex.gold!=null?ex.gold:null;
  if(field==='gameRating')return ex.gameRating!=null?ex.gameRating:null;
  if(field==='dmgDealtPct')return ex.dmgDealtPct!=null?ex.dmgDealtPct:null;
  if(field==='dmgTakenPct')return ex.dmgTakenPct!=null?ex.dmgTakenPct:null;
  if(field==='dmgDealt')return ex.dmgDealt!=null?ex.dmgDealt:null;
  if(field==='dmgTaken')return ex.dmgTaken!=null?ex.dmgTaken:null;
  return null;
}

function buildPlayerScanRows(entry,raw){
  var ex=entry.extracted;var p=entry.player;
  var pid=p?p.id:'nopl';var rows=[];
  if(ex.kills!=null){
    rows.push({id:pid+'_kda',label:'SCORE (K/D/A)',val:ex.kills+' / '+ex.deaths+' / '+ex.assists,badge:'NEW',
      badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',note:null});
  }
  if(ex.gold!=null){
    var warn=(ex.gold>14000||ex.gold<3500);
    rows.push({id:pid+'_gold',label:'GOLD',val:Number(ex.gold).toLocaleString(),
      badge:warn?'WARN':'NEW',badgeColor:warn?'var(--warn)':'var(--success)',
      badgeBg:warn?'rgba(255,204,68,0.08)':'rgba(68,255,136,0.08)',
      badgeBorder:warn?'rgba(255,204,68,0.3)':'rgba(68,255,136,0.25)',
      note:warn?'check against role avg':null});
  }
  if(ex.gameRating!=null){
    // Coach rating: in log mode from LS.scores; in edit mode from saved game
    var editMode2=!!(_scanResult&&_scanResult._editMode);
    var editGIdx2=editMode2?_cache.games.findIndex(function(g){return g.id===window._editGameId;}):-1;
    var editSc2=editMode2&&editGIdx2>=0?(_cache.games[editGIdx2].playerScores&&_cache.games[editGIdx2].playerScores[pid])||{}:{};
    var coachRating=editMode2?(editSc2.coachRating!=null?editSc2.coachRating:null):(p&&LS.scores&&LS.scores[p.id]&&LS.scores[p.id].coachRating!=null?LS.scores[p.id].coachRating:null);
    if(coachRating!=null){
      rows.push({id:pid+'_gameRating',label:'IN-GAME RATING',val:''+ex.gameRating,badge:'+ STORED',
        badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',
        note:'stored alongside coach rating · coach rating remains canonical',coachVal:coachRating,gameVal:ex.gameRating});
    } else {
      rows.push({id:pid+'_gameRating',label:'IN-GAME RATING',val:''+ex.gameRating,badge:'NEW',
        badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',note:null});
    }
  }
  if(ex.dmgDealtPct!=null){
    rows.push({id:pid+'_dmgDealtPct',label:'DMG DEALT %',val:ex.dmgDealtPct+'%',badge:'NEW',
      badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',note:null});
  }
  if(ex.dmgTakenPct!=null){
    rows.push({id:pid+'_dmgTakenPct',label:'DMG TAKEN %',val:ex.dmgTakenPct+'%',badge:'NEW',
      badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',note:null});
  }
  if(ex.dmgDealt!=null){
    rows.push({id:pid+'_dmgDealt',label:'DMG DEALT (RAW)',val:Number(ex.dmgDealt).toLocaleString(),badge:'NEW',
      badgeColor:'var(--auto)',badgeBg:'rgba(68,136,255,0.08)',badgeBorder:'rgba(68,136,255,0.25)',note:null});
  }
  if(ex.dmgTaken!=null){
    rows.push({id:pid+'_dmgTaken',label:'DMG TAKEN (RAW)',val:Number(ex.dmgTaken).toLocaleString(),badge:'NEW',
      badgeColor:'var(--auto)',badgeBg:'rgba(68,136,255,0.08)',badgeBorder:'rgba(68,136,255,0.25)',note:null});
  }
  return rows;
}

function scanDiffRow(id,checked,label,val,badge,badgeColor,badgeBg,badgeBorder,hasBorder,note,coachVal,gameVal){
  var valsHtml;
  if(coachVal!=null&&gameVal!=null){
    var delta=parseFloat(gameVal)-parseFloat(coachVal);
    var dStr=(delta>=0?'+':'')+delta.toFixed(1);
    var dColor=Math.abs(delta)>=1.5?'var(--warn)':'var(--grey-5)';
    valsHtml='<span style="display:inline-flex;align-items:center;gap:4px;">'
      +'<span style="font-size:9px;letter-spacing:1px;color:var(--grey-5);font-family:\'DM Mono\',monospace;">COACH</span>'
      +'<span style="font-weight:600;">'+coachVal+'</span></span>'
      +'<span style="color:var(--grey-3);">|</span>'
      +'<span style="display:inline-flex;align-items:center;gap:4px;">'
      +'<span style="font-size:9px;letter-spacing:1px;color:var(--warn);font-family:\'DM Mono\',monospace;">GAME</span>'
      +'<span style="font-weight:600;color:var(--warn);">'+gameVal+'</span></span>'
      +'<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:'+dColor+';margin-left:2px;">Δ '+dStr+'</span>';
  } else {
    valsHtml='<span style="font-weight:600;">'+val+'</span>';
  }
  return '<div style="display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:flex-start;padding:11px 12px;'+(hasBorder?'border-bottom:var(--border);':'')+'">'
    +'<div class="scan-check" data-scan-field="'+id+'" style="width:18px;height:18px;border-radius:3px;border:1.5px solid '+(checked?'var(--white)':'var(--grey-3)')+';display:grid;place-items:center;cursor:pointer;flex-shrink:0;margin-top:2px;background:'+(checked?'var(--white)':'transparent')+';">'
    +(checked?'<svg width="9" height="6" fill="none" stroke="var(--black)" stroke-width="2"><path d="M1 3l2.5 2.5L8 1"/></svg>':'')
    +'</div>'
    +'<div>'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:8.5px;letter-spacing:2px;color:var(--grey-5);margin-bottom:3px;text-transform:uppercase;">'+label+'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;font-size:13px;flex-wrap:wrap;">'+valsHtml+'</div>'
    +(note?'<div style="font-size:10.5px;color:var(--grey-4);margin-top:3px;">'+note+'</div>':'')
    +'</div>'
    +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;padding:3px 7px;border-radius:99px;white-space:nowrap;margin-top:2px;color:'+badgeColor+';background:'+badgeBg+';border:1px solid '+badgeBorder+';">'+badge+'</div>'
    +'</div>';
}

function countCheckedScanFields(){
  return Object.values(_scanChecked).filter(Boolean).length;
}

function handleScanFileInput(input){
  var files=Array.from(input.files||[]);
  var toProcess=files.slice(0,3-_scanFiles.length);
  var done=0;
  if(toProcess.length===0){input.value='';return;}
  toProcess.forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      var img=new Image();
      img.onload=function(){
        var maxW=1920,maxH=1920,w=img.width,h=img.height;
        if(w>maxW||h>maxH){var sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
        var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        var mimeType=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg';
        var dataUrl=canvas.toDataURL(mimeType,0.92);
        _scanFiles.push({file:file,dataUrl:dataUrl,base64:dataUrl.split(',')[1],mimeType:mimeType,label:SHOT_LABELS[_scanFiles.length]||SHOT_LABELS[0]});
        done++;
        if(done===toProcess.length)renderScanModal();
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value='';
}

function startScan(){
  if(_scanFiles.length===0){showToast('Please select at least one screenshot');return;}
  _scanCancelled=false;
  _scanState='scanning';
  renderScanModal();
  var imageContents=_scanFiles.map(function(sf){
    return{type:'image',source:{type:'base64',media_type:sf.mimeType,data:sf.base64}};
  });
  var steps=[
    'RESULT · player names · heroes · KDA',
    'RESULT · gold · in-game rating',
    'RESULT · duration · MVP',
    'DAMAGE · reading damage dealt %',
    'DAMAGE · damage taken %',
    'BUILD · final items',
    'cross-validating player matches…'
  ];
  var tick=0;
  function advance(){
    if(_scanCancelled)return;
    var lines=steps.map(function(s,i){
      return scanProgressLine(i<tick?'done':i===tick?'active':'pending',s);
    });
    updateScanProgress(lines);
    if(tick<steps.length-1){tick++;setTimeout(advance,700+Math.random()*500);}
  }
  advance();
  callClaudeVision(imageContents).then(function(raw){
    if(_scanCancelled)return;
    var matched=processScanResult(raw);
    _scanResult={ourTeam:matched.ourTeam,oppTeam:matched.oppTeam,raw:raw};
    _scanChecked={};
    _scanState='review';
    renderScanModal();
  }).catch(function(err){
    if(_scanCancelled)return;
    _scanState='upload';
    renderScanModal();
    showToast('Scan failed: '+(err.message||'Unknown error'));
  });
}

async function callClaudeVision(imageContents){
  // imageContents: array of {type:'image',source:{type:'base64',media_type,data}}
  var resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'x-api-key':_cache.anthropicKey,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
      'content-type':'application/json'
    },
    body:JSON.stringify({
      model:'claude-opus-4-7',
      max_tokens:2048,
      messages:[{role:'user',content:[
        ...imageContents,
        {type:'text',text:SCAN_PROMPT}
      ]}]
    })
  });
  if(!resp.ok){
    var errText=await resp.text();
    if(resp.status===401)throw new Error('Invalid API key — go to Settings and re-enter your key from console.anthropic.com');
    if(resp.status===429)throw new Error('Rate limited or out of credits — check your Anthropic account');
    throw new Error('API error '+resp.status+': '+errText.slice(0,100));
  }
  var json=await resp.json();
  var text=(json.content&&json.content[0]&&json.content[0].text)||'';
  text=text.replace(/^```[a-z]*\n?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(text);}
  catch(e){throw new Error('Could not parse scan response — try again');}
}

function findHeroByName(name){
  if(!name) return null;
  var all=[].concat(_cache.heroes,_cache.customHeroes);
  var lo=name.toLowerCase();
  return all.find(function(h){return h.name.toLowerCase()===lo;})||
         all.find(function(h){return h.name.toLowerCase().includes(lo)||lo.includes(h.name.toLowerCase());})||
         null;
}

function findPlayerByIgn(ign){
  if(!ign) return null;
  var lo=ign.toLowerCase();
  return _cache.players.find(function(p){return p.ign&&p.ign.toLowerCase()===lo;})||
         _cache.players.find(function(p){
           return p.ign&&(p.ign.toLowerCase().includes(lo)||lo.includes(p.ign.toLowerCase()));
         })||null;
}

function processScanResult(raw){
  function mapTeam(list){
    return (list||[]).map(function(entry){
      return {extracted:entry,player:findPlayerByIgn(entry.ign),hero:findHeroByName(entry.hero)};
    });
  }
  return{ourTeam:mapTeam(raw.ourTeam),oppTeam:mapTeam(raw.oppTeam)};
}

// The scanner sometimes reads the result-screen wall-clock (time of day) instead of the
// match-length timer. Reject a duration that just copies the end clock or isn't a sane MM:SS.
function _validScannedDuration(dur, endedAt){
  if(!dur) return null;
  var d=String(dur).trim();
  if(endedAt && d===String(endedAt).trim()) return null; // copied the end-of-match clock
  var p=d.split(':');
  if(p.length!==2) return null;
  var mm=parseInt(p[0],10), ss=parseInt(p[1],10);
  if(isNaN(mm)||isNaN(ss)||ss<0||ss>59||mm<1||mm>99) return null;
  return d;
}

function applyScannedData(){
  if(!_scanResult)return;
  if(_scanResult._editMode){applyEditScannedData();return;}
  var raw=_scanResult.raw;
  var ourTeam=_scanResult.ourTeam;
  var oppTeam=_scanResult.oppTeam;
  if(!LS.matchInfo)LS.matchInfo={};

  // Result → logDraft + toggle
  if(raw.result){
    var _res=/loss|defeat/i.test(raw.result)?'Loss':'Win';
    LS.matchInfo.result=_res;
    if(typeof setLogResult==='function')setLogResult(_res);
  }

  // Match-level: endedAt, duration
  if(_scanChecked['endedAt']&&raw.endedAt){if(!LS.matchInfo)LS.matchInfo={};LS.matchInfo.endedAt=raw.endedAt;}
  var _scanDur=_validScannedDuration(raw.duration,raw.endedAt);
  if(_scanChecked['duration']&&_scanDur){if(!LS.matchInfo)LS.matchInfo={};LS.matchInfo.duration=_scanDur;}
  // duration_seconds for pillar calculations
  if(_scanDur){
    var dParts=_scanDur.split(':');
    if(dParts.length===2)LS.matchInfo.duration_seconds=parseInt(dParts[0])*60+parseInt(dParts[1]);
  }
  // Total kills per side — prefer the scanned tally, else sum per-player kills
  function _sumKills(list){
    var t=0,seen=false;
    (list||[]).forEach(function(e){if(e.extracted&&e.extracted.kills!=null){t+=e.extracted.kills;seen=true;}});
    return seen?t:null;
  }
  var ourK=(typeof raw.ourKills==='number')?raw.ourKills:_sumKills(_scanResult.ourTeam);
  var enemyK=(typeof raw.enemyKills==='number')?raw.enemyKills:_sumKills(_scanResult.oppTeam);
  if(ourK!=null)LS.matchInfo.team_total_kills=ourK;
  if(enemyK!=null)LS.matchInfo.enemy_total_kills=enemyK;
  // Pre-fill Step 0 kill inputs (only when empty) so logStep0Next preserves them
  if(LS.matchInfo.team_total_kills!=null){var tkEl=document.getElementById('log-team-kills');if(tkEl&&!tkEl.value)tkEl.value=LS.matchInfo.team_total_kills;}
  if(LS.matchInfo.enemy_total_kills!=null){var ekEl=document.getElementById('log-enemy-kills');if(ekEl&&!ekEl.value)ekEl.value=LS.matchInfo.enemy_total_kills;}
  // Store opp team for enemy role confirmation step
  if(_scanResult.oppTeam&&_scanResult.oppTeam.length){
    LS._pendingOppTeam=_scanResult.oppTeam;
  }

  // MVP — mark the score and autofill the Step-0 MVP search box
  if(_scanChecked['mvp']&&raw.mvpIgn){
    var mvpP=findPlayerByIgn(raw.mvpIgn);
    if(mvpP){
      if(!LS.scores[mvpP.id])LS.scores[mvpP.id]={};
      LS.scores[mvpP.id].mvp=true;
      var mvpInp=document.getElementById('log-mvp');
      if(mvpInp) mvpInp.value=mvpP.nick||mvpP.ign||'';
    }
  }

  // Player-level
  ourTeam.forEach(function(entry){
    if(!entry.player)return;
    var pid=entry.player.id;var ex=entry.extracted;
    if(!LS.scores[pid])LS.scores[pid]={};
    // hero always applied if matched
    if(entry.hero)LS.scores[pid].hero=entry.hero.name;
    if(_scanChecked[pid+'_kda']&&ex.kills!=null){LS.scores[pid].kills=ex.kills;LS.scores[pid].deaths=ex.deaths;LS.scores[pid].assists=ex.assists;}
    if(_scanChecked[pid+'_gold']&&ex.gold!=null)LS.scores[pid].gold=ex.gold;
    if(_scanChecked[pid+'_gameRating']&&ex.gameRating!=null)LS.scores[pid].gameRating=ex.gameRating;
    if(_scanChecked[pid+'_dmgDealtPct']&&ex.dmgDealtPct!=null)LS.scores[pid].dmgDealtPct=ex.dmgDealtPct;
    if(_scanChecked[pid+'_dmgTakenPct']&&ex.dmgTakenPct!=null)LS.scores[pid].dmgTakenPct=ex.dmgTakenPct;
    if(_scanChecked[pid+'_dmgDealt']&&ex.dmgDealt!=null)LS.scores[pid].dmgDealt=ex.dmgDealt;
    if(_scanChecked[pid+'_dmgTaken']&&ex.dmgTaken!=null)LS.scores[pid].dmgTaken=ex.dmgTaken;
  });

  // Role for our players comes from their roster entry, not the hero played.
  // Guessing from the hero mis-tags games (e.g. a jungler on a flex hero → Support).
  ourTeam.forEach(function(entry){
    if(!entry.player)return;
    var pid=entry.player.id;
    if(!LS.scores[pid])LS.scores[pid]={};
    LS.scores[pid].role=_normalizeRole(entry.player.role);
  });
  LS.scanEnemy=oppTeam.map(function(entry){
    var hName=(entry.hero&&entry.hero.name)||(entry.extracted&&entry.extracted.hero)||'';
    var hObj=entry.hero||findHeroByName(hName);
    entry._inferredRole=_inferEnemyRole(hObj,hName);
    return {
      hero: hName,
      role: entry._inferredRole||'',
      gold: (entry.extracted&&entry.extracted.gold!=null)?entry.extracted.gold:null
    };
  });

  // Match date → logDraft (scanner has no date; default to the form's date)
  if(!LS.matchInfo.date){
    var dEl=document.getElementById('log-date');
    if(dEl&&dEl.value)LS.matchInfo.date=dEl.value;
  }

  // Populate the duration input so logStep0Next() reads the scanned value back.
  // Force-set (don't skip when non-empty): a checked duration means apply it.
  if(LS.matchInfo.duration){var durInp=document.getElementById('log-duration');if(durInp)durInp.value=LS.matchInfo.duration;}
  if(LS.matchInfo.endedAt){var etInp=document.getElementById('log-end-time');if(etInp)etInp.value=LS.matchInfo.endedAt;}

  // Draft
  if(!LS.draft)LS.draft={side:'Blue',ourPicks:['','','','',''],oppPicks:['','','','','']};
  ourTeam.forEach(function(entry){
    if(entry.player&&entry.hero){var idx=GAME_ROLES.indexOf(entry.player.role);if(idx>=0)LS.draft.ourPicks[idx]=entry.hero.name;}
  });
  var oppIdx=0;
  oppTeam.forEach(function(entry){
    if(entry.hero&&oppIdx<5){
      if(entry.player){var idx=GAME_ROLES.indexOf(entry.player.role);if(idx>=0&&!LS.draft.oppPicks[idx]){LS.draft.oppPicks[idx]=entry.hero.name;return;}}
      while(oppIdx<5&&LS.draft.oppPicks[oppIdx])oppIdx++;
      if(oppIdx<5){LS.draft.oppPicks[oppIdx]=entry.hero.name;oppIdx++;}
    }
  });

  LS.scanData=_scanResult;
  _scanResult=null;
  closeScanModal();
  showToast('✓ Scan applied');
  // If opp team available, prompt for enemy role confirmation
  if(LS._pendingOppTeam&&LS._pendingOppTeam.length){
    setTimeout(openEnemyRoleConfirm, 300);
  }
}

// ══════════════════════════════════════════
// ENEMY ROLE CONFIRMATION
// ══════════════════════════════════════════

// Map any role string (case/spelling variants) to a canonical GAME_ROLES value, or '' if unknown.
// Without this, a hero whose stored role is e.g. "Jungle" fails to match any <option> and the
// role <select> silently falls back to its first option — Support.
function _normalizeRole(r) {
  if (!r) return '';
  var s = String(r).trim().toLowerCase();
  if (s === 'jungle' || s === 'jg' || s === 'jung') s = 'jungler';
  var hit = GAME_ROLES.find(function(g){ return g.toLowerCase() === s; });
  return hit || '';
}

function _inferEnemyRole(heroObj, heroName) {
  // Multi-role heroes — always require manual selection
  var MULTI_ROLE = ['Flowborn'];
  if (MULTI_ROLE.indexOf(heroName) !== -1) return null;
  if (!heroObj || !heroObj.roles || !heroObj.roles.length) return null;
  if (heroObj.roles.length === 1) return _normalizeRole(heroObj.roles[0]) || null;
  return null; // multiple roles → coach must pick
}

function openEnemyRoleConfirm() {
  var opp = LS._pendingOppTeam;
  if (!opp || !opp.length) return;
  var roleOptions = GAME_ROLES.map(function(r) {
    return '<option value="'+r+'">'+r+'</option>';
  }).join('');
  var rows = opp.map(function(entry, i) {
    var heroName = (entry.extracted && entry.extracted.hero) || '';
    var heroObj  = entry.hero || findHeroByName(heroName);
    var gold     = (entry.extracted && entry.extracted.gold) || null;
    var inferred = _inferEnemyRole(heroObj, heroName);
    var isMulti  = heroObj && heroObj.roles && heroObj.roles.length > 1;
    var isUnknown = !heroObj;
    var badgeHtml;
    if (inferred) {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">'+inferred.toUpperCase()+' · PRE-FILLED</span>';
    } else if (isMulti) {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--warn);letter-spacing:1px;">MULTI-ROLE — SELECT BELOW</span>';
    } else {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">NOT IN DB — SELECT BELOW</span>';
    }
    var selectedRole = inferred || '';
    var selectHtml =
      '<select class="input" id="er-role-'+i+'" style="font-size:11px;padding:6px 10px;width:130px;flex-shrink:0;">' +
        '<option value="" disabled'+(selectedRole?'':' selected')+'>— role —</option>' +
        GAME_ROLES.map(function(r) {
          return '<option value="'+r+'"'+(r===selectedRole?' selected':'')+'>'+r+'</option>';
        }).join('') +
      '</select>';
    var goldHtml = gold != null
      ? '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-left:8px;">'+Number(gold).toLocaleString()+' g</span>'
      : '';
    return '<div id="er-row-'+i+'" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:var(--border);">'+
      heroPortraitHtml(heroName, 36, false)+
      '<div style="flex:1;min-width:0;">'+
        '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+
          (heroName||'Unknown')+goldHtml+
        '</div>'+
        '<div style="margin-top:3px;">'+badgeHtml+'</div>'+
      '</div>'+
      selectHtml+
    '</div>';
  }).join('');
  document.getElementById('enemy-role-body').innerHTML =
    '<div style="padding:0 20px;">' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;padding:12px 0 4px;">'+
        'Heroes pre-filled from database. Adjust any that are wrong before confirming.'+
      '</div>'+
      rows+
    '</div>';
  document.getElementById('enemy-role-modal').classList.add('open');
}

function closeEnemyRoleConfirm() {
  LS._pendingOppTeam = null;
  document.getElementById('enemy-role-modal').classList.remove('open');
  showToast('Enemy roles skipped — scanned lineup kept, confirm in Step 1');
}

function confirmEnemyRoles() {
  var opp = LS._pendingOppTeam;
  if (!opp) return;
  var result = [];
  var missing = false;
  opp.forEach(function(entry, i) {
    var sel = document.getElementById('er-role-'+i);
    var role = sel ? sel.value : '';
    var row  = document.getElementById('er-row-'+i);
    if (!role) {
      missing = true;
      if (row) row.style.outline = '1px solid var(--danger)';
    } else {
      if (row) row.style.outline = '';
      result.push({
        hero: (entry.extracted && entry.extracted.hero) || '',
        role: role,
        gold: (entry.extracted && entry.extracted.gold) || null
      });
    }
  });
  if (missing) { showToast('Assign a role to every hero first'); return; }
  LS.enemyRoles = result;
  LS._pendingOppTeam = null;
  document.getElementById('enemy-role-modal').classList.remove('open');
  showToast('Enemy roles confirmed');
}

function triggerEditScan(){
  if(!_cache.anthropicKey){showToast('Set your Anthropic API key in Settings first');return;}
  var inp=document.getElementById('edit-scan-input');
  if(inp){inp.value='';inp.click();}
}

function handleEditScanUpload(input){
  var files=Array.from(input.files||[]);
  if(!files.length)return;
  var toProcess=files.slice(0,3);
  var processed=[];
  var done=0;
  function onAllReady(){
    _scanState='scanning';
    _scanFiles=processed;
    _scanCancelled=false;_scanResult=null;_scanChecked={};
    document.getElementById('scan-modal').classList.add('open');
    renderScanModal();
    var imageContents=processed.map(function(sf){
      return{type:'image',source:{type:'base64',media_type:sf.mimeType,data:sf.base64}};
    });
    callClaudeVision(imageContents).then(function(raw){
      if(_scanCancelled)return;
      var matched=processScanResult(raw);
      _scanResult={ourTeam:matched.ourTeam,oppTeam:matched.oppTeam,raw:raw,_editMode:true};
      _scanChecked={};_scanState='review';
      renderScanModal();
    }).catch(function(err){
      if(_scanCancelled)return;
      _scanState='upload';renderScanModal();
      showToast('Scan failed: '+(err.message||'Unknown error'));
    });
  }
  toProcess.forEach(function(file,i){
    var reader=new FileReader();
    reader.onload=function(e){
      var img=new Image();
      img.onload=function(){
        var maxW=1920,maxH=1920,w=img.width,h=img.height;
        if(w>maxW||h>maxH){var sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
        var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        var mimeType=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg';
        var dataUrl=canvas.toDataURL(mimeType,0.92);
        processed[i]={file:file,dataUrl:dataUrl,base64:dataUrl.split(',')[1],mimeType:mimeType,label:SHOT_LABELS[i]||SHOT_LABELS[0]};
        done++;
        if(done===toProcess.length)onAllReady();
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value='';
}

function applyEditScannedData(){
  if(!_scanResult)return;
  var raw=_scanResult.raw,our=_scanResult.ourTeam,opp=_scanResult.oppTeam;
  var gameIdx=_cache.games.findIndex(function(g){return g.id===window._editGameId;});

  // Result
  if(raw.result){var resEl=document.getElementById('edit-result');if(resEl)resEl.value=raw.result;}

  // Match-level: endedAt, duration stored on the game object
  if(gameIdx>=0){
    if(_scanChecked['endedAt']&&raw.endedAt){_cache.games[gameIdx].endedAt=raw.endedAt;var etEl=document.getElementById('egm-ended-at');if(etEl)etEl.value=raw.endedAt;}
    if(_scanChecked['duration']&&raw.duration)_cache.games[gameIdx].duration=raw.duration;
    // MVP
    if(_scanChecked['mvp']&&raw.mvpIgn){
      var mvpP=findPlayerByIgn(raw.mvpIgn);
      if(mvpP){
        _cache.games[gameIdx].mvpPlayerId=mvpP.id;
        window._editMvpId=mvpP.id;
        PLAYERS.forEach(function(p){
          var btn=document.getElementById('emvp-'+p.id);
          if(!btn)return;
          var isNow=p.id===mvpP.id;
          btn.className='btn btn-sm '+(isNow?'btn-primary':'btn-muted');
          btn.textContent=isNow?'⭐ MVP':'MVP?';
        });
      }
    }
  }

  // Heroes in edit form and draft
  var side=window._editDraftSide||'Blue';
  var ourColor=side==='Blue'?'blue':'red';
  var oppColor=side==='Blue'?'red':'blue';
  our.forEach(function(entry){
    if(entry.player&&entry.hero){
      var inp=document.getElementById('ehero-'+entry.player.id);
      if(inp)inp.value=entry.hero.name;
      var di=GAME_ROLES.indexOf(entry.player.role);
      if(di>=0){var dinp=document.getElementById('ed-'+ourColor+'-inp-'+di);if(dinp)dinp.value=entry.hero.name;}
    }
  });
  var oppIdx=0;
  opp.forEach(function(entry){
    if(entry.hero&&oppIdx<5){
      if(entry.player){
        var di=GAME_ROLES.indexOf(entry.player.role);
        if(di>=0){var dinp=document.getElementById('ed-'+oppColor+'-inp-'+di);if(dinp&&!dinp.value){dinp.value=entry.hero.name;return;}}
      }
      while(oppIdx<5){var dinp=document.getElementById('ed-'+oppColor+'-inp-'+oppIdx);if(dinp&&!dinp.value){dinp.value=entry.hero.name;oppIdx++;return;}oppIdx++;}
    }
  });

  // Player-level objective stats → applied directly to cache (fill only empty fields)
  if(gameIdx>=0){
    if(!_cache.games[gameIdx].playerScores)_cache.games[gameIdx].playerScores={};
    our.forEach(function(entry){
      if(!entry.player)return;
      var pid=entry.player.id;var ex=entry.extracted;
      var sc=_cache.games[gameIdx].playerScores[pid]||{};
      _cache.games[gameIdx].playerScores[pid]=sc;
      if(_scanChecked[pid+'_kda']&&ex.kills!=null){sc.kills=ex.kills;sc.deaths=ex.deaths;sc.assists=ex.assists;}
      if(_scanChecked[pid+'_gold']&&ex.gold!=null)sc.gold=ex.gold;
      if(_scanChecked[pid+'_gameRating']&&ex.gameRating!=null)sc.gameRating=ex.gameRating;
      if(_scanChecked[pid+'_dmgDealtPct']&&ex.dmgDealtPct!=null)sc.dmgDealtPct=ex.dmgDealtPct;
      if(_scanChecked[pid+'_dmgTakenPct']&&ex.dmgTakenPct!=null)sc.dmgTakenPct=ex.dmgTakenPct;
      if(_scanChecked[pid+'_dmgDealt']&&ex.dmgDealt!=null)sc.dmgDealt=ex.dmgDealt;
      if(_scanChecked[pid+'_dmgTaken']&&ex.dmgTaken!=null)sc.dmgTaken=ex.dmgTaken;
    });
    // Refresh the stats display in the edit modal
    PLAYERS.forEach(function(p){
      var wrap=document.getElementById('escan-stats-'+p.id);
      if(!wrap)return;
      var sc=_cache.games[gameIdx].playerScores[p.id]||{};
      wrap.innerHTML=buildEditScanStatsHtml(sc);
    });
  }

  _scanResult=null;
  closeScanModal();
  showToast('✓ Scan applied to game');
}

function buildEditScanStatsHtml(sc){
  var parts=[];
  if(sc.kills!=null)parts.push('<span>'+sc.kills+'/'+sc.deaths+'/'+sc.assists+'</span>');
  if(sc.gold!=null)parts.push('<span>'+Number(sc.gold).toLocaleString()+' g</span>');
  if(sc.gameRating!=null)parts.push('<span>'+sc.gameRating+' <span style="color:var(--grey-5);">rating</span></span>');
  if(sc.dmgDealtPct!=null)parts.push('<span>'+sc.dmgDealtPct+'% <span style="color:var(--grey-5);">dmg%</span></span>');
  if(sc.dmgTakenPct!=null)parts.push('<span>'+sc.dmgTakenPct+'% <span style="color:var(--grey-5);">taken%</span></span>');
  if(sc.dmgDealt!=null)parts.push('<span>'+Number(sc.dmgDealt).toLocaleString()+' <span style="color:var(--grey-5);">dealt</span></span>');
  if(sc.dmgTaken!=null)parts.push('<span>'+Number(sc.dmgTaken).toLocaleString()+' <span style="color:var(--grey-5);">taken</span></span>');
  if(!parts.length)return '';
  return parts.join('<span style="color:var(--grey-3);margin:0 4px;">·</span>');
}

function editAutoAssignDraftPicks(){
  var side=window._editDraftSide||'Blue';
  var ourColor=side==='Blue'?'blue':'red';
  GAME_ROLES.forEach(function(role,i){
    var player=PLAYERS.find(function(p){return p.role===role;});
    if(!player)return;
    var heroInp=document.getElementById('ehero-'+player.id);
    var heroVal=heroInp?(heroInp.value||'').trim():'';
    if(!heroVal)return;
    var draftInp=document.getElementById('ed-'+ourColor+'-inp-'+i);
    if(draftInp)draftInp.value=heroVal;
  });
  showToast('↺ Draft picks assigned from player scores');
}

// ══════════════════════════════════════════
// LOG FORM — Day 2
// ══════════════════════════════════════════

var PILLAR_MAP = {
  carry:   ['Lane Influence', 'Scaling', 'Teamfight & Dmg', 'Survival'],
  midlane: ['Map Influence',  'Scaling', 'Teamfight & Dmg', 'Survival'],
  offlane: ['Lane Influence', 'Scaling', 'Teamfight', 'Wave Management'],
  jungler: ['Map Influence',  'Scaling', 'Gank', 'Objective'],
  support: ['Map Influence',  'Protection', 'Teamfight', 'Tank'],
};
var MANUAL_PILLARS = new Set(['Lane Influence','Map Influence','Wave Management','Objective']);

function initLog(){
  LS.matchInfo = {};
  LS.scores    = {};
  LS.enemyRoles = null;
  LS.scanEnemy = null;
  LS.scanData = null;
  LS._pendingOppTeam = null;
  LS._matchId = null;
  LS._gameNum = null;
  LS._step = 0;

  // Clear the static Step-0 inputs. These are not regenerated per game, so without
  // this they keep the previous game's values — and applyScannedData only fills
  // empty fields, so a fresh scan would be ignored in favour of stale data.
  ['log-opponent','log-duration','log-end-time','log-team-kills','log-enemy-kills','log-vod','log-notes','log-mvp']
    .forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });

  // Populate the MVP search list with our roster
  var mvpList=document.getElementById('log-mvp-list');
  if(mvpList){
    mvpList.innerHTML=(PLAYERS||[]).map(function(p){
      return '<option value="'+(p.nick||p.ign||'').replace(/"/g,'&quot;')+'"></option>';
    }).join('');
  }

  // Default result to Win
  var winBtn  = document.getElementById('log-result-win');
  var lossBtn = document.getElementById('log-result-loss');
  if(winBtn)  { winBtn.className  = 'log-toggle-btn active-win'; }
  if(lossBtn) { lossBtn.className = 'log-toggle-btn'; }
  LS.matchInfo.result = 'Win';

  // Default type to Scrim
  var scrimBtn  = document.getElementById('log-type-scrim');
  var tournBtn  = document.getElementById('log-type-tournament');
  if(scrimBtn)  { scrimBtn.className  = 'log-toggle-btn active'; }
  if(tournBtn)  { tournBtn.className  = 'log-toggle-btn'; }
  LS.matchInfo.type = 'Scrim';

  // Set today's date
  var dateEl = document.getElementById('log-date');
  if(dateEl){
    var today = new Date();
    var yyyy  = today.getFullYear();
    var mm    = String(today.getMonth()+1).padStart(2,'0');
    var dd    = String(today.getDate()).padStart(2,'0');
    dateEl.value = yyyy+'-'+mm+'-'+dd;
  }

  logGoToStep(0);
}

function logGoToStep(n){
  var steps = ['log-step-0','log-step-enemy','log-step-players'];
  steps.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  var showId = ['log-step-0','log-step-enemy','log-step-players'][n];
  var showEl = document.getElementById(showId);
  if(showEl) showEl.style.display = 'block';

  LS._step = n;
  renderLogStepIndicator();
  window.scrollTo(0, 0);

  if(n === 1) renderEnemyStep();
  if(n === 2) renderPlayerStep();
}

function renderLogStepIndicator(){
  var el = document.getElementById('step-indicator');
  if(!el) return;
  var s = LS._step || 0;
  var labels = ['Details','Enemy','Players'];
  var html = '';
  for(var i = 0; i < 3; i++){
    var cls, col;
    if(i === s){
      cls = 'active'; col = 'var(--white)';
    } else if(i < s){
      cls = 'done'; col = 'var(--success)';
    } else {
      cls = 'skipped'; col = 'var(--grey-4)';
    }
    html += '<div style="display:flex;align-items:center;gap:5px;">';
    html += '<div style="width:8px;height:8px;border-radius:50%;background:'+col+';"></div>';
    html += '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:'+col+';letter-spacing:1px;text-transform:uppercase;">'+labels[i]+'</span>';
    html += '</div>';
    if(i < 2) html += '<div style="flex:1;height:1px;background:var(--grey-3);margin:0 4px;"></div>';
  }
  el.innerHTML = html;
}

function setLogResult(r){
  LS.matchInfo.result = r;
  var winBtn  = document.getElementById('log-result-win');
  var lossBtn = document.getElementById('log-result-loss');
  if(r === 'Win'){
    if(winBtn)  winBtn.className  = 'log-toggle-btn active-win';
    if(lossBtn) lossBtn.className = 'log-toggle-btn';
  } else {
    if(winBtn)  winBtn.className  = 'log-toggle-btn';
    if(lossBtn) lossBtn.className = 'log-toggle-btn active-loss';
  }
}

function setLogType(t){
  LS.matchInfo.type = t;
  var scrimBtn = document.getElementById('log-type-scrim');
  var tournBtn = document.getElementById('log-type-tournament');
  if(t === 'Scrim'){
    if(scrimBtn) scrimBtn.className = 'log-toggle-btn active';
    if(tournBtn) tournBtn.className = 'log-toggle-btn';
  } else {
    if(scrimBtn) scrimBtn.className = 'log-toggle-btn';
    if(tournBtn) tournBtn.className = 'log-toggle-btn active';
  }
}

function logStep0Next(){
  var result   = LS.matchInfo.result || 'Win';
  var date     = (document.getElementById('log-date')?.value || '').trim();
  var type     = LS.matchInfo.type || 'Scrim';
  var opponent = (document.getElementById('log-opponent')?.value || '').trim();
  var durStr   = (document.getElementById('log-duration')?.value || '').trim();
  var endedAt  = (document.getElementById('log-end-time')?.value || '').trim();
  var teamK    = (document.getElementById('log-team-kills')?.value || '').trim();
  var enemyK   = (document.getElementById('log-enemy-kills')?.value || '').trim();
  var vod      = (document.getElementById('log-vod')?.value || '').trim();
  var notes    = (document.getElementById('log-notes')?.value || '').trim();

  if(!date){ showToast('Match date is required'); return; }

  LS.matchInfo.result   = result;
  LS.matchInfo.date     = date;
  LS.matchInfo.type     = type;
  LS.matchInfo.opponent = opponent || null;
  LS.matchInfo.vod_url  = vod      || null;
  LS.matchInfo.notes    = notes    || null;
  LS.matchInfo.team_total_kills  = teamK  ? parseInt(teamK,10)  : null;
  LS.matchInfo.enemy_total_kills = enemyK ? parseInt(enemyK,10) : null;
  LS.matchInfo.endedAt = endedAt || null;

  if(durStr){
    LS.matchInfo.duration = durStr;
    var parts = durStr.split(':');
    if(parts.length === 2){
      LS.matchInfo.duration_seconds = parseInt(parts[0],10)*60 + parseInt(parts[1],10);
    }
  } else {
    LS.matchInfo.duration = null;
    LS.matchInfo.duration_seconds = null;
  }

  logGoToStep(1);
}

function renderEnemyStep(){
  var container = document.getElementById('log-enemy-rows');
  if(!container) return;

  var roleOptions = '<option value="" disabled selected>— role —</option>' +
    GAME_ROLES.map(function(r){ return '<option value="'+r+'">'+r+'</option>'; }).join('');

  var opp = LS._pendingOppTeam;
  // Source priority: modal-confirmed roles → durable scanned enemy → raw pending
  var confirmed = (LS.enemyRoles && LS.enemyRoles.length) ? LS.enemyRoles : null;
  var scanEnemy = (LS.scanEnemy && LS.scanEnemy.length) ? LS.scanEnemy : null;
  var html = '';
  for(var i = 0; i < 5; i++){
    var heroVal = '', goldVal = '', inferredRole = '';
    if(confirmed && confirmed[i]){
      heroVal      = confirmed[i].hero || '';
      goldVal      = (confirmed[i].gold != null) ? confirmed[i].gold : '';
      inferredRole = confirmed[i].role || '';
    } else if(scanEnemy && scanEnemy[i]){
      heroVal      = scanEnemy[i].hero || '';
      goldVal      = (scanEnemy[i].gold != null) ? scanEnemy[i].gold : '';
      inferredRole = scanEnemy[i].role || '';
    } else if(opp && opp[i]){
      var entry    = opp[i];
      var heroName = (entry.extracted && entry.extracted.hero) || '';
      var heroObj  = entry.hero || findHeroByName(heroName);
      goldVal      = (entry.extracted && entry.extracted.gold != null) ? entry.extracted.gold : '';
      heroVal      = heroName;
      inferredRole = _inferEnemyRole(heroObj, heroName) || '';
    }
    var selOpts = GAME_ROLES.map(function(r){
      return '<option value="'+r+'"'+(r===inferredRole?' selected':'')+'>'+r+'</option>';
    }).join('');
    html += '<div class="enemy-lineup-row">';
    html += '<input class="input" style="flex:2;min-width:0;" id="el-hero-'+i+'" placeholder="Hero name" value="'+heroVal+'" oninput="onEnemyHeroInput('+i+')" />';
    html += '<select class="input" style="flex:1.5;min-width:0;" id="el-role-'+i+'">';
    html += '<option value="" disabled'+(inferredRole?'':' selected')+'>— role —</option>';
    html += selOpts;
    html += '</select>';
    html += '<input class="input" style="width:72px;flex-shrink:0;font-family:\'DM Mono\',monospace;" type="number" id="el-gold-'+i+'" placeholder="Gold" value="'+goldVal+'"/>';
    html += '<span id="el-badge-'+i+'" style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;white-space:nowrap;min-width:0;"></span>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Update badges from whatever hero ended up in each row (any source)
  for(var j = 0; j < 5; j++){
    var hn2 = (document.getElementById('el-hero-'+j) || {}).value || '';
    if(!hn2) continue;
    var ho2 = findHeroByName(hn2);
    _updateEnemyBadge(j, ho2, _inferEnemyRole(ho2, hn2));
  }

  // Consume the pending data
  LS._pendingOppTeam = null;
}

function onEnemyHeroInput(i){
  var val     = (document.getElementById('el-hero-'+i)?.value || '').trim();
  var heroObj = val ? findHeroByName(val) : null;
  var inferred = _inferEnemyRole(heroObj, val);
  if(inferred){
    var sel = document.getElementById('el-role-'+i);
    if(sel) sel.value = inferred;
  }
  _updateEnemyBadge(i, heroObj, inferred);
}

function _updateEnemyBadge(i, heroObj, inferredRole){
  var badge = document.getElementById('el-badge-'+i);
  if(!badge) return;
  if(inferredRole){
    badge.style.color = 'var(--grey-5)';
    badge.textContent = 'PRE-FILLED';
  } else if(heroObj && heroObj.roles && heroObj.roles.length > 1){
    badge.style.color = 'var(--warn)';
    badge.textContent = 'MULTI-ROLE';
  } else {
    badge.textContent = '';
  }
}

function logStep1Next(){
  var rows = [];
  var valid = true;
  for(var i = 0; i < 5; i++){
    var hero = (document.getElementById('el-hero-'+i)?.value || '').trim();
    var role = document.getElementById('el-role-'+i)?.value || '';
    var gold = document.getElementById('el-gold-'+i)?.value;
    var roleEl = document.getElementById('el-role-'+i);
    // Only require a role if the coach entered a hero name
    if(hero && !role){
      if(roleEl) roleEl.style.outline = '2px solid var(--danger)';
      valid = false;
    } else {
      if(roleEl) roleEl.style.outline = '';
    }
    rows.push({
      hero: hero || null,
      role: role || null,
      gold: gold !== '' && gold != null ? parseFloat(gold) : null,
    });
  }
  if(!valid){ showToast('Select a role for every hero you entered'); return; }
  // Store only if at least one row has data; otherwise null (no enemy info this game)
  LS.enemyRoles = rows.some(function(r){ return r.hero || r.role; }) ? rows : null;
  logGoToStep(2);
}

function renderPlayerStep(){
  PLAYERS = getPlayers();
  var container = document.getElementById('log-player-sections');
  if(!container) return;

  var roleOpts = GAME_ROLES.map(function(r){
    return '<option value="'+r+'">'+r+'</option>';
  }).join('');

  var playerOpts = function(defaultRole){
    var active   = PLAYERS.filter(function(p){ return p.status !== 'Inactive'; });
    var inactive = PLAYERS.filter(function(p){ return p.status === 'Inactive'; });
    var all = active.concat(inactive);
    var defaultP = PLAYERS.find(function(p){ return p.role === defaultRole && p.status !== 'Inactive'; }) ||
                   PLAYERS.find(function(p){ return p.role === defaultRole; });
    return all.map(function(p){
      return '<option value="'+p.id+'"'+(defaultP&&p.id===defaultP.id?' selected':'')+'>'+p.nick+' ('+p.role+')</option>';
    }).join('');
  };

  var statsFields = [
    {id:'kills',      label:'Kills'},
    {id:'deaths',     label:'Deaths'},
    {id:'assists',    label:'Assists'},
    {id:'gold',       label:'Gold'},
    {id:'in_game_rating', label:'Rating'},
    {id:'dmg_dealt_pct',  label:'Dmg% Dealt'},
    {id:'dmg_taken_pct',  label:'Dmg% Taken'},
    {id:'dmg_dealt_raw',  label:'Dmg Dealt'},
    {id:'dmg_taken_raw',  label:'Dmg Taken'},
  ];

  var html = '';
  for(var i = 0; i < 5; i++){
    var role = GAME_ROLES[i];
    var roleLower = role.toLowerCase();
    var defaultP  = PLAYERS.find(function(p){ return p.role === role && p.status !== 'Inactive'; }) ||
                    PLAYERS.find(function(p){ return p.role === role; });
    var preScore = (defaultP && LS.scores[defaultP.id]) ? LS.scores[defaultP.id] : null;
    var preHero  = (preScore && preScore.hero) ? preScore.hero : '';
    // Inferred hero role pre-selects the picker; null (Flowborn/unknown) falls back to slot role
    var prefRole = (preScore && preScore.role) ? preScore.role : role;

    var roleSelOpts = GAME_ROLES.map(function(r){
      return '<option value="'+r+'"'+(r===prefRole?' selected':'')+'>'+r+'</option>';
    }).join('');

    var statsHtml = statsFields.map(function(f){
      return '<div class="raw-stat-cell">'+
        '<div class="raw-stat-label">'+f.label+'</div>'+
        '<input class="input" type="number" id="lp-'+f.id+'-'+i+'" placeholder="0" style="padding:6px 8px;font-size:12px;font-family:\'DM Mono\',monospace;" oninput="updateComputedStats('+i+')"/>'+
        '</div>';
    }).join('');

    html += '<div class="player-score-section" id="log-player-section-'+i+'">';
    html += '<div class="player-score-header">';
    html += '<select class="input" style="flex:1;font-size:12px;" id="lp-player-'+i+'">';
    html += playerOpts(role);
    html += '</select>';
    html += '<select class="input" style="width:110px;font-size:11px;" id="lp-role-'+i+'" onchange="onLogRoleChange('+i+')">';
    html += roleSelOpts;
    html += '</select>';
    html += '<button type="button" id="lp-autoscore-btn-'+i+'" onclick="autoScorePlayer('+i+')" style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;padding:5px 10px;border:1px solid rgba(68,136,255,0.3);background:rgba(68,136,255,0.08);color:var(--auto);border-radius:2px;cursor:pointer;white-space:nowrap;flex-shrink:0;">⚡ Auto Score</button>';
    html += '</div>';
    html += '<div class="player-score-body">';
    html += '<div class="input-group" style="margin-bottom:10px;">';
    html += '<label class="input-label">Hero</label>';
    html += '<input class="input" id="lp-hero-'+i+'" placeholder="Hero name" value="'+preHero+'"/>';
    html += '</div>';
    html += '<div id="lp-gpm-strip-'+i+'"></div>';
    html += '<div id="lp-pillars-'+i+'"></div>';
    html += '<details class="raw-stats-details">';
    html += '<summary>Raw Stats</summary>';
    html += '<div class="raw-stats-grid">'+statsHtml+'</div>';
    html += '<div id="lp-computed-'+i+'"></div>';
    html += '</details>';
    html += '<div class="input-group" style="margin-top:12px;margin-bottom:0;">';
    html += '<label class="input-label">Coach Note <span style="color:var(--grey-5);font-weight:400;">(optional)</span></label>';
    html += '<textarea class="input" id="lp-note-'+i+'" rows="2" placeholder="Coach note (optional)"></textarea>';
    html += '</div>';
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Pre-fill raw stats + render pillar sliders + suggestions for each slot
  for(var j = 0; j < 5; j++){
    var dp = PLAYERS.find(function(p){ return p.role === GAME_ROLES[j] && p.status !== 'Inactive'; }) ||
             PLAYERS.find(function(p){ return p.role === GAME_ROLES[j]; });
    var sc = (dp && LS.scores[dp.id]) ? LS.scores[dp.id] : null;
    var rEl = document.getElementById('lp-role-'+j);
    var rl  = (rEl ? rEl.value : GAME_ROLES[j]).toLowerCase();
    if(sc){ if(dp) sc._playerId = dp.id; _prefillRawStats(j, sc); }
    renderPillarSliders(rl, j);
    if(sc) _prefillPillarSuggestions(j, rl, sc);
    updateComputedStats(j);
  }
}

function _prefillRawStats(i, sc){
  function setv(id, v){
    var el = document.getElementById(id);
    if(el && v != null && v !== '') el.value = v;
  }
  setv('lp-kills-'+i,          sc.kills);
  setv('lp-deaths-'+i,         sc.deaths);
  setv('lp-assists-'+i,        sc.assists);
  setv('lp-gold-'+i,           sc.gold);
  setv('lp-in_game_rating-'+i, sc.gameRating);
  setv('lp-dmg_dealt_pct-'+i,  sc.dmgDealtPct);
  setv('lp-dmg_taken_pct-'+i,  sc.dmgTakenPct);
  setv('lp-dmg_dealt_raw-'+i,  sc.dmgDealt);
  setv('lp-dmg_taken_raw-'+i,  sc.dmgTaken);
}

function _prefillPillarSuggestions(i, role, sc){
  var pillars = PILLAR_MAP[role] || [];
  for(var n = 0; n < pillars.length; n++){
    var sug = calculateSuggestion(role, n, sc);
    if(sug == null) continue;
    var inp  = document.getElementById('lp-p'+n+'-'+i);
    var disp = document.getElementById('lp-pv'+n+'-'+i);
    if(inp)  inp.value = sug;
    if(disp) disp.textContent = parseFloat(sug).toFixed(0);
  }
}

function onLogRoleChange(i){
  var roleEl = document.getElementById('lp-role-'+i);
  var role   = roleEl ? roleEl.value.toLowerCase() : '';
  renderPillarSliders(role, i);
  updateComputedStats(i);
}

function updateComputedStats(slotIdx){
  var container = document.getElementById('lp-computed-'+slotIdx);
  if(!container) return;

  var kills    = parseFloat(document.getElementById('lp-kills-'+slotIdx)?.value)         || 0;
  var deaths   = parseFloat(document.getElementById('lp-deaths-'+slotIdx)?.value)        || 0;
  var assists  = parseFloat(document.getElementById('lp-assists-'+slotIdx)?.value)       || 0;
  var gold     = parseFloat(document.getElementById('lp-gold-'+slotIdx)?.value)          || 0;
  var dmgDealt = parseFloat(document.getElementById('lp-dmg_dealt_raw-'+slotIdx)?.value) || 0;
  var dmgTaken = parseFloat(document.getElementById('lp-dmg_taken_raw-'+slotIdx)?.value) || 0;
  var role     = (document.getElementById('lp-role-'+slotIdx)?.value || '').toLowerCase();

  var durSec   = LS.matchInfo && LS.matchInfo.duration_seconds;
  var durMin   = durSec ? durSec / 60 : 0;
  var durLabel = (LS.matchInfo && LS.matchInfo.duration) || null;
  var teamK    = (LS.matchInfo && LS.matchInfo.team_total_kills) || 0;

  var oppRow  = LS.enemyRoles ? LS.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
  var oppGold = oppRow ? (oppRow.gold || 0) : 0;

  var kda         = ((kills + assists) / Math.max(deaths, 1)).toFixed(2);
  var goldPerMin  = (durMin > 0 && gold > 0)       ? Math.round(gold / durMin)            : null;
  var killContrib = teamK > 0                       ? ((kills + assists) / teamK * 100).toFixed(1) + '%' : null;
  var minPerDeath = (durMin > 0 && deaths > 0)      ? (durMin / deaths).toFixed(1)         : null;
  var dmgRatio    = (dmgDealt > 0 && dmgTaken > 0)  ? (dmgDealt / dmgTaken).toFixed(2)    : null;
  var oppGoldDisp = oppGold > 0                     ? oppGold                               : null;
  var oppGPerMin  = (oppGold > 0 && durMin > 0)     ? Math.round(oppGold / durMin)          : null;

  var rows = [
    {label:'Duration',     val:durLabel,    warn:!durLabel},
    {label:'KDA',          val:kda},
    {label:'Gold / Min',   val:goldPerMin},
    {label:'Kill Contrib', val:killContrib},
    {label:'Min / Death',  val:minPerDeath},
    {label:'Dmg Ratio',    val:dmgRatio},
    {label:'Opp Gold',     val:oppGoldDisp},
    {label:'Opp G / Min',  val:oppGPerMin},
  ];

  var html = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--grey-2);">';
  html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">COMPUTED</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 6px;">';
  rows.forEach(function(s){
    var color = s.val != null ? (s.warn ? 'var(--warn)' : 'var(--white)') : 'var(--grey-3)';
    html += '<div>';
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:0.5px;margin-bottom:2px;">'+s.label+'</div>';
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:13px;font-weight:500;color:'+color+';">'+(s.val!=null?s.val:'—')+'</div>';
    html += '</div>';
  });
  html += '</div></div>';
  container.innerHTML = html;

  _refreshPillarHints(slotIdx);
  updateGPMStrip(slotIdx);
}

function renderPillarSliders(role, slotIdx){
  var container = document.getElementById('lp-pillars-'+slotIdx);
  if(!container) return;
  var pillars = PILLAR_MAP[role] || [];
  if(!pillars.length){ container.innerHTML = ''; return; }
  var html = '';
  for(var n = 0; n < pillars.length; n++){
    var pName    = pillars[n];
    var isManual = MANUAL_PILLARS.has(pName);
    var dispId   = 'lp-pv'+n+'-'+slotIdx;
    var inpId    = 'lp-p'+n+'-'+slotIdx;
    html += '<div class="pillar-row">';
    html += '<div class="pillar-label-row">';
    html += '<span class="pillar-label">'+pName+'</span>';
    html += '<span class="pillar-val" id="'+dispId+'">5</span>';
    html += '</div>';
    if(!isManual){
      html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;" id="lp-phint'+n+'-'+slotIdx+'">Stat-based — drag to override</div>';
    }
    html += '<input type="range" class="pillar-slider" id="'+inpId+'" min="1" max="10" step="1" value="5" oninput="updatePillarDisplay(this,\''+dispId+'\')" />';
    html += '</div>';
  }
  container.innerHTML = html;
}

function updatePillarDisplay(input, displayId){
  var el = document.getElementById(displayId);
  if(el) el.textContent = parseFloat(input.value).toFixed(0);
}

// ── DAY 6 — BENCHMARK MODEL ──────────────────────────
// Pillar index N maps to benchmark field N for that role.
var BENCHMARK_ROLES  = ['carry','midlane','offlane','jungler','support'];
var BENCHMARK_LABELS = {carry:'Carry',midlane:'Midlane',offlane:'Offlane',jungler:'Jungler',support:'Support'};
// First 4 fields per role map 1:1 to pillar index 0-3 (used by calculateSuggestion).
// Fields beyond index 3 are extra reference data shown in the panel for coaching decisions.
var BENCHMARK_FIELDS = {
  carry:   [{k:'kda',label:'KDA'},{k:'gpm',label:'Gold / Min'},{k:'dmg_dealt_pct',label:'Dmg Dealt %'},{k:'rating',label:'Rating'},
            {k:'kill_contrib',label:'Kill Contribution %'},{k:'min_per_death',label:'Min / Death'},{k:'dmg_per_dmg_taken',label:'Dmg / Dmg Taken'}],
  midlane: [{k:'kda',label:'KDA'},{k:'gpm',label:'Gold / Min'},{k:'dmg_dealt_pct',label:'Dmg Dealt %'},{k:'rating',label:'Rating'},
            {k:'kill_contrib',label:'Kill Contribution %'},{k:'min_per_death',label:'Min / Death'},{k:'dmg_per_dmg_taken',label:'Dmg / Dmg Taken'}],
  offlane: [{k:'kda',label:'KDA'},{k:'gpm',label:'Gold / Min'},{k:'dmg_taken_pct',label:'Dmg Taken %'},{k:'rating',label:'Rating'},
            {k:'kill_contrib',label:'Kill Contribution %'},{k:'min_per_death',label:'Min / Death'},{k:'dmg_dealt_pct',label:'Dmg Dealt %'}],
  jungler: [{k:'kda',label:'KDA'},{k:'gpm',label:'Gold / Min'},{k:'kill_contrib',label:'Kill Contribution %'},{k:'rating',label:'Rating'},
            {k:'min_per_death',label:'Min / Death'},{k:'dmg_per_dmg_taken',label:'Dmg / Dmg Taken'},{k:'dmg_dealt_pct',label:'Dmg Dealt %'}],
  support: [{k:'kda',label:'KDA'},{k:'dmg_taken_pct',label:'Dmg Taken %'},{k:'kill_contrib',label:'Kill Contribution %'},{k:'rating',label:'Rating'},
            {k:'gpm',label:'Gold / Min'},{k:'min_per_death',label:'Min / Death'},{k:'dmg_per_dmg_taken',label:'Dmg / Dmg Taken'}],
};
var BENCHMARK_LS_KEY = 'sucrose_benchmarks';

function _benchEmptyConfig(){
  var cur={};
  BENCHMARK_ROLES.forEach(function(role){
    cur[role]={};
    BENCHMARK_FIELDS[role].forEach(function(f){ cur[role][f.k]={value:'',auto:false}; });
  });
  return cur;
}
// Normalise any stored config so every role/field exists.
function _benchMergeShape(cfg){
  var out=_benchEmptyConfig();
  if(cfg&&typeof cfg==='object'){
    BENCHMARK_ROLES.forEach(function(role){
      BENCHMARK_FIELDS[role].forEach(function(f){
        var src=cfg[role]&&cfg[role][f.k];
        if(src&&typeof src==='object'){
          out[role][f.k]={value:(src.value==null?'':src.value),auto:!!src.auto};
        }
      });
    });
  }
  return out;
}
function _benchLoadStore(){
  var raw=null;
  try{ raw=JSON.parse(localStorage.getItem(BENCHMARK_LS_KEY)||'null'); }catch(e){}
  if(!raw||typeof raw!=='object') raw={};
  raw.current=_benchMergeShape(raw.current);
  if(!raw.presets||typeof raw.presets!=='object') raw.presets={};
  return raw;
}
function _benchSaveStore(store){
  try{ localStorage.setItem(BENCHMARK_LS_KEY, JSON.stringify(store)); }catch(e){}
}
var _benchmarkStore=null;
function _benchStore(){ if(!_benchmarkStore) _benchmarkStore=_benchLoadStore(); return _benchmarkStore; }

// Compute a single metric from a stored player_scores_v2 row.
function _benchMetricFromScore(fieldKey, s, g){
  if(!s) return null;
  switch(fieldKey){
    case 'kda':           return ((s.kills||0)+(s.assists||0))/Math.max(s.deaths||0,1);
    case 'gpm':           return s.gold_per_min!=null ? s.gold_per_min
                                 : (g&&g.duration_seconds&&s.gold ? s.gold/(g.duration_seconds/60) : null);
    case 'dmg_dealt_pct': return s.dmg_dealt_pct!=null ? s.dmg_dealt_pct : null;
    case 'dmg_taken_pct': return s.dmg_taken_pct!=null ? s.dmg_taken_pct : null;
    case 'kill_contrib':  return s.kill_contribution_pct!=null ? s.kill_contribution_pct
                                 : ((g&&g.team_total_kills) ? ((s.kills||0)+(s.assists||0))/g.team_total_kills*100 : null);
    case 'rating':        return s.in_game_rating!=null ? s.in_game_rating : null;
    case 'min_per_death': return s.min_per_death!=null ? s.min_per_death
                                 : ((g&&g.duration_seconds) ? (g.duration_seconds/60)/Math.max(s.deaths||0,1) : null);
    case 'dmg_per_dmg_taken': return s.dmg_per_dmg_taken!=null ? s.dmg_per_dmg_taken
                                 : ((s.dmg_dealt_raw&&s.dmg_taken_raw) ? s.dmg_dealt_raw/Math.max(s.dmg_taken_raw,1) : null);
  }
  return null;
}
// Compute a metric from a not-yet-saved log entry (LS.scores row + LS.matchInfo).
function _benchMetricFromRaw(fieldKey, raw){
  if(!raw) return null;
  var mi=(typeof LS!=='undefined'&&LS.matchInfo)?LS.matchInfo:{};
  var durMin=mi.duration_seconds?mi.duration_seconds/60:0;
  var teamK=mi.team_total_kills||0;
  switch(fieldKey){
    case 'kda':           return ((raw.kills||0)+(raw.assists||0))/Math.max(raw.deaths||0,1);
    case 'gpm':           return (durMin>0&&raw.gold) ? raw.gold/durMin : null;
    case 'dmg_dealt_pct': return raw.dmgDealtPct!=null ? raw.dmgDealtPct : null;
    case 'dmg_taken_pct': return raw.dmgTakenPct!=null ? raw.dmgTakenPct : null;
    case 'kill_contrib':  return teamK>0 ? ((raw.kills||0)+(raw.assists||0))/teamK*100 : null;
    case 'rating':        return raw.gameRating!=null ? raw.gameRating : null;
    case 'min_per_death': return durMin>0 ? durMin/Math.max(raw.deaths||0,1) : null;
    case 'dmg_per_dmg_taken': return (raw.dmgDealt&&raw.dmgTaken) ? raw.dmgDealt/Math.max(raw.dmgTaken,1) : null;
  }
  return null;
}
// Player's own average for a metric across logged games in that role (needs 3+).
function _benchPlayerAvg(role, fieldKey, playerId){
  if(!playerId) return null;
  var vals=[];
  (_cache.games||[]).forEach(function(g){
    var s=g.playerScores&&g.playerScores[playerId];
    if(!s) return;
    if((s.role||'').toLowerCase()!==role) return;
    var v=_benchMetricFromScore(fieldKey,s,g);
    if(v!=null&&!isNaN(v)) vals.push(v);
  });
  if(vals.length<3) return null;
  return vals.reduce(function(a,b){return a+b;},0)/vals.length;
}
// ── THE single source for benchmark values — swap this out later. ──
// Returns the resolved benchmark number, or null for a "Not set" metric.
function getBenchmark(role, fieldKey, playerId){
  var cell=_benchStore().current[role] && _benchStore().current[role][fieldKey];
  if(!cell) return null;
  var fixed=(cell.value!==''&&cell.value!=null&&!isNaN(parseFloat(cell.value))) ? parseFloat(cell.value) : null;
  if(cell.auto){
    var avg=_benchPlayerAvg(role,fieldKey,playerId);
    if(avg!=null) return avg;
    return fixed; // <3 games — fall back to fixed (null => Not set)
  }
  return fixed; // Auto off — fixed number, or null when blank => Not set
}

function calculateSuggestion(role, pillarIndex, rawStats){
  if(!role||!rawStats) return null;
  role=String(role).toLowerCase();
  var fields=BENCHMARK_FIELDS[role];
  if(!fields||pillarIndex<0||pillarIndex>=fields.length) return null;
  var fieldKey=fields[pillarIndex].k;
  var playerId=rawStats._playerId||rawStats.playerId||rawStats.id||null;
  var benchmark=getBenchmark(role,fieldKey,playerId);
  if(benchmark==null||benchmark<=0) return null; // Not set — skip this metric
  var actual=_benchMetricFromRaw(fieldKey,rawStats);
  if(actual==null||isNaN(actual)) return null;
  return _benchScale(actual,benchmark);
}

// Shared scaler: 5 = at benchmark, linear, clamped + rounded to 1-10.
function _benchScale(actual,benchmark){
  if(actual==null||isNaN(actual)||benchmark==null||benchmark<=0) return null;
  var score=5*(actual/benchmark);
  if(score<1) score=1;
  if(score>10) score=10;
  return Math.round(score);
}

// Benchmark suggestion from a stored player_scores_v2 row (used by the edit-game page).
function calculateSuggestionFromScore(role, pillarIndex, score, game, playerId){
  if(!role||!score) return null;
  role=String(role).toLowerCase();
  var fields=BENCHMARK_FIELDS[role];
  if(!fields||pillarIndex<0||pillarIndex>=fields.length) return null;
  var fieldKey=fields[pillarIndex].k;
  var benchmark=getBenchmark(role,fieldKey,playerId||score._playerId||null);
  if(benchmark==null||benchmark<=0) return null;
  return _benchScale(_benchMetricFromScore(fieldKey,score,game),benchmark);
}

// ── Pillar stat hints — show the stat behind each slider next to its title ──
function _fmtBenchMetric(fieldKey, v){
  if(v==null||isNaN(v)) return null;
  if(fieldKey==='kda'||fieldKey==='dmg_per_dmg_taken'||fieldKey==='min_per_death') return (+v).toFixed(2);
  if(fieldKey==='kill_contrib'||fieldKey==='dmg_dealt_pct'||fieldKey==='dmg_taken_pct') return Math.round(v)+'%';
  if(fieldKey==='rating') return (+v).toFixed(1);
  return Math.round(v); // gpm
}

// "KDA 3.20  ·  benchmark 7" — the stat behind a pillar plus its benchmark score.
function _pillarHint(role, pillarIndex, metricVal, suggestion){
  var fields=BENCHMARK_FIELDS[String(role||'').toLowerCase()];
  if(!fields||pillarIndex<0||pillarIndex>=fields.length) return '';
  var f=fields[pillarIndex];
  var parts=[];
  var fv=_fmtBenchMetric(f.k, metricVal);
  if(fv!=null) parts.push(f.label+' '+fv);
  if(suggestion!=null) parts.push('benchmark '+suggestion);
  return parts.join('  ·  ');
}

// Refresh the live stat hint under each stat-based pillar slider of a log slot.
function _refreshPillarHints(i){
  var roleEl=document.getElementById('lp-role-'+i);
  var role=(roleEl?roleEl.value:'').toLowerCase();
  var pillars=PILLAR_MAP[role]||[];
  if(!pillars.length) return;
  function num(id){ var el=document.getElementById(id); var v=el?parseFloat(el.value):NaN; return isNaN(v)?null:v; }
  var raw={
    kills:num('lp-kills-'+i)||0, deaths:num('lp-deaths-'+i)||0, assists:num('lp-assists-'+i)||0,
    gold:num('lp-gold-'+i), gameRating:num('lp-in_game_rating-'+i),
    dmgDealtPct:num('lp-dmg_dealt_pct-'+i), dmgTakenPct:num('lp-dmg_taken_pct-'+i),
    dmgDealt:num('lp-dmg_dealt_raw-'+i), dmgTaken:num('lp-dmg_taken_raw-'+i),
    _playerId:(document.getElementById('lp-player-'+i)||{}).value||null
  };
  for(var n=0;n<pillars.length;n++){
    var span=document.getElementById('lp-phint'+n+'-'+i);
    if(!span||MANUAL_PILLARS.has(pillars[n])) continue;
    var fk=(BENCHMARK_FIELDS[role]&&BENCHMARK_FIELDS[role][n])?BENCHMARK_FIELDS[role][n].k:null;
    var hint=_pillarHint(role, n, _benchMetricFromRaw(fk, raw), calculateSuggestion(role, n, raw));
    span.textContent = hint || 'Stat-based — drag to override';
  }
}

// === GPM SCORING ENGINE ===

var GPM_ANCHORS = {
  raw: {
    offlane: [[0, 100], [1, 187], [5, 269], [15, 350], [30, 417], [50, 509], [70, 604], [85, 717], [95, 876], [99, 1048], [100, 1211]],
    jungler: [[0, 87], [1, 157], [5, 253], [15, 341], [30, 424], [50, 518], [70, 623], [85, 730], [95, 890], [99, 1028], [100, 1390]],
    midlane: [[0, 199], [1, 467], [5, 601], [15, 733], [30, 829], [50, 955], [70, 1079], [85, 1202], [95, 1375], [99, 1609], [100, 2553]],
    carry:   [[0, 84], [1, 307], [5, 435], [15, 542], [30, 641], [50, 748], [70, 857], [85, 976], [95, 1135], [99, 1302], [100, 1568]],
    support: [[0, 50], [1, 130], [5, 183], [15, 233], [30, 287], [50, 352], [70, 438], [85, 540], [95, 652], [99, 867], [100, 1782]],
  },
  diff: {
    offlane: [[0, -1011], [1, -626], [5, -429], [15, -262], [30, -130], [50, 0], [70, 130], [85, 262], [95, 429], [99, 626], [100, 1011]],
    jungler: [[0, -1117], [1, -681], [5, -484], [15, -288], [30, -147], [50, 0], [70, 147], [85, 288], [95, 484], [99, 681], [100, 1117]],
    midlane: [[0, -1411], [1, -824], [5, -565], [15, -347], [30, -172], [50, 0], [70, 172], [85, 347], [95, 565], [99, 824], [100, 1411]],
    carry:   [[0, -1066], [1, -679], [5, -497], [15, -321], [30, -161], [50, 0], [70, 161], [85, 321], [95, 497], [99, 679], [100, 1066]],
    support: [[0, -1333], [1, -562], [5, -337], [15, -193], [30, -96], [50, 0], [70, 96], [85, 193], [95, 337], [99, 562], [100, 1333]],
  }
};

function getGPMPercentile(gpm, role, type) {
  var table = GPM_ANCHORS[type] && GPM_ANCHORS[type][role.toLowerCase()];
  if (!table) return 50;
  if (gpm <= table[0][1]) return table[0][0];
  if (gpm >= table[table.length - 1][1]) return table[table.length - 1][0];
  for (var i = 1; i < table.length; i++) {
    if (gpm <= table[i][1]) {
      var lo = table[i - 1], hi = table[i];
      var t = (gpm - lo[1]) / (hi[1] - lo[1]);
      return lo[0] + t * (hi[0] - lo[0]);
    }
  }
  return 50;
}

function pctToScore(pct) {
  if (pct <= 1)  return 1;
  if (pct <= 5)  return 2;
  if (pct <= 15) return 3;
  if (pct <= 30) return 4;
  if (pct <= 50) return 5;
  if (pct <= 70) return 6;
  if (pct <= 85) return 7;
  if (pct <= 95) return 8;
  if (pct <= 99) return 9;
  return 10;
}

function calcGPMScore(playerData, durationSeconds) {
  if (!playerData || !playerData.gold || !durationSeconds) return null;
  var role = (playerData.role_played || '').toLowerCase();
  if (!role) return null;
  var durMin = durationSeconds / 60;
  var rawGPM = playerData.gold / durMin;

  var enemyGold = playerData.enemy_gold && playerData.enemy_gold[role];
  var diffGPM = null;
  if (enemyGold) {
    diffGPM = rawGPM - (enemyGold / durMin);
  }

  var rawPct  = getGPMPercentile(rawGPM, role, 'raw');
  var rawScore = pctToScore(rawPct);

  var diffPct  = null;
  var diffScore = null;
  if (diffGPM !== null) {
    diffPct  = getGPMPercentile(diffGPM, role, 'diff');
    diffScore = pctToScore(diffPct);
  }

  var finalRaw = diffScore !== null ? (rawScore + diffScore) / 2 : rawScore;
  var finalScore = Math.round(finalRaw * 2) / 2;

  return {
    rawGPM:    Math.round(rawGPM),
    diffGPM:   diffGPM !== null ? Math.round(diffGPM) : null,
    rawPct:    Math.round(rawPct),
    diffPct:   diffPct  !== null ? Math.round(diffPct)  : null,
    rawScore:  rawScore,
    diffScore: diffScore,
    finalScore: finalScore,
  };
}

function _gpmPillarIndex(role) {
  var fields = BENCHMARK_FIELDS[role.toLowerCase()];
  if (!fields) return -1;
  for (var i = 0; i < Math.min(fields.length, 4); i++) {
    if (fields[i].k === 'gpm') return i;
  }
  return -1;
}

function _gpmScoreColor(s) {
  if (s >= 7) return '#44ff88';
  if (s >= 5) return '#ffcc44';
  return '#ff4444';
}

function _gpmOrdinal(n) {
  n = Math.round(n);
  var v = n % 100;
  var sfx = ['th','st','nd','rd'];
  return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]);
}

function updateGPMStrip(slotIdx) {
  var el = document.getElementById('lp-gpm-strip-' + slotIdx);
  if (!el) return;

  var gold   = parseFloat(document.getElementById('lp-gold-' + slotIdx) && document.getElementById('lp-gold-' + slotIdx).value) || 0;
  var role   = (document.getElementById('lp-role-' + slotIdx) ? document.getElementById('lp-role-' + slotIdx).value : '').toLowerCase();
  var durSec = LS.matchInfo && LS.matchInfo.duration_seconds;

  if (!gold || !durSec || !role) {
    el.innerHTML = '<div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:3px;padding:8px 12px;margin-bottom:10px;font-family:\'DM Mono\',monospace;font-size:9px;color:#555;">[ GPM ANALYSIS ]  Enter gold &amp; duration above</div>';
    return;
  }

  var oppRow   = LS.enemyRoles ? LS.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
  var enemyGold = oppRow ? (oppRow.gold || null) : null;
  var pData = { gold: gold, role_played: role, enemy_gold: enemyGold ? {} : null };
  if (enemyGold) pData.enemy_gold[role] = enemyGold;

  var r = calcGPMScore(pData, durSec);
  if (!r) {
    el.innerHTML = '<div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:3px;padding:8px 12px;margin-bottom:10px;font-family:\'DM Mono\',monospace;font-size:9px;color:#555;">[ GPM ANALYSIS ]  —</div>';
    return;
  }

  var diffStr = r.diffGPM !== null ? ((r.diffGPM >= 0 ? '+' : '') + r.diffGPM + ' g/min') : '—';
  var diffPctStr  = r.diffPct  !== null ? _gpmOrdinal(r.diffPct) + ' pct' : '—';
  var diffScoreStr = r.diffScore !== null ? '→ ' + r.diffScore + '/10' : '—';

  el.innerHTML =
    '<div style="background:#1e1e1e;border:1px solid #2a2a2a;border-radius:3px;padding:9px 12px;margin-bottom:10px;font-family:\'DM Mono\',monospace;">' +
      '<div style="font-size:9px;letter-spacing:2px;color:#888;margin-bottom:7px;">[ GPM ANALYSIS ]</div>' +
      '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:9px;">' +
        '<span style="color:#888;width:68px;flex-shrink:0;">Raw GPM</span>' +
        '<span style="color:#f4f4f0;flex:1;">' + r.rawGPM + ' g/min</span>' +
        '<span style="color:#888;margin-right:8px;">' + _gpmOrdinal(r.rawPct) + ' pct</span>' +
        '<span style="font-weight:600;color:' + _gpmScoreColor(r.rawScore) + ';">→ ' + r.rawScore + '/10</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:4px;margin-bottom:7px;font-size:9px;">' +
        '<span style="color:#888;width:68px;flex-shrink:0;">Diff GPM</span>' +
        '<span style="color:#f4f4f0;flex:1;">' + diffStr + '</span>' +
        '<span style="color:#888;margin-right:8px;">' + diffPctStr + '</span>' +
        '<span style="font-weight:600;color:' + (r.diffScore !== null ? _gpmScoreColor(r.diffScore) : '#555') + ';">' + diffScoreStr + '</span>' +
      '</div>' +
      '<div style="border-top:1px solid #2a2a2a;padding-top:5px;text-align:right;font-size:9px;">' +
        '<span style="color:#888;">Gold score: </span>' +
        '<span style="font-weight:600;font-size:11px;color:' + _gpmScoreColor(r.finalScore) + ';">' + r.finalScore + '</span>' +
      '</div>' +
    '</div>';
}

function autoScorePlayer(slotIdx) {
  var role      = (document.getElementById('lp-role-' + slotIdx) ? document.getElementById('lp-role-' + slotIdx).value : '').toLowerCase();
  var gold      = parseFloat(document.getElementById('lp-gold-' + slotIdx) && document.getElementById('lp-gold-' + slotIdx).value) || 0;
  var kills     = parseFloat(document.getElementById('lp-kills-' + slotIdx) && document.getElementById('lp-kills-' + slotIdx).value) || 0;
  var deaths    = parseFloat(document.getElementById('lp-deaths-' + slotIdx) && document.getElementById('lp-deaths-' + slotIdx).value) || 0;
  var assists   = parseFloat(document.getElementById('lp-assists-' + slotIdx) && document.getElementById('lp-assists-' + slotIdx).value) || 0;
  var durSec    = LS.matchInfo && LS.matchInfo.duration_seconds;
  var playerId  = document.getElementById('lp-player-' + slotIdx) ? document.getElementById('lp-player-' + slotIdx).value : null;

  function _num(id){ var e=document.getElementById(id); var v=e?parseFloat(e.value):NaN; return isNaN(v)?null:v; }
  var rawStats = {
    kills: kills, deaths: deaths, assists: assists,
    gold: gold || null,
    gameRating:   _num('lp-in_game_rating-' + slotIdx),
    dmgDealtPct:  _num('lp-dmg_dealt_pct-' + slotIdx),
    dmgTakenPct:  _num('lp-dmg_taken_pct-' + slotIdx),
    dmgDealt:     _num('lp-dmg_dealt_raw-' + slotIdx),
    dmgTaken:     _num('lp-dmg_taken_raw-' + slotIdx),
    _playerId: playerId
  };

  var gpmIdx = _gpmPillarIndex(role);
  var oppRow = LS.enemyRoles ? LS.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
  var enemyGold = oppRow ? (oppRow.gold || null) : null;
  var gpmResult = null;
  if (gpmIdx >= 0 && gold && durSec) {
    var pData = { gold: gold, role_played: role, enemy_gold: enemyGold ? {} : null };
    if (enemyGold) pData.enemy_gold[role] = enemyGold;
    gpmResult = calcGPMScore(pData, durSec);
  }

  var pillars = PILLAR_MAP[role] || [];
  for (var n = 0; n < pillars.length; n++) {
    var sug = (n === gpmIdx && gpmResult) ? gpmResult.finalScore : calculateSuggestion(role, n, rawStats);
    if (sug == null) continue;
    var slEl = document.getElementById('lp-p' + n + '-' + slotIdx);
    var dpEl = document.getElementById('lp-pv' + n + '-' + slotIdx);
    if (slEl) slEl.value = sug;
    if (dpEl) dpEl.textContent = Math.round(sug);
  }

  var btn = document.getElementById('lp-autoscore-btn-' + slotIdx);
  if (btn) {
    var orig = btn.innerHTML;
    var origColor = btn.style.color;
    btn.innerHTML = '✓ Scored';
    btn.style.color = '#44ff88';
    setTimeout(function(){ btn.innerHTML = orig; btn.style.color = origColor; }, 1500);
  }
}

function autoScoreAll() {
  for (var i = 0; i < 5; i++) { autoScorePlayer(i); }
  var btn = document.getElementById('autoscore-all-btn');
  if (btn) {
    var orig = btn.innerHTML;
    var origColor = btn.style.color;
    btn.innerHTML = '✓ All Scored';
    btn.style.color = '#44ff88';
    setTimeout(function(){ btn.innerHTML = orig; btn.style.color = origColor; }, 1500);
  }
}

// === END GPM SCORING ENGINE ===

function _dbErr(err, table){
  var msg = (err && err.message) || String(err);
  if(msg.toLowerCase().indexOf('row-level security') !== -1 || (err && (err.code === '42501' || err.status === 401 || err.status === 403))){
    showToast('Permission denied on '+table+' — run supabase-setup.sql in Supabase dashboard');
  } else {
    showToast('DB error ('+table+'): '+msg);
  }
}

// Reject after `ms` so a stalled network request can't hang the UI forever.
function _withTimeout(promise, ms, label){
  return Promise.race([
    Promise.resolve(promise),
    new Promise(function(_, reject){
      setTimeout(function(){
        reject(new Error((label||'Request')+' timed out — check your connection and try again'));
      }, ms);
    })
  ]);
}

async function saveGame(){
  var btn = document.getElementById('save-game-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }

  var _restoreBtn = function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Save Game'; }
  };

  try{
    var result = LS.matchInfo.result;
    var date   = LS.matchInfo.date;
    if(!result){ showToast('Result is required'); _restoreBtn(); return; }
    if(!date){   showToast('Match date is required'); _restoreBtn(); return; }

    // Soft warning — no block
    if(!LS.matchInfo.duration_seconds && !LS.matchInfo.team_total_kills){
      showToast('Tip: duration or kills not set — saving anyway');
    }

    // MVP from the Step-0 search box (the scan autofills it; the coach can override).
    var _mvpPid = null;
    var _mvpVal = (document.getElementById('log-mvp')?.value || '').trim().toLowerCase();
    if(_mvpVal){
      var _mvpP = (PLAYERS||[]).find(function(p){
        return (p.nick && p.nick.toLowerCase()===_mvpVal) || (p.ign && p.ign.toLowerCase()===_mvpVal);
      });
      if(_mvpP) _mvpPid = _mvpP.id;
    }

    // The Step-0 "Game Name" box drives both the game name and opponent label.
    var _gameName = LS.matchInfo.opponent || null;

    // Build games_v2 row
    var gameRow = {
      match_date:        LS.matchInfo.date,
      mvp_player_id:     _mvpPid,
      result:            LS.matchInfo.result === 'Win' ? 'win' : 'loss',
      game_type:         (LS.matchInfo.type || 'Scrim').toLowerCase(),
      game_name:         _gameName,
      game_num:          LS._gameNum || 1,
      opponent_name:     _gameName,
      duration_seconds:  LS.matchInfo.duration_seconds || null,
      ended_at:          LS.matchInfo.endedAt || null,
      team_total_kills:  LS.matchInfo.team_total_kills  || null,
      enemy_total_kills: LS.matchInfo.enemy_total_kills || null,
      vod_url:           LS.matchInfo.vod_url  || null,
      notes:             LS.matchInfo.notes    || null,
      enemy_roles: LS.enemyRoles
        ? Object.fromEntries(LS.enemyRoles.filter(function(e){ return e.role; }).map(function(e){ return [e.role.toLowerCase(), e.hero]; }))
        : null,
      enemy_gold: LS.enemyRoles
        ? Object.fromEntries(LS.enemyRoles.filter(function(e){ return e.role && e.gold != null; }).map(function(e){ return [e.role.toLowerCase(), e.gold]; }))
        : null,
      team_total_gold:  null,
      enemy_total_gold: LS.enemyRoles
        ? LS.enemyRoles.reduce(function(s,e){ return s+(e.gold||0); }, 0) || null
        : null,
    };

    // Per-player data
    var playerRows = [];
    var teamTotalGold = 0;
    var durMin = (LS.matchInfo.duration_seconds || 0) / 60;

    for(var i = 0; i < 5; i++){
      var pid          = document.getElementById('lp-player-'+i)?.value || null;
      var hero         = (document.getElementById('lp-hero-'+i)?.value||'').trim() || null;
      var role         = (document.getElementById('lp-role-'+i)?.value||'').toLowerCase();
      var kills        = parseFloat(document.getElementById('lp-kills-'+i)?.value)        || 0;
      var deaths       = parseFloat(document.getElementById('lp-deaths-'+i)?.value)       || 0;
      var assists      = parseFloat(document.getElementById('lp-assists-'+i)?.value)      || 0;
      var gold         = parseFloat(document.getElementById('lp-gold-'+i)?.value)         || 0;
      var rating       = parseFloat(document.getElementById('lp-in_game_rating-'+i)?.value) || null;
      var dmgDealtPct  = parseFloat(document.getElementById('lp-dmg_dealt_pct-'+i)?.value)  || null;
      var dmgTakenPct  = parseFloat(document.getElementById('lp-dmg_taken_pct-'+i)?.value)  || null;
      var dmgDealtRaw  = parseFloat(document.getElementById('lp-dmg_dealt_raw-'+i)?.value)  || null;
      var dmgTakenRaw  = parseFloat(document.getElementById('lp-dmg_taken_raw-'+i)?.value)  || null;
      var note         = (document.getElementById('lp-note-'+i)?.value||'').trim() || null;
      var p1           = parseFloat(document.getElementById('lp-p0-'+i)?.value) || null;
      var p2           = parseFloat(document.getElementById('lp-p1-'+i)?.value) || null;
      var p3           = parseFloat(document.getElementById('lp-p2-'+i)?.value) || null;
      var p4           = parseFloat(document.getElementById('lp-p3-'+i)?.value) || null;

      teamTotalGold += gold || 0;

      var kda            = (kills + assists) / Math.max(deaths, 1);
      var goldPerMin     = durMin > 0 ? gold / durMin : null;
      var minPerDeath    = durMin > 0 ? durMin / Math.max(deaths, 1) : null;
      var killContribPct = (kills + assists) / Math.max(LS.matchInfo.team_total_kills || 1, 1) * 100;
      var dmgRatio       = (dmgDealtRaw && dmgTakenRaw) ? dmgDealtRaw / Math.max(dmgTakenRaw, 1) : null;
      var oppRole        = LS.enemyRoles ? LS.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
      var oppGold        = oppRole ? (oppRole.gold || null) : null;
      var oppGoldPerMin  = (oppGold && durMin > 0) ? oppGold / durMin : null;

      playerRows.push({
        game_id:               null,
        player_id:             pid  || null,
        hero_name:             hero || null,
        role_played:           role || null,
        kills:                 kills,
        deaths:                deaths,
        assists:               assists,
        gold:                  gold  || null,
        in_game_rating:        rating,
        dmg_dealt_pct:         dmgDealtPct,
        dmg_taken_pct:         dmgTakenPct,
        dmg_dealt_raw:         dmgDealtRaw,
        dmg_taken_raw:         dmgTakenRaw,
        pillar_1_score:        p1,
        pillar_2_score:        p2,
        pillar_3_score:        p3,
        pillar_4_score:        p4,
        pillar_1_auto:         null,
        pillar_2_auto:         null,
        pillar_3_auto:         null,
        pillar_4_auto:         null,
        coach_note:            note,
        kda:                   kda,
        gold_per_min:          goldPerMin,
        min_per_death:         minPerDeath,
        kill_contribution_pct: killContribPct,
        dmg_per_dmg_taken:     dmgRatio,
        opp_gold:              oppGold,
        opp_gold_per_min:      oppGoldPerMin,
      });
    }

    gameRow.team_total_gold = teamTotalGold || null;

    // Build enemy_picks rows
    var enemyRows = [];
    if(LS.enemyRoles && LS.enemyRoles.length){
      LS.enemyRoles.forEach(function(e){
        enemyRows.push({
          game_id:   null,
          hero_name: e.hero || null,
          role:      e.role ? e.role.toLowerCase() : null,
          gold:      e.gold || null,
        });
      });
    }

    // 1. Insert game row
    var gRes = await _withTimeout(sb.from('games_v2').insert(gameRow).select('id').single(), 25000, 'Saving the game');
    if(gRes.error){ _dbErr(gRes.error, 'games_v2'); _restoreBtn(); return; }
    var gameId = gRes.data.id;

    // Attach game_id to child rows
    playerRows.forEach(function(r){ r.game_id = gameId; });
    enemyRows.forEach(function(r){  r.game_id = gameId; });

    // 2. Parallel child inserts — check both for errors
    var results = await _withTimeout(Promise.all([
      sb.from('player_scores_v2').insert(playerRows),
      enemyRows.length ? sb.from('enemy_picks').insert(enemyRows) : Promise.resolve({error:null}),
    ]), 25000, 'Saving player scores');
    var pErr = results[0] && results[0].error;
    var eErr = results[1] && results[1].error;
    if(pErr){ _dbErr(pErr, 'player_scores_v2'); _restoreBtn(); return; }
    if(eErr){ _dbErr(eErr, 'enemy_picks'); }

    // Update local cache so hero page reflects the save immediately
    (function(){
      var newPS={};
      playerRows.forEach(function(r){
        if(!r.player_id)return;
        newPS[r.player_id]={
          hero:r.hero_name||null,role:r.role_played||null,
          kills:r.kills||0,deaths:r.deaths||0,assists:r.assists||0,
          gold:r.gold||null,gold_per_min:r.gold_per_min||null,in_game_rating:r.in_game_rating||null,
          dmg_dealt_pct:r.dmg_dealt_pct||null,dmg_taken_pct:r.dmg_taken_pct||null,
          dmg_dealt_raw:r.dmg_dealt_raw||null,dmg_taken_raw:r.dmg_taken_raw||null,
          kda:r.kda||null,min_per_death:r.min_per_death||null,
          kill_contribution_pct:r.kill_contribution_pct||null,dmg_per_dmg_taken:r.dmg_per_dmg_taken||null,
          opp_gold:r.opp_gold||null,opp_gold_per_min:r.opp_gold_per_min||null,
          pillar_scores:{p0:r.pillar_1_score||null,p1:r.pillar_2_score||null,p2:r.pillar_3_score||null,p3:r.pillar_4_score||null},
          comment:r.coach_note||null,
        };
      });
      _cache.games.unshift({
        id:gameId,date:LS.matchInfo.date,
        type:LS.matchInfo.type||'Scrim',gameNum:LS._gameNum||1,gameName:_gameName||'',
        result:LS.matchInfo.result,opponent:_gameName||'',
        oppTier:'',notes:LS.matchInfo.notes||'',playerScores:newPS,
        duration_seconds:LS.matchInfo.duration_seconds||null,
        team_total_kills:LS.matchInfo.team_total_kills||null,
        enemy_total_kills:LS.matchInfo.enemy_total_kills||null,
        enemyPicks:enemyRows.map(function(e){return {hero:e.hero_name,role:e.role,gold:e.gold};}),
        matchMentality:{},matchId:LS._matchId||null,mvpPlayerId:_mvpPid,savedAt:new Date().toISOString(),
      });
    })();

    // If launched from a match, link the game now
    var _returnMatchId = LS._matchId||null;
    if(_returnMatchId){
      try{ await _withTimeout(sbAssignGameToMatch(gameId, _returnMatchId), 25000, 'Linking to match'); }catch(e){ console.warn('match link failed',e); }
    }

    showToast('✓ Game saved');
    _restoreBtn();
    resetLog();
    if(_returnMatchId) showMatchDetail(_returnMatchId);

  }catch(err){
    console.error('saveGame error', err);
    showToast('Save error: '+(err.message||String(err)));
    _restoreBtn();
  }
}

function resetLog(){
  LS.matchInfo = {};
  LS.scores    = {};
  LS.enemyRoles = null;
  LS.scanEnemy = null;
  LS._pendingOppTeam = null;
  LS._step = 0;
  showPage('page-home');
}

// ══════════════════════════════════════════
// STUB FUNCTIONS (placeholders for pages not yet rebuilt)
// ══════════════════════════════════════════
function initTiers(){
  var meta=document.getElementById('tier-meta-section');
  var mastery=document.getElementById('tier-mastery-section');
  var history=document.getElementById('tier-history-section');
  var tMeta=document.getElementById('tmode-meta');
  var tMastery=document.getElementById('tmode-mastery');
  var tHistory=document.getElementById('tmode-history');
  if(!meta)return;
  // Default to meta mode if nothing active
  var active=document.querySelector('.tier-mode-btn.active[id^="tmode-"]');
  if(!active){if(tMeta)tMeta.classList.add('active');meta.style.display='';if(mastery)mastery.style.display='none';if(history)history.style.display='none';}
  renderMetaTiers();
}
function setTierMode(mode){
  ['meta','mastery','history'].forEach(function(m){
    var btn=document.getElementById('tmode-'+m);
    var sec=document.getElementById('tier-'+m+'-section');
    if(btn)btn.classList.toggle('active',m===mode);
    if(sec)sec.style.display=m===mode?'':'none';
  });
  if(mode==='meta')renderMetaTiers();
  else if(mode==='mastery')renderMasteryTiers();
  else renderPatchHistory();
}
function renderMetaTiers(){
  var data=loadData();
  var metaTiers=data.metaTiers||{};
  var role=window._metaRole||GAME_ROLES[0];
  var roles=GAME_ROLES;
  document.getElementById('meta-role-tabs').innerHTML=roles.map(function(r){
    return '<button class="tier-role-tab'+(r===role?' active':'')+'" onclick="setMetaRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  var byTier={};
  META_LEVELS.forEach(function(l){byTier[l.key]=[];});
  var unplaced=[];
  var allH=getLiveHeroes().concat(_cache.customHeroes||[]);
  allH.filter(function(h){return h.roles.includes(role);}).forEach(function(h){
    var t=metaTiers[h.name]&&metaTiers[h.name][role];
    if(t&&byTier[t])byTier[t].push(h.name);
    else unplaced.push(h.name);
  });
  var bandsEl=document.getElementById('meta-tier-bands');
  if(bandsEl)bandsEl.innerHTML=META_LEVELS.map(function(l){
    var chips=(byTier[l.key]||[]).map(function(name){
      return '<div class="tier-hero-chip placed" onclick="openTierAssign(\''+_encHero(name)+'\',\''+role+'\',\'meta\')">'+
        heroPortraitHtml(name,22,false)+
        '<span>'+name+'</span>'+
        '<button class="chip-edit" onclick="event.stopPropagation();openHeroEditModal(decodeURIComponent(\''+_encHero(name)+'\'))">✎</button>'+
      '</div>';
    }).join('');
    return '<div class="tier-band"><div class="tier-band-header"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span class="tier-band-desc">'+l.desc+'</span></div><div class="tier-hero-grid">'+chips+'</div></div>';
  }).join('');
  var upEl=document.getElementById('meta-unplaced');
  if(upEl)upEl.innerHTML=unplaced.map(function(name){
    return '<div class="tier-hero-chip" onclick="openTierAssign(\''+_encHero(name)+'\',\''+role+'\',\'meta\')">'+heroPortraitHtml(name,22,false)+'<span>'+name+'</span></div>';
  }).join('');
  var pn=document.getElementById('patch-name-display');
  if(pn)pn.textContent=(_cache.patches&&_cache.patches.length?_cache.patches[_cache.patches.length-1].name:'Current');
}
function setMetaRole(r){window._metaRole=r;renderMetaTiers();}
function renderMasteryTiers(){
  PLAYERS=getPlayers();
  var pid=window._masteryPlayer||(PLAYERS[0]&&PLAYERS[0].id)||null;
  window._masteryPlayer=pid;
  var masteryRole=window._masteryRole||GAME_ROLES[0];
  var selEl=document.getElementById('mastery-player-selector');
  if(selEl)selEl.innerHTML=PLAYERS.filter(function(p){return p.active;}).map(function(p){
    return '<button class="player-chip'+(p.id===pid?' active':'')+'" onclick="setMasteryPlayer(\''+p.id+'\')">'+p.nick+'</button>';
  }).join('');
  document.getElementById('mastery-role-tabs').innerHTML=GAME_ROLES.map(function(r){
    return '<button class="tier-role-tab'+(r===masteryRole?' active':'')+'" onclick="setMasteryRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  var data=loadData();
  var masteryTiers=(data.masteryTiers||{})[pid]||{};
  var metaTiers=data.metaTiers||{};
  var allH=getLiveHeroes().concat(_cache.customHeroes||[]);
  var roleH=allH.filter(function(h){return h.roles.includes(masteryRole);});
  var byTier={};MASTERY_LEVELS.forEach(function(l){byTier[l.key]=[];});var unplaced=[];
  roleH.forEach(function(h){var t=masteryTiers[h.name];if(t&&byTier[t])byTier[t].push(h.name);else unplaced.push(h.name);});
  var sa=document.getElementById('mastery-score-area');
  if(sa&&pid){var hp=calcHeroPoolScore(pid);sa.innerHTML='<div class="hp-score-card"><div class="hp-score-big">'+hp.pct+'%</div><div class="hp-score-sub">HERO POOL SCORE — '+masteryRole.toUpperCase()+'</div></div>';}
  var bandsEl=document.getElementById('mastery-tier-bands');
  if(bandsEl)bandsEl.innerHTML=MASTERY_LEVELS.map(function(l){
    var chips=(byTier[l.key]||[]).map(function(name){
      var mt=metaTiers[name]&&metaTiers[name][masteryRole];
      return '<div class="tier-hero-chip placed" onclick="openTierAssign(\''+_encHero(name)+'\',\''+masteryRole+'\',\'mastery\')">'+
        heroPortraitHtml(name,22,false)+
        (mt?'<span class="chip-class">'+mt+'</span>':'')+
        '<span>'+name+'</span>'+
      '</div>';
    }).join('');
    return '<div class="tier-band"><div class="tier-band-header"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span class="tier-band-desc">'+l.desc+'</span></div><div class="tier-hero-grid">'+chips+'</div></div>';
  }).join('');
  var upEl=document.getElementById('mastery-unplaced');
  if(upEl)upEl.innerHTML=unplaced.map(function(name){
    return '<div class="tier-hero-chip" onclick="openTierAssign(\''+_encHero(name)+'\',\''+masteryRole+'\',\'mastery\')">'+heroPortraitHtml(name,22,false)+'<span>'+name+'</span></div>';
  }).join('');
}
function setMasteryPlayer(pid){window._masteryPlayer=pid;renderMasteryTiers();}
function setMasteryRole(r){window._masteryRole=r;renderMasteryTiers();}
function renderPatchHistory(){
  var patches=(_cache.patches||[]).slice().reverse();
  var el=document.getElementById('patch-history-list');
  if(!el)return;
  if(!patches.length){el.innerHTML='<div class="empty"><div class="empty-text">No patches saved yet</div></div>';return;}
  el.innerHTML=patches.map(function(p){
    return '<div class="patch-history-row"><div style="flex:1;"><div style="font-size:13px;font-weight:600;">'+p.name+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+new Date(p.savedAt).toLocaleDateString('en-GB')+'</div></div></div>';
  }).join('');
}
// Encode a hero name for use inside an inline onclick string. encodeURIComponent
// leaves apostrophes intact, which breaks the JS string for heroes like Y'bneth.
function _encHero(n){ return encodeURIComponent(n).replace(/'/g,'%27'); }

function openTierAssign(encodedName,role,mode){
  var heroName=decodeURIComponent(encodedName);
  var data=loadData();
  var levels=mode==='meta'?META_LEVELS:MASTERY_LEVELS;
  var current=mode==='meta'?(data.metaTiers[heroName]&&data.metaTiers[heroName][role]):((data.masteryTiers[window._masteryPlayer]||{})[heroName]);
  document.getElementById('tier-assign-title').textContent=(mode==='meta'?'META TIER':'MASTERY TIER')+' · '+heroName;
  document.getElementById('tier-assign-body').innerHTML=
    '<div style="margin-bottom:16px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+role.toUpperCase()+'</div>'+
    levels.map(function(l){return '<button class="btn btn-full'+(current===l.key?' btn-primary':'')+' mb-0" style="margin-bottom:8px;justify-content:space-between;" onclick="assignTier(\''+encodedName+'\',\''+role+'\',\''+l.key+'\',\''+mode+'\')"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+l.desc+'</span></button>';}).join('')+
    '<button class="btn btn-full btn-danger btn-sm" style="margin-top:8px;" onclick="assignTier(\''+encodedName+'\',\''+role+'\',null,\''+mode+'\')">Remove Tier</button>';
  document.getElementById('tier-assign-modal').classList.add('open');
}
async function assignTier(encodedName,role,tier,mode){
  var heroName=decodeURIComponent(encodedName);
  var data=loadData();
  if(mode==='meta'){
    if(!data.metaTiers[heroName])data.metaTiers[heroName]={};
    if(tier)data.metaTiers[heroName][role]=tier;
    else delete data.metaTiers[heroName][role];
    _cache.metaTiers=data.metaTiers;
    await sbSaveMetaTier(heroName,role,tier);
  } else {
    var pid=window._masteryPlayer;
    if(!data.masteryTiers[pid])data.masteryTiers[pid]={};
    if(tier)data.masteryTiers[pid][heroName]=tier;
    else delete data.masteryTiers[pid][heroName];
    _cache.masteryTiers=data.masteryTiers;
    await sbSaveMasteryTier(pid,heroName,tier);
  }
  closeModal('tier-assign-modal');
  mode==='meta'?renderMetaTiers():renderMasteryTiers();
}
function openPatchModal(){document.getElementById('patch-modal').classList.add('open');}
async function savePatch(){
  var name=(document.getElementById('patch-input')?.value||'').trim();
  if(!name){showToast('Enter a patch name');return;}
  var data=loadData();
  var p={name:name,savedAt:new Date().toISOString(),metaTiers:JSON.parse(JSON.stringify(data.metaTiers))};
  _cache.patches.push(p);
  await sbSavePatch(p);
  closeModal('patch-modal');
  showToast('Patch "'+name+'" saved');
}
function renderCompare(){
  PLAYERS=getPlayers();
  var aEl=document.getElementById('cmp-a');var bEl=document.getElementById('cmp-b');
  if(!aEl||!bEl)return;
  var opts=PLAYERS.map(function(p){return '<option value="'+p.id+'">'+p.nick+' ('+p.role+')</option>';}).join('');
  if(!aEl.innerHTML)aEl.innerHTML=opts;
  if(!bEl.innerHTML){bEl.innerHTML=opts;if(PLAYERS.length>1)bEl.selectedIndex=1;}
  var aId=aEl.value,bId=bEl.value;
  var pA=PLAYERS.find(function(p){return p.id===aId;}),pB=PLAYERS.find(function(p){return p.id===bId;});
  var data=loadData();
  var cc=document.getElementById('compare-content');if(!cc)return;
  if(!pA||!pB){cc.innerHTML='<div class="empty"><div class="empty-icon">⚖️</div><div class="empty-text">Select two players</div></div>';return;}

  var COL_A='rgba(100,180,255,1)',COL_B='rgba(80,220,140,1)';
  var roleA=(pA.role||'').toLowerCase(),roleB=(pB.role||'').toLowerCase();
  var pillarsA=PILLAR_MAP[roleA]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var pillarsB=PILLAR_MAP[roleB]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];

  // Game lists backed by player_scores_v2 (skip un-scored / skipped entries)
  function pGames(pid){return (data.games||[]).filter(function(g){var s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});}
  var gamesA=pGames(aId),gamesB=pGames(bId);
  function avgPillar(pid,gs,idx){
    var vals=gs.map(function(g){var ps=g.playerScores[pid].pillar_scores;return ps?ps['p'+idx]:null;}).filter(function(v){return v!=null&&v>0;});
    return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
  }
  var stA=getPlayerStats(aId,data.games),stB=getPlayerStats(bId,data.games);

  // ── Player header (compare UI shell from old site) ──
  function avHtml(p,pfp,bc){
    if(pfp)return '<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:1px solid '+bc+';flex-shrink:0;"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>';
    return '<div style="width:36px;height:36px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:15px;color:var(--grey-6);border:1px solid '+bc+';">'+p.nick[0]+'</div>';
  }
  var pfpA=data.pfp&&data.pfp[aId],pfpB=data.pfp&&data.pfp[bId];
  var header='<div style="display:flex;gap:16px;justify-content:center;align-items:center;padding:14px 20px 4px;">'+
    '<div style="display:flex;align-items:center;gap:8px;">'+avHtml(pA,pfpA,COL_A)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+COL_A+';">'+pA.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pA.role||'')+'</div></div></div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">VS</div>'+
    '<div style="display:flex;align-items:center;gap:8px;">'+avHtml(pB,pfpB,COL_B)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+COL_B+';">'+pB.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pB.role||'')+'</div></div></div>'+
  '</div>';

  // ── GRADED STATS — horizontal bar chart, each player keeps their own role labels ──
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
      barRow(la,va,COL_A)+
      barRow(lb,vb,COL_B)+
    '</div>';
  }
  var graded='<div class="section-label" style="padding:16px 20px 8px;">Graded Performance <span style="color:var(--grey-4);">· avg of logged games</span></div>';
  graded+=aspectBlock('30-Day Overall', pA.nick, stA.monthAvg, pB.nick, stB.monthAvg);
  [0,1,2,3].forEach(function(i){
    graded+=aspectBlock('Aspect '+(i+1),
      pillarsA[i]||('Pillar '+(i+1)), avgPillar(aId,gamesA,i),
      pillarsB[i]||('Pillar '+(i+1)), avgPillar(bId,gamesB,i));
  });

  // ── RAW STATS — separate window at the bottom ──
  function rawAgg(pid,gs){
    var r={g:gs.length,k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0};
    gs.forEach(function(g){var s=g.playerScores[pid];
      r.k+=s.kills||0;r.d+=s.deaths||0;r.a+=s.assists||0;
      if(s.gold_per_min!=null){r.gpmS+=s.gold_per_min;r.gpmN++;}
      if(s.in_game_rating!=null){r.rS+=s.in_game_rating;r.rN++;}
      if(s.dmg_dealt_pct!=null){r.ddS+=s.dmg_dealt_pct;r.ddN++;}
      if(s.dmg_taken_pct!=null){r.dtS+=s.dmg_taken_pct;r.dtN++;}
    });
    r.kda=r.g?((r.k+r.a)/Math.max(r.d,1)):null;
    r.gpm=r.gpmN?r.gpmS/r.gpmN:null;
    r.rating=r.rN?r.rS/r.rN:null;
    r.dd=r.ddN?r.ddS/r.ddN:null;
    r.dt=r.dtN?r.dtS/r.dtN:null;
    return r;
  }
  var rA=rawAgg(aId,gamesA),rB=rawAgg(bId,gamesB);
  function rawRow(lbl,a,b,aN,bN){
    var hi=aN!=null&&bN!=null;
    var aWin=hi&&aN>bN,bWin=hi&&bN>aN;
    return '<div class="compare-table-row">'+
      '<div class="compare-table-cell">'+lbl+'</div>'+
      '<div class="compare-table-cell mono '+(aWin?'compare-winner':bWin?'compare-loser':'')+'">'+a+'</div>'+
      '<div class="compare-table-cell mono '+(bWin?'compare-winner':aWin?'compare-loser':'')+'">'+b+'</div>'+
    '</div>';
  }
  function f1(v){return v!=null?v.toFixed(1):'--';}
  var rawWin='<div class="section-label" style="padding:18px 20px 8px;">Raw Stats <span style="color:var(--grey-4);">· informational · not scored</span></div>'+
    '<div class="compare-table">'+
      '<div class="compare-table-row compare-table-header"><div class="compare-table-cell header-cell">Metric</div><div class="compare-table-cell header-cell" style="color:'+COL_A+';">'+pA.nick+'</div><div class="compare-table-cell header-cell" style="color:'+COL_B+';">'+pB.nick+'</div></div>'+
      rawRow('Games', rA.g, rB.g, rA.g, rB.g)+
      rawRow('KDA', f1(rA.kda), f1(rB.kda), rA.kda, rB.kda)+
      rawRow('Gold / Min', rA.gpm!=null?Math.round(rA.gpm):'--', rB.gpm!=null?Math.round(rB.gpm):'--', rA.gpm, rB.gpm)+
      rawRow('Avg Rating', f1(rA.rating), f1(rB.rating), rA.rating, rB.rating)+
      rawRow('Dmg Dealt %', rA.dd!=null?rA.dd.toFixed(1)+'%':'--', rB.dd!=null?rB.dd.toFixed(1)+'%':'--', rA.dd, rB.dd)+
      rawRow('Dmg Taken %', rA.dt!=null?rA.dt.toFixed(1)+'%':'--', rB.dt!=null?rB.dt.toFixed(1)+'%':'--', rA.dt, rB.dt)+
    '</div>';

  cc.innerHTML=header+graded+rawWin+'<div style="height:24px;"></div>';
}
function openCreateMatchModal(){
  var d=new Date();
  var inp=document.getElementById('cm-date');
  if(inp)inp.value=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  document.getElementById('cm-name').value='';
  document.getElementById('cm-notes').value='';
  document.getElementById('create-match-modal').classList.add('open');
}
async function saveCreateMatch(){
  var name=(document.getElementById('cm-name')?.value||'').trim();
  var date=(document.getElementById('cm-date')?.value||'').trim();
  var type=document.getElementById('cm-type')?.value||'Scrim';
  var oppTier=document.getElementById('cm-opp-tier')?.value||'';
  var notes=(document.getElementById('cm-notes')?.value||'').trim();
  if(!name){showToast('Match name is required');return;}
  var id=crypto.randomUUID();
  var matchObj={id,name,date,type,oppTier,notes,mentality:{},tournamentId:null};
  try{
    var newId=await sbSaveMatch(matchObj);
    matchObj.id=newId||id;
    _cache.matches.unshift({...matchObj,createdAt:new Date().toISOString()});
    closeModal('create-match-modal');
    showToast('Match created');
    renderHistory();
  }catch(e){showToast('Save failed: '+(e.message||e));}
}
function exportCSV(){
  var games=(_cache.games||[]).slice().sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);});
  var players=_cache.players||[];
  var lines=['Date\tResult\tType\tOpponent\tDuration\tPlayer\tRole\tHero\tKills\tDeaths\tAssists\tGold/Min\tRating\tP1\tP2\tP3\tP4'];
  games.forEach(function(g){
    var dur=g.duration_seconds?Math.floor(g.duration_seconds/60)+':'+(''+(g.duration_seconds%60)).padStart(2,'0'):'';
    players.forEach(function(p){
      var s=g.playerScores&&g.playerScores[p.id];
      if(!s)return;
      var ps=s.pillar_scores||{};
      lines.push([g.date,g.result,g.type,g.opponent||'',dur,p.nick,s.role||'',s.hero||'',s.kills||0,s.deaths||0,s.assists||0,s.gold_per_min!=null?s.gold_per_min.toFixed(1):'',s.in_game_rating!=null?s.in_game_rating:'',ps.p0||'',ps.p1||'',ps.p2||'',ps.p3||''].join('\t'));
    });
  });
  var text=lines.join('\n');
  document.getElementById('export-text').value=text;
  document.getElementById('export-modal').classList.add('open');
}
function selectExportText(){var el=document.getElementById('export-text');if(el){el.select();try{document.execCommand('copy');showToast('Copied to clipboard');}catch(e){}}}
var _benchTab='carry';
function _benchEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function openBenchmarkPanel(){
  _benchmarkStore=_benchLoadStore();
  document.getElementById('benchmark-modal').classList.add('open');
  renderBenchmarkModal();
}
function setBenchTab(role){ _benchTab=role; renderBenchmarkModal(); }

function renderBenchmarkModal(){
  var el=document.getElementById('benchmark-body');if(!el)return;
  var store=_benchStore();
  var role=_benchTab;
  var html='';
  // role tabs
  html+='<div class="bench-tabs">';
  BENCHMARK_ROLES.forEach(function(r){
    html+='<button class="bench-tab'+(r===role?' active':'')+'" onclick="setBenchTab(\''+r+'\')">'+BENCHMARK_LABELS[r]+'</button>';
  });
  html+='</div>';
  // fields
  html+='<div class="bench-scroll">';
  html+='<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);line-height:1.7;margin-bottom:4px;">Set a target number per metric, or flip <strong>Auto</strong> to use the player\'s own average from logged games (needs 3+, otherwise the number is used). Blank with Auto off = not set &mdash; that metric is skipped.</div>';
  BENCHMARK_FIELDS[role].forEach(function(f,fi){
    if(fi===4){
      html+='<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-4);text-transform:uppercase;margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--grey-2);">Reference metrics</div>';
    }
    var cell=store.current[role][f.k]||{value:'',auto:false};
    var notSet=(cell.value===''||cell.value==null)&&!cell.auto;
    html+='<div class="bench-field">';
    html+='<div class="bench-field-label">'+f.label+(notSet?' <span style="color:var(--grey-4);font-size:8px;letter-spacing:0;">&middot; not set</span>':'')+'</div>';
    html+='<input type="number" step="0.1" class="bench-field-input" placeholder="&mdash;" value="'+(cell.value==null?'':_benchEsc(cell.value))+'" oninput="benchSetField(\''+role+'\',\''+f.k+'\',\'value\',this.value)"/>';
    html+='<label class="bench-auto"><span class="bench-auto-label">Auto</span>';
    html+='<span class="bench-switch"><input type="checkbox" '+(cell.auto?'checked':'')+' onchange="benchSetField(\''+role+'\',\''+f.k+'\',\'auto\',this.checked)"/><span class="bench-switch-track"><span class="bench-switch-thumb"></span></span></span>';
    html+='</label>';
    html+='</div>';
  });
  html+='</div>';
  // presets
  var presetNames=Object.keys(store.presets||{}).sort();
  html+='<div class="bench-preset">';
  html+='<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-4);text-transform:uppercase;margin-bottom:8px;">Presets</div>';
  html+='<div class="bench-preset-row">';
  html+='<input class="input" id="bench-preset-name" placeholder="New preset name" style="margin:0;flex:1;"/>';
  html+='<button class="btn btn-primary btn-sm" onclick="benchSavePreset()">Save Preset</button>';
  html+='</div>';
  html+='<div class="bench-preset-row">';
  html+='<select class="input" id="bench-preset-select" style="margin:0;flex:1;">';
  if(!presetNames.length){ html+='<option value="">No saved presets</option>'; }
  else { presetNames.forEach(function(n){ html+='<option value="'+_benchEsc(n)+'">'+_benchEsc(n)+'</option>'; }); }
  html+='</select>';
  html+='<button class="btn btn-sm" onclick="benchLoadPreset()">Load</button>';
  html+='<button class="btn btn-danger btn-sm" onclick="benchDeletePreset()">Delete</button>';
  html+='</div>';
  html+='</div>';
  el.innerHTML=html;
}

function benchSetField(role,key,prop,val){
  var store=_benchStore();
  if(!store.current[role]) store.current[role]={};
  if(!store.current[role][key]) store.current[role][key]={value:'',auto:false};
  if(prop==='value') store.current[role][key].value=(val===''?'':val);
  else store.current[role][key].auto=!!val;
  _benchSaveStore(store);
  if(prop==='auto') renderBenchmarkModal();
}

function benchSavePreset(){
  var inp=document.getElementById('bench-preset-name');
  var name=((inp&&inp.value)||'').trim();
  if(!name){ showToast('Enter a preset name'); return; }
  var store=_benchStore();
  store.presets[name]=JSON.parse(JSON.stringify(store.current));
  _benchSaveStore(store);
  showToast('Preset "'+name+'" saved');
  renderBenchmarkModal();
}

function benchLoadPreset(){
  var sel=document.getElementById('bench-preset-select');
  var name=sel&&sel.value;
  if(!name){ showToast('No preset selected'); return; }
  var store=_benchStore();
  if(!store.presets[name]){ showToast('Preset not found'); return; }
  store.current=_benchMergeShape(store.presets[name]);
  _benchSaveStore(store);
  showToast('Loaded preset "'+name+'"');
  renderBenchmarkModal();
}

function benchDeletePreset(){
  var sel=document.getElementById('bench-preset-select');
  var name=sel&&sel.value;
  if(!name){ showToast('No preset selected'); return; }
  if(!confirm('Delete preset "'+name+'"? This cannot be undone.')) return;
  var store=_benchStore();
  delete store.presets[name];
  _benchSaveStore(store);
  showToast('Preset "'+name+'" deleted');
  renderBenchmarkModal();
}

// ══════════════════════════════════════════
// DAY 5 — HISTORY, GAME DETAIL & EDIT GAME
// ══════════════════════════════════════════

var _histMode = 'games'; // 'games' | 'matches'

function setHistoryMode(mode){
  _histMode = mode;
  document.getElementById('hist-mode-matches').classList.toggle('active', mode==='matches');
  document.getElementById('hist-mode-games').classList.toggle('active', mode==='games');
  renderHistory();
}

function renderHistory(){
  var el = document.getElementById('history-list');
  if(!el) return;
  if(_histMode === 'matches'){
    _renderMatchList(el);
  } else {
    _renderGameList(el);
  }
}

function _fmtDate(dateStr){
  if(!dateStr) return '—';
  // dateStr may be ISO 'YYYY-MM-DD' or 'DD/MM/YYYY'
  var d;
  if(dateStr.includes('-') && dateStr.length >= 10){
    d = new Date(dateStr+'T00:00:00');
  } else {
    var p = dateStr.split('/');
    d = new Date(+p[2], +p[1]-1, +p[0]);
  }
  if(isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

function _fmtDuration(secs){
  if(!secs) return null;
  var m = Math.floor(secs/60);
  var s = secs % 60;
  return m + ':' + (''+s).padStart(2,'0');
}

function _renderGameList(el){
  var games = (_cache.games||[]).slice().sort(function(a,b){
    return new Date(b.savedAt||0) - new Date(a.savedAt||0);
  });
  if(!games.length){
    el.innerHTML = '<div class="empty" style="padding:40px 20px;"><div class="empty-icon">📋</div><div class="empty-text">No games logged yet</div></div>';
    return;
  }
  el.innerHTML = '<div style="padding:10px 0 2px;">' + games.map(function(g){
    var incomplete = Object.keys(g.playerScores||{}).length === 0;
    var isWin = g.result === 'Win';
    var badge = incomplete ?
      '<span class="tag tag-dnp" style="font-size:9px;letter-spacing:1px;padding:4px 8px;">INCOMPLETE</span>' :
      '<span class="game-card-badge '+(isWin?'game-card-badge-win':'game-card-badge-loss')+'">'+(isWin?'WIN':'LOSS')+'</span>';
    var opp = g.opponent || 'Unknown Opponent';
    var dur = _fmtDuration(g.duration_seconds);
    var typeTag = g.type === 'Tournament' ?
      '<span class="tag tag-tourney" style="font-size:8px;padding:2px 6px;">TOURNAMENT</span>' :
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">Scrim</span>';
    var trashBtn = '<button title="Delete game" onclick="event.stopPropagation();deleteGame(\''+g.id+'\')" style="background:none;border:none;color:var(--grey-5);cursor:pointer;padding:6px;flex-shrink:0;" onmouseover="this.style.color=\'var(--danger)\'" onmouseout="this.style.color=\'var(--grey-5)\'">'+
      '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'+
    '</button>';
    return '<div class="game-card" id="game-card-'+g.id+'">'+
      '<div class="game-card-row" onclick="openGameDetail(\''+g.id+'\')">'+
        badge+
        '<div class="game-card-info">'+
          '<div class="game-card-opponent">'+opp+'</div>'+
          '<div class="game-card-meta">'+_fmtDate(g.date)+(dur?' · '+dur:'')+'</div>'+
        '</div>'+
        '<div class="game-card-right">'+typeTag+'</div>'+
        trashBtn+
      '</div>'+
      '<div class="inline-confirm" id="del-game-confirm-'+g.id+'" style="margin:0 16px 12px;">'+
        '<div class="inline-confirm-text">Permanently delete this game and all its player scores?</div>'+
        '<div class="inline-confirm-btns">'+
          '<button class="btn btn-sm btn-muted" onclick="event.stopPropagation();document.getElementById(\'del-game-confirm-'+g.id+'\').classList.remove(\'open\')">Cancel</button>'+
          '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();confirmDeleteGame(\''+g.id+'\')">Yes, Delete</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('') + '</div>';
}

// Delete game: opens inline confirm on the card (or deletes directly if no card present)
function deleteGame(gameId){
  var c = document.getElementById('del-game-confirm-'+gameId);
  if(c){ c.classList.add('open'); return; }
  confirmDeleteGame(gameId);
}
async function confirmDeleteGame(gameId){
  try{
    await sbDeleteGame(gameId);
    _cache.games = (_cache.games||[]).filter(function(g){return g.id!==gameId;});
    closeModal('game-detail-modal');
    renderHistory();
    showToast('✓ Game deleted');
  }catch(err){
    showToast('Delete failed: '+(err.message||String(err)));
  }
}

function _renderMatchList(el){
  var matches = (_cache.matches||[]).slice().sort(function(a,b){
    return new Date(b.createdAt||0) - new Date(a.createdAt||0);
  });
  if(!matches.length){
    el.innerHTML = '<div class="empty" style="padding:40px 20px;"><div class="empty-icon">📋</div><div class="empty-text">No matches yet — create one above</div></div>';
    return;
  }
  el.innerHTML = '<div style="padding:10px 0 2px;">' + matches.map(function(m){
    var mGames = (_cache.games||[]).filter(function(g){return g.matchId===m.id;});
    var wins = mGames.filter(function(g){return g.result==='Win';}).length;
    var total = mGames.length;
    var scoreTxt = total ? wins+'–'+(total-wins) : 'No games';
    return '<div class="game-card" onclick="showMatchDetail(\''+m.id+'\')">'+
      '<div class="game-card-row">'+
        '<div class="game-card-info">'+
          '<div class="game-card-opponent">'+m.name+'</div>'+
          '<div class="game-card-meta">'+_fmtDate(m.date)+(m.type?' · '+m.type:'')+(total?' · '+total+' game'+(total!==1?'s':''):'')+'</div>'+
        '</div>'+
        '<div class="game-card-right" style="align-items:center;">'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;'+(total?'':'color:var(--grey-5);font-size:11px;')+'">'+scoreTxt+'</div>'+
          '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--grey-4);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('') + '</div>';
}

// ──────────────────────────────────────────
// GAME DETAIL VIEW (Task 2)
// ──────────────────────────────────────────
function openGameDetail(gameId){
  var game = (_cache.games||[]).find(function(g){return g.id===gameId;});
  if(!game){showToast('Game not found');return;}
  var players = _cache.players||[];
  var isWin = game.result==='Win';

  // Header
  document.getElementById('gdm-title').textContent = (isWin?'WIN':'LOSS') + (game.opponent?' vs '+game.opponent:'');
  var dur = _fmtDuration(game.duration_seconds);
  document.getElementById('gdm-sub').textContent = _fmtDate(game.date) + ' · ' + (game.type||'Scrim') + (dur?' · '+dur:'');
  document.getElementById('gdm-edit-btn').onclick = function(){ closeModal('game-detail-modal'); openEditGame(gameId); };
  var assignBtn = document.getElementById('gdm-assign-btn');
  assignBtn.textContent = game.matchId ? '✓ Match' : '+ Match';
  assignBtn.onclick = function(){ openAssignGameModal(null, gameId); };
  var delConfirm=document.getElementById('gdm-del-confirm');
  delConfirm.classList.remove('open');
  document.getElementById('gdm-delete-btn').onclick = function(){ delConfirm.classList.add('open'); };
  document.getElementById('gdm-del-confirm-yes').onclick = function(){ confirmDeleteGame(gameId); };

  // Body
  var body = document.getElementById('gdm-body');

  // Pillar label helper
  function pillarLabels(role){return PILLAR_MAP[(role||'').toLowerCase()]||['P1','P2','P3','P4'];}

  // Player rows
  var playerHtml = '<div class="section-label" style="padding:14px 20px 8px;">OUR TEAM</div>';
  var playersWithScores = [];
  players.forEach(function(p){
    var s = game.playerScores&&game.playerScores[p.id];
    if(s) playersWithScores.push({player:p,score:s});
  });
  // Also handle any player IDs in scores that aren't in roster
  Object.keys(game.playerScores||{}).forEach(function(pid){
    if(!players.find(function(p){return p.id===pid;})){
      playersWithScores.push({player:{id:pid,nick:pid,role:''},score:game.playerScores[pid]});
    }
  });

  if(!playersWithScores.length){
    playerHtml += '<div class="empty"><div class="empty-text">No player data</div></div>';
  } else {
    playerHtml += playersWithScores.map(function(item){
      var p = item.player, s = item.score;
      var role = (s.role||p.role||'').toLowerCase();
      var lbls = pillarLabels(role);
      var ps = s.pillar_scores||{};
      var pillarsHtml = ['p0','p1','p2','p3'].map(function(k,i){
        var v = ps[k];
        var pct = v ? Math.round(v/10*100) : 0;
        var col = v>=8?'var(--success)':v>=6?'var(--warn)':'var(--white)';
        return '<div style="min-width:60px;"><div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px;">'+lbls[i]+'</div>'+
          '<div class="gd-pillar-bar"><div class="gd-pillar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:9px;margin-top:1px;color:'+col+';">'+(v!=null?v.toFixed(0):'—')+'</div>'+
        '</div>';
      }).join('');
      var kdaTxt = (s.kills||0)+'/'+(s.deaths||0)+'/'+(s.assists||0);
      var gpm = s.gold_per_min!=null ? Math.round(s.gold_per_min) : null;
      var rating = s.in_game_rating!=null ? s.in_game_rating.toFixed(1) : null;
      // Computed metrics — prefer the stored column, fall back to recomputing.
      var durMinD = game.duration_seconds ? game.duration_seconds/60 : 0;
      var kdaVal  = s.kda!=null ? s.kda : ((s.kills||0)+(s.assists||0))/Math.max(s.deaths||0,1);
      var killCt  = s.kill_contribution_pct!=null ? s.kill_contribution_pct
                      : (game.team_total_kills ? ((s.kills||0)+(s.assists||0))/game.team_total_kills*100 : null);
      var minDth  = s.min_per_death!=null ? s.min_per_death
                      : (durMinD>0 ? durMinD/Math.max(s.deaths||0,1) : null);
      var dmgRt   = s.dmg_per_dmg_taken!=null ? s.dmg_per_dmg_taken
                      : ((s.dmg_dealt_raw&&s.dmg_taken_raw) ? s.dmg_dealt_raw/Math.max(s.dmg_taken_raw,1) : null);
      var oppG    = s.opp_gold!=null ? s.opp_gold : null;
      var oppGpm  = s.opp_gold_per_min!=null ? s.opp_gold_per_min
                      : ((oppG&&durMinD>0) ? oppG/durMinD : null);
      function _gdStat(val,lbl){ return val==null?'':'<div><div class="gd-stat-val">'+val+'</div><div class="gd-stat-lbl">'+lbl+'</div></div>'; }
      var extraStats = ''+
        _gdStat(kdaVal!=null?kdaVal.toFixed(2):null,'KDA RATIO')+
        _gdStat(killCt!=null?killCt.toFixed(1)+'%':null,'KILL%')+
        _gdStat(minDth!=null?minDth.toFixed(1):null,'MIN/DTH')+
        _gdStat(dmgRt!=null?dmgRt.toFixed(2):null,'DMG RATIO')+
        _gdStat(s.dmg_dealt_raw!=null?Number(s.dmg_dealt_raw).toLocaleString():null,'DMG DEALT')+
        _gdStat(s.dmg_taken_raw!=null?Number(s.dmg_taken_raw).toLocaleString():null,'DMG TAKEN')+
        _gdStat(oppG!=null?Number(oppG).toLocaleString():null,'OPP GOLD')+
        _gdStat(oppGpm!=null?Math.round(oppGpm):null,'OPP G/MIN');
      var overallScore = calcGameScore(s, role, game, p.id);
      var grade = overallScore>0 ? scoreToGrade(overallScore) : null;
      return '<div class="gd-player-row">'+
        '<div style="flex-shrink:0;">'+
          ((_cache.pfp&&_cache.pfp[p.id]) ?
            '<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:1px solid var(--grey-3);flex-shrink:0;"><img src="'+_cache.pfp[p.id]+'" style="width:100%;height:100%;object-fit:cover;"/></div>' :
            '<div style="width:36px;height:36px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:14px;color:var(--grey-6);">'+p.nick[0]+'</div>')+
        '</div>'+
        '<div class="gd-player-info">'+
          '<div style="display:flex;align-items:center;gap:6px;">'+
            '<span class="gd-player-name">'+p.nick+'</span>'+
            '<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(s.role||p.role||'')+'</span>'+
            (s.hero?'<span style="font-size:11px;color:var(--grey-6);">· '+s.hero+'</span>':'')+
          '</div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">'+pillarsHtml+'</div>'+
          '<div style="display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;">'+
            '<div><div class="gd-stat-val">'+kdaTxt+'</div><div class="gd-stat-lbl">KDA</div></div>'+
            (gpm!=null?'<div><div class="gd-stat-val">'+gpm+'</div><div class="gd-stat-lbl">G/MIN</div></div>':'')+
            (rating!=null?'<div><div class="gd-stat-val">'+rating+'</div><div class="gd-stat-lbl">RATING</div></div>':'')+
            extraStats+
          '</div>'+
        '</div>'+
        '<div style="flex-shrink:0;text-align:center;">'+
          '<div class="grade '+(grade?grade.cls:'grade-am')+'" style="font-size:18px;">'+(grade?grade.grade:'—')+'</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  // Enemy team
  var enemyHtml = '';
  var ep = game.enemyPicks||[];
  if(ep.length){
    enemyHtml = '<div class="section-label" style="padding:14px 20px 8px;">ENEMY TEAM</div>'+
      ep.map(function(e){
        return '<div class="gd-enemy-row">'+
          heroPortraitHtml(e.hero||'?',32,false)+
          '<div style="flex:1;margin-left:8px;"><div style="font-size:12px;font-weight:600;">'+(e.hero||'Unknown')+'</div>'+
            '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+(e.role||'')+(e.gold?' · '+Number(e.gold).toLocaleString()+' g':'')+'</div>'+
          '</div>'+
        '</div>';
      }).join('');
  }

  // Game notes
  var notesHtml = game.notes ?
    '<div class="section-label" style="padding:14px 20px 8px;">NOTES</div>'+
    '<div style="padding:0 20px 16px;font-size:12px;color:var(--grey-6);line-height:1.6;">'+game.notes+'</div>' : '';

  body.innerHTML = playerHtml + enemyHtml + notesHtml + '<div style="height:20px;"></div>';
  document.getElementById('game-detail-modal').classList.add('open');
}

// ──────────────────────────────────────────
// EDIT GAME (Task 3)
// ──────────────────────────────────────────
function openEditGame(gameId){
  var game = (_cache.games||[]).find(function(g){return g.id===gameId;});
  if(!game){showToast('Game not found');return;}
  window._editingGameId = gameId;
  var players = _cache.players||[];
  var activePlayers = players.filter(function(p){return p.active!==false;});

  // Determine which players have scores
  var scoredPlayers = activePlayers.filter(function(p){return game.playerScores&&game.playerScores[p.id];});
  if(!scoredPlayers.length) scoredPlayers = activePlayers.slice(0,5);

  window._editGamePlayers = scoredPlayers;
  window._editGameActiveTab = 0;

  _renderEditGameModal(game, scoredPlayers);
  document.getElementById('edit-game-modal').classList.add('open');
}

function _renderEditGameModal(game, scoredPlayers){
  var body = document.getElementById('egm-body');
  if(!body) return;
  var isWin = game.result==='Win';
  var dur = game.duration_seconds ? (Math.floor(game.duration_seconds/60)+':'+(''+(game.duration_seconds%60)).padStart(2,'0')) : '';

  // Game info header — editable game/date/opponent
  var oppVal = (game.opponent||'').replace(/"/g,'&quot;');
  var headerHtml = '<div style="padding:14px 16px;background:var(--grey-1);border-bottom:var(--border);flex-shrink:0;">'+
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">'+
      '<span class="game-card-badge '+(isWin?'game-card-badge-win':'game-card-badge-loss')+'">'+(isWin?'WIN':'LOSS')+'</span>'+
      (dur?'<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+dur+'</span>':'')+
    '</div>'+
    '<div class="row" style="gap:8px;">'+
      '<div class="input-group mb-0" style="flex:2;">'+
        '<label class="input-label">Game Name</label>'+
        '<input class="input" id="egm-opponent" value="'+oppVal+'" placeholder="Game name"/>'+
      '</div>'+
      '<div class="input-group mb-0" style="flex:1;">'+
        '<label class="input-label">Game #</label>'+
        '<input class="input" type="number" min="1" id="egm-gamenum" value="'+(game.gameNum||1)+'"/>'+
      '</div>'+
    '</div>'+
    '<div class="row" style="gap:8px;margin-top:8px;">'+
      '<div class="input-group mb-0" style="flex:2;">'+
        '<label class="input-label">Date</label>'+
        '<input class="input" type="date" id="egm-date" value="'+(game.date||'')+'"/>'+
      '</div>'+
      '<div class="input-group mb-0" style="flex:1;">'+
        '<label class="input-label">End Time <span style="color:var(--grey-5);font-weight:400;">(HH:MM)</span></label>'+
        '<input class="input" type="text" id="egm-ended-at" value="'+(game.endedAt||'')+'" placeholder="21:34" style="font-family:\'DM Mono\',monospace;letter-spacing:1px;"/>'+
      '</div>'+
    '</div>'+
  '</div>';

  // Player tabs
  var tabHtml = '<div class="edit-game-player-tabs" style="flex-shrink:0;">' +
    scoredPlayers.map(function(p,i){
      return '<button class="edit-player-chip'+(i===window._editGameActiveTab?' active':'')+'" onclick="switchEditGameTab('+i+')">'+p.nick+'</button>';
    }).join('') +
  '</div>';

  // Player panels
  var panelsHtml = scoredPlayers.map(function(p,i){
    return '<div id="egm-panel-'+i+'" style="'+(i===window._editGameActiveTab?'':'display:none;')+'">' +
      _buildEditPlayerPanel(game, p, i) +
    '</div>';
  }).join('');

  // Footer
  var footerHtml = '<div style="padding:14px 16px;border-top:var(--border);background:var(--grey-1);flex-shrink:0;display:flex;gap:10px;">'+
    '<button class="btn" style="flex:1;" onclick="closeModal(\'edit-game-modal\')">Cancel</button>'+
    '<button class="btn btn-primary" style="flex:2;" id="egm-save-btn" onclick="saveEditGame(\''+game.id+'\')">Save Changes</button>'+
  '</div>';

  body.innerHTML = headerHtml + '<div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">' +
    tabHtml + '<div style="flex:1;overflow-y:auto;">' + panelsHtml + '</div>' +
  '</div>' + footerHtml;
}

function _buildEditPlayerPanel(game, player, idx){
  var s = (game.playerScores&&game.playerScores[player.id]) || {};
  var role = (s.role||player.role||'support').toLowerCase();
  var pillars = PILLAR_MAP[role] || ['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var ps = s.pillar_scores || {};

  function sliderRow(label, key, val, sug, hintStr){
    var v = Math.round(val!=null ? val : (sug!=null ? sug : 5));
    var hint = hintStr
      ? '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;">'+hintStr+'</div>'
      : '';
    return '<div class="pillar-row">'+
      '<div class="pillar-label-row">'+
        '<span class="pillar-label">'+label+'</span>'+
        '<span class="pillar-val" id="egm-'+idx+'-'+key+'-val">'+v.toFixed(0)+'</span>'+
      '</div>'+ hint +
      '<input type="range" class="pillar-slider" min="1" max="10" step="1" value="'+v+'" id="egm-'+idx+'-'+key+'" '+
        'oninput="document.getElementById(\'egm-'+idx+'-'+key+'-val\').textContent=parseFloat(this.value).toFixed(0)"/>'+
    '</div>';
  }

  var html = '<div style="padding:14px 16px;">';

  // Hero + role
  html += '<div class="row" style="gap:8px;margin-bottom:14px;">'+
    '<div class="input-group mb-0" style="flex:2;">'+
      '<label class="input-label">Hero</label>'+
      '<input class="input" id="egm-'+idx+'-hero" value="'+(s.hero||'')+'" placeholder="Hero name"/>'+
    '</div>'+
    '<div class="input-group mb-0" style="flex:1;">'+
      '<label class="input-label">Role</label>'+
      '<select class="input" id="egm-'+idx+'-role" onchange="refreshEditPillars('+idx+')">'+
        GAME_ROLES.map(function(r){
          return '<option value="'+r.toLowerCase()+'"'+(r.toLowerCase()===role?' selected':'')+'>'+r+'</option>';
        }).join('')+
      '</select>'+
    '</div>'+
  '</div>';

  // Pillar sliders
  html += '<div class="score-sec">PILLAR SCORES</div>';
  html += '<div id="egm-'+idx+'-pillars">';
  pillars.forEach(function(lbl, i){
    var _sug = calculateSuggestionFromScore(role, i, s, game, player.id);
    var _fk = (BENCHMARK_FIELDS[role]&&BENCHMARK_FIELDS[role][i]) ? BENCHMARK_FIELDS[role][i].k : null;
    var _hint = MANUAL_PILLARS.has(lbl) ? '' : _pillarHint(role, i, _benchMetricFromScore(_fk, s, game), _sug);
    html += sliderRow(lbl, 'p'+i, ps['p'+i], _sug, _hint);
  });
  html += '</div>';

  // Raw stats
  html += '<details class="raw-stats-details"><summary>RAW STATS (EDITABLE)</summary><div class="raw-stats-grid">';
  function rawCell(label, id, val, type){
    return '<div class="raw-stat-cell"><label class="raw-stat-label">'+label+'</label>'+
      '<input class="input" type="'+(type||'number')+'" id="egm-'+idx+'-'+id+'" value="'+(val!=null?val:'')+'" placeholder="—" style="padding:6px 8px;font-size:12px;"/>'+
    '</div>';
  }
  html += rawCell('Kills','kills',s.kills,'number');
  html += rawCell('Deaths','deaths',s.deaths,'number');
  html += rawCell('Assists','assists',s.assists,'number');
  html += rawCell('Gold','gold',s.gold,'number');
  html += rawCell('Rating','in_game_rating',s.in_game_rating,'number');
  html += rawCell('Dmg %','dmg_dealt_pct',s.dmg_dealt_pct,'number');
  html += rawCell('Taken %','dmg_taken_pct',s.dmg_taken_pct,'number');
  html += rawCell('Dmg Dealt','dmg_dealt_raw',s.dmg_dealt_raw,'number');
  html += rawCell('Dmg Taken','dmg_taken_raw',s.dmg_taken_raw,'number');
  html += '</div></details>';

  // Coach note
  html += '<div class="input-group" style="margin-top:10px;">'+
    '<label class="input-label">Coach Note</label>'+
    '<textarea class="input" id="egm-'+idx+'-note" rows="2" placeholder="Optional note...">'+(s.comment||'')+'</textarea>'+
  '</div>';

  html += '</div>';
  return html;
}

function refreshEditPillars(idx){
  var game = (_cache.games||[]).find(function(g){return g.id===window._editingGameId;});
  if(!game) return;
  var players = window._editGamePlayers||[];
  var player = players[idx];
  if(!player) return;
  var roleEl = document.getElementById('egm-'+idx+'-role');
  var role = roleEl ? roleEl.value : (player.role||'support').toLowerCase();
  var pillars = PILLAR_MAP[role] || ['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  var s = (game.playerScores&&game.playerScores[player.id])||{};
  var ps = s.pillar_scores||{};
  var container = document.getElementById('egm-'+idx+'-pillars');
  if(!container) return;
  container.innerHTML = '';
  pillars.forEach(function(lbl, i){
    var sug = calculateSuggestionFromScore(role, i, s, game, player.id);
    var v = Math.round(ps['p'+i]!=null ? ps['p'+i] : (sug!=null ? sug : 5));
    var _fk = (BENCHMARK_FIELDS[role]&&BENCHMARK_FIELDS[role][i]) ? BENCHMARK_FIELDS[role][i].k : null;
    var _hintStr = MANUAL_PILLARS.has(lbl) ? '' : _pillarHint(role, i, _benchMetricFromScore(_fk, s, game), sug);
    var hint = _hintStr
      ? '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;">'+_hintStr+'</div>'
      : '';
    container.innerHTML += '<div class="pillar-row">'+
      '<div class="pillar-label-row">'+
        '<span class="pillar-label">'+lbl+'</span>'+
        '<span class="pillar-val" id="egm-'+idx+'-p'+i+'-val">'+v.toFixed(0)+'</span>'+
      '</div>'+ hint +
      '<input type="range" class="pillar-slider" min="1" max="10" step="1" value="'+v+'" id="egm-'+idx+'-p'+i+'" '+
        'oninput="document.getElementById(\'egm-'+idx+'-p'+i+'-val\').textContent=parseFloat(this.value).toFixed(0)"/>'+
    '</div>';
  });
}

function switchEditGameTab(idx){
  var players = window._editGamePlayers||[];
  players.forEach(function(p,i){
    var panel = document.getElementById('egm-panel-'+i);
    var chip = document.querySelectorAll('.edit-player-chip')[i];
    if(panel) panel.style.display = i===idx?'':'none';
    if(chip) chip.classList.toggle('active', i===idx);
  });
  window._editGameActiveTab = idx;
}

async function saveEditGame(gameId){
  var btn = document.getElementById('egm-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    var game = (_cache.games||[]).find(function(g){return g.id===gameId;});
    if(!game) throw new Error('Game not found');
    var players = window._editGamePlayers||[];
    var durMin = game.duration_seconds ? game.duration_seconds/60 : 0;
    var teamK  = game.team_total_kills || 0;
    var enemyPicks = game.enemyPicks || [];

    var updateRows = [];
    players.forEach(function(p, i){
      var heroEl   = document.getElementById('egm-'+i+'-hero');
      var roleEl   = document.getElementById('egm-'+i+'-role');
      var noteEl   = document.getElementById('egm-'+i+'-note');
      var hero     = heroEl  ? heroEl.value.trim()  : (game.playerScores&&game.playerScores[p.id]&&game.playerScores[p.id].hero)||'';
      var role     = roleEl  ? roleEl.value         : (game.playerScores&&game.playerScores[p.id]&&game.playerScores[p.id].role)||(p.role||'').toLowerCase();
      var note     = noteEl  ? noteEl.value.trim()  : null;
      var kills    = parseFloat(document.getElementById('egm-'+i+'-kills')?.value)||0;
      var deaths   = parseFloat(document.getElementById('egm-'+i+'-deaths')?.value)||0;
      var assists  = parseFloat(document.getElementById('egm-'+i+'-assists')?.value)||0;
      var gold     = parseFloat(document.getElementById('egm-'+i+'-gold')?.value)||null;
      var rating   = parseFloat(document.getElementById('egm-'+i+'-in_game_rating')?.value)||null;
      var ddPct    = parseFloat(document.getElementById('egm-'+i+'-dmg_dealt_pct')?.value)||null;
      var dtPct    = parseFloat(document.getElementById('egm-'+i+'-dmg_taken_pct')?.value)||null;
      var ddRaw    = parseFloat(document.getElementById('egm-'+i+'-dmg_dealt_raw')?.value)||null;
      var dtRaw    = parseFloat(document.getElementById('egm-'+i+'-dmg_taken_raw')?.value)||null;
      var p0 = parseFloat(document.getElementById('egm-'+i+'-p0')?.value)||null;
      var p1 = parseFloat(document.getElementById('egm-'+i+'-p1')?.value)||null;
      var p2 = parseFloat(document.getElementById('egm-'+i+'-p2')?.value)||null;
      var p3 = parseFloat(document.getElementById('egm-'+i+'-p3')?.value)||null;
      // Derived metrics — kept in sync with the new-game save path.
      var kda            = (kills+assists)/Math.max(deaths,1);
      var gpm            = (gold&&durMin>0) ? gold/durMin : null;
      var minPerDeath    = durMin>0 ? durMin/Math.max(deaths,1) : null;
      var killContribPct = teamK>0 ? (kills+assists)/teamK*100 : null;
      var dmgRatio       = (ddRaw&&dtRaw) ? ddRaw/Math.max(dtRaw,1) : null;
      var oppPick        = enemyPicks.find(function(e){ return e.role && e.role.toLowerCase()===String(role).toLowerCase(); });
      var oppGold        = oppPick ? (oppPick.gold||null) : null;
      var oppGoldPerMin  = (oppGold&&durMin>0) ? oppGold/durMin : null;
      updateRows.push({
        player_id: p.id,
        game_id: gameId,
        hero_name: hero||null,
        role_played: role||null,
        kills: kills, deaths: deaths, assists: assists,
        gold: gold,
        in_game_rating: rating,
        dmg_dealt_pct: ddPct,
        dmg_taken_pct: dtPct,
        dmg_dealt_raw: ddRaw,
        dmg_taken_raw: dtRaw,
        pillar_1_score: p0, pillar_2_score: p1,
        pillar_3_score: p2, pillar_4_score: p3,
        coach_note: note||null,
        kda: kda,
        gold_per_min: gpm,
        min_per_death: minPerDeath,
        kill_contribution_pct: killContribPct,
        dmg_per_dmg_taken: dmgRatio,
        opp_gold: oppGold,
        opp_gold_per_min: oppGoldPerMin,
      });
    });

    // Replace this game's player_scores_v2 rows.
    // (Avoids the ON CONFLICT spec, which needs a (game_id,player_id) unique constraint.)
    var {error: delErr} = await sb.from('player_scores_v2').delete().eq('game_id', gameId);
    if(delErr) throw delErr;
    var {error: uErr} = await sb.from('player_scores_v2').insert(updateRows);
    if(uErr) throw uErr;

    // Persist editable game-level info (date / game number / opponent)
    var gnEl = document.getElementById('egm-gamenum');
    var gdEl = document.getElementById('egm-date');
    var goEl = document.getElementById('egm-opponent');
    var newGameNum = (gnEl && gnEl.value !== '') ? parseInt(gnEl.value, 10) : null;
    var newDate    = gdEl ? gdEl.value : '';
    var newOpp     = goEl ? goEl.value.trim() : '';
    var newEndedAt  = (document.getElementById('egm-ended-at')?.value || '').trim();
    var gameUpdate = { opponent_name: newOpp || null, game_name: newOpp || null };
    if(newDate) gameUpdate.match_date = newDate;
    if(newGameNum != null && !isNaN(newGameNum)) gameUpdate.game_num = newGameNum;
    gameUpdate.ended_at = newEndedAt || null;
    var {error: gErr} = await sb.from('games_v2').update(gameUpdate).eq('id', gameId);
    if(gErr) throw gErr;
    game.opponent = gameUpdate.opponent_name || '';
    game.gameName = gameUpdate.game_name || '';
    if(gameUpdate.match_date) game.date = gameUpdate.match_date;
    if('game_num' in gameUpdate) game.gameNum = gameUpdate.game_num;
    game.endedAt = newEndedAt || game.endedAt || null;

    // Update local cache
    players.forEach(function(p, i){
      var row = updateRows[i];
      if(!game.playerScores) game.playerScores={};
      game.playerScores[p.id] = {
        hero: row.hero_name, role: row.role_played,
        kills: row.kills, deaths: row.deaths, assists: row.assists,
        gold: row.gold, gold_per_min: row.gold_per_min,
        in_game_rating: row.in_game_rating,
        dmg_dealt_pct: row.dmg_dealt_pct, dmg_taken_pct: row.dmg_taken_pct,
        dmg_dealt_raw: row.dmg_dealt_raw, dmg_taken_raw: row.dmg_taken_raw,
        kda: row.kda, min_per_death: row.min_per_death,
        kill_contribution_pct: row.kill_contribution_pct,
        dmg_per_dmg_taken: row.dmg_per_dmg_taken,
        opp_gold: row.opp_gold, opp_gold_per_min: row.opp_gold_per_min,
        pillar_scores: {p0:row.pillar_1_score,p1:row.pillar_2_score,p2:row.pillar_3_score,p3:row.pillar_4_score},
        comment: row.coach_note,
      };
    });

    showToast('✓ Game updated');
    closeModal('edit-game-modal');
    renderHistory();
  } catch(err){
    showToast('Save failed: '+(err.message||String(err)));
    if(btn){btn.disabled=false;btn.textContent='Save Changes';}
  }
}

// ══════════════════════════════════════════
// MATCH DETAIL + LINKING (bug fixes)
// ══════════════════════════════════════════

// Latent bug: summary modal close button referenced this undefined fn
function closeSummaryAndReturn(){ closeModal('summary-modal'); }

function _matchGames(matchId){
  return (_cache.games||[]).filter(function(g){return g.matchId===matchId;})
    .sort(function(a,b){return new Date(a.savedAt||0)-new Date(b.savedAt||0);});
}

function showMatchDetail(matchId){
  renderMatchDetail(matchId);
  showPage('page-match');
  window.scrollTo(0,0);
}

function renderMatchDetail(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  var el = document.getElementById('match-content');
  if(!m){ if(el) el.innerHTML='<div class="empty"><div class="empty-text">Match not found</div></div>'; return; }
  window._currentMatchId = matchId;
  var games = _matchGames(matchId);
  var wins = games.filter(function(g){return g.result==='Win';}).length;
  var losses = games.length - wins;
  var players = _cache.players||[];
  var activePlayers = players.filter(function(p){return p.status!=='Inactive';});

  // ── Series trend bar (W/L dots in order) ──
  var trendHtml = '';
  if(games.length){
    trendHtml = '<div style="display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap;">'+
      games.map(function(g,idx){
        var isWin = g.result==='Win';
        var num = idx+1;
        return '<div title="Game '+num+' · '+g.result+'" style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:\'DM Mono\',monospace;font-size:9px;font-weight:700;'+
          (isWin?'background:rgba(68,255,136,0.15);border:1px solid rgba(68,255,136,0.5);color:var(--success);':'background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.35);color:var(--danger);')+
          '">'+num+'</div>';
      }).join('<div style="width:12px;height:1px;background:var(--grey-3);"></div>')+
    '</div>';
  }

  // ── Player summary (avg score + mentality per player) ──
  var playerSummaryHtml;
  if(games.length && activePlayers.length){
    var rows = activePlayers.map(function(p){
      var played = games.filter(function(g){var s=g.playerScores&&g.playerScores[p.id];return s&&!s.skipped;});
      if(!played.length) return null;
      var avgScore = played.map(function(g){return calcGameScore(g.playerScores[p.id],p.role,g,p.id);}).reduce(function(a,b){return a+b;},0)/played.length;
      var mentObj = m.mentality&&m.mentality[p.id]?m.mentality[p.id]:null;
      var avgMent = mentObj?calcMentality(null,mentObj):null;
      var grd = scoreToGrade(avgScore);
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:var(--border);">'+
        '<div style="font-size:13px;font-weight:600;width:48px;flex-shrink:0;">'+p.nick+'</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);width:38px;flex-shrink:0;">'+(p.role||'').substring(0,3).toUpperCase()+'</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:9px;color:var(--grey-5);font-family:\'DM Mono\',monospace;margin-bottom:3px;">AVG SCORE</div>'+
          '<div style="height:2px;background:var(--grey-3);"><div style="height:100%;width:'+(Math.min(avgScore/10,1)*100)+'%;background:var(--white);"></div></div>'+
        '</div>'+
        (grd?'<div class="grade '+grd.cls+'" style="font-size:16px;width:28px;text-align:right;">'+grd.grade+'</div>':'<div style="width:28px;"></div>')+
        '<div style="text-align:right;min-width:52px;">'+
          (avgMent!==null?
            '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">MENT</div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+(avgMent>=7?'var(--success)':avgMent>=5?'var(--warn)':'var(--danger)')+';">'+avgMent.toFixed(1)+'</div>':
            '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">—</div>')+
        '</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);width:24px;text-align:right;">'+played.length+'G</div>'+
      '</div>';
    }).filter(Boolean).join('');
    playerSummaryHtml = rows||'<div style="padding:16px 20px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">No player data yet</div>';
  } else {
    playerSummaryHtml = '<div style="padding:16px 20px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">Log games to see player averages</div>';
  }

  // ── Mentality detail (if rated) ──
  var rated = activePlayers.filter(function(p){return m.mentality&&m.mentality[p.id];});
  var mentDetailHtml = rated.length ?
    '<div class="match-mentality-panel">'+rated.map(function(p){
      var mo = m.mentality[p.id];
      var sc = calcMentality(null,mo);
      var grd = sc>0?scoreToGrade(sc):null;
      return '<div class="match-mentality-player">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'+
          '<div style="font-size:12px;font-weight:600;">'+p.nick+' <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+p.role+'</span></div>'+
          '<div class="grade '+(grd?grd.cls:'grade-am')+'" style="font-size:16px;">'+(grd?grd.grade:'--')+'</div>'+
        '</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-top:3px;">'+
          'COMM '+(mo.communication||0)+' · DISC '+(mo.discipline||0)+' · TEAM '+(mo.team_contribution||0)+'</div>'+
        (mo.note?'<div style="font-size:11px;color:var(--grey-6);margin-top:5px;line-height:1.5;">'+mo.note+'</div>':'')+
      '</div>';
    }).join('')+'</div>' :
    '<div style="padding:0 20px 12px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">No mentality ratings yet.</div>';

  // ── Game rows ──
  var gameRowsHtml = games.length ? games.map(function(g,idx){
    var isWin = g.result==='Win';
    var num = idx+1;
    var mvpP = g.mvpPlayerId?players.find(function(p){return p.id===g.mvpPlayerId;}):null;
    var played = players.filter(function(p){var s=g.playerScores&&g.playerScores[p.id];return s&&!s.skipped;});
    var heroList = played.map(function(p){var s=g.playerScores[p.id];return s.hero||'?';}).join(', ');
    return '<div class="match-game-row" style="cursor:pointer;" onclick="openGameDetail(\''+g.id+'\')">'+
      '<div style="flex:1;">'+
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">'+
          '<span class="tag '+(isWin?'tag-win':'tag-loss')+'" style="font-size:8px;">'+g.result+'</span>'+
          '<span style="font-size:12px;font-weight:600;">Game '+num+'</span>'+
          (mvpP?'<span style="font-size:11px;color:var(--warn);">⭐ '+mvpP.nick+'</span>':'')+
        '</div>'+
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+_fmtDate(g.date)+(heroList?' · '+heroList:'')+'</div>'+
      '</div>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();openEditGame(\''+g.id+'\')">Edit</button>'+
      '<button class="btn btn-sm btn-muted" onclick="event.stopPropagation();removeGameFromMatch(\''+g.id+'\',\''+matchId+'\')">↩</button>'+
    '</div>';
  }).join('') :
    '<div class="empty" style="padding:30px 20px;"><div class="empty-icon">🎮</div><div class="empty-text">No games yet — add one below</div></div>';

  el.innerHTML =
    '<button class="back-btn" onclick="showPage(\'page-history\')">&#x2190; Back to History</button>'+

    '<div class="match-header">'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;">'+
        '<div>'+
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:26px;letter-spacing:1px;line-height:1.1;">'+m.name+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-top:4px;">'+
            (_fmtDate(m.date)||'No date')+' · '+(m.type||'Scrim')+(m.oppTier?' · Tier '+m.oppTier:'')+
          '</div>'+
        '</div>'+
        '<button class="btn btn-sm btn-muted" onclick="openEditMatchModal(\''+matchId+'\')">Edit</button>'+
      '</div>'+
      (games.length?
        '<div style="display:flex;align-items:baseline;gap:8px;margin-top:12px;">'+
          '<div class="match-series-score '+(wins>losses?'grade-s':wins<losses?'grade-am':'')+'">'+wins+' – '+losses+'</div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+(wins>losses?'LEAD':wins<losses?'TRAILING':'TIED')+'</div>'+
        '</div>' :
        '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);margin-top:8px;">No games logged yet</div>')+
      trendHtml+
    '</div>'+

    '<div class="section-label">Player Summary <span style="font-size:8px;color:var(--grey-4);letter-spacing:1px;">· THIS MATCH</span></div>'+
    '<div style="border-top:var(--border);">'+playerSummaryHtml+'</div>'+

    '<div style="padding:12px 20px;border-top:var(--border);display:flex;align-items:center;justify-content:space-between;">'+
      '<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--grey-5);">Mentality</div>'+
      '<button class="btn btn-sm" onclick="openRateMentalityModal(\''+matchId+'\')">🧠 Rate Mentality</button>'+
    '</div>'+
    mentDetailHtml+

    '<div class="section-label">Games</div>'+
    gameRowsHtml+
    '<div style="padding:16px 20px;border-top:var(--border);display:flex;gap:10px;">'+
      '<button class="btn btn-primary" style="flex:1;" onclick="addGameToMatch(\''+matchId+'\')">+ Log Game</button>'+
      '<button class="btn btn-full" onclick="openAssignGameModal(\''+matchId+'\',null)">Assign Existing</button>'+
    '</div>'+

    '<div class="section-label">Coaching Notes</div>'+
    '<div style="padding:0 20px 16px;">'+
      '<textarea class="input" id="match-notes-area" placeholder="Tactics, VOD timestamps, areas to improve..." style="min-height:90px;">'+(m.notes||'')+'</textarea>'+
      '<button class="btn btn-primary btn-full mt-8" onclick="saveMatchNotes(\''+matchId+'\')">Save Notes</button>'+
    '</div>'+

    '<div style="padding:16px 20px;border-top:var(--border);">'+
      '<button class="btn btn-danger btn-full" onclick="openEditMatchModal(\''+matchId+'\')">Delete Match</button>'+
    '</div>'+
    '<div style="height:20px;"></div>';
}

function saveMatchNotes(matchId){
  var idx = _cache.matches.findIndex(function(m){return m.id===matchId;});
  if(idx===-1) return;
  _cache.matches[idx].notes = document.getElementById('match-notes-area')?.value||'';
  sbSaveMatch(_cache.matches[idx]).then(function(){showToast('Notes saved');}).catch(function(e){showToast('Failed: '+e.message);});
}

async function removeGameFromMatch(gameId, matchId){
  try{
    await sbUnassignGameFromMatch(gameId);
    renderMatchDetail(matchId);
    showToast('Game unlinked');
  }catch(err){ showToast('Failed: '+(err.message||String(err))); }
}

function addGameToMatch(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m) return;
  var nextNum = _matchGames(matchId).length+1;
  showPage('page-log'); // triggers initLog(), which resets LS.*
  LS._matchId = matchId; // set after initLog so it isn't cleared
  LS._gameNum = nextNum;
  setTimeout(function(){
    // Game name = (match/opponent name)-(game number)
    var nameEl = document.getElementById('log-opponent');
    if(nameEl) nameEl.value = m.name + '-' + nextNum;
    if(m.date){ var dateEl=document.getElementById('log-date'); if(dateEl) dateEl.value=m.date; }
    if(m.type==='Tournament') setLogType('Tournament'); else setLogType('Scrim');
  },50);
}

// Dual-mode: openAssignGameModal(matchId,null) → pick games for a match
//            openAssignGameModal(null,gameId)  → pick a match for a game
function openAssignGameModal(matchId, gameId){
  var body = document.getElementById('assign-game-body');
  if(matchId && !gameId){
    var candidates = (_cache.games||[]).filter(function(g){
      return Object.keys(g.playerScores||{}).length>0 && (!g.matchId || g.matchId===matchId);
    }).sort(function(a,b){return new Date(b.savedAt||0)-new Date(a.savedAt||0);});
    if(!candidates.length){
      body.innerHTML='<div class="empty"><div class="empty-text">No unassigned games available</div></div>';
    } else {
      body.innerHTML =
        '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-bottom:12px;">Select games to include in this match.</div>'+
        candidates.map(function(g){
          var checked = g.matchId===matchId ? 'checked' : '';
          var dur=_fmtDuration(g.duration_seconds);
          return '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:var(--border);cursor:pointer;">'+
            '<input type="checkbox" value="'+g.id+'" class="ag-game-cb" '+checked+' style="width:16px;height:16px;flex-shrink:0;"/>'+
            '<span class="game-card-badge '+(g.result==='Win'?'game-card-badge-win':'game-card-badge-loss')+'">'+(g.result==='Win'?'W':'L')+'</span>'+
            '<span style="flex:1;font-size:12px;">'+(g.opponent||'Unknown')+' <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+_fmtDate(g.date)+(dur?' · '+dur:'')+'</span></span>'+
          '</label>';
        }).join('')+
        '<button class="btn btn-primary btn-full mt-16" onclick="saveAssignGames(\''+matchId+'\')">Save</button>';
    }
  } else {
    var matches = (_cache.matches||[]).slice().sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0);});
    var g = (_cache.games||[]).find(function(x){return x.id===gameId;});
    var cur = g ? g.matchId : null;
    if(!matches.length){
      body.innerHTML='<div class="empty"><div class="empty-text">No matches yet</div><button class="btn btn-sm mt-8" onclick="closeModal(\'assign-game-modal\');openCreateMatchModal()">Create Match</button></div>';
    } else {
      body.innerHTML =
        '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-bottom:12px;">Attach this game to a match.</div>'+
        '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:var(--border);cursor:pointer;">'+
          '<input type="radio" name="ag-match" value="" '+(!cur?'checked':'')+' style="width:16px;height:16px;"/>'+
          '<span style="font-size:12px;color:var(--grey-5);">None (unassigned)</span></label>'+
        matches.map(function(mm){
          return '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:var(--border);cursor:pointer;">'+
            '<input type="radio" name="ag-match" value="'+mm.id+'" '+(cur===mm.id?'checked':'')+' style="width:16px;height:16px;"/>'+
            '<span style="flex:1;font-size:12px;">'+mm.name+' <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+_fmtDate(mm.date)+'</span></span>'+
          '</label>';
        }).join('')+
        '<button class="btn btn-primary btn-full mt-16" onclick="saveAssignGameToMatch(\''+gameId+'\')">Save</button>';
    }
  }
  document.getElementById('assign-game-modal').classList.add('open');
}

async function saveAssignGames(matchId){
  var cbs = Array.prototype.slice.call(document.querySelectorAll('.ag-game-cb'));
  try{
    for(var i=0;i<cbs.length;i++){
      var gid = cbs[i].value;
      var g = (_cache.games||[]).find(function(x){return x.id===gid;});
      if(!g) continue;
      if(cbs[i].checked && g.matchId!==matchId) await sbAssignGameToMatch(gid, matchId);
      else if(!cbs[i].checked && g.matchId===matchId) await sbUnassignGameFromMatch(gid);
    }
    closeModal('assign-game-modal');
    renderMatchDetail(matchId);
    showToast('✓ Games updated');
  }catch(err){ showToast('Failed: '+(err.message||String(err))); }
}

async function saveAssignGameToMatch(gameId){
  var sel = document.querySelector('input[name="ag-match"]:checked');
  var matchId = sel ? sel.value : '';
  try{
    if(matchId) await sbAssignGameToMatch(gameId, matchId);
    else await sbUnassignGameFromMatch(gameId);
    closeModal('assign-game-modal');
    closeModal('game-detail-modal');
    renderHistory();
    showToast(matchId?'✓ Assigned to match':'✓ Unassigned');
  }catch(err){ showToast('Failed: '+(err.message||String(err))); }
}

function openEditMatchModal(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m){showToast('Match not found');return;}
  var body = document.getElementById('edit-match-body');
  body.innerHTML =
    '<div class="input-group"><label class="input-label">Match Name</label><input class="input" id="em-name" value="'+(m.name||'').replace(/"/g,'&quot;')+'"/></div>'+
    '<div class="row">'+
      '<div class="input-group mb-0"><label class="input-label">Date</label><input class="input" id="em-date" type="date" value="'+(m.date||'')+'"/></div>'+
      '<div class="input-group mb-0"><label class="input-label">Type</label><select class="input" id="em-type">'+
        ['Scrim','Tournament'].map(function(t){return '<option'+(m.type===t?' selected':'')+'>'+t+'</option>';}).join('')+
      '</select></div>'+
    '</div>'+
    '<div class="input-group mt-16"><label class="input-label">Opponent Tier</label><select class="input" id="em-opp-tier">'+
      ['','A','A+','S-','S','S+'].map(function(t){return '<option value="'+t+'"'+(m.oppTier===t?' selected':'')+'>'+(t||'Unknown')+'</option>';}).join('')+
    '</select></div>'+
    '<div class="input-group"><label class="input-label">Notes</label><textarea class="input" id="em-notes" style="min-height:60px;">'+(m.notes||'')+'</textarea></div>'+
    '<div style="display:flex;gap:10px;margin-top:8px;">'+
      '<button class="btn btn-danger btn-sm" onclick="document.getElementById(\'em-del-confirm\').classList.add(\'open\')">Delete</button>'+
      '<button class="btn btn-primary" style="flex:1;" onclick="saveEditMatch(\''+matchId+'\')">Save Changes</button>'+
    '</div>'+
    '<div class="inline-confirm" id="em-del-confirm"><div class="inline-confirm-text">Delete this match? Its games will be unlinked but not deleted.</div>'+
      '<div class="inline-confirm-btns">'+
        '<button class="btn btn-sm btn-muted" onclick="document.getElementById(\'em-del-confirm\').classList.remove(\'open\')">Cancel</button>'+
        '<button class="btn btn-sm btn-danger" onclick="confirmDeleteMatch(\''+matchId+'\')">Yes, Delete</button>'+
      '</div></div>';
  document.getElementById('edit-match-modal').classList.add('open');
}

async function saveEditMatch(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m) return;
  m.name = (document.getElementById('em-name').value||'').trim()||m.name;
  m.date = document.getElementById('em-date').value||'';
  m.type = document.getElementById('em-type').value||'Scrim';
  m.oppTier = document.getElementById('em-opp-tier').value||'';
  m.notes = (document.getElementById('em-notes').value||'').trim();
  try{
    await sbSaveMatch(m);
    closeModal('edit-match-modal');
    renderMatchDetail(matchId);
    showToast('✓ Match updated');
  }catch(err){ showToast('Save failed: '+(err.message||String(err))); }
}

async function confirmDeleteMatch(matchId){
  try{
    await sbDeleteMatch(matchId);
    (_cache.games||[]).forEach(function(g){ if(g.matchId===matchId) g.matchId=null; });
    _cache.matches = (_cache.matches||[]).filter(function(x){return x.id!==matchId;});
    closeModal('edit-match-modal');
    showPage('page-history');
    showToast('✓ Match deleted');
  }catch(err){ showToast('Delete failed: '+(err.message||String(err))); }
}

function openRateMentalityModal(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m){showToast('Match not found');return;}
  var players = (_cache.players||[]).filter(function(p){return p.active!==false;});
  var body = document.getElementById('rate-mentality-body');
  function fld(pid,key,val){
    return '<input type="number" id="rm-'+pid+'-'+key+'" min="0" max="5" step="0.5" value="'+(val!=null?val:'')+'" placeholder="0–5" class="input" style="padding:6px 8px;font-size:12px;text-align:center;"/>';
  }
  body.innerHTML =
    '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-bottom:12px;">Rate each player 0–5 on communication, discipline, and team contribution.</div>'+
    players.map(function(p){
      var mo=(m.mentality&&m.mentality[p.id])||{};
      return '<div style="border:var(--border);border-radius:2px;padding:12px;margin-bottom:10px;">'+
        '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">'+p.nick+' <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+p.role+'</span></div>'+
        '<div class="row" style="gap:8px;">'+
          '<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1px;margin-bottom:4px;">COMM</div>'+fld(p.id,'communication',mo.communication)+'</div>'+
          '<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1px;margin-bottom:4px;">DISC</div>'+fld(p.id,'discipline',mo.discipline)+'</div>'+
          '<div style="flex:1;"><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1px;margin-bottom:4px;">TEAM</div>'+fld(p.id,'team_contribution',mo.team_contribution)+'</div>'+
        '</div>'+
        '<div class="input-group mb-0" style="margin-top:8px;"><textarea class="input" id="rm-'+p.id+'-note" placeholder="Note (optional)" style="min-height:44px;font-size:12px;">'+(mo.note||'')+'</textarea></div>'+
      '</div>';
    }).join('')+
    '<button class="btn btn-primary btn-full" onclick="saveRateMentality(\''+matchId+'\')">Save Ratings</button>';
  document.getElementById('rate-mentality-modal').classList.add('open');
}

async function saveRateMentality(matchId){
  var m = (_cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m) return;
  var players = (_cache.players||[]).filter(function(p){return p.active!==false;});
  var mentality = m.mentality || {};
  players.forEach(function(p){
    function num(key){var v=parseFloat(document.getElementById('rm-'+p.id+'-'+key)?.value);return isNaN(v)?0:v;}
    var note=(document.getElementById('rm-'+p.id+'-note')?.value||'').trim();
    var c=num('communication'),d=num('discipline'),t=num('team_contribution');
    if(c||d||t||note) mentality[p.id]={communication:c,discipline:d,team_contribution:t,note:note||undefined};
    else delete mentality[p.id];
  });
  m.mentality = mentality;
  try{
    await sbSaveMatch(m);
    closeModal('rate-mentality-modal');
    renderMatchDetail(matchId);
    showToast('✓ Mentality saved');
  }catch(err){ showToast('Save failed: '+(err.message||String(err))); }
}

// ══════════════════════════════════════════
bootApp();
