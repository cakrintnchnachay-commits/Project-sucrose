'use strict';

// ══════════════════════════════════════════
// SUPABASE CLIENT
// ══════════════════════════════════════════
const SUPABASE_URL = 'https://ihxnvlfilhcadqqcpqke.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloeG52bGZpbGhjYWRxcWNwcWtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTI4NDEsImV4cCI6MjA5Mzc4ODg0MX0.c0gKpFDmSiNpjjm2rbnPybbz91-SqmLmAHArotgjbKI';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory cache (loaded once on boot, kept in sync)
let _cache = {
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
  let el=document.getElementById('global-loader');
  if(el) el.style.display=on?'flex':'none';
}

// Boot: load all data from Supabase into cache
async function bootApp(){
  setLoading(true);
  try{
    const [heroRes, customRes, playerRes, gameRes, matchRes, metaRes, masteryRes, patchRes, settingsRes, psRes, epRes] = await Promise.all([
      sb.from('heroes').select('*').order('name'),
      sb.from('custom_heroes').select('*').order('name'),
      sb.from('players').select('*').order('nick'),
      sb.from('games_v2').select('*').order('created_at'),
      sb.from('matches').select('*').order('created_at',{ascending:false}),
      sb.from('meta_tiers').select('*'),
      sb.from('mastery_tiers').select('*'),
      sb.from('patches').select('*').order('saved_at'),
      sb.from('app_settings').select('*'),
      sb.from('player_scores_v2').select('*'),
      sb.from('enemy_picks').select('*'),
    ]);
    _cache.heroes = (heroRes.data||[]).map(h=>({name:h.name,cls:h.cls,roles:h.roles||[]}));
    _cache.customHeroes = (customRes.data||[]).map(h=>({name:h.name,cls:h.cls,roles:h.roles||[]}));
    _cache.players = (playerRes.data||[]).map(p=>({
      id:p.id, ign:p.ign, nick:p.nick, role:p.role,
      status:p.active?(p.rank&&p.rank!=='Unranked'?p.rank:'Starter'):'Inactive',
      rank:p.rank||'Unranked', active:p.active
    }));
    _cache.games = (gameRes.data||[]).map(g=>({
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
      savedAt:g.created_at,
      endedAt:g.ended_at||null
    }));
    // Merge per-player scores from player_scores_v2 into _cache.games
    var _psMap={};
    (psRes.data||[]).forEach(function(ps){
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
    _cache.games.forEach(function(g){if(_psMap[g.id])g.playerScores=_psMap[g.id];});
    // Merge enemy_picks into _cache.games
    var _epMap={};
    (epRes.data||[]).forEach(function(ep){
      if(!_epMap[ep.game_id])_epMap[ep.game_id]=[];
      _epMap[ep.game_id].push({hero:ep.hero_name||null,role:ep.role||null,gold:ep.gold||null});
    });
    _cache.games.forEach(function(g){if(_epMap[g.id])g.enemyPicks=_epMap[g.id];});
    _cache.matches = (matchRes.data||[]).map(m=>({
      id:m.id, name:m.name, date:m.date||'', type:m.type||'Scrim',
      oppTier:m.opp_tier||'', notes:m.notes||'',
      mentality:m.mentality||{},
      tournamentId:m.tournament_id||null,
      createdAt:m.created_at,
    }));
    // Flatten meta tiers: {heroName: {role: tier}}
    _cache.metaTiers={};
    (metaRes.data||[]).forEach(r=>{
      if(r.role){
        if(!_cache.metaTiers[r.hero_name]) _cache.metaTiers[r.hero_name]={};
        _cache.metaTiers[r.hero_name][r.role]=r.tier;
      }
    });
    // Flatten mastery tiers
    _cache.masteryTiers={};
    (masteryRes.data||[]).forEach(r=>{
      if(!_cache.masteryTiers[r.player_id]) _cache.masteryTiers[r.player_id]={};
      _cache.masteryTiers[r.player_id][r.hero_name]=r.tier;
    });
    _cache.patches=(patchRes.data||[]).map(p=>({name:p.name,savedAt:p.saved_at,metaTiers:p.meta_snapshot||{}}));
    // Settings
    (settingsRes.data||[]).forEach(s=>{
      if(s.key==='hero_overrides') _cache.heroOverrides=s.value||{};
      if(s.key==='pfp') _cache.pfp=s.value||{};
      if(s.key==='sheet_url') _cache.sheetUrl=s.value||'';
      if(s.key==='last_sync') _cache.lastSync=s.value||'';
      if(s.key==='settings_pin') _cache.settingsPin=s.value||'';
      if(s.key==='anthropic_key') _cache.anthropicKey=(s.value||'').replace(/\s+/g,'');
      if(s.key==='meta_tiers_json'&&s.value&&!Object.keys(_cache.metaTiers).length) _cache.metaTiers=s.value;
    });
    // If no players in DB yet, seed with defaults
    if(_cache.players.length===0){
      await seedDefaultPlayers();
    }
    _cache.dismissed=JSON.parse(localStorage.getItem('ps_dismissed')||'{}');
    _cache.loaded=true;
  }catch(e){
    console.error('Boot failed',e);
    showToast('⚠ Could not connect to Supabase');
  }
  setLoading(false);
  PLAYERS=_cache.players;
  initLayout();
  renderHome();
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
  _cache.players=defaults.map(p=>({...p,status:p.active?'Starter':'Substitute'}));
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
  // A game assigned to a match inherits that match's date.
  var m=(_cache.matches||[]).find(function(x){return x.id===matchId;});
  var upd={match_id:matchId};
  if(m&&m.date) upd.match_date=m.date;
  const {error}=await sb.from('games_v2').update(upd).eq('id',gameId);
  if(error) throw error;
  var g=(_cache.games||[]).find(function(x){return x.id===gameId;});
  if(g){ g.matchId=matchId; if(m&&m.date) g.date=m.date; }
}

async function sbUnassignGameFromMatch(gameId){
  const {error}=await sb.from('games_v2').update({match_id:null}).eq('id',gameId);
  if(error) throw error;
  var g=(_cache.games||[]).find(function(x){return x.id===gameId;});
  if(g) g.matchId=null;
}

// ══════════════════════════════════════════
// SETTINGS PIN — V7
// ══════════════════════════════════════════
function submitPin(){
  var entered=(document.getElementById('pin-entry-inp')?.value||'').trim();
  if(entered===String(_cache.settingsPin)){
    _cache._pinUnlocked=true;
    setTimeout(function(){_cache._pinUnlocked=false;},5*60*1000);
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
  var nw=(document.getElementById('pin-new-inp')?.value||'').trim();
  var cf=(document.getElementById('pin-confirm-inp')?.value||'').trim();
  var errEl=document.getElementById('pin-change-err');
  if(!/^\d{4,8}$/.test(nw)){errEl.textContent='PIN must be 4–8 digits';errEl.style.display='block';return;}
  if(nw!==cf){errEl.textContent='PINs do not match';errEl.style.display='block';return;}
  _cache.settingsPin=nw;
  _cache._pinUnlocked=true;
  await sbSaveSetting('settings_pin',nw);
  closeModal('pin-change-modal');
  showToast('PIN saved');
}

async function clearPin(){
  _cache.settingsPin='';
  _cache._pinUnlocked=false;
  await sbSaveSetting('settings_pin','');
  closeModal('pin-change-modal');
  showToast('PIN removed');
}
