'use strict';

// App namespace — shared mutable state lives here, not on the flat global scope.
const App = { cache: {}, log: {}, players: [], ui: {} };

// ══════════════════════════════════════════
// SUPABASE CLIENT
// ══════════════════════════════════════════
const SUPABASE_URL = 'https://ihxnvlfilhcadqqcpqke.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloeG52bGZpbGhjYWRxcWNwcWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTI4NDEsImV4cCI6MjA5Mzc4ODg0MX0.c0gKpFDmSiNpjjm2rbnPybbz91-SqmLmAHArotgjbKI';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory cache (loaded once on boot, kept in sync)
App.cache = {
  heroes: [],        // from heroes table
  customHeroes: [],  // from custom_heroes table
  heroOverrides: {}, // from app_settings key='hero_overrides'
  players: [],       // from players table
  games: [],         // from games table
  matches: [],       // from matches table
  tournaments: [],   // from tournaments table (stub, future)
  metaTiers: {},     // from meta_tiers table ({heroName: {role: tier}})
  masteryTiers: {},  // from mastery_tiers table (flattened to {playerId: {heroName: tier}})
  patches: [],       // from patches table
  pfp: {},           // from app_settings key='pfp'
  dismissed: {},     // localStorage only (UI state)
  sheetUrl: '',
  lastSync: '',
  loaded: false,
  settingsPin: '',   // from app_settings key='settings_pin'
  anthropicKey: '', // from app_settings key='anthropic_key'
  _pinUnlocked: false,
};

// Show/hide global loading overlay
function setLoading(on){
  const el=document.getElementById('global-loader');
  if(el) el.style.display=on?'flex':'none';
}

// Most-recent games load first for a fast cold start; the rest stream in
// behind the initial render via _loadRemainingGames(). Aggregate views are
// briefly computed on the first page, then re-rendered once the full set lands.
const GAMES_PAGE_SIZE = 60;

// games_v2 rows -> app game objects.
function _mapGameRows(rows){
  return (rows||[]).map(g=>({
    id:g.id,
    // handle both old column names (date/map/opponent/result=W) and new (match_date/game_type/opponent_name/result=win)
    date: g.match_date || g.date || '',
    type: g.game_type ? (g.game_type.charAt(0).toUpperCase()+g.game_type.slice(1)) : (g.map||'Scrim'),
    result: (g.result==='win'||g.result==='W') ? 'Win' : 'Loss',
    opponent: g.opponent_name || g.opponent || '',
    duration_seconds: g.duration_seconds || null,
    team_total_kills: g.team_total_kills || null,
    enemy_total_kills: g.enemy_total_kills || null,
    vod_url: g.vod_url || null,
    gameNum:g.game_num||1, gameName:g.game_name||'',
    oppTier:'', notes:g.notes||'',
    playerScores:{},
    enemyPicks:[],
    matchMentality:g.match_mentality||{},
    matchId:g.match_id||null,
    mvpPlayerId:g.mvp_player_id||null,
    savedAt:g.created_at
  }));
}

// Merge player_scores_v2 + enemy_picks rows into the given game objects.
function _mergeChildRows(games, psRows, epRows){
  const _psMap={};
  (psRows||[]).forEach(function(ps){
    if(!_psMap[ps.game_id])_psMap[ps.game_id]={};
    if(ps.player_id){
      _psMap[ps.game_id][ps.player_id]={
        hero:ps.hero_name||null,role:ps.role_played||null,
        kills:ps.kills||0,deaths:ps.deaths||0,assists:ps.assists||0,
        gold:ps.gold||null,gold_per_min:ps.gold_per_min||null,in_game_rating:ps.in_game_rating||null,
        dmg_dealt_pct:ps.dmg_dealt_pct||null,dmg_taken_pct:ps.dmg_taken_pct||null,
        dmg_dealt_raw:ps.dmg_dealt_raw||null,dmg_taken_raw:ps.dmg_taken_raw||null,
        kda:ps.kda||null,min_per_death:ps.min_per_death||null,
        kill_contribution_pct:ps.kill_contribution_pct||null,dmg_per_dmg_taken:ps.dmg_per_dmg_taken||null,
        opp_gold:ps.opp_gold||null,opp_gold_per_min:ps.opp_gold_per_min||null,
        pillar_scores:{p0:ps.pillar_1_score||null,p1:ps.pillar_2_score||null,p2:ps.pillar_3_score||null,p3:ps.pillar_4_score||null},
        comment:ps.coach_note||null,
        _psId: ps.id || null,
      };
    }
  });
  const _epMap={};
  (epRows||[]).forEach(function(ep){
    if(!_epMap[ep.game_id])_epMap[ep.game_id]=[];
    _epMap[ep.game_id].push({hero:ep.hero_name||null,role:ep.role||null,gold:ep.gold||null});
  });
  games.forEach(function(g){
    if(_psMap[g.id])g.playerScores=_psMap[g.id];
    if(_epMap[g.id])g.enemyPicks=_epMap[g.id];
  });
}

