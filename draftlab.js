// ═══════════════════════════════════════════════════════════
// DRAFT LAB — AoV competitive draft simulator with live intel
// Sequence (4-ban): BB1 RB1 BB2 RB2 | BP1 RP1 RP2 BP2 BP3 RP3
//                   RB3 BB3 RB4 BB4 | RP4 BP4 BP5 RP5 | swap
// Global ban-pick: bans block both teams; a team cannot repeat
// its OWN picks, but CAN pick what the opponent picked.
// ═══════════════════════════════════════════════════════════

var DL_GAMES   = null;     // parsed pro games (mlBuildGames format)
var DL_AGG     = null;     // aggregated stats cache
var DL_ACTIONS = [];       // [{side,type,n,hero|null}]  null = skipped ban
var DL_STARTED = false;
var DL_TEAM    = {B:'', R:''};   // team abbr per side ('' = unset)
var DL_US      = 'B';      // which side is our team
var DL_SEARCH  = '';
var DL_GRID_ROLE = 'All';
var DL_INTEL_EXP = false;  // expanded intel table
var DL_ROLE_OVERRIDE = {B:{}, R:{}}; // pickN -> role (manual swaps)
var DL_SWAP_SEL = null;    // {side,n} first slot selected for swap
var DL_TIMER_ON  = true;
var DL_TIMER_LEFT = 30;
var _DL_TIMER_IV = null;
var _DL_CSS_DONE = false;

var _DL_ROLES = ['DSL','JUG','MID','ADL','SUP'];

var _DL_SEQ = [
  {side:'B',type:'ban', n:1}, {side:'R',type:'ban', n:1},
  {side:'B',type:'ban', n:2}, {side:'R',type:'ban', n:2},
  {side:'B',type:'pick',n:1},
  {side:'R',type:'pick',n:1}, {side:'R',type:'pick',n:2},
  {side:'B',type:'pick',n:2}, {side:'B',type:'pick',n:3},
  {side:'R',type:'pick',n:3},
  {side:'R',type:'ban', n:3}, {side:'B',type:'ban', n:3},
  {side:'R',type:'ban', n:4}, {side:'B',type:'ban', n:4},
  {side:'R',type:'pick',n:4},
  {side:'B',type:'pick',n:4}, {side:'B',type:'pick',n:5},
  {side:'R',type:'pick',n:5}
];

// ── Engine ──────────────────────────────────────────────────

function dlCurStep() {
  return DL_ACTIONS.length < _DL_SEQ.length ? _DL_SEQ[DL_ACTIONS.length] : null;
}

function dlIsBanned(hero) {
  return DL_ACTIONS.some(function(a){ return a.type==='ban' && a.hero===hero; });
}
function dlIsPickedBy(side, hero) {
  return DL_ACTIONS.some(function(a){ return a.type==='pick' && a.side===side && a.hero===hero; });
}
function dlIsPickedAny(hero) {
  return dlIsPickedBy('B',hero) || dlIsPickedBy('R',hero);
}

// Availability of hero for the CURRENT step
function dlAvailable(hero) {
  var st = dlCurStep();
  if (!st || !DL_STARTED) return false;
  if (dlIsBanned(hero)) return false;
  if (st.type === 'ban')  return !dlIsPickedAny(hero);          // cannot ban a locked pick
  return !dlIsPickedBy(st.side, hero);                          // own picks blocked, mirror allowed
}

function dlApply(hero) {
  var st = dlCurStep();
  if (!st || !dlAvailable(hero)) return;
  DL_ACTIONS.push({side:st.side, type:st.type, n:st.n, hero:hero});
  DL_SWAP_SEL = null;
  _dlTimerReset();
  dlRender();
}

function dlSkipBan() {
  var st = dlCurStep();
  if (!st || st.type !== 'ban') return;
  DL_ACTIONS.push({side:st.side, type:st.type, n:st.n, hero:null});
  _dlTimerReset();
  dlRender();
}

function dlUndo() {
  if (!DL_ACTIONS.length) return;
  DL_ACTIONS.pop();
  DL_SWAP_SEL = null;
  _dlTimerReset();
  dlRender();
}

function dlNewDraft() {
  DL_ACTIONS = [];
  DL_ROLE_OVERRIDE = {B:{}, R:{}};
  DL_SWAP_SEL = null;
  DL_STARTED = true;
  _dlTimerReset();
  dlRender();
}

function dlResetDraft() {
  DL_ACTIONS = [];
  DL_ROLE_OVERRIDE = {B:{}, R:{}};
  DL_SWAP_SEL = null;
  DL_STARTED = false;
  _dlTimerStop();
  dlRender();
}

function dlSwapSides() {
  var t = DL_TEAM.B; DL_TEAM.B = DL_TEAM.R; DL_TEAM.R = t;
  DL_US = DL_US === 'B' ? 'R' : 'B';
  dlRender();
}

function dlPicksFor(side) {
  return DL_ACTIONS.filter(function(a){ return a.type==='pick' && a.side===side; });
}
function dlBansFor(side) {
  return DL_ACTIONS.filter(function(a){ return a.type==='ban' && a.side===side; });
}

// ── Role assignment (auto + manual swap) ─────────────────────

function _dlHeroRoleCounts(hero) {
  var counts = {};
  if (DL_AGG && DL_AGG.heroes[hero]) counts = DL_AGG.heroes[hero].roles || {};
  if (!Object.keys(counts).length && typeof getLiveHeroes === 'function') {
    var db = getLiveHeroes() || [];
    var hh = db.find(function(x){ return x.name === hero; });
    if (hh && hh.roles) hh.roles.forEach(function(r){ if(_DL_ROLES.indexOf(r)>=0) counts[r]=1; });
  }
  return counts;
}

