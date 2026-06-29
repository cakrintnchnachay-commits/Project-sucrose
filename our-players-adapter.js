// ═══════════════════════════════════════════════════════════
// OUR PLAYERS ADAPTER — bridge Supabase roster → datalab-core
//
// Pro players come from the CSV engine (datalab-core.js) and are
// rendered from a single "rawAgg" shape via dlcDerive(). Our own
// roster lives in Supabase (_cache.players / _cache.games /
// per-game playerScores) with a very different shape. This file
// converts our data into the SAME rawAgg shape so our players flow
// through dlcDerive, the radar, the compare table and the player
// list unchanged — no edits to the pro stats engine.
//
// Hard rule: our players live in a SEPARATE agg. Peer-stat code
// (dlcRoleAvg / dlcPercentile / dlcZ / dlcStyleRead) must only ever
// see the pure pro agg, or "pro average / percentile" gets skewed.
// The merged agg from dlcAggWithOurs() is DISPLAY-ONLY.
// ═══════════════════════════════════════════════════════════

// our roster role → pro lane code (DLC_ROLES = DSL/JUG/MID/ADL/SUP).
// Offlane→DSL (exp / dark-slayer lane) is the one to revisit if a
// role benchmark ever looks off.
var OUR_ROLE_MAP = { Carry:'ADL', Midlane:'MID', Offlane:'DSL', Jungler:'JUG', Support:'SUP' };

// shared scope filter, driven by the controls in Compare + Player Lab.
// type: 'All' | 'Scrim' | 'Tournament' ; sinceDays: null | number
var OUR_FILTER = { type:'All', sinceDays:null };

var OUR_TIME_WINDOWS = [['all','All time',null],['90','Last 90d',90],['30','Last 30d',30]];
var OUR_TYPE_FILTERS = ['All','Scrim','Tournament'];

var _OUR_AGG_CACHE = {};          // filter signature → agg

function ourInvalidate(){ _OUR_AGG_CACHE = {}; }

function _ourSig(f){ return (f.type||'All')+'|'+(f.sinceDays==null?'all':f.sinceDays); }

// true when there is at least one of our players with logged games
function ourHasData(){
  return !!(typeof _cache!=='undefined' && _cache && (_cache.players||[]).length && (_cache.games||[]).length);
}

// is this players-map key one of ours?
function ourIsKey(key){ return typeof key==='string' && key.charAt(0)==='@'; }

// ── Core adapter: Supabase data → dlcAgg-shaped object ────────
function ourBuildAgg(filter){
  filter = filter || OUR_FILTER;
  var sig = _ourSig(filter);
  if (_OUR_AGG_CACHE[sig]) return _OUR_AGG_CACHE[sig];

  var agg = {tour:'Ours', total:0, blueWins:0,
             heroes:{}, players:{}, teams:{}, pairs:{},
             bucketTotals:{}, _pctCache:{}, _isOurs:true};

  if (!ourHasData()){ _OUR_AGG_CACHE[sig]=agg; return agg; }

  var players = _cache.players || [];
  var byId = {};
  players.forEach(function(p){ byId[p.id]=p; });

  var cutoff = null;
  if (filter.sinceDays!=null){
    cutoff = new Date(Date.now() - filter.sinceDays*24*60*60*1000);
  }

  // mirror datalab-core.js P() initializer so the object is byte-compatible
  function P(key, label){
    if (!agg.players[key]) agg.players[key]={g:0,w:0,team:'OURS',label:label,roles:{},heroes:{},
      weeks:{},snow:{g:0,w:0},late:{g:0,w:0},sideA:{g:0,w:0},sideB:{g:0,w:0},
      k:0,d:0,a:0,dmg:0,dtk:0,dur:0,kpSum:0,kpN:0,mvp:0,_dmgN:0};
    return agg.players[key];
  }

  var games = _cache.games || [];
  games.forEach(function(g){
    // scope filters
    if (filter.type && filter.type!=='All' && g.type!==filter.type) return;
    if (cutoff && parseDate(g.date) < cutoff) return;
    var scores = g.playerScores || {};
    var ids = Object.keys(scores);
    if (!ids.length) return;
    agg.total++;
    var won = g.result==='Win';
    var durMin = (g.duration_seconds||0)/60;

    ids.forEach(function(pid){
      var score = scores[pid];
      if (!score || score.skipped) return;
      var pl = byId[pid];
      if (!pl) return;
      var key = '@'+pid;
      var x = P(key, pl.nick||pl.ign||pid);

      x.g++; if (won) x.w++;
      x.k += (+score.kills||0); x.d += (+score.deaths||0); x.a += (+score.assists||0);
      x.dur += durMin;
      // raw dmg: only trust it when present; if a player never has it,
      // dmg/dtk stay 0 → dlcDerive yields 0 → renders blank, not garbage.
      if (score.dmg_dealt_raw!=null || score.dmg_taken_raw!=null){
        x.dmg += (+score.dmg_dealt_raw||0);
        x.dtk += (+score.dmg_taken_raw||0);
        x._dmgN++;
      }
      // kill participation: pro kpSum holds a 0..1 fraction (dlcDerive ×100),
      // but our kill_contribution_pct is already a percent.
      if (score.kill_contribution_pct!=null){
        x.kpSum += (+score.kill_contribution_pct||0)/100; x.kpN++;
      }
      if (g.mvpPlayerId===pid) x.mvp++;
      var rkey = OUR_ROLE_MAP[score.role] || OUR_ROLE_MAP[pl.role] || null;
      if (rkey) x.roles[rkey]=(x.roles[rkey]||0)+1;
      if (score.hero){
        if (!x.heroes[score.hero]) x.heroes[score.hero]={g:0,w:0};
        x.heroes[score.hero].g++; if (won) x.heroes[score.hero].w++;
      }
      // sideA/sideB/snow/late/weeks intentionally left zeroed — we have no
      // side or game-end data, so dlcDerive returns null and the UI shows "—".
    });
  });

  _OUR_AGG_CACHE[sig]=agg;
  return agg;
}

