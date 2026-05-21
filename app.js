// ── DAY-2 NOTE ─────────────────────────────────────────────────────────────
// To populate player_id on each player_scores_v2 row, use:
//   findPlayerByIgn(ignString)   →  returns player object (with .id uuid)
// findPlayerByIgn is defined inside the scanner module below.
// Call it in Day 2's save function when writing player_scores_v2 rows:
//   const player = findPlayerByIgn(entry.ign);
//   const playerId = player ? player.id : null;
// ───────────────────────────────────────────────────────────────────────────

// ── LOG SESSION STATE ───────────────────────────────────────────────────────
App.log = {
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
function getHeroDB(){ return App.cache.heroes; }
function saveHeroDB(arr){ App.cache.heroes=arr; sbSaveHeroes(arr); }
function getHeroOverrides(){ return App.cache.heroOverrides||{}; }
function saveHeroOverrides(obj){ App.cache.heroOverrides=obj; sbSaveSetting('hero_overrides',obj); }

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
  const custom=App.cache.customHeroes||[];
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
      App.cache.heroes=heroes;
      App.cache.sheetUrl=url;
      App.cache.lastSync=new Date().toISOString();
      await sbSaveSetting('sheet_url',url);
      await sbSaveSetting('last_sync',App.cache.lastSync);
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
      App.cache.heroes=heroes;
      App.cache.lastSync=new Date().toISOString();
      App.cache.sheetUrl='local:'+file.name;
      await sbSaveSetting('last_sync',App.cache.lastSync);
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
  App.cache.heroes=[];
  App.cache.heroOverrides={};
  App.cache.sheetUrl='';
  App.cache.lastSync='';
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
  if(syncEl) syncEl.textContent=App.cache.lastSync?new Date(App.cache.lastSync).toLocaleString('en-GB'):'Never';
  if(srcEl) srcEl.textContent=App.cache.sheetUrl||'Not set';
  const urlInput=document.getElementById('sheet-url-input');
  if(urlInput&&App.cache.sheetUrl&&!urlInput.value) urlInput.value=App.cache.sheetUrl;
  const keyInput=document.getElementById('anthropic-key-input');
  if(keyInput&&App.cache.anthropicKey&&!keyInput.value) keyInput.value=App.cache.anthropicKey;
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
  const url=(document.getElementById('he-img')?.value||'').trim();
  const prev=document.getElementById('he-img-preview');
  if(!prev) return;
  if(url){
    prev.innerHTML='<div class="hero-img-wrap" style="width:80px;height:80px;">'+
      '<img class="hero-img" src="'+url+'" alt="" loading="eager" onerror="this.style.display=\'none\'"/>'+
    '</div>';
  } else {
    const name=(document.getElementById('hero-edit-title')?.textContent||'').replace('EDIT: ','');
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
  const ov=getHeroOverrides();
  if(ov[name]&&ov[name].img) return ov[name].img;
  if(!name) return '';
  const mapped=HERO_IMG_MAP[name];
  if(mapped) return HERO_IMG_BASE+(mapped.includes('/')?mapped:mapped+'.jpg');
  return HERO_IMG_BASE+name+'.jpg';
}

function heroPortraitHtml(name,px,showName){
  const url=heroImgUrl(name);
  const init=(name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase()||'?';
  const fs=Math.max(9,Math.round(px*0.36));
  let wrap='<div class="hero-img-wrap" style="width:'+px+'px;height:'+px+'px;">'+
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
  const player=App.players.find(function(p){return p.id===playerId;});
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
function buildHeroInput(wrapId,inputId,dropId,val){const el=document.getElementById(wrapId);if(!el)return;el.innerHTML='<label class="input-label">Hero Played</label><div class="hero-search-wrap"><input class="input" id="'+inputId+'" placeholder="Type to search..." autocomplete="off" value="'+(val||'')+'" oninput="filterHeroes(\''+inputId+'\',\''+dropId+'\')" onfocus="filterHeroes(\''+inputId+'\',\''+dropId+'\')"/><div class="hero-dropdown" id="'+dropId+'"></div></div>';}
function filterHeroes(inputId,dropId){const inp=document.getElementById(inputId);const drop=document.getElementById(dropId);if(!inp||!drop)return;const val=inp.value.trim().toLowerCase();const heroes=getHeroList();const filtered=val?heroes.filter(function(h){return h.toLowerCase().includes(val);}):heroes;let html=filtered.slice(0,10).map(function(h){return '<div class="hero-option" ontouchstart="" onclick="selectHero(\''+inputId+'\',\''+dropId+'\',\''+h.replace(/'/g,"\\'")+'\')">'+h+'</div>';}).join('');const raw=inp.value.trim();if(raw&&!heroes.find(function(h){return h.toLowerCase()===raw.toLowerCase();})) html+='<div class="hero-option new-hero" ontouchstart="" onclick="selectHero(\''+inputId+'\',\''+dropId+'\',\''+raw.replace(/'/g,"\\'")+'\')">+ Add "'+raw+'"</div>';if(!html) html='<div class="hero-option new-hero" style="cursor:default;">Type a hero name</div>';drop.innerHTML=html;drop.classList.add('open');}
function selectHero(inputId,dropId,name){const inp=document.getElementById(inputId);const drop=document.getElementById(dropId);if(inp)inp.value=name;if(drop)drop.classList.remove('open');}


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
function getHeroCutoff(){const wDays=(HERO_WINDOWS.find(function(w){return w.k===_heroState.window;})||{}).days||null;return wDays?new Date(Date.now()-wDays*24*60*60*1000):null;}

// ── SCORING UTILITIES (ported from index.html; adapted for v2 pillar_scores format) ──
function parseDate(str){
  if(!str)return new Date(0);
  // Handle YYYY-MM-DD (ISO) and DD/MM/YYYY (legacy)
  if(str.includes('-')&&str.length>=10){const d=new Date(str+'T00:00:00');return isNaN(d.getTime())?new Date(0):d;}
  const p=str.split('/');
  return new Date(+p[2],+p[1]-1,+p[0]);
}
var GRADE_SCALE=[{grade:'S+',min:9.0,cls:'grade-sp'},{grade:'S',min:8.0,cls:'grade-s'},{grade:'S-',min:7.0,cls:'grade-sm'},{grade:'A+',min:6.0,cls:'grade-ap'},{grade:'A',min:5.0,cls:'grade-a'},{grade:'A-',min:0,cls:'grade-am'}];
function scoreToGrade(score){if(!score||score<=0)return null;for(let i=0;i<GRADE_SCALE.length;i++){if(score>=GRADE_SCALE[i].min)return GRADE_SCALE[i];}return GRADE_SCALE[GRADE_SCALE.length-1];}
var MENTALITY_CRITERIA=[];
var GAME_SENSE_CRITERIA=[];
var ROLE_CRITERIA={Support:[],Midlane:[],Carry:[],Offlane:[],Jungler:[]};
function calcMentality(s,mentObj){const m=mentObj||s;const c=m.communication||0,d=m.discipline||0,t=m.team_contribution||0;if(c+d+t===0)return 0;return(c*0.5+d*0.25+t*0.25)*2;}
function calcGameScore(s,role,game,pid){
  if(!s)return 0;
  if(s.pillar_scores){
    const ps=s.pillar_scores;
    const vals=Object.values(ps).filter(function(v){return v!=null&&v>0;});
    const avg=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
    let mentality=0,matchId=game&&game.matchId;
    if(matchId&&pid){const pm=(App.cache.matches||[]).find(function(m){return m.id===matchId;});const mo=pm&&pm.mentality&&pm.mentality[pid]?pm.mentality[pid]:null;if(mo)mentality=calcMentality(null,mo);}
    const parts=(mentality>0?[mentality]:[]).concat(vals.length?[avg]:[]).filter(function(v){return v>0;});
    return parts.length?parts.reduce(function(a,b){return a+b;},0)/parts.length:0;
  }
  return 0;
}
function getPlayerStats(playerId,games){
  const player=(App.players||[]).find(function(p){return p.id===playerId;})||(App.cache.players||[]).find(function(p){return p.id===playerId;});
  const now=new Date(),oneMonth=new Date(now-30*24*60*60*1000),oneWeek=new Date(now-7*24*60*60*1000);
  const played=(games||[]).filter(function(g){const s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped;});
  const monthGames=played.filter(function(g){return parseDate(g.date)>=oneMonth;});
  const weekGames=played.filter(function(g){return parseDate(g.date)>=oneWeek;});
  function avg(list){return list.length?list.reduce(function(acc,g){return acc+calcGameScore(g.playerScores[playerId],player?player.role:'',g,playerId);},0)/list.length:0;}
  return{games:played.length,monthAvg:avg(monthGames),weekAvg:avg(weekGames),playerGames:played};
}
function getRadarValues(playerId,games){
  const player=(App.players||[]).find(function(p){return p.id===playerId;})||(App.cache.players||[]).find(function(p){return p.id===playerId;});
  const empty=[{label:'Mentality',value:0},{label:'Pillar 1',value:0},{label:'Pillar 2',value:0},{label:'Pillar 3',value:0},{label:'Pillar 4',value:0},{label:'Hero Pool',value:0}];
  if(!player)return empty;
  const roleKey=(player.role||'').toLowerCase();
  const pLabels=PILLAR_MAP[roleKey]||[];
  const now=new Date(),cutoff=new Date(now-30*24*60*60*1000);
  const monthGames=(games||[]).filter(function(g){const s=g.playerScores&&g.playerScores[playerId];return s&&!s.skipped&&parseDate(g.date)>=cutoff;});
  function avgPillar(idx){const key='p'+idx;const vals=monthGames.map(function(g){const s=g.playerScores&&g.playerScores[playerId];return s&&s.pillar_scores?s.pillar_scores[key]:null;}).filter(function(v){return v!=null&&v>0;});return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;}
  function avgMentality(){const vals=monthGames.map(function(g){const pm=g.matchId?(App.cache.matches||[]).find(function(m){return m.id===g.matchId;}):null;const mo=pm&&pm.mentality&&pm.mentality[playerId]?pm.mentality[playerId]:null;return mo?calcMentality(null,mo):null;}).filter(function(v){return v!==null&&v>0;});return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;}
  return[{label:'Mentality',value:avgMentality()},{label:pLabels[0]||'Pillar 1',value:avgPillar(0)},{label:pLabels[1]||'Pillar 2',value:avgPillar(1)},{label:pLabels[2]||'Pillar 3',value:avgPillar(2)},{label:pLabels[3]||'Pillar 4',value:avgPillar(3)},{label:'Hero Pool',value:0}];
}

function buildHeroStats(cutoff){
  const games=(App.cache.games||[]).filter(function(g){return !cutoff||parseDate(g.date)>=cutoff;});
  const totalGames=games.length;
  const heroMap={};
  const players=App.cache.players||[];
  games.forEach(function(g){
    if(!g.playerScores) return;
    const isWin=g.result==='Win';
    const teamHeroes=[];
    players.forEach(function(p){
      const s=g.playerScores[p.id];
      if(s&&!s.skipped&&s.hero) teamHeroes.push({pid:p.id,hero:s.hero});
    });
    players.forEach(function(p){
      const s=g.playerScores[p.id];
      if(!s||s.skipped||!s.hero) return;
      const hname=s.hero;
      const allH=getLiveHeroes().concat(App.cache.customHeroes||[]);
      const hobj=allH.find(function(h){return h.name===hname;})||{name:hname,cls:'Custom',roles:[]};
      if(!heroMap[hname]){
        heroMap[hname]={name:hname,cls:hobj.cls,roles:hobj.roles,picks:0,wins:0,losses:0,scores:[],players:{},pairsWith:{},
          rawKills:[],rawDeaths:[],rawAssists:[],rawGpm:[],rawRating:[],rawDmgDealt:[],rawDmgTaken:[]};
      }
      const entry=heroMap[hname];
      entry.picks++;
      if(isWin) entry.wins++; else entry.losses++;
      const score=calcGameScore(s,p.role,g,p.id);
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
      const pe=entry.players[p.id];
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
  getLiveHeroes().concat(App.cache.customHeroes||[]).forEach(function(hobj){
    if(!heroMap[hobj.name]){
      heroMap[hobj.name]={name:hobj.name,cls:hobj.cls||'Unknown',roles:hobj.roles||[],picks:0,wins:0,losses:0,scores:[],players:{},pairsWith:{},
        rawKills:[],rawDeaths:[],rawAssists:[],rawGpm:[],rawRating:[],rawDmgDealt:[],rawDmgTaken:[]};
    }
  });
  const result=Object.values(heroMap);
  result.totalGames=totalGames;
  return result;
}

function renderHeroes(){
  const cutoff=getHeroCutoff();
  const heroes=buildHeroStats(cutoff);
  const totalGames=heroes.totalGames||0;
  const role=_heroState.role||'All';
  const sort=_heroState.sort||'picks';
  const q=(document.getElementById('hero-search-inp')?.value||'').trim().toLowerCase();
  // Role tabs
  const roles=['All'].concat(GAME_ROLES);
  document.getElementById('heroes-role-tabs').innerHTML=roles.map(function(r){
    return '<button class="hero-role-tab '+(role===r?'active':'')+'" onclick="setHeroRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  // Sort bar
  const sorts=[{k:'picks',l:'Pick Rate'},{k:'wr',l:'Win Rate'},{k:'score',l:'Avg Score'},{k:'name',l:'Name'}];
  document.getElementById('heroes-sort-bar').innerHTML=sorts.map(function(s){
    return '<button class="hero-sort-btn '+(sort===s.k?'active':'')+'" onclick="setHeroSort(\''+s.k+'\')">'+s.l+'</button>';
  }).join('');
  // Date window bar
  const win=_heroState.window||'All';
  document.getElementById('heroes-window-bar').innerHTML=HERO_WINDOWS.map(function(w){
    return '<button class="hero-sort-btn '+(win===w.k?'active':'')+'" onclick="setHeroWindow(\''+w.k+'\')">'+w.l+'</button>';
  }).join('');
  // Filter
  const filtered=heroes.filter(function(h){
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
      const wa=a.wins/a.picks,wb=b.wins/b.picks;
      return wb-wa||b.picks-a.picks;
    }
    if(sort==='score'){
      const sa=a.scores.length?a.scores.reduce(function(x,y){return x+y;},0)/a.scores.length:0;
      const sb=b.scores.length?b.scores.reduce(function(x,y){return x+y;},0)/b.scores.length:0;
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
    const wr=h.picks?Math.round(h.wins/h.picks*100):null;
    const pr=totalGames?Math.round(h.picks/totalGames*100):null;
    const avgScore=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
    const grade=avgScore>0?scoreToGrade(avgScore):null;
    const wrCol=wr!=null?(wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)'):'var(--grey-5)';
    const lowConf=h.picks>0&&h.picks<3?'<span class="low-conf">·</span>':'';
    return '<div class="hero-row" onclick="openHeroDetail(decodeURIComponent(\''+encodeURIComponent(h.name)+'\'))">'+
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
  const cutoff=getHeroCutoff();
  const heroes=buildHeroStats(cutoff);
  const totalGames=heroes.totalGames||0;
  const h=heroes.find(function(x){return x.name===heroName;});
  if(!h){showToast('Hero not found');return;}
  const wr=h.picks?Math.round(h.wins/h.picks*100):null;
  const pr=totalGames?Math.round(h.picks/totalGames*100):null;
  const wrCol=wr!=null?(wr>=60?'var(--success)':wr>=50?'var(--warn)':'var(--danger)'):'var(--grey-5)';
  const avgScore=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
  const grade=avgScore>0?scoreToGrade(avgScore):null;
  const lowWarn=h.picks>0&&h.picks<3?'<div style="background:rgba(255,204,68,0.1);border:1px solid rgba(255,204,68,0.3);border-radius:2px;padding:8px 12px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--warn);margin-bottom:12px;">⚠ Low sample (&lt;3 games) — data may not be reliable</div>':'';
  const playerRows=Object.values(h.players).sort(function(a,b){return b.picks-a.picks;}).map(function(pe){
    const pwr=pe.picks?Math.round(pe.wins/pe.picks*100):0;
    const pavgScore=pe.scores.length?pe.scores.reduce(function(a,b){return a+b;},0)/pe.scores.length:0;
    const pgr=pavgScore>0?scoreToGrade(pavgScore):null;
    return '<div class="hd-player-row">'+
      '<div style="flex:1;"><div style="font-size:12px;font-weight:600;">'+pe.nick+'</div><div class="hd-wl">'+pe.wins+'W / '+pe.losses+'L · '+pwr+'% WR · '+pe.picks+' game'+(pe.picks!==1?'s':'')+'</div></div>'+
      '<div class="grade '+(pgr?pgr.cls:'grade-am')+'" style="font-size:18px;">'+(pgr?pgr.grade:'--')+'</div>'+
    '</div>';
  }).join('');
  // Pair synergy
  const pairs=Object.values(h.pairsWith||{}).filter(function(p){return p.picks>=2;}).sort(function(a,b){
    const wa=a.picks?a.wins/a.picks:0,wb=b.picks?b.wins/b.picks:0;return wb-wa;
  });
  const topPairs=pairs.slice(0,5);
  const pairsHtml=topPairs.length?topPairs.map(function(p){
    const pwr=p.picks?Math.round(p.wins/p.picks*100):0;
    const pc=pwr>=60?'var(--success)':pwr>=50?'var(--warn)':'var(--danger)';
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
  const avgK=_avg(h.rawKills),avgD=_avg(h.rawDeaths),avgA=_avg(h.rawAssists);
  const kdaVal=avgK!=null&&avgD!=null&&avgA!=null?((avgK+avgA)/(avgD||1)).toFixed(2):null;
  const kdaLine=kdaVal?kdaVal+' ('+avgK.toFixed(1)+' / '+avgD.toFixed(1)+' / '+avgA.toFixed(1)+')':null;
  const avgGpm=_avg(h.rawGpm),avgRating=_avg(h.rawRating),avgDmgDealt=_avg(h.rawDmgDealt),avgDmgTaken=_avg(h.rawDmgTaken);
  function rawStatRow(label,val,suffix,decimals){
    const disp=val!=null?val.toFixed(decimals||0)+(suffix||''):'—';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:var(--border);font-family:\'DM Mono\',monospace;">'+
      '<div style="font-size:9px;color:var(--grey-5);">'+label+'</div>'+
      '<div style="font-size:12px;color:var(--text);">'+disp+'</div>'+
    '</div>';
  }
  const rawStatsHtml=h.picks>0?
    rawStatRow('KDA',null,null,2).replace('—',kdaLine||'—')+
    rawStatRow('Avg Gold / Min',avgGpm,'',0)+
    rawStatRow('Avg In-Game Rating',avgRating,'',1)+
    rawStatRow('Avg DMG Dealt %',avgDmgDealt!=null?avgDmgDealt*100:null,'%',1)+
    rawStatRow('Avg DMG Taken %',avgDmgTaken!=null?avgDmgTaken*100:null,'%',1):
    '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No games logged with this hero yet</div>';
  const winLabel=(HERO_WINDOWS.find(function(w){return w.k===_heroState.window;})||{l:'All Time'}).l;
  document.getElementById('hd-title').textContent=heroName.toUpperCase();
  document.getElementById('hd-body').innerHTML=
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);text-align:center;padding:8px 0 0;letter-spacing:1px;">'+winLabel.toUpperCase()+'</div>'+
    '<div style="display:flex;flex-direction:column;align-items:center;padding:16px 0 8px;">'+
      heroPortraitHtml(heroName,160,false)+
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;margin-top:10px;">'+heroName+'</div>'+
      (function(){const hdb=getLiveHeroes().find(function(x){return x.name===heroName;});return hdb?'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-top:2px;">'+hdb.cls+(hdb.roles.length?' · '+hdb.roles.join(', '):'')+'</div>':'';})() +
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
  const heroMap={};
  const player=(App.cache.players||[]).find(function(p){return p.id===playerId;});
  if(!player) return '';
  games.forEach(function(g){
    const s=g.playerScores&&g.playerScores[playerId];
    if(!s||s.skipped||!s.hero) return;
    const hname=s.hero;
    if(!heroMap[hname]) heroMap[hname]={name:hname,picks:0,wins:0,scores:[]};
    heroMap[hname].picks++;
    if(g.result==='Win') heroMap[hname].wins++;
    const sc=calcGameScore(s,player.role,g,player.id);
    if(sc>0) heroMap[hname].scores.push(sc);
  });
  // Top 3 by avg score, but only from the top 10 most-played heroes
  const byPlays=Object.values(heroMap).filter(function(h){return h.picks>0;}).sort(function(a,b){return b.picks-a.picks;}).slice(0,10);
  const top3=byPlays.slice().sort(function(a,b){
    const sa=a.scores.length?a.scores.reduce(function(x,y){return x+y;},0)/a.scores.length:0;
    const sb=b.scores.length?b.scores.reduce(function(x,y){return x+y;},0)/b.scores.length:0;
    return sb-sa;
  }).slice(0,3);
  if(!top3.length) return '<div style="padding:8px 20px 12px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">No hero data yet</div>';
  const medals=['🥇','🥈','🥉'];
  const chips=top3.map(function(h,i){
    const wr=h.picks?Math.round(h.wins/h.picks*100):0;
    const avgSc=h.scores.length?h.scores.reduce(function(a,b){return a+b;},0)/h.scores.length:0;
    const gr=avgSc>0?scoreToGrade(avgSc):null;
    return '<div class="top3-chip" onclick="openHeroDetail(decodeURIComponent(\''+encodeURIComponent(h.name)+'\'))" style="display:flex;flex-direction:column;align-items:center;padding:8px 10px;min-width:80px;">'+
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

var SHOT_LABELS = ['RESULT','DAMAGE','BUILD'];
var SCAN_FIELDS_LIST = [
  ['Player names','Hero played'],
  ['KDA scores','Gold per player'],
  ['In-game rating','MVP (win side)'],
  ['Match end clock','Game duration'],
  ['DMG dealt %','DMG taken %']
];

const SCAN_PROMPT = `Analyze these AOV (Arena of Valor) screenshots. Extract all data as JSON only, no explanation.

Return this exact shape:
{
  "result": "Win or Loss",
  "endedAt": "HH:MM from clock icon on result screen (NOT game duration) or null",
  "duration": "MM:SS game timer shown at top center or null",
  "mvpIgn": "exact IGN of gold crown MVP on win side only or null",
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
- endedAt is the HH:MM next to a CLOCK ICON on the result screen — NOT the game duration timer.
- duration is the game timer at the top center of the result screen (e.g. "18:22").
- mvpIgn is the player name with the GOLD MVP CROWN on the winning side (not silver crown).
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
  const val=(document.getElementById('anthropic-key-input')?.value||'').replace(/\s+/g,'');
  const statusEl=document.getElementById('anthropic-key-status');
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
    App.cache.anthropicKey=val;
    sbSaveSetting('anthropic_key',val).then(function(){
      if(statusEl)statusEl.textContent='✓ Key verified and saved.';
      setTimeout(function(){if(statusEl)statusEl.textContent='';},3000);
    }).catch(function(){
      if(statusEl)statusEl.textContent='⚠ Key valid but could not save to database.';
    });
  }).catch(function(){
    App.cache.anthropicKey=val;
    sbSaveSetting('anthropic_key',val).then(function(){
      if(statusEl)statusEl.textContent='✓ Saved (could not verify — check network).';
      setTimeout(function(){if(statusEl)statusEl.textContent='';},3000);
    });
  });
}

// ── SCAN MODAL FUNCTIONS ─────────────────────────────────────────────────────

function openScanModal(){
  if(!App.cache.anthropicKey){showToast('Set your Anthropic API key in Settings first');return;}
  _scanState='upload';
  _scanFiles=[];
  _scanResult=null;
  _scanChecked={};
  _scanCancelled=false;
  renderScanModal();
  document.getElementById('scan-modal').classList.add('open');
}

function closeScanModal(){
  document.getElementById('scan-modal').classList.remove('open');
  _scanCancelled=true;
  _scanResult=null;
}

function renderScanModal(){
  const body=document.getElementById('scan-modal-body');
  const sec=document.getElementById('scan-btn-secondary');
  const prim=document.getElementById('scan-btn-primary');
  if(!body)return;
  if(_scanState==='upload'){
    body.innerHTML=buildScanUploadHtml();
    sec.textContent='CANCEL'; sec.disabled=false;
    const n=_scanFiles.length;
    prim.textContent='SCAN '+(n||1)+' SHOT'+(n!==1?'S →':'→');
    prim.disabled=(n===0);
  } else if(_scanState==='scanning'){
    body.innerHTML=buildScanScanningHtml();
    sec.textContent='CANCEL SCAN'; sec.disabled=false;
    prim.textContent='PLEASE WAIT…'; prim.disabled=true;
  } else {
    body.innerHTML=buildScanReviewHtml();
    sec.textContent='DISCARD'; sec.disabled=false;
    const cnt=countCheckedScanFields();
    prim.textContent='APPLY '+cnt+' FIELDS →'; prim.disabled=(cnt===0);
    // wire checkboxes
    document.querySelectorAll('[data-scan-field]').forEach(function(el){
      el.addEventListener('click',function(){
        const fid=el.dataset.scanField;
        _scanChecked[fid]=!_scanChecked[fid];
        renderCheckbox(el,!!_scanChecked[fid]);
        const cnt=countCheckedScanFields();
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
  let html='<div style="background:rgba(255,204,68,0.06);border:1px solid rgba(255,204,68,0.2);border-radius:4px;padding:10px 12px;display:flex;gap:10px;margin-bottom:14px;font-size:11.5px;color:var(--grey-6);line-height:1.5;">'
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
  const n=_scanFiles.length||1;
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
  const el=document.getElementById('scan-progress-list');
  if(el)el.innerHTML=lines.join('');
}

function scanProgressLine(state,text){
  const colors={done:'var(--success)',active:'var(--warn)',pending:'var(--grey-4)'};
  const icons={done:'✓ ',active:'▸ ',pending:'· '};
  return '<div style="color:'+colors[state]+';">'+icons[state]+text+'</div>';
}

function buildScanReviewHtml(){
  if(!_scanResult)return '<div style="color:var(--grey-4);text-align:center;padding:20px;">No scan data</div>';
  const raw=_scanResult.raw;
  const ourTeam=_scanResult.ourTeam;

  // build match-level rows
  const matchRows=[];
  if(raw.endedAt)matchRows.push({id:'endedAt',label:'MATCH END · CLOCK ICON',val:''+raw.endedAt,badge:'NEW',badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)'});
  if(raw.duration)matchRows.push({id:'duration',label:'GAME DURATION',val:''+raw.duration,badge:'NEW',badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)'});
  if(raw.mvpIgn){
    const mvpP=findPlayerByIgn(raw.mvpIgn);
    matchRows.push({id:'mvp',label:'MVP (WIN SIDE)',val:(mvpP?mvpP.nick+' · ':'')+raw.mvpIgn,badge:'MVP',badgeColor:'var(--warn)',badgeBg:'rgba(255,204,68,0.1)',badgeBorder:'rgba(255,204,68,0.3)'});
  }

  // count fields & init checked
  // In edit mode, load existing game scores to detect already-filled fields
  const editMode=!!(_scanResult&&_scanResult._editMode);
  const editGameIdx=editMode?App.cache.games.findIndex(function(g){return g.id===App.ui.editGameId;}):-1;
  const editScores=(editGameIdx>=0&&App.cache.games[editGameIdx].playerScores)||{};

  let coexistCount=0;
  matchRows.forEach(function(r){
    if(!(r.id in _scanChecked)){
      // In edit mode, default OFF if the field already has a value on the game
      if(editMode&&r.id==='endedAt'&&App.cache.games[editGameIdx]&&App.cache.games[editGameIdx].endedAt)_scanChecked[r.id]=false;
      else if(editMode&&r.id==='duration'&&App.cache.games[editGameIdx]&&App.cache.games[editGameIdx].duration)_scanChecked[r.id]=false;
      else if(editMode&&r.id==='mvp'&&App.cache.games[editGameIdx]&&App.cache.games[editGameIdx].mvpPlayerId)_scanChecked[r.id]=false;
      else _scanChecked[r.id]=true;
    }
  });
  ourTeam.forEach(function(e){
    if(!e.player)return;
    const pid=e.player.id;
    const ex=e.extracted;
    const sc=editScores[pid]||{};
    ['kda','gold','gameRating','dmgDealtPct','dmgTakenPct','dmgDealt','dmgTaken'].forEach(function(f){
      const fid=pid+'_'+f;
      if(!(fid in _scanChecked)&&getScanFieldVal(ex,f)!==null){
        // In edit mode, default OFF for fields already present in the saved game
        const alreadyFilled=editMode&&(
          (f==='kda'&&sc.kills!=null)||(f==='gold'&&sc.gold!=null)||
          (f==='gameRating'&&sc.gameRating!=null)||
          (f==='dmgDealtPct'&&sc.dmgDealtPct!=null)||(f==='dmgTakenPct'&&sc.dmgTakenPct!=null)||
          (f==='dmgDealt'&&sc.dmgDealt!=null)||(f==='dmgTaken'&&sc.dmgTaken!=null)
        );
        _scanChecked[fid]=!alreadyFilled;
      }
    });
    // Coexist: in log mode use App.log.scores; in edit mode use saved scores
    const coachRating=editMode?(sc.coachRating!=null?sc.coachRating:null):(App.log.scores&&App.log.scores[pid]&&App.log.scores[pid].coachRating!=null?App.log.scores[pid].coachRating:null);
    if(coachRating!=null&&ex.gameRating!=null)coexistCount++;
  });
  const totalFields=Object.keys(_scanChecked).length;
  const shotCount=_scanFiles.length||1;

  let html='';
  // summary stats
  html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">';
  [{n:shotCount,l:'SHOTS'},{n:totalFields,l:'FIELDS'},{n:coexistCount,l:'COEXIST'}].forEach(function(s){
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;padding:10px 8px;text-align:center;">'
      +'<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;">'+s.n+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--grey-5);margin-top:2px;">'+s.l+'</div>'
      +'</div>';
  });
  html+='</div>';

  // clock tip
  html+='<div style="background:rgba(255,204,68,0.06);border:1px solid rgba(255,204,68,0.2);border-radius:4px;padding:10px 12px;display:flex;gap:10px;margin-bottom:12px;font-size:11.5px;color:var(--grey-6);line-height:1.5;">'
    +'<span style="font-size:14px;">ℹ</span><div><b style="color:var(--white)">Match end (clock icon) ≠ game duration.</b> Sucrose combines with the match date. Confirm if the value looks off.</div></div>';

  // match-level section
  if(matchRows.length>0){
    html+=scanSectionLabel('MATCH-LEVEL');
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;overflow:hidden;margin-bottom:4px;">';
    matchRows.forEach(function(r,i){
      const ck=_scanChecked[r.id]!==false;
      html+=scanDiffRow(r.id,ck,r.label,r.val,r.badge,r.badgeColor,r.badgeBg,r.badgeBorder,i<matchRows.length-1,null,null,null);
    });
    html+='</div>';
  }

  // player-level section
  html+=scanSectionLabel('PLAYER-LEVEL · OUR SIDE');
  ourTeam.forEach(function(e){
    const p=e.player;const ex=e.extracted;
    const prows=buildPlayerScanRows(e,raw);
    if(prows.length===0)return;
    const init=p?(p.nick||p.ign||'?').substring(0,2).toUpperCase():'??';
    const name=p?p.nick:(ex.ign||'Unknown');
    const heroName=(e.hero&&e.hero.name)||(ex.hero||'');
    const isMvp=raw.mvpIgn&&p&&findPlayerByIgn(raw.mvpIgn)&&findPlayerByIgn(raw.mvpIgn).id===p.id;
    html+='<div style="background:var(--grey-1);border:var(--border);border-radius:2px;margin-bottom:8px;overflow:hidden;">';
    html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--grey-2);border-bottom:var(--border);">'
      +'<div style="width:28px;height:28px;border-radius:4px;background:var(--grey-3);display:grid;place-items:center;font-family:\'DM Mono\',monospace;font-size:10px;font-weight:600;color:var(--grey-6);">'+init+'</div>'
      +'<div style="font-weight:600;font-size:13px;">'+name+(isMvp?' <span style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;background:rgba(255,204,68,0.12);color:var(--warn);border:1px solid rgba(255,204,68,0.3);padding:1px 6px;border-radius:2px;margin-left:4px;vertical-align:middle;">MVP</span>':'')+'</div>'
      +'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);margin-left:auto;">'+(p?p.role:(ex.ign||''))+' · '+(heroName.toUpperCase())+'</div>'
      +'</div>';
    prows.forEach(function(r,i){
      const ck=_scanChecked[r.id]!==false;
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
  const ex=entry.extracted;const p=entry.player;
  const pid=p?p.id:'nopl';const rows=[];
  if(ex.kills!=null){
    rows.push({id:pid+'_kda',label:'SCORE (K/D/A)',val:ex.kills+' / '+ex.deaths+' / '+ex.assists,badge:'NEW',
      badgeColor:'var(--success)',badgeBg:'rgba(68,255,136,0.08)',badgeBorder:'rgba(68,255,136,0.25)',note:null});
  }
  if(ex.gold!=null){
    const warn=(ex.gold>14000||ex.gold<3500);
    rows.push({id:pid+'_gold',label:'GOLD',val:Number(ex.gold).toLocaleString(),
      badge:warn?'WARN':'NEW',badgeColor:warn?'var(--warn)':'var(--success)',
      badgeBg:warn?'rgba(255,204,68,0.08)':'rgba(68,255,136,0.08)',
      badgeBorder:warn?'rgba(255,204,68,0.3)':'rgba(68,255,136,0.25)',
      note:warn?'check against role avg':null});
  }
  if(ex.gameRating!=null){
    // Coach rating: in log mode from App.log.scores; in edit mode from saved game
    const editMode2=!!(_scanResult&&_scanResult._editMode);
    const editGIdx2=editMode2?App.cache.games.findIndex(function(g){return g.id===App.ui.editGameId;}):-1;
    const editSc2=editMode2&&editGIdx2>=0?(App.cache.games[editGIdx2].playerScores&&App.cache.games[editGIdx2].playerScores[pid])||{}:{};
    const coachRating=editMode2?(editSc2.coachRating!=null?editSc2.coachRating:null):(p&&App.log.scores&&App.log.scores[p.id]&&App.log.scores[p.id].coachRating!=null?App.log.scores[p.id].coachRating:null);
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
  let valsHtml;
  if(coachVal!=null&&gameVal!=null){
    const delta=parseFloat(gameVal)-parseFloat(coachVal);
    const dStr=(delta>=0?'+':'')+delta.toFixed(1);
    const dColor=Math.abs(delta)>=1.5?'var(--warn)':'var(--grey-5)';
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
  const files=Array.from(input.files||[]);
  const toProcess=files.slice(0,3-_scanFiles.length);
  let done=0;
  if(toProcess.length===0){input.value='';return;}
  toProcess.forEach(function(file){
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        let maxW=1920,maxH=1920,w=img.width,h=img.height;
        if(w>maxW||h>maxH){const sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const mimeType=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg';
        const dataUrl=canvas.toDataURL(mimeType,0.92);
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
  const imageContents=_scanFiles.map(function(sf){
    return{type:'image',source:{type:'base64',media_type:sf.mimeType,data:sf.base64}};
  });
  const steps=[
    'RESULT · player names · heroes · KDA',
    'RESULT · gold · in-game rating',
    'RESULT · clock icon timestamp · MVP',
    'DAMAGE · reading damage dealt %',
    'DAMAGE · damage taken %',
    'BUILD · final items',
    'cross-validating player matches…'
  ];
  let tick=0;
  function advance(){
    if(_scanCancelled)return;
    const lines=steps.map(function(s,i){
      return scanProgressLine(i<tick?'done':i===tick?'active':'pending',s);
    });
    updateScanProgress(lines);
    if(tick<steps.length-1){tick++;setTimeout(advance,700+Math.random()*500);}
  }
  advance();
  callClaudeVision(imageContents).then(function(raw){
    if(_scanCancelled)return;
    const matched=processScanResult(raw);
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
  const resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'x-api-key':App.cache.anthropicKey,
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
    const errText=await resp.text();
    if(resp.status===401)throw new Error('Invalid API key — go to Settings and re-enter your key from console.anthropic.com');
    if(resp.status===429)throw new Error('Rate limited or out of credits — check your Anthropic account');
    throw new Error('API error '+resp.status+': '+errText.slice(0,100));
  }
  const json=await resp.json();
  let text=(json.content&&json.content[0]&&json.content[0].text)||'';
  text=text.replace(/^```[a-z]*\n?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(text);}
  catch(e){throw new Error('Could not parse scan response — try again');}
}

function findHeroByName(name){
  if(!name) return null;
  const all=[].concat(App.cache.heroes,App.cache.customHeroes);
  const lo=name.toLowerCase();
  return all.find(function(h){return h.name.toLowerCase()===lo;})||
         all.find(function(h){return h.name.toLowerCase().includes(lo)||lo.includes(h.name.toLowerCase());})||
         null;
}

function findPlayerByIgn(ign){
  if(!ign) return null;
  const lo=ign.toLowerCase();
  return App.cache.players.find(function(p){return p.ign&&p.ign.toLowerCase()===lo;})||
         App.cache.players.find(function(p){
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

function applyScannedData(){
  if(!_scanResult)return;
  if(_scanResult._editMode){applyEditScannedData();return;}
  const raw=_scanResult.raw;
  const ourTeam=_scanResult.ourTeam;
  const oppTeam=_scanResult.oppTeam;
  if(!App.log.matchInfo)App.log.matchInfo={};

  // Result → logDraft + toggle
  if(raw.result){
    const _res=/loss|defeat/i.test(raw.result)?'Loss':'Win';
    App.log.matchInfo.result=_res;
    if(typeof setLogResult==='function')setLogResult(_res);
  }

  // Match-level: endedAt, duration
  if(_scanChecked['endedAt']&&raw.endedAt){if(!App.log.matchInfo)App.log.matchInfo={};App.log.matchInfo.endedAt=raw.endedAt;}
  if(_scanChecked['duration']&&raw.duration){if(!App.log.matchInfo)App.log.matchInfo={};App.log.matchInfo.duration=raw.duration;}
  // duration_seconds for pillar calculations
  if(raw.duration){
    const dParts=raw.duration.split(':');
    if(dParts.length===2)App.log.matchInfo.duration_seconds=parseInt(dParts[0])*60+parseInt(dParts[1]);
  }
  // Total kills per side — prefer the scanned tally, else sum per-player kills
  function _sumKills(list){
    let t=0,seen=false;
    (list||[]).forEach(function(e){if(e.extracted&&e.extracted.kills!=null){t+=e.extracted.kills;seen=true;}});
    return seen?t:null;
  }
  const ourK=(typeof raw.ourKills==='number')?raw.ourKills:_sumKills(_scanResult.ourTeam);
  const enemyK=(typeof raw.enemyKills==='number')?raw.enemyKills:_sumKills(_scanResult.oppTeam);
  if(ourK!=null)App.log.matchInfo.team_total_kills=ourK;
  if(enemyK!=null)App.log.matchInfo.enemy_total_kills=enemyK;
  // Pre-fill Step 0 kill inputs (only when empty) so logStep0Next preserves them
  if(App.log.matchInfo.team_total_kills!=null){const tkEl=document.getElementById('log-team-kills');if(tkEl&&!tkEl.value)tkEl.value=App.log.matchInfo.team_total_kills;}
  if(App.log.matchInfo.enemy_total_kills!=null){const ekEl=document.getElementById('log-enemy-kills');if(ekEl&&!ekEl.value)ekEl.value=App.log.matchInfo.enemy_total_kills;}
  // Store opp team for enemy role confirmation step
  if(_scanResult.oppTeam&&_scanResult.oppTeam.length){
    App.log._pendingOppTeam=_scanResult.oppTeam;
  }

  // MVP
  if(_scanChecked['mvp']&&raw.mvpIgn){
    const mvpP=findPlayerByIgn(raw.mvpIgn);
    if(mvpP){if(!App.log.scores[mvpP.id])App.log.scores[mvpP.id]={};App.log.scores[mvpP.id].mvp=true;}
  }

  // Player-level
  ourTeam.forEach(function(entry){
    if(!entry.player)return;
    const pid=entry.player.id;const ex=entry.extracted;
    if(!App.log.scores[pid])App.log.scores[pid]={};
    // hero always applied if matched
    if(entry.hero)App.log.scores[pid].hero=entry.hero.name;
    if(_scanChecked[pid+'_kda']&&ex.kills!=null){App.log.scores[pid].kills=ex.kills;App.log.scores[pid].deaths=ex.deaths;App.log.scores[pid].assists=ex.assists;}
    if(_scanChecked[pid+'_gold']&&ex.gold!=null)App.log.scores[pid].gold=ex.gold;
    if(_scanChecked[pid+'_gameRating']&&ex.gameRating!=null)App.log.scores[pid].gameRating=ex.gameRating;
    if(_scanChecked[pid+'_dmgDealtPct']&&ex.dmgDealtPct!=null)App.log.scores[pid].dmgDealtPct=ex.dmgDealtPct;
    if(_scanChecked[pid+'_dmgTakenPct']&&ex.dmgTakenPct!=null)App.log.scores[pid].dmgTakenPct=ex.dmgTakenPct;
    if(_scanChecked[pid+'_dmgDealt']&&ex.dmgDealt!=null)App.log.scores[pid].dmgDealt=ex.dmgDealt;
    if(_scanChecked[pid+'_dmgTaken']&&ex.dmgTaken!=null)App.log.scores[pid].dmgTaken=ex.dmgTaken;
  });

  // Hero → default role for all 10 players (Flowborn → unassigned, unknown → manual picker)
  ourTeam.forEach(function(entry){
    if(!entry.player)return;
    const pid=entry.player.id;
    const hName=(entry.hero&&entry.hero.name)||(entry.extracted&&entry.extracted.hero)||'';
    const hObj=entry.hero||findHeroByName(hName);
    if(!App.log.scores[pid])App.log.scores[pid]={};
    App.log.scores[pid].role=_defaultHeroRole(hObj,hName);
  });
  App.log.scanEnemy=oppTeam.map(function(entry){
    const hName=(entry.hero&&entry.hero.name)||(entry.extracted&&entry.extracted.hero)||'';
    const hObj=entry.hero||findHeroByName(hName);
    entry._inferredRole=_inferEnemyRole(hObj,hName);
    return {
      hero: hName,
      role: entry._inferredRole||'',
      gold: (entry.extracted&&entry.extracted.gold!=null)?entry.extracted.gold:null
    };
  });

  // Match date → logDraft (scanner has no date; default to the form's date)
  if(!App.log.matchInfo.date){
    const dEl=document.getElementById('log-date');
    if(dEl&&dEl.value)App.log.matchInfo.date=dEl.value;
  }

  // Populate duration input in the log form if visible
  if(App.log.matchInfo.duration){const durInp=document.getElementById('log-duration');if(durInp&&!durInp.value)durInp.value=App.log.matchInfo.duration;}

  // Draft
  if(!App.log.draft)App.log.draft={side:'Blue',ourPicks:['','','','',''],oppPicks:['','','','','']};
  ourTeam.forEach(function(entry){
    if(entry.player&&entry.hero){const idx=GAME_ROLES.indexOf(entry.player.role);if(idx>=0)App.log.draft.ourPicks[idx]=entry.hero.name;}
  });
  let oppIdx=0;
  oppTeam.forEach(function(entry){
    if(entry.hero&&oppIdx<5){
      if(entry.player){const idx=GAME_ROLES.indexOf(entry.player.role);if(idx>=0&&!App.log.draft.oppPicks[idx]){App.log.draft.oppPicks[idx]=entry.hero.name;return;}}
      while(oppIdx<5&&App.log.draft.oppPicks[oppIdx])oppIdx++;
      if(oppIdx<5){App.log.draft.oppPicks[oppIdx]=entry.hero.name;oppIdx++;}
    }
  });

  App.log.scanData=_scanResult;
  _scanResult=null;
  closeScanModal();
  showToast('✓ Scan applied');
  // If opp team available, prompt for enemy role confirmation
  if(App.log._pendingOppTeam&&App.log._pendingOppTeam.length){
    setTimeout(openEnemyRoleConfirm, 300);
  }
}

// ══════════════════════════════════════════
// ENEMY ROLE CONFIRMATION
// ══════════════════════════════════════════

function _inferEnemyRole(heroObj, heroName) {
  // Multi-role heroes — always require manual selection
  const MULTI_ROLE = ['Flowborn'];
  if (MULTI_ROLE.indexOf(heroName) !== -1) return null;
  if (!heroObj || !heroObj.roles || !heroObj.roles.length) return null;
  if (heroObj.roles.length === 1) return heroObj.roles[0];
  return null; // multiple roles → coach must pick
}

// Default role for our-side players: first DB role.
// Flowborn → unassigned; unknown hero → null (manual picker).
function _defaultHeroRole(heroObj, heroName) {
  const MULTI_ROLE = ['Flowborn'];
  if (MULTI_ROLE.indexOf(heroName) !== -1) return null;
  if (!heroObj || !heroObj.roles || !heroObj.roles.length) return null;
  return heroObj.roles[0];
}

function openEnemyRoleConfirm() {
  const opp = App.log._pendingOppTeam;
  if (!opp || !opp.length) return;
  const roleOptions = GAME_ROLES.map(function(r) {
    return '<option value="'+r+'">'+r+'</option>';
  }).join('');
  const rows = opp.map(function(entry, i) {
    const heroName = (entry.extracted && entry.extracted.hero) || '';
    const heroObj  = entry.hero || findHeroByName(heroName);
    const gold     = (entry.extracted && entry.extracted.gold) || null;
    const inferred = _inferEnemyRole(heroObj, heroName);
    const isMulti  = heroObj && heroObj.roles && heroObj.roles.length > 1;
    const isUnknown = !heroObj;
    let badgeHtml;
    if (inferred) {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">'+inferred.toUpperCase()+' · PRE-FILLED</span>';
    } else if (isMulti) {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--warn);letter-spacing:1px;">MULTI-ROLE — SELECT BELOW</span>';
    } else {
      badgeHtml = '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);letter-spacing:1px;">NOT IN DB — SELECT BELOW</span>';
    }
    const selectedRole = inferred || '';
    const selectHtml =
      '<select class="input" id="er-role-'+i+'" style="font-size:11px;padding:6px 10px;width:130px;flex-shrink:0;">' +
        '<option value="" disabled'+(selectedRole?'':' selected')+'>— role —</option>' +
        GAME_ROLES.map(function(r) {
          return '<option value="'+r+'"'+(r===selectedRole?' selected':'')+'>'+r+'</option>';
        }).join('') +
      '</select>';
    const goldHtml = gold != null
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
  App.log._pendingOppTeam = null;
  document.getElementById('enemy-role-modal').classList.remove('open');
  showToast('Enemy roles skipped — scanned lineup kept, confirm in Step 1');
}

function confirmEnemyRoles() {
  const opp = App.log._pendingOppTeam;
  if (!opp) return;
  const result = [];
  let missing = false;
  opp.forEach(function(entry, i) {
    const sel = document.getElementById('er-role-'+i);
    const role = sel ? sel.value : '';
    const row  = document.getElementById('er-row-'+i);
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
  App.log.enemyRoles = result;
  App.log._pendingOppTeam = null;
  document.getElementById('enemy-role-modal').classList.remove('open');
  showToast('Enemy roles confirmed');
}

function triggerEditScan(){
  if(!App.cache.anthropicKey){showToast('Set your Anthropic API key in Settings first');return;}
  const inp=document.getElementById('edit-scan-input');
  if(inp){inp.value='';inp.click();}
}

function handleEditScanUpload(input){
  const files=Array.from(input.files||[]);
  if(!files.length)return;
  const toProcess=files.slice(0,3);
  const processed=[];
  let done=0;
  function onAllReady(){
    _scanState='scanning';
    _scanFiles=processed;
    _scanCancelled=false;_scanResult=null;_scanChecked={};
    document.getElementById('scan-modal').classList.add('open');
    renderScanModal();
    const imageContents=processed.map(function(sf){
      return{type:'image',source:{type:'base64',media_type:sf.mimeType,data:sf.base64}};
    });
    callClaudeVision(imageContents).then(function(raw){
      if(_scanCancelled)return;
      const matched=processScanResult(raw);
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
    const reader=new FileReader();
    reader.onload=function(e){
      const img=new Image();
      img.onload=function(){
        let maxW=1920,maxH=1920,w=img.width,h=img.height;
        if(w>maxW||h>maxH){const sc=Math.min(maxW/w,maxH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const mimeType=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg';
        const dataUrl=canvas.toDataURL(mimeType,0.92);
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
  const raw=_scanResult.raw,our=_scanResult.ourTeam,opp=_scanResult.oppTeam;
  const gameIdx=App.cache.games.findIndex(function(g){return g.id===App.ui.editGameId;});

  // Result
  if(raw.result){const resEl=document.getElementById('edit-result');if(resEl)resEl.value=raw.result;}

  // Match-level: endedAt, duration stored on the game object
  if(gameIdx>=0){
    if(_scanChecked['endedAt']&&raw.endedAt)App.cache.games[gameIdx].endedAt=raw.endedAt;
    if(_scanChecked['duration']&&raw.duration)App.cache.games[gameIdx].duration=raw.duration;
    // MVP
    if(_scanChecked['mvp']&&raw.mvpIgn){
      const mvpP=findPlayerByIgn(raw.mvpIgn);
      if(mvpP){
        App.cache.games[gameIdx].mvpPlayerId=mvpP.id;
        App.ui.editMvpId=mvpP.id;
        App.players.forEach(function(p){
          const btn=document.getElementById('emvp-'+p.id);
          if(!btn)return;
          const isNow=p.id===mvpP.id;
          btn.className='btn btn-sm '+(isNow?'btn-primary':'btn-muted');
          btn.textContent=isNow?'⭐ MVP':'MVP?';
        });
      }
    }
  }

  // Heroes in edit form and draft
  const side=App.ui.editDraftSide||'Blue';
  const ourColor=side==='Blue'?'blue':'red';
  const oppColor=side==='Blue'?'red':'blue';
  our.forEach(function(entry){
    if(entry.player&&entry.hero){
      const inp=document.getElementById('ehero-'+entry.player.id);
      if(inp)inp.value=entry.hero.name;
      const di=GAME_ROLES.indexOf(entry.player.role);
      if(di>=0){const dinp=document.getElementById('ed-'+ourColor+'-inp-'+di);if(dinp)dinp.value=entry.hero.name;}
    }
  });
  let oppIdx=0;
  opp.forEach(function(entry){
    if(entry.hero&&oppIdx<5){
      if(entry.player){
        const di=GAME_ROLES.indexOf(entry.player.role);
        if(di>=0){var dinp=document.getElementById('ed-'+oppColor+'-inp-'+di);if(dinp&&!dinp.value){dinp.value=entry.hero.name;return;}}
      }
      while(oppIdx<5){var dinp=document.getElementById('ed-'+oppColor+'-inp-'+oppIdx);if(dinp&&!dinp.value){dinp.value=entry.hero.name;oppIdx++;return;}oppIdx++;}
    }
  });

  // Player-level objective stats → applied directly to cache (fill only empty fields)
  if(gameIdx>=0){
    if(!App.cache.games[gameIdx].playerScores)App.cache.games[gameIdx].playerScores={};
    our.forEach(function(entry){
      if(!entry.player)return;
      const pid=entry.player.id;const ex=entry.extracted;
      const sc=App.cache.games[gameIdx].playerScores[pid]||{};
      App.cache.games[gameIdx].playerScores[pid]=sc;
      if(_scanChecked[pid+'_kda']&&ex.kills!=null){sc.kills=ex.kills;sc.deaths=ex.deaths;sc.assists=ex.assists;}
      if(_scanChecked[pid+'_gold']&&ex.gold!=null)sc.gold=ex.gold;
      if(_scanChecked[pid+'_gameRating']&&ex.gameRating!=null)sc.gameRating=ex.gameRating;
      if(_scanChecked[pid+'_dmgDealtPct']&&ex.dmgDealtPct!=null)sc.dmgDealtPct=ex.dmgDealtPct;
      if(_scanChecked[pid+'_dmgTakenPct']&&ex.dmgTakenPct!=null)sc.dmgTakenPct=ex.dmgTakenPct;
      if(_scanChecked[pid+'_dmgDealt']&&ex.dmgDealt!=null)sc.dmgDealt=ex.dmgDealt;
      if(_scanChecked[pid+'_dmgTaken']&&ex.dmgTaken!=null)sc.dmgTaken=ex.dmgTaken;
    });
    // Refresh the stats display in the edit modal
    App.players.forEach(function(p){
      const wrap=document.getElementById('escan-stats-'+p.id);
      if(!wrap)return;
      const sc=App.cache.games[gameIdx].playerScores[p.id]||{};
      wrap.innerHTML=buildEditScanStatsHtml(sc);
    });
  }

  _scanResult=null;
  closeScanModal();
  showToast('✓ Scan applied to game');
}

function buildEditScanStatsHtml(sc){
  const parts=[];
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
  const side=App.ui.editDraftSide||'Blue';
  const ourColor=side==='Blue'?'blue':'red';
  GAME_ROLES.forEach(function(role,i){
    const player=App.players.find(function(p){return p.role===role;});
    if(!player)return;
    const heroInp=document.getElementById('ehero-'+player.id);
    const heroVal=heroInp?(heroInp.value||'').trim():'';
    if(!heroVal)return;
    const draftInp=document.getElementById('ed-'+ourColor+'-inp-'+i);
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
  const prevDuration = App.log.matchInfo && App.log.matchInfo.duration;
  App.log.matchInfo = {};
  App.log.scores    = {};
  App.log.enemyRoles = null;
  App.log.scanEnemy = null;
  App.log._pendingOppTeam = null;
  App.log._matchId = null;
  App.log._step = 0;

  // Default result to Win
  const winBtn  = document.getElementById('log-result-win');
  const lossBtn = document.getElementById('log-result-loss');
  if(winBtn)  { winBtn.className  = 'log-toggle-btn active-win'; }
  if(lossBtn) { lossBtn.className = 'log-toggle-btn'; }
  App.log.matchInfo.result = 'Win';

  // Default type to Scrim
  const scrimBtn  = document.getElementById('log-type-scrim');
  const tournBtn  = document.getElementById('log-type-tournament');
  if(scrimBtn)  { scrimBtn.className  = 'log-toggle-btn active'; }
  if(tournBtn)  { tournBtn.className  = 'log-toggle-btn'; }
  App.log.matchInfo.type = 'Scrim';

  // Set today's date
  const dateEl = document.getElementById('log-date');
  if(dateEl){
    const today = new Date();
    const yyyy  = today.getFullYear();
    const mm    = String(today.getMonth()+1).padStart(2,'0');
    const dd    = String(today.getDate()).padStart(2,'0');
    dateEl.value = yyyy+'-'+mm+'-'+dd;
  }

  // Pre-fill duration from scan if available
  if(prevDuration){
    const durEl = document.getElementById('log-duration');
    if(durEl) durEl.value = prevDuration;
  }

  logGoToStep(0);
}

function logGoToStep(n){
  const steps = ['log-step-0','log-step-enemy','log-step-players'];
  steps.forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  const showId = ['log-step-0','log-step-enemy','log-step-players'][n];
  const showEl = document.getElementById(showId);
  if(showEl) showEl.style.display = 'block';

  App.log._step = n;
  renderLogStepIndicator();
  window.scrollTo(0, 0);

  if(n === 1) renderEnemyStep();
  if(n === 2) renderPlayerStep();
}

function renderLogStepIndicator(){
  const el = document.getElementById('step-indicator');
  if(!el) return;
  const s = App.log._step || 0;
  const labels = ['Details','Enemy','Players'];
  let html = '';
  for(let i = 0; i < 3; i++){
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
  App.log.matchInfo.result = r;
  const winBtn  = document.getElementById('log-result-win');
  const lossBtn = document.getElementById('log-result-loss');
  if(r === 'Win'){
    if(winBtn)  winBtn.className  = 'log-toggle-btn active-win';
    if(lossBtn) lossBtn.className = 'log-toggle-btn';
  } else {
    if(winBtn)  winBtn.className  = 'log-toggle-btn';
    if(lossBtn) lossBtn.className = 'log-toggle-btn active-loss';
  }
}

function setLogType(t){
  App.log.matchInfo.type = t;
  const scrimBtn = document.getElementById('log-type-scrim');
  const tournBtn = document.getElementById('log-type-tournament');
  if(t === 'Scrim'){
    if(scrimBtn) scrimBtn.className = 'log-toggle-btn active';
    if(tournBtn) tournBtn.className = 'log-toggle-btn';
  } else {
    if(scrimBtn) scrimBtn.className = 'log-toggle-btn';
    if(tournBtn) tournBtn.className = 'log-toggle-btn active';
  }
}

function logStep0Next(){
  const result   = App.log.matchInfo.result || 'Win';
  const date     = (document.getElementById('log-date')?.value || '').trim();
  const type     = App.log.matchInfo.type || 'Scrim';
  const opponent = (document.getElementById('log-opponent')?.value || '').trim();
  const durStr   = (document.getElementById('log-duration')?.value || '').trim();
  const teamK    = (document.getElementById('log-team-kills')?.value || '').trim();
  const enemyK   = (document.getElementById('log-enemy-kills')?.value || '').trim();
  const vod      = (document.getElementById('log-vod')?.value || '').trim();
  const notes    = (document.getElementById('log-notes')?.value || '').trim();

  if(!date){ showToast('Match date is required'); return; }

  App.log.matchInfo.result   = result;
  App.log.matchInfo.date     = date;
  App.log.matchInfo.type     = type;
  App.log.matchInfo.opponent = opponent || null;
  App.log.matchInfo.vod_url  = vod      || null;
  App.log.matchInfo.notes    = notes    || null;
  App.log.matchInfo.team_total_kills  = teamK  ? parseInt(teamK,10)  : null;
  App.log.matchInfo.enemy_total_kills = enemyK ? parseInt(enemyK,10) : null;

  if(durStr){
    App.log.matchInfo.duration = durStr;
    const parts = durStr.split(':');
    if(parts.length === 2){
      App.log.matchInfo.duration_seconds = parseInt(parts[0],10)*60 + parseInt(parts[1],10);
    }
  } else {
    App.log.matchInfo.duration = null;
    App.log.matchInfo.duration_seconds = null;
  }

  logGoToStep(1);
}

function renderEnemyStep(){
  const container = document.getElementById('log-enemy-rows');
  if(!container) return;

  const roleOptions = '<option value="" disabled selected>— role —</option>' +
    GAME_ROLES.map(function(r){ return '<option value="'+r+'">'+r+'</option>'; }).join('');

  const opp = App.log._pendingOppTeam;
  // Source priority: modal-confirmed roles → durable scanned enemy → raw pending
  const confirmed = (App.log.enemyRoles && App.log.enemyRoles.length) ? App.log.enemyRoles : null;
  const scanEnemy = (App.log.scanEnemy && App.log.scanEnemy.length) ? App.log.scanEnemy : null;
  let html = '';
  for(let i = 0; i < 5; i++){
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
      const entry    = opp[i];
      const heroName = (entry.extracted && entry.extracted.hero) || '';
      const heroObj  = entry.hero || findHeroByName(heroName);
      goldVal      = (entry.extracted && entry.extracted.gold != null) ? entry.extracted.gold : '';
      heroVal      = heroName;
      inferredRole = _inferEnemyRole(heroObj, heroName) || '';
    }
    const selOpts = GAME_ROLES.map(function(r){
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
  for(let j = 0; j < 5; j++){
    const hn2 = (document.getElementById('el-hero-'+j) || {}).value || '';
    if(!hn2) continue;
    const ho2 = findHeroByName(hn2);
    _updateEnemyBadge(j, ho2, _inferEnemyRole(ho2, hn2));
  }

  // Consume the pending data
  App.log._pendingOppTeam = null;
}

function onEnemyHeroInput(i){
  const val     = (document.getElementById('el-hero-'+i)?.value || '').trim();
  const heroObj = val ? findHeroByName(val) : null;
  const inferred = _inferEnemyRole(heroObj, val);
  if(inferred){
    const sel = document.getElementById('el-role-'+i);
    if(sel) sel.value = inferred;
  }
  _updateEnemyBadge(i, heroObj, inferred);
}

function _updateEnemyBadge(i, heroObj, inferredRole){
  const badge = document.getElementById('el-badge-'+i);
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
  const rows = [];
  let valid = true;
  for(let i = 0; i < 5; i++){
    const hero = (document.getElementById('el-hero-'+i)?.value || '').trim();
    const role = document.getElementById('el-role-'+i)?.value || '';
    const gold = document.getElementById('el-gold-'+i)?.value;
    const roleEl = document.getElementById('el-role-'+i);
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
  App.log.enemyRoles = rows.some(function(r){ return r.hero || r.role; }) ? rows : null;
  logGoToStep(2);
}

function renderPlayerStep(){
  App.players = getPlayers();
  const container = document.getElementById('log-player-sections');
  if(!container) return;

  const roleOpts = GAME_ROLES.map(function(r){
    return '<option value="'+r+'">'+r+'</option>';
  }).join('');

  const playerOpts = function(defaultRole){
    const active   = App.players.filter(function(p){ return p.status !== 'Inactive'; });
    const inactive = App.players.filter(function(p){ return p.status === 'Inactive'; });
    const all = active.concat(inactive);
    const defaultP = App.players.find(function(p){ return p.role === defaultRole && p.status !== 'Inactive'; }) ||
                   App.players.find(function(p){ return p.role === defaultRole; });
    return all.map(function(p){
      return '<option value="'+p.id+'"'+(defaultP&&p.id===defaultP.id?' selected':'')+'>'+p.nick+' ('+p.role+')</option>';
    }).join('');
  };

  const statsFields = [
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

  let html = '';
  for(var i = 0; i < 5; i++){
    var role = GAME_ROLES[i];
    const roleLower = role.toLowerCase();
    const defaultP  = App.players.find(function(p){ return p.role === role && p.status !== 'Inactive'; }) ||
                    App.players.find(function(p){ return p.role === role; });
    const preScore = (defaultP && App.log.scores[defaultP.id]) ? App.log.scores[defaultP.id] : null;
    const preHero  = (preScore && preScore.hero) ? preScore.hero : '';
    // Inferred hero role pre-selects the picker; null (Flowborn/unknown) falls back to slot role
    var prefRole = (preScore && preScore.role) ? preScore.role : role;

    const roleSelOpts = GAME_ROLES.map(function(r){
      return '<option value="'+r+'"'+(r===prefRole?' selected':'')+'>'+r+'</option>';
    }).join('');

    const statsHtml = statsFields.map(function(f){
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
    html += '</div>';
    html += '<div class="player-score-body">';
    html += '<div class="input-group" style="margin-bottom:10px;">';
    html += '<label class="input-label">Hero</label>';
    html += '<input class="input" id="lp-hero-'+i+'" placeholder="Hero name" value="'+preHero+'"/>';
    html += '</div>';
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
    const dp = App.players.find(function(p){ return p.role === GAME_ROLES[j] && p.status !== 'Inactive'; }) ||
             App.players.find(function(p){ return p.role === GAME_ROLES[j]; });
    const sc = (dp && App.log.scores[dp.id]) ? App.log.scores[dp.id] : null;
    const rEl = document.getElementById('lp-role-'+j);
    const rl  = (rEl ? rEl.value : GAME_ROLES[j]).toLowerCase();
    if(sc){ if(dp) sc._playerId = dp.id; _prefillRawStats(j, sc); }
    renderPillarSliders(rl, j);
    if(sc) _prefillPillarSuggestions(j, rl, sc);
    updateComputedStats(j);
  }
}

function _prefillRawStats(i, sc){
  function setv(id, v){
    const el = document.getElementById(id);
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
  const pillars = PILLAR_MAP[role] || [];
  for(let n = 0; n < pillars.length; n++){
    const sug = calculateSuggestion(role, n, sc);
    if(sug == null) continue;
    const inp  = document.getElementById('lp-p'+n+'-'+i);
    const disp = document.getElementById('lp-pv'+n+'-'+i);
    if(inp)  inp.value = sug;
    if(disp) disp.textContent = parseFloat(sug).toFixed(0);
  }
}

function onLogRoleChange(i){
  const roleEl = document.getElementById('lp-role-'+i);
  const role   = roleEl ? roleEl.value.toLowerCase() : '';
  renderPillarSliders(role, i);
  updateComputedStats(i);
}

function updateComputedStats(slotIdx){
  const container = document.getElementById('lp-computed-'+slotIdx);
  if(!container) return;

  const kills    = parseFloat(document.getElementById('lp-kills-'+slotIdx)?.value)         || 0;
  const deaths   = parseFloat(document.getElementById('lp-deaths-'+slotIdx)?.value)        || 0;
  const assists  = parseFloat(document.getElementById('lp-assists-'+slotIdx)?.value)       || 0;
  const gold     = parseFloat(document.getElementById('lp-gold-'+slotIdx)?.value)          || 0;
  const dmgDealt = parseFloat(document.getElementById('lp-dmg_dealt_raw-'+slotIdx)?.value) || 0;
  const dmgTaken = parseFloat(document.getElementById('lp-dmg_taken_raw-'+slotIdx)?.value) || 0;
  const role     = (document.getElementById('lp-role-'+slotIdx)?.value || '').toLowerCase();

  const durSec   = App.log.matchInfo && App.log.matchInfo.duration_seconds;
  const durMin   = durSec ? durSec / 60 : 0;
  const durLabel = (App.log.matchInfo && App.log.matchInfo.duration) || null;
  const teamK    = (App.log.matchInfo && App.log.matchInfo.team_total_kills) || 0;

  const oppRow  = App.log.enemyRoles ? App.log.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
  const oppGold = oppRow ? (oppRow.gold || 0) : 0;

  const kda         = ((kills + assists) / Math.max(deaths, 1)).toFixed(2);
  const goldPerMin  = (durMin > 0 && gold > 0)       ? Math.round(gold / durMin)            : null;
  const killContrib = teamK > 0                       ? ((kills + assists) / teamK * 100).toFixed(1) + '%' : null;
  const minPerDeath = (durMin > 0 && deaths > 0)      ? (durMin / deaths).toFixed(1)         : null;
  const dmgRatio    = (dmgDealt > 0 && dmgTaken > 0)  ? (dmgDealt / dmgTaken).toFixed(2)    : null;
  const oppGoldDisp = oppGold > 0                     ? oppGold                               : null;
  const oppGPerMin  = (oppGold > 0 && durMin > 0)     ? Math.round(oppGold / durMin)          : null;

  const rows = [
    {label:'Duration',     val:durLabel,    warn:!durLabel},
    {label:'KDA',          val:kda},
    {label:'Gold / Min',   val:goldPerMin},
    {label:'Kill Contrib', val:killContrib},
    {label:'Min / Death',  val:minPerDeath},
    {label:'Dmg Ratio',    val:dmgRatio},
    {label:'Opp Gold',     val:oppGoldDisp},
    {label:'Opp G / Min',  val:oppGPerMin},
  ];

  let html = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--grey-2);">';
  html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">COMPUTED</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 6px;">';
  rows.forEach(function(s){
    const color = s.val != null ? (s.warn ? 'var(--warn)' : 'var(--white)') : 'var(--grey-3)';
    html += '<div>';
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);letter-spacing:0.5px;margin-bottom:2px;">'+s.label+'</div>';
    html += '<div style="font-family:\'DM Mono\',monospace;font-size:13px;font-weight:500;color:'+color+';">'+(s.val!=null?s.val:'—')+'</div>';
    html += '</div>';
  });
  html += '</div></div>';
  container.innerHTML = html;
}

function renderPillarSliders(role, slotIdx){
  const container = document.getElementById('lp-pillars-'+slotIdx);
  if(!container) return;
  const pillars = PILLAR_MAP[role] || [];
  if(!pillars.length){ container.innerHTML = ''; return; }
  let html = '';
  for(let n = 0; n < pillars.length; n++){
    const pName    = pillars[n];
    const isManual = MANUAL_PILLARS.has(pName);
    const dispId   = 'lp-pv'+n+'-'+slotIdx;
    const inpId    = 'lp-p'+n+'-'+slotIdx;
    html += '<div class="pillar-row">';
    html += '<div class="pillar-label-row">';
    html += '<span class="pillar-label">'+pName+'</span>';
    html += '<span class="pillar-val" id="'+dispId+'">5</span>';
    html += '</div>';
    if(!isManual){
      html += '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;">Stat-based — drag to override</div>';
    }
    html += '<input type="range" class="pillar-slider" id="'+inpId+'" min="1" max="10" step="1" value="5" oninput="updatePillarDisplay(this,\''+dispId+'\')" />';
    html += '</div>';
  }
  container.innerHTML = html;
}

function updatePillarDisplay(input, displayId){
  const el = document.getElementById(displayId);
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
  const cur={};
  BENCHMARK_ROLES.forEach(function(role){
    cur[role]={};
    BENCHMARK_FIELDS[role].forEach(function(f){ cur[role][f.k]={value:'',auto:false}; });
  });
  return cur;
}
// Normalise any stored config so every role/field exists.
function _benchMergeShape(cfg){
  const out=_benchEmptyConfig();
  if(cfg&&typeof cfg==='object'){
    BENCHMARK_ROLES.forEach(function(role){
      BENCHMARK_FIELDS[role].forEach(function(f){
        const src=cfg[role]&&cfg[role][f.k];
        if(src&&typeof src==='object'){
          out[role][f.k]={value:(src.value==null?'':src.value),auto:!!src.auto};
        }
      });
    });
  }
  return out;
}
function _benchLoadStore(){
  let raw=null;
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
// Compute a metric from a not-yet-saved log entry (App.log.scores row + App.log.matchInfo).
function _benchMetricFromRaw(fieldKey, raw){
  if(!raw) return null;
  const mi=(typeof App.log!=='undefined'&&App.log.matchInfo)?App.log.matchInfo:{};
  const durMin=mi.duration_seconds?mi.duration_seconds/60:0;
  const teamK=mi.team_total_kills||0;
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
  const vals=[];
  (App.cache.games||[]).forEach(function(g){
    const s=g.playerScores&&g.playerScores[playerId];
    if(!s) return;
    if((s.role||'').toLowerCase()!==role) return;
    const v=_benchMetricFromScore(fieldKey,s,g);
    if(v!=null&&!isNaN(v)) vals.push(v);
  });
  if(vals.length<3) return null;
  return vals.reduce(function(a,b){return a+b;},0)/vals.length;
}
// ── THE single source for benchmark values — swap this out later. ──
// Returns the resolved benchmark number, or null for a "Not set" metric.
function getBenchmark(role, fieldKey, playerId){
  const cell=_benchStore().current[role] && _benchStore().current[role][fieldKey];
  if(!cell) return null;
  const fixed=(cell.value!==''&&cell.value!=null&&!isNaN(parseFloat(cell.value))) ? parseFloat(cell.value) : null;
  if(cell.auto){
    const avg=_benchPlayerAvg(role,fieldKey,playerId);
    if(avg!=null) return avg;
    return fixed; // <3 games — fall back to fixed (null => Not set)
  }
  return fixed; // Auto off — fixed number, or null when blank => Not set
}

function calculateSuggestion(role, pillarIndex, rawStats){
  if(!role||!rawStats) return null;
  role=String(role).toLowerCase();
  const fields=BENCHMARK_FIELDS[role];
  if(!fields||pillarIndex<0||pillarIndex>=fields.length) return null;
  const fieldKey=fields[pillarIndex].k;
  const playerId=rawStats._playerId||rawStats.playerId||rawStats.id||null;
  const benchmark=getBenchmark(role,fieldKey,playerId);
  if(benchmark==null||benchmark<=0) return null; // Not set — skip this metric
  const actual=_benchMetricFromRaw(fieldKey,rawStats);
  if(actual==null||isNaN(actual)) return null;
  return _benchScale(actual,benchmark);
}

// Shared scaler: 5 = at benchmark, linear, clamped + rounded to 1-10.
function _benchScale(actual,benchmark){
  if(actual==null||isNaN(actual)||benchmark==null||benchmark<=0) return null;
  let score=5*(actual/benchmark);
  if(score<1) score=1;
  if(score>10) score=10;
  return Math.round(score);
}

// Benchmark suggestion from a stored player_scores_v2 row (used by the edit-game page).
function calculateSuggestionFromScore(role, pillarIndex, score, game, playerId){
  if(!role||!score) return null;
  role=String(role).toLowerCase();
  const fields=BENCHMARK_FIELDS[role];
  if(!fields||pillarIndex<0||pillarIndex>=fields.length) return null;
  const fieldKey=fields[pillarIndex].k;
  const benchmark=getBenchmark(role,fieldKey,playerId||score._playerId||null);
  if(benchmark==null||benchmark<=0) return null;
  return _benchScale(_benchMetricFromScore(fieldKey,score,game),benchmark);
}

function _dbErr(err, table){
  const msg = (err && err.message) || String(err);
  if(msg.toLowerCase().indexOf('row-level security') !== -1 || (err && (err.code === '42501' || err.status === 401 || err.status === 403))){
    showToast('Permission denied on '+table+' — run supabase-setup.sql in Supabase dashboard');
  } else {
    showToast('DB error ('+table+'): '+msg);
  }
}

async function saveGame(){
  const btn = document.getElementById('save-game-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }

  const _restoreBtn = function(){
    if(btn){ btn.disabled = false; btn.textContent = 'Save Game'; }
  };

  try{
    const result = App.log.matchInfo.result;
    const date   = App.log.matchInfo.date;
    if(!result){ showToast('Result is required'); _restoreBtn(); return; }
    if(!date){   showToast('Match date is required'); _restoreBtn(); return; }

    // Soft warning — no block
    if(!App.log.matchInfo.duration_seconds && !App.log.matchInfo.team_total_kills){
      showToast('Tip: duration or kills not set — saving anyway');
    }

    // Build games_v2 row
    const gameRow = {
      match_date:        App.log.matchInfo.date,
      result:            App.log.matchInfo.result === 'Win' ? 'win' : 'loss',
      game_type:         (App.log.matchInfo.type || 'Scrim').toLowerCase(),
      opponent_name:     App.log.matchInfo.opponent  || null,
      duration_seconds:  App.log.matchInfo.duration_seconds || null,
      team_total_kills:  App.log.matchInfo.team_total_kills  || null,
      enemy_total_kills: App.log.matchInfo.enemy_total_kills || null,
      vod_url:           App.log.matchInfo.vod_url  || null,
      notes:             App.log.matchInfo.notes    || null,
      enemy_roles: App.log.enemyRoles
        ? Object.fromEntries(App.log.enemyRoles.filter(function(e){ return e.role; }).map(function(e){ return [e.role.toLowerCase(), e.hero]; }))
        : null,
      enemy_gold: App.log.enemyRoles
        ? Object.fromEntries(App.log.enemyRoles.filter(function(e){ return e.role && e.gold != null; }).map(function(e){ return [e.role.toLowerCase(), e.gold]; }))
        : null,
      team_total_gold:  null,
      enemy_total_gold: App.log.enemyRoles
        ? App.log.enemyRoles.reduce(function(s,e){ return s+(e.gold||0); }, 0) || null
        : null,
    };

    // Per-player data
    const playerRows = [];
    let teamTotalGold = 0;
    const durMin = (App.log.matchInfo.duration_seconds || 0) / 60;

    for(let i = 0; i < 5; i++){
      const pid          = document.getElementById('lp-player-'+i)?.value || null;
      const hero         = (document.getElementById('lp-hero-'+i)?.value||'').trim() || null;
      var role         = (document.getElementById('lp-role-'+i)?.value||'').toLowerCase();
      const kills        = parseFloat(document.getElementById('lp-kills-'+i)?.value)        || 0;
      const deaths       = parseFloat(document.getElementById('lp-deaths-'+i)?.value)       || 0;
      const assists      = parseFloat(document.getElementById('lp-assists-'+i)?.value)      || 0;
      const gold         = parseFloat(document.getElementById('lp-gold-'+i)?.value)         || 0;
      const rating       = parseFloat(document.getElementById('lp-in_game_rating-'+i)?.value) || null;
      const dmgDealtPct  = parseFloat(document.getElementById('lp-dmg_dealt_pct-'+i)?.value)  || null;
      const dmgTakenPct  = parseFloat(document.getElementById('lp-dmg_taken_pct-'+i)?.value)  || null;
      const dmgDealtRaw  = parseFloat(document.getElementById('lp-dmg_dealt_raw-'+i)?.value)  || null;
      const dmgTakenRaw  = parseFloat(document.getElementById('lp-dmg_taken_raw-'+i)?.value)  || null;
      const note         = (document.getElementById('lp-note-'+i)?.value||'').trim() || null;
      const p1           = parseFloat(document.getElementById('lp-p0-'+i)?.value) || null;
      const p2           = parseFloat(document.getElementById('lp-p1-'+i)?.value) || null;
      const p3           = parseFloat(document.getElementById('lp-p2-'+i)?.value) || null;
      const p4           = parseFloat(document.getElementById('lp-p3-'+i)?.value) || null;

      teamTotalGold += gold || 0;

      const kda            = (kills + assists) / Math.max(deaths, 1);
      const goldPerMin     = durMin > 0 ? gold / durMin : null;
      const minPerDeath    = durMin > 0 ? durMin / Math.max(deaths, 1) : null;
      const killContribPct = (kills + assists) / Math.max(App.log.matchInfo.team_total_kills || 1, 1) * 100;
      const dmgRatio       = (dmgDealtRaw && dmgTakenRaw) ? dmgDealtRaw / Math.max(dmgTakenRaw, 1) : null;
      const oppRole        = App.log.enemyRoles ? App.log.enemyRoles.find(function(e){ return e.role && e.role.toLowerCase() === role; }) : null;
      const oppGold        = oppRole ? (oppRole.gold || null) : null;
      const oppGoldPerMin  = (oppGold && durMin > 0) ? oppGold / durMin : null;

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
    const enemyRows = [];
    if(App.log.enemyRoles && App.log.enemyRoles.length){
      App.log.enemyRoles.forEach(function(e){
        enemyRows.push({
          game_id:   null,
          hero_name: e.hero || null,
          role:      e.role ? e.role.toLowerCase() : null,
          gold:      e.gold || null,
        });
      });
    }

    // 1. Insert game row
    const gRes = await sb.from('games_v2').insert(gameRow).select('id').single();
    if(gRes.error){ _dbErr(gRes.error, 'games_v2'); _restoreBtn(); return; }
    const gameId = gRes.data.id;

    // Attach game_id to child rows
    playerRows.forEach(function(r){ r.game_id = gameId; });
    enemyRows.forEach(function(r){  r.game_id = gameId; });

    // 2. Parallel child inserts — check both for errors
    const results = await Promise.all([
      sb.from('player_scores_v2').insert(playerRows),
      enemyRows.length ? sb.from('enemy_picks').insert(enemyRows) : Promise.resolve({error:null}),
    ]);
    const pErr = results[0] && results[0].error;
    const eErr = results[1] && results[1].error;
    if(pErr){ _dbErr(pErr, 'player_scores_v2'); _restoreBtn(); return; }
    if(eErr){ _dbErr(eErr, 'enemy_picks'); }

    // Update local cache so hero page reflects the save immediately
    (function(){
      const newPS={};
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
      App.cache.games.unshift({
        id:gameId,date:App.log.matchInfo.date,
        type:App.log.matchInfo.type||'Scrim',gameNum:1,gameName:'',
        result:App.log.matchInfo.result,opponent:App.log.matchInfo.opponent||'',
        oppTier:'',notes:App.log.matchInfo.notes||'',playerScores:newPS,
        duration_seconds:App.log.matchInfo.duration_seconds||null,
        team_total_kills:App.log.matchInfo.team_total_kills||null,
        enemy_total_kills:App.log.matchInfo.enemy_total_kills||null,
        enemyPicks:enemyRows.map(function(e){return {hero:e.hero_name,role:e.role,gold:e.gold};}),
        matchMentality:{},matchId:App.log._matchId||null,mvpPlayerId:null,savedAt:new Date().toISOString(),
      });
    })();

    // If launched from a match, link the game now
    const _returnMatchId = App.log._matchId||null;
    if(_returnMatchId){
      try{ await sbAssignGameToMatch(gameId, _returnMatchId); }catch(e){ console.warn('match link failed',e); }
    }

    showToast('✓ Game saved');
    resetLog();
    if(_returnMatchId) showMatchDetail(_returnMatchId);

  }catch(err){
    console.error('saveGame error', err);
    showToast('Save error: '+(err.message||String(err)));
    _restoreBtn();
  }
}

function resetLog(){
  App.log.matchInfo = {};
  App.log.scores    = {};
  App.log.enemyRoles = null;
  App.log.scanEnemy = null;
  App.log._pendingOppTeam = null;
  App.log._step = 0;
  showPage('page-home');
}

// ══════════════════════════════════════════
// STUB FUNCTIONS (placeholders for pages not yet rebuilt)
// ══════════════════════════════════════════
function initTiers(){
  const meta=document.getElementById('tier-meta-section');
  const mastery=document.getElementById('tier-mastery-section');
  const history=document.getElementById('tier-history-section');
  const tMeta=document.getElementById('tmode-meta');
  const tMastery=document.getElementById('tmode-mastery');
  const tHistory=document.getElementById('tmode-history');
  if(!meta)return;
  // Default to meta mode if nothing active
  const active=document.querySelector('.tier-mode-btn.active[id^="tmode-"]');
  if(!active){if(tMeta)tMeta.classList.add('active');meta.style.display='';if(mastery)mastery.style.display='none';if(history)history.style.display='none';}
  renderMetaTiers();
}
function setTierMode(mode){
  ['meta','mastery','history'].forEach(function(m){
    const btn=document.getElementById('tmode-'+m);
    const sec=document.getElementById('tier-'+m+'-section');
    if(btn)btn.classList.toggle('active',m===mode);
    if(sec)sec.style.display=m===mode?'':'none';
  });
  if(mode==='meta')renderMetaTiers();
  else if(mode==='mastery')renderMasteryTiers();
  else renderPatchHistory();
}
function renderMetaTiers(){
  const data=loadData();
  const metaTiers=data.metaTiers||{};
  const role=App.ui.metaRole||GAME_ROLES[0];
  const roles=GAME_ROLES;
  document.getElementById('meta-role-tabs').innerHTML=roles.map(function(r){
    return '<button class="tier-role-tab'+(r===role?' active':'')+'" onclick="setMetaRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  const byTier={};
  META_LEVELS.forEach(function(l){byTier[l.key]=[];});
  const unplaced=[];
  const allH=getLiveHeroes().concat(App.cache.customHeroes||[]);
  allH.filter(function(h){return h.roles.includes(role);}).forEach(function(h){
    const t=metaTiers[h.name]&&metaTiers[h.name][role];
    if(t&&byTier[t])byTier[t].push(h.name);
    else unplaced.push(h.name);
  });
  const bandsEl=document.getElementById('meta-tier-bands');
  if(bandsEl)bandsEl.innerHTML=META_LEVELS.map(function(l){
    const chips=(byTier[l.key]||[]).map(function(name){
      return '<div class="tier-hero-chip placed" onclick="openTierAssign(\''+encodeURIComponent(name)+'\',\''+role+'\',\'meta\')">'+
        heroPortraitHtml(name,22,false)+
        '<span>'+name+'</span>'+
        '<button class="chip-edit" onclick="event.stopPropagation();openHeroEditModal(decodeURIComponent(\''+encodeURIComponent(name)+'\'))">✎</button>'+
      '</div>';
    }).join('');
    return '<div class="tier-band"><div class="tier-band-header"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span class="tier-band-desc">'+l.desc+'</span></div><div class="tier-hero-grid">'+chips+'</div></div>';
  }).join('');
  const upEl=document.getElementById('meta-unplaced');
  if(upEl)upEl.innerHTML=unplaced.map(function(name){
    return '<div class="tier-hero-chip" onclick="openTierAssign(\''+encodeURIComponent(name)+'\',\''+role+'\',\'meta\')">'+heroPortraitHtml(name,22,false)+'<span>'+name+'</span></div>';
  }).join('');
  const pn=document.getElementById('patch-name-display');
  if(pn)pn.textContent=(App.cache.patches&&App.cache.patches.length?App.cache.patches[App.cache.patches.length-1].name:'Current');
}
function setMetaRole(r){App.ui.metaRole=r;renderMetaTiers();}
function renderMasteryTiers(){
  App.players=getPlayers();
  const pid=App.ui.masteryPlayer||(App.players[0]&&App.players[0].id)||null;
  App.ui.masteryPlayer=pid;
  const masteryRole=App.ui.masteryRole||GAME_ROLES[0];
  const selEl=document.getElementById('mastery-player-selector');
  if(selEl)selEl.innerHTML=App.players.filter(function(p){return p.active;}).map(function(p){
    return '<button class="player-chip'+(p.id===pid?' active':'')+'" onclick="setMasteryPlayer(\''+p.id+'\')">'+p.nick+'</button>';
  }).join('');
  document.getElementById('mastery-role-tabs').innerHTML=GAME_ROLES.map(function(r){
    return '<button class="tier-role-tab'+(r===masteryRole?' active':'')+'" onclick="setMasteryRole(\''+r+'\')">'+r+'</button>';
  }).join('');
  const data=loadData();
  const masteryTiers=(data.masteryTiers||{})[pid]||{};
  const metaTiers=data.metaTiers||{};
  const allH=getLiveHeroes().concat(App.cache.customHeroes||[]);
  const roleH=allH.filter(function(h){return h.roles.includes(masteryRole);});
  const byTier={};MASTERY_LEVELS.forEach(function(l){byTier[l.key]=[];});const unplaced=[];
  roleH.forEach(function(h){const t=masteryTiers[h.name];if(t&&byTier[t])byTier[t].push(h.name);else unplaced.push(h.name);});
  const sa=document.getElementById('mastery-score-area');
  if(sa&&pid){const hp=calcHeroPoolScore(pid);sa.innerHTML='<div class="hp-score-card"><div class="hp-score-big">'+hp.pct+'%</div><div class="hp-score-sub">HERO POOL SCORE — '+masteryRole.toUpperCase()+'</div></div>';}
  const bandsEl=document.getElementById('mastery-tier-bands');
  if(bandsEl)bandsEl.innerHTML=MASTERY_LEVELS.map(function(l){
    const chips=(byTier[l.key]||[]).map(function(name){
      const mt=metaTiers[name]&&metaTiers[name][masteryRole];
      return '<div class="tier-hero-chip placed" onclick="openTierAssign(\''+encodeURIComponent(name)+'\',\''+masteryRole+'\',\'mastery\')">'+
        heroPortraitHtml(name,22,false)+
        (mt?'<span class="chip-class">'+mt+'</span>':'')+
        '<span>'+name+'</span>'+
      '</div>';
    }).join('');
    return '<div class="tier-band"><div class="tier-band-header"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span class="tier-band-desc">'+l.desc+'</span></div><div class="tier-hero-grid">'+chips+'</div></div>';
  }).join('');
  const upEl=document.getElementById('mastery-unplaced');
  if(upEl)upEl.innerHTML=unplaced.map(function(name){
    return '<div class="tier-hero-chip" onclick="openTierAssign(\''+encodeURIComponent(name)+'\',\''+masteryRole+'\',\'mastery\')">'+heroPortraitHtml(name,22,false)+'<span>'+name+'</span></div>';
  }).join('');
}
function setMasteryPlayer(pid){App.ui.masteryPlayer=pid;renderMasteryTiers();}
function setMasteryRole(r){App.ui.masteryRole=r;renderMasteryTiers();}
function renderPatchHistory(){
  const patches=(App.cache.patches||[]).slice().reverse();
  const el=document.getElementById('patch-history-list');
  if(!el)return;
  if(!patches.length){el.innerHTML='<div class="empty"><div class="empty-text">No patches saved yet</div></div>';return;}
  el.innerHTML=patches.map(function(p){
    return '<div class="patch-history-row"><div style="flex:1;"><div style="font-size:13px;font-weight:600;">'+p.name+'</div><div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+new Date(p.savedAt).toLocaleDateString('en-GB')+'</div></div></div>';
  }).join('');
}
function openTierAssign(encodedName,role,mode){
  const heroName=decodeURIComponent(encodedName);
  const data=loadData();
  const levels=mode==='meta'?META_LEVELS:MASTERY_LEVELS;
  const current=mode==='meta'?(data.metaTiers[heroName]&&data.metaTiers[heroName][role]):((data.masteryTiers[App.ui.masteryPlayer]||{})[heroName]);
  document.getElementById('tier-assign-title').textContent=(mode==='meta'?'META TIER':'MASTERY TIER')+' · '+heroName;
  document.getElementById('tier-assign-body').innerHTML=
    '<div style="margin-bottom:16px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+role.toUpperCase()+'</div>'+
    levels.map(function(l){return '<button class="btn btn-full'+(current===l.key?' btn-primary':'')+' mb-0" style="margin-bottom:8px;justify-content:space-between;" onclick="assignTier(\''+encodedName+'\',\''+role+'\',\''+l.key+'\',\''+mode+'\')"><span class="tier-band-letter '+l.cls+'">'+l.label+'</span><span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+l.desc+'</span></button>';}).join('')+
    '<button class="btn btn-full btn-danger btn-sm" style="margin-top:8px;" onclick="assignTier(\''+encodedName+'\',\''+role+'\',null,\''+mode+'\')">Remove Tier</button>';
  document.getElementById('tier-assign-modal').classList.add('open');
}
async function assignTier(encodedName,role,tier,mode){
  const heroName=decodeURIComponent(encodedName);
  const data=loadData();
  if(mode==='meta'){
    if(!data.metaTiers[heroName])data.metaTiers[heroName]={};
    if(tier)data.metaTiers[heroName][role]=tier;
    else delete data.metaTiers[heroName][role];
    App.cache.metaTiers=data.metaTiers;
    await sbSaveMetaTier(heroName,role,tier);
  } else {
    const pid=App.ui.masteryPlayer;
    if(!data.masteryTiers[pid])data.masteryTiers[pid]={};
    if(tier)data.masteryTiers[pid][heroName]=tier;
    else delete data.masteryTiers[pid][heroName];
    App.cache.masteryTiers=data.masteryTiers;
    await sbSaveMasteryTier(pid,heroName,tier);
  }
  closeModal('tier-assign-modal');
  mode==='meta'?renderMetaTiers():renderMasteryTiers();
}
function openPatchModal(){document.getElementById('patch-modal').classList.add('open');}
async function savePatch(){
  const name=(document.getElementById('patch-input')?.value||'').trim();
  if(!name){showToast('Enter a patch name');return;}
  const data=loadData();
  const p={name:name,savedAt:new Date().toISOString(),metaTiers:JSON.parse(JSON.stringify(data.metaTiers))};
  App.cache.patches.push(p);
  await sbSavePatch(p);
  closeModal('patch-modal');
  showToast('Patch "'+name+'" saved');
}
function renderCompare(){
  App.players=getPlayers();
  const aEl=document.getElementById('cmp-a');const bEl=document.getElementById('cmp-b');
  if(!aEl||!bEl)return;
  const opts=App.players.map(function(p){return '<option value="'+p.id+'">'+p.nick+' ('+p.role+')</option>';}).join('');
  if(!aEl.innerHTML)aEl.innerHTML=opts;
  if(!bEl.innerHTML){bEl.innerHTML=opts;if(App.players.length>1)bEl.selectedIndex=1;}
  const aId=aEl.value,bId=bEl.value;
  const pA=App.players.find(function(p){return p.id===aId;}),pB=App.players.find(function(p){return p.id===bId;});
  const data=loadData();
  const cc=document.getElementById('compare-content');if(!cc)return;
  if(!pA||!pB){cc.innerHTML='<div class="empty"><div class="empty-icon">⚖️</div><div class="empty-text">Select two players</div></div>';return;}

  const COL_A='rgba(100,180,255,1)',COL_B='rgba(80,220,140,1)';
  const roleA=(pA.role||'').toLowerCase(),roleB=(pB.role||'').toLowerCase();
  const pillarsA=PILLAR_MAP[roleA]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  const pillarsB=PILLAR_MAP[roleB]||['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];

  // Game lists backed by player_scores_v2 (skip un-scored / skipped entries)
  function pGames(pid){return (data.games||[]).filter(function(g){const s=g.playerScores&&g.playerScores[pid];return s&&!s.skipped;});}
  const gamesA=pGames(aId),gamesB=pGames(bId);
  function avgPillar(pid,gs,idx){
    const vals=gs.map(function(g){const ps=g.playerScores[pid].pillar_scores;return ps?ps['p'+idx]:null;}).filter(function(v){return v!=null&&v>0;});
    return vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
  }
  const stA=getPlayerStats(aId,data.games),stB=getPlayerStats(bId,data.games);

  // ── Player header (compare UI shell from old site) ──
  function avHtml(p,pfp,bc){
    if(pfp)return '<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:1px solid '+bc+';flex-shrink:0;"><img src="'+pfp+'" style="width:100%;height:100%;object-fit:cover;"/></div>';
    return '<div style="width:36px;height:36px;border-radius:50%;background:var(--grey-3);display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:15px;color:var(--grey-6);border:1px solid '+bc+';">'+p.nick[0]+'</div>';
  }
  const pfpA=data.pfp&&data.pfp[aId],pfpB=data.pfp&&data.pfp[bId];
  const header='<div style="display:flex;gap:16px;justify-content:center;align-items:center;padding:14px 20px 4px;">'+
    '<div style="display:flex;align-items:center;gap:8px;">'+avHtml(pA,pfpA,COL_A)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+COL_A+';">'+pA.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pA.role||'')+'</div></div></div>'+
    '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-4);">VS</div>'+
    '<div style="display:flex;align-items:center;gap:8px;">'+avHtml(pB,pfpB,COL_B)+'<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:'+COL_B+';">'+pB.nick+'</div><div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">'+(pB.role||'')+'</div></div></div>'+
  '</div>';

  // ── GRADED STATS — horizontal bar chart, each player keeps their own role labels ──
  function gradeTxt(v){const g=v>0?scoreToGrade(v):null;return g?g.grade:'';}
  function barRow(lbl,val,col){
    const pct=val>0?Math.max(val/10*100,3):0;
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
  let graded='<div class="section-label" style="padding:16px 20px 8px;">Graded Performance <span style="color:var(--grey-4);">· avg of logged games</span></div>';
  graded+=aspectBlock('30-Day Overall', pA.nick, stA.monthAvg, pB.nick, stB.monthAvg);
  [0,1,2,3].forEach(function(i){
    graded+=aspectBlock('Aspect '+(i+1),
      pillarsA[i]||('Pillar '+(i+1)), avgPillar(aId,gamesA,i),
      pillarsB[i]||('Pillar '+(i+1)), avgPillar(bId,gamesB,i));
  });

  // ── RAW STATS — separate window at the bottom ──
  function rawAgg(pid,gs){
    const r={g:gs.length,k:0,d:0,a:0,gpmS:0,gpmN:0,rS:0,rN:0,ddS:0,ddN:0,dtS:0,dtN:0};
    gs.forEach(function(g){const s=g.playerScores[pid];
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
  const rA=rawAgg(aId,gamesA),rB=rawAgg(bId,gamesB);
  function rawRow(lbl,a,b,aN,bN){
    const hi=aN!=null&&bN!=null;
    const aWin=hi&&aN>bN,bWin=hi&&bN>aN;
    return '<div class="compare-table-row">'+
      '<div class="compare-table-cell">'+lbl+'</div>'+
      '<div class="compare-table-cell mono '+(aWin?'compare-winner':bWin?'compare-loser':'')+'">'+a+'</div>'+
      '<div class="compare-table-cell mono '+(bWin?'compare-winner':aWin?'compare-loser':'')+'">'+b+'</div>'+
    '</div>';
  }
  function f1(v){return v!=null?v.toFixed(1):'--';}
  const rawWin='<div class="section-label" style="padding:18px 20px 8px;">Raw Stats <span style="color:var(--grey-4);">· informational · not scored</span></div>'+
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
  const d=new Date();
  const inp=document.getElementById('cm-date');
  if(inp)inp.value=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  document.getElementById('cm-name').value='';
  document.getElementById('cm-notes').value='';
  document.getElementById('create-match-modal').classList.add('open');
}
async function saveCreateMatch(){
  const name=(document.getElementById('cm-name')?.value||'').trim();
  const date=(document.getElementById('cm-date')?.value||'').trim();
  const type=document.getElementById('cm-type')?.value||'Scrim';
  const oppTier=document.getElementById('cm-opp-tier')?.value||'';
  const notes=(document.getElementById('cm-notes')?.value||'').trim();
  if(!name){showToast('Match name is required');return;}
  const id=crypto.randomUUID();
  const matchObj={id,name,date,type,oppTier,notes,mentality:{},tournamentId:null};
  try{
    const newId=await sbSaveMatch(matchObj);
    matchObj.id=newId||id;
    App.cache.matches.unshift({...matchObj,createdAt:new Date().toISOString()});
    closeModal('create-match-modal');
    showToast('Match created');
    renderHistory();
  }catch(e){showToast('Save failed: '+(e.message||e));}
}
function exportCSV(){
  const games=(App.cache.games||[]).slice().sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);});
  const players=App.cache.players||[];
  const lines=['Date\tResult\tType\tOpponent\tDuration\tPlayer\tRole\tHero\tKills\tDeaths\tAssists\tGold/Min\tRating\tP1\tP2\tP3\tP4'];
  games.forEach(function(g){
    const dur=g.duration_seconds?Math.floor(g.duration_seconds/60)+':'+(''+(g.duration_seconds%60)).padStart(2,'0'):'';
    players.forEach(function(p){
      const s=g.playerScores&&g.playerScores[p.id];
      if(!s)return;
      const ps=s.pillar_scores||{};
      lines.push([g.date,g.result,g.type,g.opponent||'',dur,p.nick,s.role||'',s.hero||'',s.kills||0,s.deaths||0,s.assists||0,s.gold_per_min!=null?s.gold_per_min.toFixed(1):'',s.in_game_rating!=null?s.in_game_rating:'',ps.p0||'',ps.p1||'',ps.p2||'',ps.p3||''].join('\t'));
    });
  });
  const text=lines.join('\n');
  document.getElementById('export-text').value=text;
  document.getElementById('export-modal').classList.add('open');
}
function selectExportText(){const el=document.getElementById('export-text');if(el){el.select();try{document.execCommand('copy');showToast('Copied to clipboard');}catch(e){}}}
var _benchTab='carry';
function _benchEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function openBenchmarkPanel(){
  _benchmarkStore=_benchLoadStore();
  document.getElementById('benchmark-modal').classList.add('open');
  renderBenchmarkModal();
}
function setBenchTab(role){ _benchTab=role; renderBenchmarkModal(); }

function renderBenchmarkModal(){
  const el=document.getElementById('benchmark-body');if(!el)return;
  const store=_benchStore();
  const role=_benchTab;
  let html='';
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
    const cell=store.current[role][f.k]||{value:'',auto:false};
    const notSet=(cell.value===''||cell.value==null)&&!cell.auto;
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
  const presetNames=Object.keys(store.presets||{}).sort();
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
  const store=_benchStore();
  if(!store.current[role]) store.current[role]={};
  if(!store.current[role][key]) store.current[role][key]={value:'',auto:false};
  if(prop==='value') store.current[role][key].value=(val===''?'':val);
  else store.current[role][key].auto=!!val;
  _benchSaveStore(store);
  if(prop==='auto') renderBenchmarkModal();
}

function benchSavePreset(){
  const inp=document.getElementById('bench-preset-name');
  const name=((inp&&inp.value)||'').trim();
  if(!name){ showToast('Enter a preset name'); return; }
  const store=_benchStore();
  store.presets[name]=JSON.parse(JSON.stringify(store.current));
  _benchSaveStore(store);
  showToast('Preset "'+name+'" saved');
  renderBenchmarkModal();
}

function benchLoadPreset(){
  const sel=document.getElementById('bench-preset-select');
  const name=sel&&sel.value;
  if(!name){ showToast('No preset selected'); return; }
  const store=_benchStore();
  if(!store.presets[name]){ showToast('Preset not found'); return; }
  store.current=_benchMergeShape(store.presets[name]);
  _benchSaveStore(store);
  showToast('Loaded preset "'+name+'"');
  renderBenchmarkModal();
}

function benchDeletePreset(){
  const sel=document.getElementById('bench-preset-select');
  const name=sel&&sel.value;
  if(!name){ showToast('No preset selected'); return; }
  if(!confirm('Delete preset "'+name+'"? This cannot be undone.')) return;
  const store=_benchStore();
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
  const el = document.getElementById('history-list');
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
  let d;
  if(dateStr.includes('-') && dateStr.length >= 10){
    d = new Date(dateStr+'T00:00:00');
  } else {
    const p = dateStr.split('/');
    d = new Date(+p[2], +p[1]-1, +p[0]);
  }
  if(isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

function _fmtDuration(secs){
  if(!secs) return null;
  const m = Math.floor(secs/60);
  const s = secs % 60;
  return m + ':' + (''+s).padStart(2,'0');
}

function _renderGameList(el){
  const games = (App.cache.games||[]).slice().sort(function(a,b){
    return new Date(b.savedAt||0) - new Date(a.savedAt||0);
  });
  if(!games.length){
    el.innerHTML = '<div class="empty" style="padding:40px 20px;"><div class="empty-icon">📋</div><div class="empty-text">No games logged yet</div></div>';
    return;
  }
  el.innerHTML = '<div style="padding:10px 0 2px;">' + games.map(function(g){
    const incomplete = Object.keys(g.playerScores||{}).length === 0;
    const isWin = g.result === 'Win';
    const badge = incomplete ?
      '<span class="tag tag-dnp" style="font-size:9px;letter-spacing:1px;padding:4px 8px;">INCOMPLETE</span>' :
      '<span class="game-card-badge '+(isWin?'game-card-badge-win':'game-card-badge-loss')+'">'+(isWin?'WIN':'LOSS')+'</span>';
    const opp = g.opponent || 'Unknown Opponent';
    const dur = _fmtDuration(g.duration_seconds);
    const typeTag = g.type === 'Tournament' ?
      '<span class="tag tag-tourney" style="font-size:8px;padding:2px 6px;">TOURNAMENT</span>' :
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">Scrim</span>';
    const trashBtn = '<button title="Delete game" onclick="event.stopPropagation();deleteGame(\''+g.id+'\')" style="background:none;border:none;color:var(--grey-5);cursor:pointer;padding:6px;flex-shrink:0;" onmouseover="this.style.color=\'var(--danger)\'" onmouseout="this.style.color=\'var(--grey-5)\'">'+
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
  const c = document.getElementById('del-game-confirm-'+gameId);
  if(c){ c.classList.add('open'); return; }
  confirmDeleteGame(gameId);
}
async function confirmDeleteGame(gameId){
  try{
    await sbDeleteGame(gameId);
    App.cache.games = (App.cache.games||[]).filter(function(g){return g.id!==gameId;});
    closeModal('game-detail-modal');
    renderHistory();
    showToast('✓ Game deleted');
  }catch(err){
    showToast('Delete failed: '+(err.message||String(err)));
  }
}

function _renderMatchList(el){
  const matches = (App.cache.matches||[]).slice().sort(function(a,b){
    return new Date(b.createdAt||0) - new Date(a.createdAt||0);
  });
  if(!matches.length){
    el.innerHTML = '<div class="empty" style="padding:40px 20px;"><div class="empty-icon">📋</div><div class="empty-text">No matches yet — create one above</div></div>';
    return;
  }
  el.innerHTML = '<div style="padding:10px 0 2px;">' + matches.map(function(m){
    const mGames = (App.cache.games||[]).filter(function(g){return g.matchId===m.id;});
    const wins = mGames.filter(function(g){return g.result==='Win';}).length;
    const total = mGames.length;
    const scoreTxt = total ? wins+'–'+(total-wins) : 'No games';
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
  const game = (App.cache.games||[]).find(function(g){return g.id===gameId;});
  if(!game){showToast('Game not found');return;}
  const players = App.cache.players||[];
  const isWin = game.result==='Win';

  // Header
  document.getElementById('gdm-title').textContent = (isWin?'WIN':'LOSS') + (game.opponent?' vs '+game.opponent:'');
  const dur = _fmtDuration(game.duration_seconds);
  document.getElementById('gdm-sub').textContent = _fmtDate(game.date) + ' · ' + (game.type||'Scrim') + (dur?' · '+dur:'');
  document.getElementById('gdm-edit-btn').onclick = function(){ closeModal('game-detail-modal'); openEditGame(gameId); };
  const assignBtn = document.getElementById('gdm-assign-btn');
  assignBtn.textContent = game.matchId ? '✓ Match' : '+ Match';
  assignBtn.onclick = function(){ openAssignGameModal(null, gameId); };
  const delConfirm=document.getElementById('gdm-del-confirm');
  delConfirm.classList.remove('open');
  document.getElementById('gdm-delete-btn').onclick = function(){ delConfirm.classList.add('open'); };
  document.getElementById('gdm-del-confirm-yes').onclick = function(){ confirmDeleteGame(gameId); };

  // Body
  const body = document.getElementById('gdm-body');

  // Pillar label helper
  function pillarLabels(role){return PILLAR_MAP[(role||'').toLowerCase()]||['P1','P2','P3','P4'];}

  // Player rows
  let playerHtml = '<div class="section-label" style="padding:14px 20px 8px;">OUR TEAM</div>';
  const playersWithScores = [];
  players.forEach(function(p){
    const s = game.playerScores&&game.playerScores[p.id];
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
      const p = item.player, s = item.score;
      const role = (s.role||p.role||'').toLowerCase();
      const lbls = pillarLabels(role);
      const ps = s.pillar_scores||{};
      const pillarsHtml = ['p0','p1','p2','p3'].map(function(k,i){
        const v = ps[k];
        const pct = v ? Math.round(v/10*100) : 0;
        const col = v>=8?'var(--success)':v>=6?'var(--warn)':'var(--white)';
        return '<div style="min-width:60px;"><div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px;">'+lbls[i]+'</div>'+
          '<div class="gd-pillar-bar"><div class="gd-pillar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'+
          '<div style="font-family:\'DM Mono\',monospace;font-size:9px;margin-top:1px;color:'+col+';">'+(v!=null?v.toFixed(0):'—')+'</div>'+
        '</div>';
      }).join('');
      const kdaTxt = (s.kills||0)+'/'+(s.deaths||0)+'/'+(s.assists||0);
      const gpm = s.gold_per_min!=null ? Math.round(s.gold_per_min) : null;
      const rating = s.in_game_rating!=null ? s.in_game_rating.toFixed(1) : null;
      // Computed metrics — prefer the stored column, fall back to recomputing.
      const durMinD = game.duration_seconds ? game.duration_seconds/60 : 0;
      const kdaVal  = s.kda!=null ? s.kda : ((s.kills||0)+(s.assists||0))/Math.max(s.deaths||0,1);
      const killCt  = s.kill_contribution_pct!=null ? s.kill_contribution_pct
                      : (game.team_total_kills ? ((s.kills||0)+(s.assists||0))/game.team_total_kills*100 : null);
      const minDth  = s.min_per_death!=null ? s.min_per_death
                      : (durMinD>0 ? durMinD/Math.max(s.deaths||0,1) : null);
      const dmgRt   = s.dmg_per_dmg_taken!=null ? s.dmg_per_dmg_taken
                      : ((s.dmg_dealt_raw&&s.dmg_taken_raw) ? s.dmg_dealt_raw/Math.max(s.dmg_taken_raw,1) : null);
      const oppG    = s.opp_gold!=null ? s.opp_gold : null;
      const oppGpm  = s.opp_gold_per_min!=null ? s.opp_gold_per_min
                      : ((oppG&&durMinD>0) ? oppG/durMinD : null);
      function _gdStat(val,lbl){ return val==null?'':'<div><div class="gd-stat-val">'+val+'</div><div class="gd-stat-lbl">'+lbl+'</div></div>'; }
      const extraStats = ''+
        _gdStat(kdaVal!=null?kdaVal.toFixed(2):null,'KDA RATIO')+
        _gdStat(killCt!=null?killCt.toFixed(1)+'%':null,'KILL%')+
        _gdStat(minDth!=null?minDth.toFixed(1):null,'MIN/DTH')+
        _gdStat(dmgRt!=null?dmgRt.toFixed(2):null,'DMG RATIO')+
        _gdStat(s.dmg_dealt_raw!=null?Number(s.dmg_dealt_raw).toLocaleString():null,'DMG DEALT')+
        _gdStat(s.dmg_taken_raw!=null?Number(s.dmg_taken_raw).toLocaleString():null,'DMG TAKEN')+
        _gdStat(oppG!=null?Number(oppG).toLocaleString():null,'OPP GOLD')+
        _gdStat(oppGpm!=null?Math.round(oppGpm):null,'OPP G/MIN');
      const overallScore = calcGameScore(s, role, game, p.id);
      const grade = overallScore>0 ? scoreToGrade(overallScore) : null;
      return '<div class="gd-player-row">'+
        '<div style="flex-shrink:0;">'+
          ((App.cache.pfp&&App.cache.pfp[p.id]) ?
            '<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:1px solid var(--grey-3);flex-shrink:0;"><img src="'+App.cache.pfp[p.id]+'" style="width:100%;height:100%;object-fit:cover;"/></div>' :
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
  let enemyHtml = '';
  const ep = game.enemyPicks||[];
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
  const notesHtml = game.notes ?
    '<div class="section-label" style="padding:14px 20px 8px;">NOTES</div>'+
    '<div style="padding:0 20px 16px;font-size:12px;color:var(--grey-6);line-height:1.6;">'+game.notes+'</div>' : '';

  body.innerHTML = playerHtml + enemyHtml + notesHtml + '<div style="height:20px;"></div>';
  document.getElementById('game-detail-modal').classList.add('open');
}

// ──────────────────────────────────────────
// EDIT GAME (Task 3)
// ──────────────────────────────────────────
function openEditGame(gameId){
  const game = (App.cache.games||[]).find(function(g){return g.id===gameId;});
  if(!game){showToast('Game not found');return;}
  App.ui.editingGameId = gameId;
  const players = App.cache.players||[];
  const activePlayers = players.filter(function(p){return p.active!==false;});

  // Determine which players have scores
  let scoredPlayers = activePlayers.filter(function(p){return game.playerScores&&game.playerScores[p.id];});
  if(!scoredPlayers.length) scoredPlayers = activePlayers.slice(0,5);

  App.ui.editGamePlayers = scoredPlayers;
  App.ui.editGameActiveTab = 0;

  _renderEditGameModal(game, scoredPlayers);
  document.getElementById('edit-game-modal').classList.add('open');
}

function _renderEditGameModal(game, scoredPlayers){
  const body = document.getElementById('egm-body');
  if(!body) return;
  const isWin = game.result==='Win';
  const dur = game.duration_seconds ? (Math.floor(game.duration_seconds/60)+':'+(''+(game.duration_seconds%60)).padStart(2,'0')) : '';

  // Game info header
  const headerHtml = '<div style="padding:14px 16px;background:var(--grey-1);border-bottom:var(--border);flex-shrink:0;">'+
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
      '<span class="game-card-badge '+(isWin?'game-card-badge-win':'game-card-badge-loss')+'">'+(isWin?'WIN':'LOSS')+'</span>'+
      '<span style="font-size:13px;font-weight:600;">'+(game.opponent||'Unknown Opponent')+'</span>'+
      '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+_fmtDate(game.date)+'</span>'+
      (dur?'<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+dur+'</span>':'')+
    '</div>'+
  '</div>';

  // Player tabs
  const tabHtml = '<div class="edit-game-player-tabs" style="flex-shrink:0;">' +
    scoredPlayers.map(function(p,i){
      return '<button class="edit-player-chip'+(i===App.ui.editGameActiveTab?' active':'')+'" onclick="switchEditGameTab('+i+')">'+p.nick+'</button>';
    }).join('') +
  '</div>';

  // Player panels
  const panelsHtml = scoredPlayers.map(function(p,i){
    return '<div id="egm-panel-'+i+'" style="'+(i===App.ui.editGameActiveTab?'':'display:none;')+'">' +
      _buildEditPlayerPanel(game, p, i) +
    '</div>';
  }).join('');

  // Footer
  const footerHtml = '<div style="padding:14px 16px;border-top:var(--border);background:var(--grey-1);flex-shrink:0;display:flex;gap:10px;">'+
    '<button class="btn" style="flex:1;" onclick="closeModal(\'edit-game-modal\')">Cancel</button>'+
    '<button class="btn btn-primary" style="flex:2;" id="egm-save-btn" onclick="saveEditGame(\''+game.id+'\')">Save Changes</button>'+
  '</div>';

  body.innerHTML = headerHtml + '<div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;">' +
    tabHtml + '<div style="flex:1;overflow-y:auto;">' + panelsHtml + '</div>' +
  '</div>' + footerHtml;
}

function _buildEditPlayerPanel(game, player, idx){
  const s = (game.playerScores&&game.playerScores[player.id]) || {};
  const role = (s.role||player.role||'support').toLowerCase();
  const pillars = PILLAR_MAP[role] || ['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  const ps = s.pillar_scores || {};

  function sliderRow(label, key, val, sug){
    const v = Math.round(val!=null ? val : (sug!=null ? sug : 5));
    const hint = (sug!=null)
      ? '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;">Benchmark suggestion: '+sug+'</div>'
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

  let html = '<div style="padding:14px 16px;">';

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
    html += sliderRow(lbl, 'p'+i, ps['p'+i], calculateSuggestionFromScore(role, i, s, game, player.id));
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
  const game = (App.cache.games||[]).find(function(g){return g.id===App.ui.editingGameId;});
  if(!game) return;
  const players = App.ui.editGamePlayers||[];
  const player = players[idx];
  if(!player) return;
  const roleEl = document.getElementById('egm-'+idx+'-role');
  const role = roleEl ? roleEl.value : (player.role||'support').toLowerCase();
  const pillars = PILLAR_MAP[role] || ['Pillar 1','Pillar 2','Pillar 3','Pillar 4'];
  const s = (game.playerScores&&game.playerScores[player.id])||{};
  const ps = s.pillar_scores||{};
  const container = document.getElementById('egm-'+idx+'-pillars');
  if(!container) return;
  container.innerHTML = '';
  pillars.forEach(function(lbl, i){
    const sug = calculateSuggestionFromScore(role, i, s, game, player.id);
    const v = Math.round(ps['p'+i]!=null ? ps['p'+i] : (sug!=null ? sug : 5));
    const hint = (sug!=null)
      ? '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-bottom:4px;">Benchmark suggestion: '+sug+'</div>'
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
  const players = App.ui.editGamePlayers||[];
  players.forEach(function(p,i){
    const panel = document.getElementById('egm-panel-'+i);
    const chip = document.querySelectorAll('.edit-player-chip')[i];
    if(panel) panel.style.display = i===idx?'':'none';
    if(chip) chip.classList.toggle('active', i===idx);
  });
  App.ui.editGameActiveTab = idx;
}

async function saveEditGame(gameId){
  const btn = document.getElementById('egm-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Saving…';}
  try{
    const game = (App.cache.games||[]).find(function(g){return g.id===gameId;});
    if(!game) throw new Error('Game not found');
    const players = App.ui.editGamePlayers||[];
    const durMin = game.duration_seconds ? game.duration_seconds/60 : 0;
    const teamK  = game.team_total_kills || 0;
    const enemyPicks = game.enemyPicks || [];

    const updateRows = [];
    players.forEach(function(p, i){
      const heroEl   = document.getElementById('egm-'+i+'-hero');
      const roleEl   = document.getElementById('egm-'+i+'-role');
      const noteEl   = document.getElementById('egm-'+i+'-note');
      const hero     = heroEl  ? heroEl.value.trim()  : (game.playerScores&&game.playerScores[p.id]&&game.playerScores[p.id].hero)||'';
      const role     = roleEl  ? roleEl.value         : (game.playerScores&&game.playerScores[p.id]&&game.playerScores[p.id].role)||(p.role||'').toLowerCase();
      const note     = noteEl  ? noteEl.value.trim()  : null;
      const kills    = parseFloat(document.getElementById('egm-'+i+'-kills')?.value)||0;
      const deaths   = parseFloat(document.getElementById('egm-'+i+'-deaths')?.value)||0;
      const assists  = parseFloat(document.getElementById('egm-'+i+'-assists')?.value)||0;
      const gold     = parseFloat(document.getElementById('egm-'+i+'-gold')?.value)||null;
      const rating   = parseFloat(document.getElementById('egm-'+i+'-in_game_rating')?.value)||null;
      const ddPct    = parseFloat(document.getElementById('egm-'+i+'-dmg_dealt_pct')?.value)||null;
      const dtPct    = parseFloat(document.getElementById('egm-'+i+'-dmg_taken_pct')?.value)||null;
      const ddRaw    = parseFloat(document.getElementById('egm-'+i+'-dmg_dealt_raw')?.value)||null;
      const dtRaw    = parseFloat(document.getElementById('egm-'+i+'-dmg_taken_raw')?.value)||null;
      const p0 = parseFloat(document.getElementById('egm-'+i+'-p0')?.value)||null;
      const p1 = parseFloat(document.getElementById('egm-'+i+'-p1')?.value)||null;
      const p2 = parseFloat(document.getElementById('egm-'+i+'-p2')?.value)||null;
      const p3 = parseFloat(document.getElementById('egm-'+i+'-p3')?.value)||null;
      // Derived metrics — kept in sync with the new-game save path.
      const kda            = (kills+assists)/Math.max(deaths,1);
      const gpm            = (gold&&durMin>0) ? gold/durMin : null;
      const minPerDeath    = durMin>0 ? durMin/Math.max(deaths,1) : null;
      const killContribPct = teamK>0 ? (kills+assists)/teamK*100 : null;
      const dmgRatio       = (ddRaw&&dtRaw) ? ddRaw/Math.max(dtRaw,1) : null;
      const oppPick        = enemyPicks.find(function(e){ return e.role && e.role.toLowerCase()===String(role).toLowerCase(); });
      const oppGold        = oppPick ? (oppPick.gold||null) : null;
      const oppGoldPerMin  = (oppGold&&durMin>0) ? oppGold/durMin : null;
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
    const {error: delErr} = await sb.from('player_scores_v2').delete().eq('game_id', gameId);
    if(delErr) throw delErr;
    const {error: uErr} = await sb.from('player_scores_v2').insert(updateRows);
    if(uErr) throw uErr;

    // Update local cache
    players.forEach(function(p, i){
      const row = updateRows[i];
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
  return (App.cache.games||[]).filter(function(g){return g.matchId===matchId;})
    .sort(function(a,b){return new Date(a.savedAt||0)-new Date(b.savedAt||0);});
}

function showMatchDetail(matchId){
  renderMatchDetail(matchId);
  showPage('page-match');
  window.scrollTo(0,0);
}

function renderMatchDetail(matchId){
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
  const el = document.getElementById('match-content');
  if(!m){ if(el) el.innerHTML='<div class="empty"><div class="empty-text">Match not found</div></div>'; return; }
  App.ui.currentMatchId = matchId;
  const games = _matchGames(matchId);
  const wins = games.filter(function(g){return g.result==='Win';}).length;
  const losses = games.length - wins;
  const players = App.cache.players||[];
  const activePlayers = players.filter(function(p){return p.status!=='Inactive';});

  // ── Series trend bar (W/L dots in order) ──
  let trendHtml = '';
  if(games.length){
    trendHtml = '<div style="display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap;">'+
      games.map(function(g,idx){
        const isWin = g.result==='Win';
        const num = idx+1;
        return '<div title="Game '+num+' · '+g.result+'" style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:\'DM Mono\',monospace;font-size:9px;font-weight:700;'+
          (isWin?'background:rgba(68,255,136,0.15);border:1px solid rgba(68,255,136,0.5);color:var(--success);':'background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.35);color:var(--danger);')+
          '">'+num+'</div>';
      }).join('<div style="width:12px;height:1px;background:var(--grey-3);"></div>')+
    '</div>';
  }

  // ── Player summary (avg score + mentality per player) ──
  let playerSummaryHtml;
  if(games.length && activePlayers.length){
    const rows = activePlayers.map(function(p){
      const played = games.filter(function(g){const s=g.playerScores&&g.playerScores[p.id];return s&&!s.skipped;});
      if(!played.length) return null;
      const avgScore = played.map(function(g){return calcGameScore(g.playerScores[p.id],p.role,g,p.id);}).reduce(function(a,b){return a+b;},0)/played.length;
      const mentObj = m.mentality&&m.mentality[p.id]?m.mentality[p.id]:null;
      const avgMent = mentObj?calcMentality(null,mentObj):null;
      const grd = scoreToGrade(avgScore);
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
  const rated = activePlayers.filter(function(p){return m.mentality&&m.mentality[p.id];});
  const mentDetailHtml = rated.length ?
    '<div class="match-mentality-panel">'+rated.map(function(p){
      const mo = m.mentality[p.id];
      const sc = calcMentality(null,mo);
      const grd = sc>0?scoreToGrade(sc):null;
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
  const gameRowsHtml = games.length ? games.map(function(g,idx){
    const isWin = g.result==='Win';
    const num = idx+1;
    const mvpP = g.mvpPlayerId?players.find(function(p){return p.id===g.mvpPlayerId;}):null;
    const played = players.filter(function(p){const s=g.playerScores&&g.playerScores[p.id];return s&&!s.skipped;});
    const heroList = played.map(function(p){const s=g.playerScores[p.id];return s.hero||'?';}).join(', ');
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
  const idx = App.cache.matches.findIndex(function(m){return m.id===matchId;});
  if(idx===-1) return;
  App.cache.matches[idx].notes = document.getElementById('match-notes-area')?.value||'';
  sbSaveMatch(App.cache.matches[idx]).then(function(){showToast('Notes saved');}).catch(function(e){showToast('Failed: '+e.message);});
}

async function removeGameFromMatch(gameId, matchId){
  try{
    await sbUnassignGameFromMatch(gameId);
    renderMatchDetail(matchId);
    showToast('Game unlinked');
  }catch(err){ showToast('Failed: '+(err.message||String(err))); }
}

function addGameToMatch(matchId){
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m) return;
  const nextNum = _matchGames(matchId).length+1;
  showPage('page-log'); // triggers initLog(), which resets App.log.*
  App.log._matchId = matchId; // set after initLog so it isn't cleared
  setTimeout(function(){
    const oppEl = document.getElementById('log-opponent');
    if(oppEl) oppEl.value = m.name;
    if(m.date){ const dateEl=document.getElementById('log-date'); if(dateEl) dateEl.value=m.date; }
    if(m.type==='Tournament') setLogType('Tournament'); else setLogType('Scrim');
    const notesEl = document.getElementById('log-notes');
    if(notesEl) notesEl.value = m.name+' – Game '+nextNum;
  },50);
}

// Dual-mode: openAssignGameModal(matchId,null) → pick games for a match
//            openAssignGameModal(null,gameId)  → pick a match for a game
function openAssignGameModal(matchId, gameId){
  const body = document.getElementById('assign-game-body');
  if(matchId && !gameId){
    const candidates = (App.cache.games||[]).filter(function(g){
      return Object.keys(g.playerScores||{}).length>0 && (!g.matchId || g.matchId===matchId);
    }).sort(function(a,b){return new Date(b.savedAt||0)-new Date(a.savedAt||0);});
    if(!candidates.length){
      body.innerHTML='<div class="empty"><div class="empty-text">No unassigned games available</div></div>';
    } else {
      body.innerHTML =
        '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-bottom:12px;">Select games to include in this match.</div>'+
        candidates.map(function(g){
          const checked = g.matchId===matchId ? 'checked' : '';
          const dur=_fmtDuration(g.duration_seconds);
          return '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:var(--border);cursor:pointer;">'+
            '<input type="checkbox" value="'+g.id+'" class="ag-game-cb" '+checked+' style="width:16px;height:16px;flex-shrink:0;"/>'+
            '<span class="game-card-badge '+(g.result==='Win'?'game-card-badge-win':'game-card-badge-loss')+'">'+(g.result==='Win'?'W':'L')+'</span>'+
            '<span style="flex:1;font-size:12px;">'+(g.opponent||'Unknown')+' <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">'+_fmtDate(g.date)+(dur?' · '+dur:'')+'</span></span>'+
          '</label>';
        }).join('')+
        '<button class="btn btn-primary btn-full mt-16" onclick="saveAssignGames(\''+matchId+'\')">Save</button>';
    }
  } else {
    const matches = (App.cache.matches||[]).slice().sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0);});
    const g = (App.cache.games||[]).find(function(x){return x.id===gameId;});
    const cur = g ? g.matchId : null;
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
  const cbs = Array.prototype.slice.call(document.querySelectorAll('.ag-game-cb'));
  try{
    for(let i=0;i<cbs.length;i++){
      var gid = cbs[i].value;
      const g = (App.cache.games||[]).find(function(x){return x.id===gid;});
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
  const sel = document.querySelector('input[name="ag-match"]:checked');
  const matchId = sel ? sel.value : '';
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
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m){showToast('Match not found');return;}
  const body = document.getElementById('edit-match-body');
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
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
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
    (App.cache.games||[]).forEach(function(g){ if(g.matchId===matchId) g.matchId=null; });
    App.cache.matches = (App.cache.matches||[]).filter(function(x){return x.id!==matchId;});
    closeModal('edit-match-modal');
    showPage('page-history');
    showToast('✓ Match deleted');
  }catch(err){ showToast('Delete failed: '+(err.message||String(err))); }
}

function openRateMentalityModal(matchId){
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m){showToast('Match not found');return;}
  const players = (App.cache.players||[]).filter(function(p){return p.active!==false;});
  const body = document.getElementById('rate-mentality-body');
  function fld(pid,key,val){
    return '<input type="number" id="rm-'+pid+'-'+key+'" min="0" max="5" step="0.5" value="'+(val!=null?val:'')+'" placeholder="0–5" class="input" style="padding:6px 8px;font-size:12px;text-align:center;"/>';
  }
  body.innerHTML =
    '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);margin-bottom:12px;">Rate each player 0–5 on communication, discipline, and team contribution.</div>'+
    players.map(function(p){
      const mo=(m.mentality&&m.mentality[p.id])||{};
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
  const m = (App.cache.matches||[]).find(function(x){return x.id===matchId;});
  if(!m) return;
  const players = (App.cache.players||[]).filter(function(p){return p.active!==false;});
  const mentality = m.mentality || {};
  players.forEach(function(p){
    function num(key){const v=parseFloat(document.getElementById('rm-'+p.id+'-'+key)?.value);return isNaN(v)?0:v;}
    const note=(document.getElementById('rm-'+p.id+'-note')?.value||'').trim();
    const c=num('communication'),d=num('discipline'),t=num('team_contribution');
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