// Returns {pickN: role} for a side — overrides respected, rest greedy-fit
function dlComputedRoles(side) {
  var picks = dlPicksFor(side);
  var out = {}, usedRoles = {};
  picks.forEach(function(p) {
    var ov = DL_ROLE_OVERRIDE[side][p.n];
    if (ov) { out[p.n] = ov; usedRoles[ov] = 1; }
  });
  var remaining = picks.filter(function(p){ return !out[p.n]; });
  var freeRoles = _DL_ROLES.filter(function(r){ return !usedRoles[r]; });
  // greedy: repeatedly take the (pick, role) pair with the highest pro-game count
  var pool = remaining.slice();
  while (pool.length && freeRoles.length) {
    var best = null;
    pool.forEach(function(p) {
      var rc = _dlHeroRoleCounts(p.hero);
      freeRoles.forEach(function(r) {
        var c = rc[r] || 0;
        if (!best || c > best.c) best = {p:p, r:r, c:c};
      });
    });
    if (!best) break;
    out[best.p.n] = best.r;
    pool = pool.filter(function(p){ return p.n !== best.p.n; });
    freeRoles = freeRoles.filter(function(r){ return r !== best.r; });
  }
  pool.forEach(function(p, i){ out[p.n] = freeRoles[i] || '—'; });
  return out;
}

function dlRoleClick(side, n) {
  if (!dlPicksFor(side).some(function(p){ return p.n === n; })) return;
  if (DL_SWAP_SEL && DL_SWAP_SEL.side === side && DL_SWAP_SEL.n !== n) {
    var roles = dlComputedRoles(side);
    var a = DL_SWAP_SEL.n, b = n;
    DL_ROLE_OVERRIDE[side][a] = roles[b];
    DL_ROLE_OVERRIDE[side][b] = roles[a];
    // freeze the rest so they don't reshuffle
    Object.keys(roles).forEach(function(k){
      if (+k !== a && +k !== b) DL_ROLE_OVERRIDE[side][k] = roles[k];
    });
    DL_SWAP_SEL = null;
  } else if (DL_SWAP_SEL && DL_SWAP_SEL.side === side && DL_SWAP_SEL.n === n) {
    DL_SWAP_SEL = null;
  } else {
    DL_SWAP_SEL = {side:side, n:n};
  }
  dlRender();
}

// ── Pro-data aggregation ─────────────────────────────────────

function _dlBuildAgg(games) {
  var agg = {total: games.length, blueWins: 0, heroes: {}, teams: {}};
  function H(h) {
    if (!agg.heroes[h]) agg.heroes[h] = {g:0, w:0, bans:0, roles:{}, players:{}};
    return agg.heroes[h];
  }
  function T(t) {
    if (!agg.teams[t]) agg.teams[t] = {g:0, w:0, players:{}};
    return agg.teams[t];
  }
  games.forEach(function(g) {
    if (g.winSide === 'A') agg.blueWins++;
    ['A','B'].forEach(function(S) {
      var abbr = g.teams[S];
      if (abbr) { var tm = T(abbr); tm.g++; if (g.winSide === S) tm.w++; }
      (g.bans[S] || []).forEach(function(h){ if (h) H(h).bans++; });
    });
    g.picks.forEach(function(pk) {
      if (!pk.hero) return;
      var h = H(pk.hero);
      var won = g.winSide === pk.side;
      h.g++; if (won) h.w++;
      if (pk.role) h.roles[pk.role] = (h.roles[pk.role] || 0) + 1;
      if (pk.player) {
        if (!h.players[pk.player]) h.players[pk.player] = {g:0, w:0, team:''};
        h.players[pk.player].g++;
        if (won) h.players[pk.player].w++;
        h.players[pk.player].team = g.teams[pk.side] || h.players[pk.player].team;
        var abbr2 = g.teams[pk.side];
        if (abbr2) {
          var tp = T(abbr2).players;
          if (!tp[pk.player]) tp[pk.player] = {g:0, roles:{}, heroes:{}};
          tp[pk.player].g++;
          if (pk.role) tp[pk.player].roles[pk.role] = (tp[pk.player].roles[pk.role] || 0) + 1;
          if (!tp[pk.player].heroes[pk.hero]) tp[pk.player].heroes[pk.hero] = {g:0, w:0};
          tp[pk.player].heroes[pk.hero].g++;
          if (won) tp[pk.player].heroes[pk.hero].w++;
        }
      }
    });
  });
  return agg;
}

function _dlShrunkWR(w, g) { return (w + 5) / (g + 10); }   // empirical-Bayes, prior 0.5, k=10

function _dlPresence(h) {
  if (!DL_AGG || !DL_AGG.heroes[h] || !DL_AGG.total) return 0;
  var x = DL_AGG.heroes[h];
  return (x.g + x.bans) / DL_AGG.total;
}

function _dlPrimaryRoles(h) {
  var rc = _dlHeroRoleCounts(h);
  var tot = 0; Object.keys(rc).forEach(function(r){ tot += rc[r]; });
  if (!tot) return [];
  return _DL_ROLES.filter(function(r){ return (rc[r] || 0) / tot >= 0.25; });
}

// Best comfort entry for hero h among players of team abbr
function _dlTeamComfort(abbr, hero) {
  if (!abbr || !DL_AGG || !DL_AGG.teams[abbr]) return null;
  var best = null;
  var ps = DL_AGG.teams[abbr].players;
  Object.keys(ps).forEach(function(ign) {
    var hs = ps[ign].heroes[hero];
    if (hs && hs.g >= 3 && (!best || hs.g > best.g)) best = {ign:ign, g:hs.g, w:hs.w};
  });
  return best;
}