// Keep games oldest-first (matches the original .order('created_at') boot).
function _sortGamesAsc(games){
  games.sort(function(a,b){ return new Date(a.savedAt||0)-new Date(b.savedAt||0); });
}

// Boot: load core tables + the most recent page of games into cache
async function bootApp(){
  setLoading(true);
  try{
    const [heroRes, customRes, playerRes, gameRes, matchRes, metaRes, masteryRes, patchRes, settingsRes] = await Promise.all([
      sb.from('heroes').select('*').order('name'),
      sb.from('custom_heroes').select('*').order('name'),
      sb.from('players').select('*').order('nick'),
      sb.from('games_v2').select('*').order('created_at',{ascending:false}).limit(GAMES_PAGE_SIZE),
      sb.from('matches').select('*').order('created_at',{ascending:false}),
      sb.from('meta_tiers').select('*'),
      sb.from('mastery_tiers').select('*'),
      sb.from('patches').select('*').order('saved_at'),
      sb.from('app_settings').select('*'),
    ]);
    App.cache.heroes = (heroRes.data||[]).map(h=>({name:h.name,cls:h.cls,roles:h.roles||[]}));
    App.cache.customHeroes = (customRes.data||[]).map(h=>({name:h.name,cls:h.cls,roles:h.roles||[]}));
    App.cache.players = (playerRes.data||[]).map(p=>({
      id:p.id, ign:p.ign, nick:p.nick, role:p.role,
      status:p.active?(p.rank&&p.rank!=='Unranked'?p.rank:'Starter'):'Inactive',
      rank:p.rank||'Unranked', active:p.active
    }));
    App.cache.games = _mapGameRows(gameRes.data);
    // Load child rows for just this first page of games.
    const _firstIds = App.cache.games.map(function(g){return g.id;});
    let psRes={data:[]}, epRes={data:[]};
    if(_firstIds.length){
      [psRes, epRes] = await Promise.all([
        sb.from('player_scores_v2').select('*').in('game_id', _firstIds),
        sb.from('enemy_picks').select('*').in('game_id', _firstIds),
      ]);
    }
    _mergeChildRows(App.cache.games, psRes.data, epRes.data);
    _sortGamesAsc(App.cache.games);
    App.cache.matches = (matchRes.data||[]).map(m=>({
      id:m.id, name:m.name, date:m.date||'', type:m.type||'Scrim',
      oppTier:m.opp_tier||'', notes:m.notes||'',
      mentality:m.mentality||{},
      tournamentId:m.tournament_id||null,
      createdAt:m.created_at,
    }));
    // Flatten meta tiers: {heroName: {role: tier}}
    App.cache.metaTiers={};
    (metaRes.data||[]).forEach(r=>{
      if(r.role){
        if(!App.cache.metaTiers[r.hero_name]) App.cache.metaTiers[r.hero_name]={};
        App.cache.metaTiers[r.hero_name][r.role]=r.tier;
      }
    });
    // Flatten mastery tiers
    App.cache.masteryTiers={};
    (masteryRes.data||[]).forEach(r=>{
      if(!App.cache.masteryTiers[r.player_id]) App.cache.masteryTiers[r.player_id]={};
      App.cache.masteryTiers[r.player_id][r.hero_name]=r.tier;
    });
    App.cache.patches=(patchRes.data||[]).map(p=>({name:p.name,savedAt:p.saved_at,metaTiers:p.meta_snapshot||{}}));
    // Settings
    (settingsRes.data||[]).forEach(s=>{
      if(s.key==='hero_overrides') App.cache.heroOverrides=s.value||{};
      if(s.key==='pfp') App.cache.pfp=s.value||{};
      if(s.key==='sheet_url') App.cache.sheetUrl=s.value||'';
      if(s.key==='last_sync') App.cache.lastSync=s.value||'';
      if(s.key==='settings_pin') App.cache.settingsPin=s.value||'';
      if(s.key==='anthropic_key') App.cache.anthropicKey=(s.value||'').replace(/\s+/g,'');
      if(s.key==='meta_tiers_json'&&s.value&&!Object.keys(App.cache.metaTiers).length) App.cache.metaTiers=s.value;
    });
    // If no players in DB yet, seed with defaults
    if(App.cache.players.length===0){
      await seedDefaultPlayers();
    }
    App.cache.dismissed=JSON.parse(localStorage.getItem('ps_dismissed')||'{}');
    App.cache.loaded=true;
  }catch(e){
    console.error('Boot failed',e);
    showToast('⚠ Could not connect to Supabase');
  }
  setLoading(false);
  App.players=App.cache.players;
  initLayout();
  renderHome();
  _loadRemainingGames();
}