// ── Display-only merge: pro pool + our players ───────────────
// Used ONLY by list / picker / compare display code. Never hand the
// result to peer-stat functions — _pctCache aliases the pro cache and
// must never be fed our players.
function dlcAggWithOurs(tour, ourFilter){
  var pro = dlcAgg(tour);
  var ours = ourBuildAgg(ourFilter);
  var merged = Object.assign({}, pro);
  merged.players = Object.assign({}, pro.players, ours.players);
  merged._pctCache = pro._pctCache;   // pro-only cache; never fed our players
  merged._withOurs = true;
  return merged;
}

// display name for a players-map key ('@id' → nick, else the key itself)
function ourDisplayName(key, agg){
  if (!ourIsKey(key)) return key;
  var x = agg && agg.players ? agg.players[key] : (ourBuildAgg().players[key]);
  return (x && x.label) || key.slice(1);
}

// small caveat note shown whenever a subject is one of ours.
// keys: array of players-map keys involved in the view.
function ourCaveatBanner(keys){
  if (!keys || !keys.some(ourIsKey)) return '';
  return '<div class="dlc-c2-extra muted" style="border-left-color:var(--warn);">'+
    '<span class="dlc-c2-extra-tag">OUR DATA</span>'+
    'Damage is read from screenshots and may not match the pro CSV scale — '+
    'treat DMG/min &amp; DTK/min as rough. Side (blue/red) and game-tempo '+
    'splits aren’t tracked for our games, so those show “—”.'+
  '</div>';
}

// reusable scope-control row (type + time window) bound to OUR_FILTER.
// onChange: name of a global fn to call after a change re-renders state.
function ourScopeControls(onChange){
  var typeBtns = OUR_TYPE_FILTERS.map(function(t){
    return '<button class="tier-mode-btn'+(t===OUR_FILTER.type?' active':'')+'" '+
      'onclick="OUR_FILTER.type=\''+t+'\';ourInvalidate();'+onChange+'()">'+t+'</button>';
  }).join('');
  var timeBtns = OUR_TIME_WINDOWS.map(function(w){
    var on = (w[2]===OUR_FILTER.sinceDays);
    return '<button class="tier-mode-btn'+(on?' active':'')+'" '+
      'onclick="OUR_FILTER.sinceDays='+(w[2]==null?'null':w[2])+';ourInvalidate();'+onChange+'()">'+w[1]+'</button>';
  }).join('');
  return '<div class="dlc-c2-ctl-row" style="margin-top:8px;">'+
      '<span class="dlc-c2-ctl-lbl">OUR GAMES</span>'+
      '<div class="dlc-c2-btns">'+typeBtns+'</div>'+
      '<span class="dlc-c2-ctl-lbl" style="margin-left:14px;">WINDOW</span>'+
      '<div class="dlc-c2-btns">'+timeBtns+'</div>'+
    '</div>';
}