// ── Intel: suggestions for the current step ──────────────────

function dlSuggestions(limit) {
  var st = dlCurStep();
  if (!st || !DL_AGG) return {label:'', items:[]};
  var heroes = Object.keys(DL_AGG.heroes).filter(dlAvailable);
  var items = [];

  if (st.type === 'ban') {
    var enemy = st.side === 'B' ? 'R' : 'B';
    var enemyTeam = DL_TEAM[enemy];
    heroes.forEach(function(h) {
      var x = DL_AGG.heroes[h];
      var wr = _dlShrunkWR(x.w, x.g);
      var pres = _dlPresence(h);
      var comfort = _dlTeamComfort(enemyTeam, h);
      var score = pres * 0.55 + wr * 0.45;
      var reason = Math.round(pres*100) + '% PRES · ' + Math.round((x.g? x.w/x.g : 0)*100) + '% WR (' + x.g + 'G)';
      if (comfort && comfort.w / comfort.g >= 0.5) {
        score += 0.22 * Math.min(comfort.g / 10, 1);
        reason += ' · ' + comfort.ign + ' ' + comfort.g + 'G';
      }
      items.push({hero:h, score:score, reason:reason, roles:_dlPrimaryRoles(h)});
    });
    items.sort(function(a,b){ return b.score - a.score; });
    return {label:'BAN TARGETS — DENY ' + (enemyTeam || (enemy==='B'?'BLUE':'RED')), items: items.slice(0, limit)};
  }

  // pick step
  var roles = dlComputedRoles(st.side);
  var covered = {};
  Object.keys(roles).forEach(function(n){ covered[roles[n]] = 1; });
  var needed = _DL_ROLES.filter(function(r){ return !covered[r]; });
  var ownTeam = DL_TEAM[st.side];
  heroes.forEach(function(h) {
    var x = DL_AGG.heroes[h];
    if (x.g < 2) return;
    var wr = _dlShrunkWR(x.w, x.g);
    var conf = Math.min(x.g / 20, 1);
    var prim = _dlPrimaryRoles(h);
    var roleMatch = prim.some(function(r){ return needed.indexOf(r) >= 0; });
    if (needed.length && !roleMatch) return;   // only suggest heroes that fill a gap
    var comfort = _dlTeamComfort(ownTeam, h);
    var score = wr * (0.7 + 0.3 * conf);
    var reason = Math.round((x.w/x.g)*100) + '% WR (' + x.g + 'G)';
    if (comfort) {
      score += 0.18 * Math.min(comfort.g / 10, 1) * (comfort.w / comfort.g);
      reason += ' · ' + comfort.ign + ' ' + comfort.g + 'G ' + Math.round((comfort.w/comfort.g)*100) + '%';
    }
    items.push({hero:h, score:score, reason:reason, roles: prim.filter(function(r){ return needed.indexOf(r) >= 0; })});
  });
  items.sort(function(a,b){ return b.score - a.score; });
  var lbl = 'PICK SUGGESTIONS' + (needed.length ? ' — NEED ' + needed.join(' / ') : '');
  return {label:lbl, items: items.slice(0, limit)};
}

// Opponent comfort picks still on the board
function dlOpenThreats(limit) {
  var st = dlCurStep();
  if (!DL_AGG) return [];
  var oppSide = DL_US === 'B' ? 'R' : 'B';
  var abbr = DL_TEAM[oppSide];
  if (!abbr || !DL_AGG.teams[abbr]) return [];
  var rows = [];
  var ps = DL_AGG.teams[abbr].players;
  Object.keys(ps).forEach(function(ign) {
    Object.keys(ps[ign].heroes).forEach(function(h) {
      var hs = ps[ign].heroes[h];
      if (hs.g < 4) return;
      if (dlIsBanned(h) || dlIsPickedBy(oppSide, h)) return;
      rows.push({hero:h, ign:ign, g:hs.g, wr:hs.w/hs.g});
    });
  });
  rows.sort(function(a,b){ return (b.g * (0.5 + b.wr)) - (a.g * (0.5 + a.wr)); });
  return rows.slice(0, limit);
}

// ── Timer ────────────────────────────────────────────────────

function _dlTimerReset() {
  DL_TIMER_LEFT = 30;
  _dlTimerStop();
  if (DL_TIMER_ON && DL_STARTED && dlCurStep()) {
    _DL_TIMER_IV = setInterval(function() {
      DL_TIMER_LEFT = Math.max(0, DL_TIMER_LEFT - 1);
      var el = document.getElementById('dl-timer');
      if (!el) { _dlTimerStop(); return; }
      el.textContent = '0:' + String(DL_TIMER_LEFT).padStart(2,'0');
      el.style.color = DL_TIMER_LEFT <= 5 ? 'var(--danger)' : 'var(--white)';
    }, 1000);
  }
}
function _dlTimerStop() { if (_DL_TIMER_IV) { clearInterval(_DL_TIMER_IV); _DL_TIMER_IV = null; } }
function dlToggleTimer() { DL_TIMER_ON = !DL_TIMER_ON; _dlTimerReset(); dlRender(); }

// ── Scenarios (localStorage) ─────────────────────────────────