// Stream the full game history in after the initial paint so aggregate
// views (hero stats, player averages, benchmarks) become complete.
// On failure the first page stands — degraded, not broken.
async function _loadRemainingGames(){
  if(App.cache.games.length < GAMES_PAGE_SIZE) return; // first page already had everything
  try{
    const [gameRes, psRes, epRes] = await Promise.all([
      sb.from('games_v2').select('*').order('created_at',{ascending:false}),
      sb.from('player_scores_v2').select('*'),
      sb.from('enemy_picks').select('*'),
    ]);
    if(!gameRes.data || gameRes.data.length <= App.cache.games.length) return; // nothing new
    const full = _mapGameRows(gameRes.data);
    _mergeChildRows(full, psRes.data, epRes.data);
    _sortGamesAsc(full);
    App.cache.games = full;
    if(typeof renderHome==='function') renderHome();
    if(typeof renderHistory==='function') renderHistory();
  }catch(e){ console.warn('Background history load failed', e); }
}

async function seedDefaultPlayers(){
  const defaults=[
    {id:'gun', ign:'Sutthiphat',nick:'Gun', role:'Support', rank:'Unranked', active:true},
    {id:'film',ign:'K1rarz',    nick:'Film',role:'Midlane', rank:'Unranked', active:true},
    {id:'yp',  ign:'Penii',     nick:'YP',  role:'Carry',   rank:'Unranked', active:true},
    {id:'poom',ign:'WildMutt',  nick:'Poom',role:'Offlane', rank:'Unranked', active:true},
    {id:'doy', ign:'Doy',       nick:'Doy', role:'Jungler', rank:'Unranked', active:true},
    {id:'ice', ign:'Ackerman',  nick:'Ice', role:'Jungler', rank:'Unranked', active:false},
    {id:'ken', ign:'Kenslayer', nick:'Ken', role:'Offlane', rank:'Unranked', active:false},
  ];
  await sb.from('players').upsert(defaults,{onConflict:'id'});
  App.cache.players=defaults.map(p=>({...p,status:p.active?'Starter':'Substitute'}));
}

// ── Supabase write helpers ──────────────────

async function sbSaveSetting(key,value){
  await sb.from('app_settings').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'});
}

async function sbSaveGame(gameObj){
  // Map app game object → DB row
  const row={
    id: gameObj.id,
    date: gameObj.date,
    result: gameObj.result==='Win'?'W':'L',
    map: gameObj.type||'Scrim',
    opponent: gameObj.opponent||null,
    is_tournament: gameObj.type==='Tournament',
    notes: gameObj.notes||null,
    game_num: gameObj.gameNum||1,
    game_name: gameObj.gameName||null,
    player_scores: gameObj.playerScores||{},
    match_mentality: gameObj.matchMentality||{},
    match_id: gameObj.matchId||null,
    mvp_player_id: gameObj.mvpPlayerId||null,
  };
  const {data,error}=await sb.from('games').upsert(row,{onConflict:'id'}).select().single();
  if(error) throw error;
  return data.id;
}

async function sbDeleteGame(gameId){
  // Cascade: remove child rows first, then the game itself (games_v2 schema)
  await sb.from('player_scores_v2').delete().eq('game_id',gameId);
  await sb.from('enemy_picks').delete().eq('game_id',gameId);
  await sb.from('games_v2').delete().eq('id',gameId);
}

async function sbSavePlayer(playerObj){
  const row={
    id:playerObj.id, ign:playerObj.ign, nick:playerObj.nick,
    role:playerObj.role, active:playerObj.status!=='Inactive',
    rank:playerObj.rank||'Unranked',
  };
  await sb.from('players').upsert(row,{onConflict:'id'});
}