function _dlScenarios() {
  try { return JSON.parse(localStorage.getItem('dl_scenarios_v1') || '[]'); }
  catch(e) { return []; }
}
function _dlSaveScenarios(list) {
  localStorage.setItem('dl_scenarios_v1', JSON.stringify(list));
}
function dlOpenSaveModal() {
  if (!DL_ACTIONS.length) return;
  var m = document.getElementById('dl-modal');
  m.style.display = 'flex';
  m.innerHTML =
    '<div class="dl-modal-box">' +
      '<div class="dl-modal-title">SAVE DRAFT SCENARIO</div>' +
      '<input id="dl-scn-name" class="dl-inp" placeholder="e.g. vs FS — snowball comp" maxlength="60"/>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
        '<button class="tier-mode-btn" onclick="dlCloseModal()">CANCEL</button>' +
        '<button class="tier-mode-btn active" onclick="dlConfirmSave()">SAVE</button>' +
      '</div>' +
    '</div>';
  setTimeout(function(){ var i=document.getElementById('dl-scn-name'); if(i) i.focus(); }, 50);
}
function dlConfirmSave() {
  var name = (document.getElementById('dl-scn-name') || {}).value || '';
  name = name.trim() || 'Unnamed draft';
  var list = _dlScenarios();
  list.unshift({
    id: Date.now(), name: name, date: new Date().toISOString().slice(0,10),
    actions: DL_ACTIONS, teams: {B:DL_TEAM.B, R:DL_TEAM.R}, us: DL_US,
    roleOverride: DL_ROLE_OVERRIDE
  });
  _dlSaveScenarios(list.slice(0, 100));
  dlCloseModal();
  dlRender();
}
function dlCloseModal() {
  var m = document.getElementById('dl-modal');
  if (m) { m.style.display = 'none'; m.innerHTML = ''; }
}
function dlOpenScenarios() {
  var list = _dlScenarios();
  var m = document.getElementById('dl-modal');
  m.style.display = 'flex';
  var rows = list.length ? list.map(function(s) {
    var picks = s.actions.filter(function(a){ return a.type==='pick'; }).length;
    return '<div class="dl-scn-row">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _dlEsc(s.name) + '</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">' + s.date + ' · ' + picks + ' picks · ' + (s.teams.B||'?') + ' vs ' + (s.teams.R||'?') + '</div>' +
      '</div>' +
      '<button class="tier-mode-btn" data-dl-load="' + s.id + '">LOAD</button>' +
      '<button class="tier-mode-btn" data-dl-del="' + s.id + '" style="color:var(--danger);">✕</button>' +
    '</div>';
  }).join('') : '<div style="padding:20px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No saved scenarios yet</div>';
  m.innerHTML =
    '<div class="dl-modal-box" style="max-width:460px;width:92%;">' +
      '<div class="dl-modal-title">DRAFT SCENARIOS</div>' +
      '<div style="max-height:340px;overflow-y:auto;">' + rows + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
        '<button class="tier-mode-btn" onclick="dlCloseModal()">CLOSE</button>' +
      '</div>' +
    '</div>';
}
function dlLoadScenario(id) {
  var s = _dlScenarios().find(function(x){ return x.id === id; });
  if (!s) return;
  DL_ACTIONS = s.actions || [];
  DL_TEAM = s.teams || {B:'',R:''};
  DL_US = s.us || 'B';
  DL_ROLE_OVERRIDE = s.roleOverride || {B:{},R:{}};
  DL_STARTED = true;
  dlCloseModal();
  _dlTimerStop();
  dlRender();
}
function dlDeleteScenario(id) {
  _dlSaveScenarios(_dlScenarios().filter(function(x){ return x.id !== id; }));
  dlOpenScenarios();
}

// ── Helpers ──────────────────────────────────────────────────

function _dlEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _dlPortrait(hero, size) {
  if (typeof heroPortraitHtml === 'function') return heroPortraitHtml(hero, size, false);
  return '<div style="width:'+size+'px;height:'+size+'px;background:var(--grey-8);"></div>';
}

// ── Init / data load ─────────────────────────────────────────

function dlInit() {
  _dlInjectCss();
  var root = document.getElementById('dl-root');
  if (!root) return;
  if (!root.dataset.built) {
    root.dataset.built = '1';
    root.innerHTML =
      '<div id="dl-bar"></div>' +
      '<div id="dl-intel"></div>' +
      '<div class="dl-cols">' +
        '<div id="dl-side-B" class="dl-side dl-side-blue"></div>' +
        '<div id="dl-center"></div>' +
        '<div id="dl-side-R" class="dl-side dl-side-red"></div>' +
      '</div>' +
      '<div id="dl-modal" class="dl-modal" style="display:none;" onclick="if(event.target===this)dlCloseModal()"></div>';
    root.addEventListener('click', function(e) {
      var t = e.target.closest('[data-dl-hero]');
      if (t) { dlApply(t.getAttribute('data-dl-hero')); return; }
      var l = e.target.closest('[data-dl-load]');
      if (l) { dlLoadScenario(+l.getAttribute('data-dl-load')); return; }
      var d = e.target.closest('[data-dl-del]');
      if (d) { dlDeleteScenario(+d.getAttribute('data-dl-del')); return; }
      var r = e.target.closest('[data-dl-role]');
      if (r) { var p = r.getAttribute('data-dl-role').split(':'); dlRoleClick(p[0], +p[1]); return; }
    });
  }
  if (DL_GAMES === null) {
    if (typeof ML_GAMES !== 'undefined' && ML_GAMES) {
      DL_GAMES = ML_GAMES;
      DL_AGG = _dlBuildAgg(DL_GAMES);
      dlRender();
    } else {
      document.getElementById('dl-center').innerHTML =
        '<div style="padding:30px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--grey-5);">Loading pro data…</div>';
      fetch('data/game_results_detailed.csv', {cache:'no-store'})
        .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); })
        .then(function(txt) {
          DL_GAMES = (typeof mlBuildGames === 'function') ? mlBuildGames(txt) : [];
          DL_AGG = _dlBuildAgg(DL_GAMES);
          dlRender();
        })
        .catch(function(err) {
          document.getElementById('dl-center').innerHTML =
            '<div style="padding:30px;font-family:\'DM Mono\',monospace;font-size:10px;color:var(--danger);">Failed to load pro data — ' + _dlEsc(err.message) + '<br><br>Draft sim still works without intel.</div>';
          DL_GAMES = [];
          DL_AGG = _dlBuildAgg([]);
          setTimeout(dlRender, 1200);
        });
    }
  } else {
    dlRender();
  }
}

// ── Render ───────────────────────────────────────────────────

function dlRender() {
  _dlRenderBar();
  _dlRenderIntel();
  _dlRenderSide('B');
  _dlRenderSide('R');
  _dlRenderCenter();
}

function _dlStepLabel(st) {
  if (!st) return 'DRAFT COMPLETE';
  return (st.side === 'B' ? 'BLUE' : 'RED') + ' ' + (st.type === 'ban' ? 'BAN' : 'PICK') + ' ' + st.n;
}

function _dlTeamOptions(sel) {
  var teams = DL_AGG ? Object.keys(DL_AGG.teams).sort() : [];
  return '<option value="">— TEAM —</option>' + teams.map(function(t) {
    return '<option value="' + _dlEsc(t) + '"' + (t === sel ? ' selected' : '') + '>' + _dlEsc(t) + '</option>';
  }).join('');
}

function _dlRenderBar() {
  var el = document.getElementById('dl-bar');
  if (!el) return;
  var st = dlCurStep();
  var done = DL_STARTED && !st;

  var seqHtml = _DL_SEQ.map(function(s, i) {
    var cls = 'dl-seq-dot' + (s.side === 'B' ? ' blue' : ' red') + (s.type === 'ban' ? ' ban' : '');
    if (i < DL_ACTIONS.length) cls += ' done';
    if (i === DL_ACTIONS.length && DL_STARTED) cls += ' cur';
    return '<div class="' + cls + '" title="' + _dlStepLabel(s) + '"></div>';
  }).join('');

  var stepCls = !DL_STARTED ? '' : st ? (st.side === 'B' ? ' dl-step-blue' : ' dl-step-red') : ' dl-step-done';

  el.innerHTML =
    '<div class="dl-bar-row">' +
      '<div class="dl-team-box blue">' +
        '<select class="dl-team-sel" onchange="DL_TEAM.B=this.value;dlRender()">' + _dlTeamOptions(DL_TEAM.B) + '</select>' +
        (DL_US === 'B' ? '<span class="dl-us-badge">US</span>' : '<span class="dl-us-badge opp">OPP</span>') +
      '</div>' +
      '<button class="tier-mode-btn" onclick="dlSwapSides()" title="Swap sides">⇄ SWAP</button>' +
      '<div class="dl-step-box' + stepCls + '">' +
        '<div class="dl-step-main">' + (!DL_STARTED ? 'PRESS NEW DRAFT' : _dlStepLabel(st)) + '</div>' +
        (DL_STARTED && st ? '<div id="dl-timer" class="dl-step-timer"' + (DL_TIMER_ON ? '' : ' style="display:none;"') + '>0:' + String(DL_TIMER_LEFT).padStart(2,'0') + '</div>' : '') +
      '</div>' +
      '<div class="dl-team-box red">' +
        (DL_US === 'R' ? '<span class="dl-us-badge">US</span>' : '<span class="dl-us-badge opp">OPP</span>') +
        '<select class="dl-team-sel" onchange="DL_TEAM.R=this.value;dlRender()">' + _dlTeamOptions(DL_TEAM.R) + '</select>' +
      '</div>' +
    '</div>' +
    '<div class="dl-seq-row">' + seqHtml + '</div>' +
    '<div class="dl-ctrl-row">' +
      '<button class="tier-mode-btn active" onclick="dlNewDraft()">▶ NEW DRAFT</button>' +
      '<button class="tier-mode-btn" onclick="dlUndo()"' + (DL_ACTIONS.length ? '' : ' disabled') + '>↩ UNDO</button>' +
      '<button class="tier-mode-btn" onclick="dlSkipBan()"' + (st && st.type === 'ban' ? '' : ' disabled') + '>⏭ SKIP BAN</button>' +
      '<button class="tier-mode-btn" onclick="dlResetDraft()">RESET</button>' +
      '<span style="flex:1;"></span>' +
      '<button class="tier-mode-btn' + (DL_TIMER_ON ? ' active' : '') + '" onclick="dlToggleTimer()">⏱ TIMER</button>' +
      '<button class="tier-mode-btn" onclick="dlOpenScenarios()">📚 SCENARIOS</button>' +
      '<button class="tier-mode-btn" onclick="dlOpenSaveModal()"' + (DL_ACTIONS.length ? '' : ' disabled') + '>💾 SAVE</button>' +
      (done ? '<span class="dl-done-hint">DRAFT COMPLETE — tap two role tags to swap positions</span>' : '') +
    '</div>';
}