async function sbDeletePlayer(playerId){
  await sb.from('players').delete().eq('id',playerId);
}

async function sbSaveMetaTier(heroName,role,tier){
  if(tier){
    await sb.from('meta_tiers').upsert({hero_name:heroName,role:role,tier,updated_at:new Date().toISOString()},{onConflict:'hero_name,role'});
  } else {
    await sb.from('meta_tiers').delete().eq('hero_name',heroName).eq('role',role);
  }
}

async function sbSaveMasteryTier(playerId,heroName,tier){
  if(tier){
    await sb.from('mastery_tiers').upsert({player_id:playerId,hero_name:heroName,tier,updated_at:new Date().toISOString()},{onConflict:'player_id,hero_name'});
  } else {
    await sb.from('mastery_tiers').delete().eq('player_id',playerId).eq('hero_name',heroName);
  }
}

async function sbSaveHeroes(heroArr){
  if(!heroArr.length) return;
  const rows=heroArr.map(h=>({name:h.name,cls:h.cls,roles:h.roles}));
  await sb.from('heroes').upsert(rows,{onConflict:'name'});
}

async function sbSaveCustomHero(h){
  await sb.from('custom_heroes').upsert({name:h.name,cls:h.cls,roles:h.roles},{onConflict:'name'});
}

async function sbSavePatch(p){
  await sb.from('patches').upsert({name:p.name,meta_snapshot:p.metaTiers,saved_at:p.savedAt},{onConflict:'name'});
}

async function sbSaveMatch(matchObj){
  const row={
    id:matchObj.id,
    name:matchObj.name,
    date:matchObj.date||null,
    type:matchObj.type||'Scrim',
    opp_tier:matchObj.oppTier||null,
    notes:matchObj.notes||null,
    mentality:matchObj.mentality||null,
    tournament_id:matchObj.tournamentId||null,
  };
  const {data,error}=await sb.from('matches').upsert(row,{onConflict:'id'}).select().single();
  if(error) throw error;
  return data.id;
}

async function sbDeleteMatch(matchId){
  // Unlink games first (games_v2), then delete match
  await sb.from('games_v2').update({match_id:null}).eq('match_id',matchId);
  await sb.from('matches').delete().eq('id',matchId);
}

async function sbAssignGameToMatch(gameId,matchId){
  const {error}=await sb.from('games_v2').update({match_id:matchId}).eq('id',gameId);
  if(error) throw error;
  const g=(App.cache.games||[]).find(function(x){return x.id===gameId;});
  if(g) g.matchId=matchId;
}

async function sbUnassignGameFromMatch(gameId){
  const {error}=await sb.from('games_v2').update({match_id:null}).eq('id',gameId);
  if(error) throw error;
  const g=(App.cache.games||[]).find(function(x){return x.id===gameId;});
  if(g) g.matchId=null;
}

// ══════════════════════════════════════════
// SETTINGS PIN — V7
// ══════════════════════════════════════════
function submitPin(){
  const entered=(document.getElementById('pin-entry-inp')?.value||'').trim();
  if(entered===String(App.cache.settingsPin)){
    App.cache._pinUnlocked=true;
    setTimeout(function(){App.cache._pinUnlocked=false;},5*60*1000);
    closeModal('pin-entry-modal');
    showPage('page-settings');
  } else {
    document.getElementById('pin-entry-err').style.display='block';
  }
}

function showPinChange(){
  document.getElementById('pin-new-inp').value='';
  document.getElementById('pin-confirm-inp').value='';
  document.getElementById('pin-change-err').style.display='none';
  document.getElementById('pin-change-modal').classList.add('open');
}

async function savePin(){
  const nw=(document.getElementById('pin-new-inp')?.value||'').trim();
  const cf=(document.getElementById('pin-confirm-inp')?.value||'').trim();
  const errEl=document.getElementById('pin-change-err');
  if(!/^\d{4,8}$/.test(nw)){errEl.textContent='PIN must be 4–8 digits';errEl.style.display='block';return;}
  if(nw!==cf){errEl.textContent='PINs do not match';errEl.style.display='block';return;}
  App.cache.settingsPin=nw;
  App.cache._pinUnlocked=true;
  await sbSaveSetting('settings_pin',nw);
  closeModal('pin-change-modal');
  showToast('PIN saved');
}

async function clearPin(){
  App.cache.settingsPin='';
  App.cache._pinUnlocked=false;
  await sbSaveSetting('settings_pin','');
  closeModal('pin-change-modal');
  showToast('PIN removed');
}