function _dlRenderIntel() {
  var el = document.getElementById('dl-intel');
  if (!el) return;
  if (!DL_STARTED || !DL_AGG || !DL_AGG.total) { el.innerHTML = ''; return; }
  var st = dlCurStep();

  if (!st) {
    // draft complete — quick summary
    var sumHtml = ['B','R'].map(function(S) {
      var picks = dlPicksFor(S);
      var ws = picks.map(function(p) {
        var x = DL_AGG.heroes[p.hero];
        return x ? _dlShrunkWR(x.w, x.g) : 0.5;
      });
      var avg = ws.length ? ws.reduce(function(a,b){return a+b;},0) / ws.length : 0.5;
      return '<div class="dl-intel-chip" style="cursor:default;">' +
        '<div class="dl-intel-chip-body"><div class="dl-intel-chip-name" style="color:' + (S==='B' ? 'rgba(100,180,255,1)' : 'rgba(255,110,110,1)') + ';">' + (DL_TEAM[S] || (S==='B'?'BLUE':'RED')) + '</div>' +
        '<div class="dl-intel-chip-sub">comp WR index ' + Math.round(avg*100) + '</div></div></div>';
    }).join('');
    el.innerHTML = '<div class="dl-intel-inner"><div class="dl-intel-label">DRAFT SUMMARY <span style="color:var(--grey-5);">(shrunk WR index, pro data)</span></div><div class="dl-intel-chips">' + sumHtml + '</div></div>';
    return;
  }

  var sug = dlSuggestions(DL_INTEL_EXP ? 18 : 6);
  var chips = sug.items.map(function(it) {
    return '<div class="dl-intel-chip" data-dl-hero="' + _dlEsc(it.hero) + '" title="Click to apply">' +
      _dlPortrait(it.hero, 30) +
      '<div class="dl-intel-chip-body">' +
        '<div class="dl-intel-chip-name">' + _dlEsc(it.hero) + (it.roles.length ? ' <span class="dl-role-mini">' + it.roles.join('/') + '</span>' : '') + '</div>' +
        '<div class="dl-intel-chip-sub">' + it.reason + '</div>' +
      '</div>' +
    '</div>';
  }).join('') || '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);padding:6px;">No data-backed suggestions</div>';

  var threats = dlOpenThreats(4);
  var threatHtml = threats.length ?
    '<div class="dl-threats">' +
      '<div class="dl-intel-label" style="color:var(--warn);">OPP COMFORT OPEN</div>' +
      threats.map(function(t) {
        return '<div class="dl-threat-row">' + _dlPortrait(t.hero, 20) +
          '<span class="dl-threat-name">' + _dlEsc(t.hero) + '</span>' +
          '<span class="dl-threat-meta">' + _dlEsc(t.ign) + ' ' + t.g + 'G ' + Math.round(t.wr*100) + '%</span></div>';
      }).join('') +
    '</div>' : '';

  el.innerHTML =
    '<div class="dl-intel-inner">' +
      '<div class="dl-intel-head">' +
        '<div class="dl-intel-label">' + sug.label + '</div>' +
        '<button class="tier-mode-btn" style="font-size:7px;padding:2px 8px;" onclick="DL_INTEL_EXP=!DL_INTEL_EXP;dlRender()">' + (DL_INTEL_EXP ? 'LESS' : 'MORE') + '</button>' +
      '</div>' +
      '<div class="dl-intel-chips">' + chips + '</div>' +
    '</div>' + threatHtml;
}

function _dlRenderSide(S) {
  var el = document.getElementById('dl-side-' + S);
  if (!el) return;
  var st = dlCurStep();
  var bans = dlBansFor(S);
  var picks = dlPicksFor(S);
  var roles = dlComputedRoles(S);

  var bansHtml = [1,2,3,4].map(function(n) {
    var a = bans.find(function(x){ return x.n === n; });
    var isCur = st && st.type === 'ban' && st.side === S && st.n === n && DL_STARTED;
    if (a && a.hero) {
      return '<div class="dl-ban-slot filled" title="' + _dlEsc(a.hero) + '">' + _dlPortrait(a.hero, 34) + '<div class="dl-ban-x">✕</div></div>';
    }
    if (a) return '<div class="dl-ban-slot skipped">SKIP</div>';
    return '<div class="dl-ban-slot' + (isCur ? ' cur' : '') + '">B' + n + '</div>';
  }).join('');

  var picksHtml = [1,2,3,4,5].map(function(n) {
    var a = picks.find(function(x){ return x.n === n; });
    var isCur = st && st.type === 'pick' && st.side === S && st.n === n && DL_STARTED;
    var selSwap = DL_SWAP_SEL && DL_SWAP_SEL.side === S && DL_SWAP_SEL.n === n;
    if (a) {
      var role = roles[n] || '—';
      return '<div class="dl-pick-slot filled">' +
        _dlPortrait(a.hero, 44) +
        '<div class="dl-pick-body">' +
          '<div class="dl-pick-name">' + _dlEsc(a.hero) + '</div>' +
          '<button class="dl-role-badge' + (selSwap ? ' sel' : '') + '" data-dl-role="' + S + ':' + n + '" title="Tap two role tags to swap">' + role + '</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="dl-pick-slot' + (isCur ? ' cur' : '') + '"><div class="dl-pick-ph">P' + n + '</div></div>';
  }).join('');

  el.innerHTML =
    '<div class="dl-side-title">' + (S === 'B' ? 'BLUE SIDE' : 'RED SIDE') + (DL_TEAM[S] ? ' · ' + _dlEsc(DL_TEAM[S]) : '') + '</div>' +
    '<div class="dl-side-sec">BANS</div>' +
    '<div class="dl-bans">' + bansHtml + '</div>' +
    '<div class="dl-side-sec">PICKS</div>' +
    '<div class="dl-picks">' + picksHtml + '</div>';
}

function _dlAllGridHeroes() {
  var set = {};
  if (DL_AGG) Object.keys(DL_AGG.heroes).forEach(function(h){ set[h] = 1; });
  if (typeof getHeroList === 'function') (getHeroList() || []).forEach(function(h){ set[h] = 1; });
  return Object.keys(set).sort();
}

function _dlRenderCenter() {
  var el = document.getElementById('dl-center');
  if (!el) return;
  var st = dlCurStep();
  var heroes = _dlAllGridHeroes();
  var sq = DL_SEARCH.trim().toLowerCase();
  if (sq) heroes = heroes.filter(function(h){ return h.toLowerCase().indexOf(sq) >= 0; });
  if (DL_GRID_ROLE !== 'All') {
    heroes = heroes.filter(function(h) {
      var prim = _dlPrimaryRoles(h);
      return prim.indexOf(DL_GRID_ROLE) >= 0;
    });
  }

  var sugSet = {};
  if (st && DL_AGG) dlSuggestions(6).items.forEach(function(it){ sugSet[it.hero] = 1; });

  var cards = heroes.map(function(h) {
    var avail = dlAvailable(h);
    var pres = _dlPresence(h);
    var cls = 'dl-card' + (avail ? '' : ' dim') + (sugSet[h] ? ' sug' : '');
    var prim = _dlPrimaryRoles(h);
    return '<div class="' + cls + '"' + (avail ? ' data-dl-hero="' + _dlEsc(h) + '"' : '') + ' title="' + _dlEsc(h) + (pres ? ' · ' + Math.round(pres*100) + '% presence' : '') + '">' +
      _dlPortrait(h, 56) +
      '<div class="dl-card-name">' + _dlEsc(h) + '</div>' +
      '<div class="dl-card-sub">' + (prim.length ? prim.join('/') : '&nbsp;') + (pres >= 0.005 ? ' · ' + Math.round(pres*100) + '%' : '') + '</div>' +
    '</div>';
  }).join('');

  var roleTabs = ['All'].concat(_DL_ROLES).map(function(r) {
    return '<button class="tier-mode-btn' + (r === DL_GRID_ROLE ? ' active' : '') + '" onclick="DL_GRID_ROLE=\'' + r + '\';dlRender()">' + r + '</button>';
  }).join('');

  el.innerHTML =
    '<div class="dl-grid-bar">' +
      '<input id="dl-search" class="dl-inp" style="max-width:180px;margin:0;" placeholder="Search hero…" value="' + _dlEsc(DL_SEARCH) + '" oninput="DL_SEARCH=this.value;dlRender();var i=document.getElementById(\'dl-search\');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}"/>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + roleTabs + '</div>' +
    '</div>' +
    '<div class="dl-grid">' + (cards || '<div style="padding:20px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No heroes found</div>') + '</div>';
}

// ── CSS (injected once; uses site design tokens) ─────────────

function _dlInjectCss() {
  if (_DL_CSS_DONE) return;
  _DL_CSS_DONE = true;
  var css =
  '#dl-root{display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;}' +
  '.dl-bar-row{display:flex;align-items:center;gap:8px;padding:10px 12px 4px;}' +
  '.dl-team-box{display:flex;align-items:center;gap:6px;padding:4px 8px;border:var(--border);}' +
  '.dl-team-box.blue{border-left:3px solid rgba(100,180,255,0.8);}' +
  '.dl-team-box.red{border-right:3px solid rgba(255,110,110,0.8);}' +
  '.dl-team-sel{background:transparent;color:var(--white);border:none;font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;outline:none;cursor:pointer;}' +
  '.dl-team-sel option{background:#111;}' +
  '.dl-us-badge{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1px;padding:2px 6px;background:rgba(80,220,140,0.15);color:var(--success);border:1px solid rgba(80,220,140,0.4);}' +
  '.dl-us-badge.opp{background:rgba(255,255,255,0.05);color:var(--grey-5);border-color:rgba(255,255,255,0.15);}' +
  '.dl-step-box{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:6px;border:var(--border);min-height:38px;}' +
  '.dl-step-main{font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:2px;color:var(--grey-5);}' +
  '.dl-step-blue .dl-step-main{color:rgba(100,180,255,1);}' +
  '.dl-step-red .dl-step-main{color:rgba(255,110,110,1);}' +
  '.dl-step-done .dl-step-main{color:var(--success);}' +
  '.dl-step-timer{font-family:\'DM Mono\',monospace;font-size:13px;color:var(--white);}' +
  '.dl-seq-row{display:flex;gap:3px;padding:4px 12px;align-items:center;}' +
  '.dl-seq-dot{width:14px;height:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);flex-shrink:0;}' +
  '.dl-seq-dot.ban{height:5px;}' +
  '.dl-seq-dot.blue.done{background:rgba(100,180,255,0.75);border-color:rgba(100,180,255,0.9);}' +
  '.dl-seq-dot.red.done{background:rgba(255,110,110,0.75);border-color:rgba(255,110,110,0.9);}' +
  '.dl-seq-dot.cur{outline:1px solid var(--white);outline-offset:1px;}' +
  '.dl-ctrl-row{display:flex;align-items:center;gap:6px;padding:4px 12px 8px;border-bottom:var(--border);flex-wrap:wrap;}' +
  '.dl-done-hint{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--success);letter-spacing:1px;}' +
  '#dl-intel{flex-shrink:0;}' +
  '.dl-intel-inner{padding:6px 12px;border-bottom:var(--border);}' +
  '.dl-intel-head{display:flex;align-items:center;justify-content:space-between;}' +
  '.dl-intel-label{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:2px;color:var(--grey-5);padding:2px 0;}' +
  '.dl-intel-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;}' +
  '.dl-intel-chip{display:flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;border:1px solid rgba(255,255,255,0.12);cursor:pointer;background:rgba(255,255,255,0.02);}' +
  '.dl-intel-chip:hover{border-color:rgba(100,180,255,0.6);background:rgba(100,180,255,0.06);}' +
  '.dl-intel-chip-name{font-family:\'Bebas Neue\',sans-serif;font-size:13px;color:var(--white);white-space:nowrap;}' +
  '.dl-intel-chip-sub{font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);white-space:nowrap;}' +
  '.dl-role-mini{font-family:\'DM Mono\',monospace;font-size:7px;color:rgba(100,180,255,0.9);letter-spacing:0;}' +
  '.dl-threats{padding:4px 12px 6px;border-bottom:var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
  '.dl-threat-row{display:flex;align-items:center;gap:5px;}' +
  '.dl-threat-name{font-family:\'Bebas Neue\',sans-serif;font-size:11px;}' +
  '.dl-threat-meta{font-family:\'DM Mono\',monospace;font-size:7px;color:var(--warn);}' +
  '.dl-cols{display:flex;flex:1;overflow:hidden;min-height:0;}' +
  '.dl-side{width:190px;flex-shrink:0;overflow-y:auto;padding:8px;}' +
  '.dl-side-blue{border-right:var(--border);}' +
  '.dl-side-red{border-left:var(--border);}' +
  '.dl-side-title{font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;margin-bottom:6px;}' +
  '.dl-side-blue .dl-side-title{color:rgba(100,180,255,1);}' +
  '.dl-side-red .dl-side-title{color:rgba(255,110,110,1);}' +
  '.dl-side-sec{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:2px;color:var(--grey-5);margin:8px 0 4px;}' +
  '.dl-bans{display:flex;gap:4px;flex-wrap:wrap;}' +
  '.dl-ban-slot{width:38px;height:38px;border:1px dashed rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);position:relative;}' +
  '.dl-ban-slot.filled{border-style:solid;}' +
  '.dl-ban-slot.filled img,.dl-ban-slot.filled>div:first-child{filter:grayscale(1) brightness(0.6);}' +
  '.dl-ban-x{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--danger);font-size:14px;font-weight:bold;text-shadow:0 0 4px #000;}' +
  '.dl-ban-slot.skipped{color:var(--grey-5);font-size:6px;letter-spacing:1px;}' +
  '.dl-ban-slot.cur{border-color:var(--white);animation:dlPulse 1.2s infinite;}' +
  '.dl-picks{display:flex;flex-direction:column;gap:5px;}' +
  '.dl-pick-slot{display:flex;align-items:center;gap:8px;border:1px dashed rgba(255,255,255,0.18);min-height:52px;padding:4px;}' +
  '.dl-pick-slot.filled{border-style:solid;background:rgba(255,255,255,0.02);}' +
  '.dl-pick-slot.cur{border-color:var(--white);animation:dlPulse 1.2s infinite;}' +
  '.dl-pick-ph{font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding-left:6px;}' +
  '.dl-pick-body{flex:1;min-width:0;}' +
  '.dl-pick-name{font-family:\'Bebas Neue\',sans-serif;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
  '.dl-role-badge{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1px;padding:2px 7px;margin-top:2px;background:rgba(255,255,255,0.05);color:var(--grey-4);border:1px solid rgba(255,255,255,0.15);cursor:pointer;}' +
  '.dl-role-badge:hover{border-color:var(--white);color:var(--white);}' +
  '.dl-role-badge.sel{border-color:var(--warn);color:var(--warn);background:rgba(255,204,68,0.1);}' +
  '#dl-center{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}' +
  '.dl-grid-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:var(--border);flex-wrap:wrap;flex-shrink:0;}' +
  '.dl-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:6px;padding:10px;align-content:start;}' +
  '.dl-card{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 3px 5px;border:1px solid rgba(255,255,255,0.08);cursor:pointer;text-align:center;}' +
  '.dl-card:hover{border-color:rgba(100,180,255,0.7);background:rgba(100,180,255,0.05);}' +
  '.dl-card.dim{opacity:0.22;cursor:default;pointer-events:none;}' +
  '.dl-card.sug{border-color:rgba(80,220,140,0.55);box-shadow:inset 0 0 12px rgba(80,220,140,0.07);}' +
  '.dl-card-name{font-family:\'Bebas Neue\',sans-serif;font-size:11px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
  '.dl-card-sub{font-family:\'DM Mono\',monospace;font-size:6.5px;color:var(--grey-5);letter-spacing:0;}' +
  '.dl-inp{background:rgba(255,255,255,0.04);border:var(--border);color:var(--white);font-family:\'DM Mono\',monospace;font-size:10px;padding:6px 10px;width:100%;outline:none;box-sizing:border-box;}' +
  '.dl-inp:focus{border-color:rgba(100,180,255,0.6);}' +
  '.dl-modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:300;align-items:center;justify-content:center;}' +
  '.dl-modal-box{background:#101010;border:var(--border);padding:18px;max-width:380px;width:90%;}' +
  '.dl-modal-title{font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;margin-bottom:12px;}' +
  '.dl-scn-row{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:var(--border);}' +
  '@keyframes dlPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0.25);}50%{box-shadow:0 0 0 3px rgba(255,255,255,0.08);}}' +
  '@media(max-width:760px){' +
    '.dl-cols{flex-direction:column;overflow-y:auto;}' +
    '.dl-side{width:auto;border:none;border-bottom:var(--border);}' +
    '.dl-picks{flex-direction:row;flex-wrap:wrap;}' +
    '.dl-pick-slot{min-width:140px;flex:1;}' +
    '#dl-center{overflow:visible;}' +
    '.dl-grid{overflow:visible;}' +
    '.dl-step-main{font-size:16px;}' +
  '}';
  var tag = document.createElement('style');
  tag.id = 'dl-style';
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ── Nav integration: init when page-draft is shown ───────────

(function dlPatchShowPage() {
  function patch() {
    var _orig = window.showPage;
    if (typeof _orig !== 'function') return false;
    window.showPage = function(id) {
      _orig(id);
      if (id === 'page-draft') {
        var d = document.getElementById('nav-draft-d');
        if (d) d.classList.add('active');
        var m = document.getElementById('nav-more-btn');
        if (m) m.classList.add('active');
        dlInit();
      }
    };
    return true;
  }
  if (!patch()) document.addEventListener('DOMContentLoaded', patch);
}());
