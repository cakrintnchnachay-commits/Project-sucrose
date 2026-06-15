// ═══════════════════════════════════════════════════════════
// DRAFT LAB v3 — AoV series draft simulator with live intel
//
// v3: categorized intel (COUNTER/COMBO/STEAL/META picks and
//     mirrored ban categories), recency-weighted meta, key-player
//     ban targeting, threat flags + answers, Roster-style visuals.
//
// Sequence (4-ban): BB1 RB1 BB2 RB2 | BP1 RP1 RP2 BP2 BP3 RP3
//                   RB3 BB3 RB4 BB4 | RP4 BP4 BP5 RP5 | swap
//
// Rules:
//  • Within a game: every picked hero is unique (no mirrors),
//    bans block both teams, phase-2 bans cannot target locked picks.
//  • STANDARD mode: every game of the series starts fresh.
//  • GLOBAL BP mode: a team cannot re-pick heroes IT used in
//    earlier games of the series; the opponent's earlier picks
//    remain available to you. Bans are fresh every game.
// ═══════════════════════════════════════════════════════════

var DL_GAMES   = null;          // parsed pro games
var DL_AGG     = null;          // aggregated stats cache
var DL_ACTIONS = [];            // current game [{side,type,n,hero|null}]
var DL_STARTED = false;
var DL_MODE    = 'global';      // 'global' | 'standard'
var DL_FORMAT  = 5;             // BO1..BO7
var DL_SERIES  = [];            // completed games [{actions,rolesB,rolesR,winner}]
var DL_VIEW    = null;          // null = live game, or index into DL_SERIES (review)
var DL_TEAM    = {B:'', R:''};
var DL_US      = 'B';
var DL_SEARCH  = '';
var DL_GRID_ROLE = 'All';
var DL_INTEL_EXP = false;
var DL_ROLE_OVERRIDE = {B:{}, R:{}};
var DL_SWAP_SEL = null;
var DL_TIMER_ON = true;
var DL_TIMER_LEFT = 40;
var _DL_TIMER_IV = null;
var _DL_CSS_DONE = false;

var _DL_ROLES = ['DSL','JUG','MID','ADL','SUP'];
var _DL_FLEX_MIN_G = 5;         // ≥5 games in a role = real flex threat
var _DL_PAIR_MIN_G = 8;         // min games to trust an ALLY pair stat
var _DL_CTR_MIN_G  = 4;         // counter hints from ≥4 shared games ('thin' below 8)
var _DL_REC_HALF   = 3;         // meta recency half-life, in week buckets
var _DL_TIME_PICK = 60;
var _DL_TIME_BAN  = 40;
var _DL_BUCKETS = ['W1','W2','W3','W4','W5','W6','W7','PO'];

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

// ── Hero identity: canonical names ──────────────────────────
// The CSV, the Supabase hero DB and HERO_IMG_MAP spell some
// heroes differently. Everything is resolved to ONE canonical
// display name so the grid never shows duplicates.

var _DL_ALIAS = {
  'flowbornmage':     'Flowborn (Mage)',
  'flowbornmarksman': 'Flowborn (Marksman)',
  'wukong':           'Wukong',     // CSV 'WuKong' → hero DB spelling
  'diaochan':         'Diaochan'    // CSV 'Diao chan' → hero DB spelling
};
var _DL_HIDDEN = { 'flowborn': 1 };   // ambiguous bare entry from hero DB

function _dlNormKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function dlCanon(name) {
  var k = _dlNormKey(name);
  return _DL_ALIAS[k] || name;
}
// distinguishing tag for heroes that share one portrait
function _dlPortraitTag(hero) {
  if (hero === 'Flowborn (Mage)') return 'MAGE';
  if (hero === 'Flowborn (Marksman)') return 'ADC';
  return '';
}

// hero-DB role vocabulary → draft role codes
var _DL_ROLE_VOCAB = {
  'Offlane':'DSL', 'Darkslayer':'DSL', 'Midlane':'MID', 'Mid':'MID',
  'Jungler':'JUG', 'Jungle':'JUG', 'Carry':'ADL', 'ADC':'ADL',
  'Marksman':'ADL', 'Support':'SUP',
  'DSL':'DSL','JUG':'JUG','MID':'MID','ADL':'ADL','SUP':'SUP'
};

// ── Engine ──────────────────────────────────────────────────

function dlCurStep() {
  return DL_ACTIONS.length < _DL_SEQ.length ? _DL_SEQ[DL_ACTIONS.length] : null;
}
function dlIsBanned(hero) {
  return DL_ACTIONS.some(function(a){ return a.type==='ban' && a.hero===hero; });
}
function dlIsPickedAny(hero) {
  return DL_ACTIONS.some(function(a){ return a.type==='pick' && a.hero===hero; });
}
// heroes a side has used in EARLIER games of the series (global BP)
function dlSeriesDead(side) {
  var set = {};
  if (DL_MODE === 'global') {
    DL_SERIES.forEach(function(g) {
      g.actions.forEach(function(a) {
        if (a.type === 'pick' && a.side === side && a.hero) set[a.hero] = 1;
      });
    });
  }
  return set;
}
// Availability for the CURRENT step. No mirrors within a game.
function dlAvailable(hero) {
  var st = dlCurStep();
  if (!st || !DL_STARTED || DL_VIEW !== null) return false;
  if (dlIsBanned(hero) || dlIsPickedAny(hero)) return false;
  if (st.type === 'pick' && dlSeriesDead(st.side)[hero]) return false;
  return true;
}

function dlApply(hero) {
  if (!dlAvailable(hero)) return;
  var st = dlCurStep();
  DL_ACTIONS.push({side:st.side, type:st.type, n:st.n, hero:hero});
  DL_SWAP_SEL = null;
  _dlTimerReset();
  dlRender();
}
function dlSkipBan() {
  var st = dlCurStep();
  if (!st || st.type !== 'ban' || DL_VIEW !== null) return;
  DL_ACTIONS.push({side:st.side, type:st.type, n:st.n, hero:null});
  _dlTimerReset();
  dlRender();
}
function dlUndo() {
  if (!DL_ACTIONS.length || DL_VIEW !== null) return;
  DL_ACTIONS.pop();
  DL_SWAP_SEL = null;
  _dlTimerReset();
  dlRender();
}
function dlNewDraft() {           // (re)start the current game
  DL_ACTIONS = [];
  DL_ROLE_OVERRIDE = {B:{}, R:{}};
  DL_SWAP_SEL = null;
  DL_STARTED = true;
  DL_VIEW = null;
  _dlTimerReset();
  dlRender();
}
function dlResetSeries() {
  DL_SERIES = [];
  dlResetGameState();
  DL_STARTED = false;
  _dlTimerStop();
  dlRender();
}
function dlResetGameState() {
  DL_ACTIONS = [];
  DL_ROLE_OVERRIDE = {B:{}, R:{}};
  DL_SWAP_SEL = null;
  DL_VIEW = null;
}
function dlNextGame() {
  if (dlCurStep() !== null) return;             // draft not finished
  if (DL_SERIES.length + 1 >= DL_FORMAT) {}     // last game: still record it
  DL_SERIES.push({
    actions: DL_ACTIONS,
    rolesB: dlComputedRoles('B'),
    rolesR: dlComputedRoles('R'),
    winner: null
  });
  dlResetGameState();
  DL_STARTED = DL_SERIES.length < DL_FORMAT;
  _dlTimerReset();
  dlRender();
}
function dlSetWinner(gameIdx, side) {
  if (!DL_SERIES[gameIdx]) return;
  DL_SERIES[gameIdx].winner = DL_SERIES[gameIdx].winner === side ? null : side;
  dlRender();
}
function dlViewGame(idx) {        // null/-1 = back to live
  DL_VIEW = (idx === -1 || idx === null) ? null : idx;
  dlRender();
}
function dlSwapSides() {
  var t = DL_TEAM.B; DL_TEAM.B = DL_TEAM.R; DL_TEAM.R = t;
  DL_US = DL_US === 'B' ? 'R' : 'B';
  dlRender();
}
function dlSetMode(m) {
  DL_MODE = m;
  dlRender();
}
function dlPicksFor(side, actions) {
  return (actions || DL_ACTIONS).filter(function(a){ return a.type==='pick' && a.side===side; });
}
function dlBansFor(side, actions) {
  return (actions || DL_ACTIONS).filter(function(a){ return a.type==='ban' && a.side===side; });
}

// ── Roles: flex data, auto-assignment, swap ──────────────────

function _dlHeroRoleCounts(hero) {
  var counts = {};
  if (DL_AGG && DL_AGG.heroes[hero]) counts = DL_AGG.heroes[hero].roles || {};
  if (!Object.keys(counts).length && typeof getLiveHeroes === 'function') {
    var db = getLiveHeroes() || [];
    var key = _dlNormKey(hero);
    var hh = db.find(function(x){ return _dlNormKey(dlCanon(x.name)) === key; });
    if (hh && hh.roles) hh.roles.forEach(function(r) {
      var code = _DL_ROLE_VOCAB[r];
      if (code) counts[code] = 1;
    });
  }
  return counts;
}

// roles this hero is a REAL threat in (≥5 pro games), main role first
function dlFlexRoles(hero) {
  var rc = _dlHeroRoleCounts(hero);
  var real = _DL_ROLES.filter(function(r){ return (rc[r] || 0) >= _DL_FLEX_MIN_G; });
  if (!real.length) {
    // low-sample hero: fall back to its most common / DB role
    var ks = Object.keys(rc).sort(function(a,b){ return rc[b]-rc[a]; });
    return ks.length ? [ks[0]] : [];
  }
  return real.sort(function(a,b){ return rc[b]-rc[a]; });
}
function dlIsFlex(hero) { return dlFlexRoles(hero).length >= 2; }

// P(hero plays role r) over its flex roles, proportional to games
function dlRoleProb(hero) {
  var rc = _dlHeroRoleCounts(hero);
  var flex = dlFlexRoles(hero);
  var tot = 0;
  flex.forEach(function(r){ tot += (rc[r] || 1); });
  var p = {};
  flex.forEach(function(r){ p[r] = tot ? (rc[r] || 1) / tot : 0; });
  return p;
}

// Openness of each role for a side's REMAINING picks (probabilistic,
// flex-aware: a Marja pick only ~78% closes DSL, leaves ~22% on JUG).
function dlRoleOpenness(side) {
  var open = {};
  _DL_ROLES.forEach(function(r){ open[r] = 1; });
  dlPicksFor(side).forEach(function(p) {
    var prob = dlRoleProb(p.hero);
    Object.keys(prob).forEach(function(r) {
      open[r] = Math.max(0, open[r] - prob[r]);
    });
  });
  return open;
}

function dlComputedRoles(side) {
  var picks = dlPicksFor(side);
  var out = {}, usedRoles = {};
  picks.forEach(function(p) {
    var ov = DL_ROLE_OVERRIDE[side][p.n];
    if (ov) { out[p.n] = ov; usedRoles[ov] = 1; }
  });
  var remaining = picks.filter(function(p){ return !out[p.n]; });
  var freeRoles = _DL_ROLES.filter(function(r){ return !usedRoles[r]; });
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

function dlAutoSwap(side) {       // clear manual overrides → optimal fit
  DL_ROLE_OVERRIDE[side] = {};
  DL_SWAP_SEL = null;
  dlRender();
}
function dlRoleClick(side, n) {
  if (DL_VIEW !== null) return;
  if (!dlPicksFor(side).some(function(p){ return p.n === n; })) return;
  if (DL_SWAP_SEL && DL_SWAP_SEL.side === side && DL_SWAP_SEL.n !== n) {
    var roles = dlComputedRoles(side);
    var a = DL_SWAP_SEL.n, b = n;
    DL_ROLE_OVERRIDE[side][a] = roles[b];
    DL_ROLE_OVERRIDE[side][b] = roles[a];
    Object.keys(roles).forEach(function(k) {
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

// ── Pro-data aggregation (canonical names) ───────────────────

// 'w3d2' → 'W3', 'po1' → 'PO' (same buckets as datalab-core)
function _dlWeekBucket(wk) {
  if (!wk) return null;
  var m = /^w(\d+)/i.exec(wk);
  if (m) return 'W' + Math.min(+m[1], 7);
  if (/^po/i.test(wk)) return 'PO';
  return null;
}

function _dlBuildAgg(games) {
  var agg = {total: games.length, blueWins: 0, heroes: {}, teams: {},
             pairAlly: {}, pairEnemy: {}, wTotal: 0, meanLift: {}};

  // recency weights: half-life of _DL_REC_HALF buckets back from the
  // latest bucket in the data. Games without WEEK get a mild discount;
  // if NO game has WEEK info, every weight is 1 (v2 behaviour).
  var maxIdx = -1;
  games.forEach(function(g) {
    var i = _DL_BUCKETS.indexOf(_dlWeekBucket(g.week));
    if (i > maxIdx) maxIdx = i;
  });
  function recW(g) {
    if (maxIdx < 0) return 1;
    var i = _DL_BUCKETS.indexOf(_dlWeekBucket(g.week));
    if (i < 0) return 0.5;
    return Math.pow(0.5, (maxIdx - i) / _DL_REC_HALF);
  }

  function H(h) {
    if (!agg.heroes[h]) agg.heroes[h] = {g:0, w:0, bans:0, roles:{}, players:{},
                                         wg:0, ww:0, wbans:0};
    return agg.heroes[h];
  }
  function T(t) {
    if (!agg.teams[t]) agg.teams[t] = {g:0, w:0, players:{}};
    return agg.teams[t];
  }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  games.forEach(function(g) {
    if (g.winSide === 'A') agg.blueWins++;
    var rw = recW(g);
    agg.wTotal += rw;
    ['A','B'].forEach(function(S) {
      var abbr = g.teams[S];
      if (abbr) { var tm = T(abbr); tm.g++; if (g.winSide === S) tm.w++; }
      (g.bans[S] || []).forEach(function(h){
        if (h) { var hb = H(dlCanon(h)); hb.bans++; hb.wbans += rw; }
      });
    });
    var sidePicks = {A:[], B:[]};
    g.picks.forEach(function(pk) {
      if (!pk.hero) return;
      var hero = dlCanon(pk.hero);
      sidePicks[pk.side].push(hero);
      var h = H(hero);
      var won = g.winSide === pk.side;
      h.g++; if (won) h.w++;
      h.wg += rw; if (won) h.ww += rw;
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
          if (!tp[pk.player].heroes[hero]) tp[pk.player].heroes[hero] = {g:0, w:0};
          tp[pk.player].heroes[hero].g++;
          if (won) tp[pk.player].heroes[hero].w++;
        }
      }
    });
    // ally pairs (same side) and enemy pairs (cross side)
    ['A','B'].forEach(function(S) {
      var won = g.winSide === S;
      var ps = sidePicks[S];
      for (var i = 0; i < ps.length; i++) {
        for (var j = i + 1; j < ps.length; j++) {
          var k = pairKey(ps[i], ps[j]);
          if (!agg.pairAlly[k]) agg.pairAlly[k] = {g:0, w:0};
          agg.pairAlly[k].g++;
          if (won) agg.pairAlly[k].w++;
        }
      }
    });
    sidePicks.A.forEach(function(ha) {
      sidePicks.B.forEach(function(hb) {
        var k = pairKey(ha, hb);
        if (!agg.pairEnemy[k]) agg.pairEnemy[k] = {g:0, wFirst:0};
        agg.pairEnemy[k].g++;
        // wFirst = wins for the alphabetically-first hero of the pair
        var firstIsA = (ha < hb);
        if ((g.winSide === 'A') === firstIsA) agg.pairEnemy[k].wFirst++;
      });
    });
  });

  // mean ally-pair lift per hero (≥8G pairs). Used to centre combo
  // scores: a hero that lifts EVERYONE (Annette) only surfaces for
  // duos above its own norm.
  var acc = {};
  Object.keys(agg.pairAlly).forEach(function(k) {
    var p = agg.pairAlly[k];
    if (p.g < _DL_PAIR_MIN_G) return;
    var hs = k.split('|');
    var a = agg.heroes[hs[0]], b = agg.heroes[hs[1]];
    if (!a || !b) return;
    var exp = (_dlShrunkWR(a.w, a.g) + _dlShrunkWR(b.w, b.g)) / 2;
    var lift = _dlShrunkWR(p.w, p.g, 8) - exp;
    hs.forEach(function(h) {
      if (!acc[h]) acc[h] = {s:0, n:0};
      acc[h].s += lift; acc[h].n++;
    });
  });
  agg.meanLiftN = {};
  Object.keys(acc).forEach(function(h) {
    agg.meanLift[h] = acc[h].s / acc[h].n;
    agg.meanLiftN[h] = acc[h].n;
  });
  return agg;
}

function _dlShrunkWR(w, g, k) { k = k || 10; return (w + k * 0.5) / (g + k); }

function _dlPresence(h) {
  if (!DL_AGG || !DL_AGG.heroes[h] || !DL_AGG.total) return 0;
  var x = DL_AGG.heroes[h];
  return (x.g + x.bans) / DL_AGG.total;
}

// synergy lift of hero h with one ally (null if low sample)
function dlAllyLift(h, ally) {
  if (!DL_AGG) return null;
  var k = h < ally ? h + '|' + ally : ally + '|' + h;
  var p = DL_AGG.pairAlly[k];
  if (!p || p.g < _DL_PAIR_MIN_G) return null;
  var ha = DL_AGG.heroes[h], hb = DL_AGG.heroes[ally];
  if (!ha || !hb) return null;
  var exp = (_dlShrunkWR(ha.w, ha.g) + _dlShrunkWR(hb.w, hb.g)) / 2;
  return {lift: _dlShrunkWR(p.w, p.g, 8) - exp, g: p.g, wr: p.w / p.g};
}
// counter lift of hero h against one enemy (positive = h beats enemy).
// ≥4 shared games; 4–7G get heavier shrinkage and a thin-data flag.
function dlCounterLift(h, enemy) {
  if (!DL_AGG) return null;
  var first = h < enemy;
  var k = first ? h + '|' + enemy : enemy + '|' + h;
  var p = DL_AGG.pairEnemy[k];
  if (!p || p.g < _DL_CTR_MIN_G) return null;
  var wins = first ? p.wFirst : p.g - p.wFirst;
  var thin = p.g < _DL_PAIR_MIN_G;
  return {lift: _dlShrunkWR(wins, p.g, thin ? 12 : 8) - 0.5,
          g: p.g, wr: wins / p.g, thin: thin};
}

// combo lift centred on the hero's own average lift across partners —
// the 'Annette fix': only above-her-norm duos count as combo signal.
// The centre is shrunk by partner count so a hero with ONE strong duo
// (n=1 → centre ≈ lift/4) still surfaces, while a lifts-everyone hero
// (large n → centre ≈ mean) gets flattened.
function dlExcessLift(h, ally) {
  var L = dlAllyLift(h, ally);
  if (!L) return null;
  var n = (DL_AGG.meanLiftN || {})[h] || 0;
  var centre = (DL_AGG.meanLift[h] || 0) * (n / (n + 3));
  L.excess = L.lift - centre;
  return L;
}

// recency-weighted presence / winrate (half-life _DL_REC_HALF buckets)
function _dlWPresence(h) {
  if (!DL_AGG || !DL_AGG.heroes[h] || !DL_AGG.wTotal) return 0;
  var x = DL_AGG.heroes[h];
  return (x.wg + x.wbans) / DL_AGG.wTotal;
}
function _dlWWR(h) {
  if (!DL_AGG || !DL_AGG.heroes[h]) return 0.5;
  var x = DL_AGG.heroes[h];
  return _dlShrunkWR(x.ww, x.wg);
}

// most bannable enemy player: narrow signature pool × WR × volume
function dlKeyPlayer(abbr) {
  if (!abbr || !DL_AGG || !DL_AGG.teams[abbr]) return null;
  var best = null;
  var ps = DL_AGG.teams[abbr].players;
  Object.keys(ps).forEach(function(ign) {
    var pl = ps[ign];
    if (pl.g < 8) return;
    var counts = Object.keys(pl.heroes).map(function(h){ return pl.heroes[h].g; });
    var tot = 0, w = 0;
    Object.keys(pl.heroes).forEach(function(h){ tot += pl.heroes[h].g; w += pl.heroes[h].w; });
    if (!tot) return;
    var top3 = counts.sort(function(a,b){ return b - a; }).slice(0, 3)
                     .reduce(function(a,b){ return a + b; }, 0);
    var conc = top3 / tot;
    var score = conc * _dlShrunkWR(w, tot) * Math.log(1 + tot);
    if (!best || score > best.score)
      best = {ign: ign, score: score, conc: conc, wr: w / tot, g: tot};
  });
  return best;
}

// threat flags on the OPPONENT's picks (from OUR perspective).
// flagged when (a) high WR and nothing of ours beats it, or
// (b) it counters ≥2 of our picks. Includes best available answers.
function dlThreats() {
  if (!DL_AGG || DL_VIEW !== null) return [];
  var E = DL_US === 'B' ? 'R' : 'B';
  var myPicks = dlPicksFor(DL_US).map(function(p){ return p.hero; });
  var enemyPicks = dlPicksFor(E).map(function(p){ return p.hero; });
  var out = [];
  enemyPicks.forEach(function(e) {
    var x = DL_AGG.heroes[e];
    var wr = x ? _dlShrunkWR(x.w, x.g) : 0.5;
    var answered = myPicks.some(function(m) {
      var C = dlCounterLift(m, e);
      return C && C.lift >= 0.02;
    });
    var beatsUs = myPicks.filter(function(m) {
      var C = dlCounterLift(e, m);
      return C && C.lift >= 0.04;
    }).length;
    var why = null;
    if (beatsUs >= 2) why = 'counters ' + beatsUs + ' of our picks';
    else if (wr >= 0.55 && !answered) why = Math.round((x.w / x.g) * 100) + '% WR, unanswered';
    if (!why) return;
    var answers = [];
    Object.keys(DL_AGG.heroes).forEach(function(h) {
      if (!dlAvailable(h)) return;
      var C = dlCounterLift(h, e);
      if (C && C.lift >= 0.04) answers.push({hero: h, C: C});
    });
    answers.sort(function(a,b){ return b.C.lift - a.C.lift; });
    out.push({hero: e, why: why, answers: answers.slice(0, 3)});
  });
  return out;
}

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

// ── Intel: categorized suggestions for the current step ──────
//
// Picks: COUNTER / COMBO / STEAL / META.  Bans mirror the same
// thinking: PROTECT / BREAK COMBO / TARGET player / DENY FLEX /
// META BAN.  A hero may appear in several sections.

function _dlPct(x) { return Math.round(x * 100); }

// anti-synergy check vs our own locked picks (shared by sections)
function _dlClash(h, myPicks) {
  var worst = null;
  myPicks.forEach(function(a) {
    var L = dlAllyLift(h, a);
    if (L && (!worst || L.lift < worst.L.lift)) worst = {ally:a, L:L};
  });
  return (worst && worst.L.lift <= -0.08) ? worst : null;
}

function _dlItem(h, score, reason, fits, extra) {
  var it = {hero:h, score:score, reason:reason,
            roles: fits && fits.length ? fits : dlFlexRoles(h),
            flex: dlIsFlex(h), warn:false, thin:false};
  if (extra) Object.keys(extra).forEach(function(k){ it[k] = extra[k]; });
  return it;
}

function _dlPickSections(st) {
  var S = st.side, E = S === 'B' ? 'R' : 'B';
  var roles = dlComputedRoles(S);
  var covered = {};
  Object.keys(roles).forEach(function(n){ covered[roles[n]] = 1; });
  var needed = _DL_ROLES.filter(function(r){ return !covered[r]; });
  var ownTeam = DL_TEAM[S], enemyTeam = DL_TEAM[E];
  var myPicks = dlPicksFor(S).map(function(p){ return p.hero; });
  var enemyPicks = dlPicksFor(E).map(function(p){ return p.hero; });

  // candidate pool: available + fills a role we still need
  var cands = [];
  Object.keys(DL_AGG.heroes).forEach(function(h) {
    if (!dlAvailable(h)) return;
    var x = DL_AGG.heroes[h];
    if (x.g < 2) return;
    var fits = dlFlexRoles(h).filter(function(r){ return needed.indexOf(r) >= 0; });
    if (needed.length && !fits.length) return;
    cands.push({h:h, fits:fits});
  });

  var counter = [], combo = [], steal = [], meta = [];

  cands.forEach(function(c) {
    var h = c.h;
    var clash = _dlClash(h, myPicks);
    var clashTxt = clash ? ' · ⚠ clashes with ' + clash.ally + ' (' + _dlPct(clash.L.wr) + '% in ' + clash.L.g + 'G)' : '';

    // COUNTER — beats what they've locked
    if (enemyPicks.length) {
      var cSum = 0, cN = 0, bestC = null;
      enemyPicks.forEach(function(e) {
        var C = dlCounterLift(h, e);
        if (!C) return;
        cSum += C.lift; cN++;
        if (!bestC || C.lift > bestC.C.lift) bestC = {enemy:e, C:C};
      });
      if (bestC && bestC.C.lift >= 0.04) {
        counter.push(_dlItem(h, cSum / cN,
          'Beats ' + bestC.enemy + ' — ' + _dlPct(bestC.C.wr) + '% in ' + bestC.C.g + 'G' + clashTxt,
          c.fits, {thin: bestC.C.thin, warn: !!clash}));
      }
    }

    // COMBO — excess lift with what we've locked (Annette-corrected)
    if (myPicks.length) {
      var xSum = 0, xN = 0, bestX = null;
      myPicks.forEach(function(a) {
        var L = dlExcessLift(h, a);
        if (!L) return;
        xSum += L.excess; xN++;
        if (!bestX || L.excess > bestX.L.excess) bestX = {ally:a, L:L};
      });
      if (bestX && bestX.L.lift >= 0.04 && bestX.L.excess >= 0.02) {
        combo.push(_dlItem(h, xSum / xN,
          'Pairs with ' + bestX.ally + ' — ' + _dlPct(bestX.L.wr) + '% in ' + bestX.L.g + 'G (+' + _dlPct(bestX.L.lift) + ' lift)',
          c.fits, {warn: false}));
      }
    }

    // STEAL — their comfort, our role need
    var cf = _dlTeamComfort(enemyTeam, h);
    if (cf && cf.g >= 4 && cf.w / cf.g >= 0.5 && c.fits.length) {
      steal.push(_dlItem(h, Math.min(cf.g / 10, 1) * _dlShrunkWR(cf.w, cf.g),
        'Denies ' + cf.ign + ' (' + cf.g + 'G ' + _dlPct(cf.w / cf.g) + '%) · fits our ' + c.fits.join('/') + clashTxt,
        c.fits, {warn: !!clash}));
    }

    // META — recency-weighted strength
    var wPres = _dlWPresence(h), pres = _dlPresence(h);
    if (wPres >= 0.03) {
      var trend = wPres > pres * 1.25 ? ' · ↑ rising' : (wPres < pres * 0.75 ? ' · ↓ fading' : '');
      var own = _dlTeamComfort(ownTeam, h);
      var ownTxt = own ? ' · ' + own.ign + ' ' + own.g + 'G' : '';
      meta.push(_dlItem(h, wPres * 0.55 + (_dlWWR(h) - 0.5) * 1.6,
        _dlPct(wPres) + '% presence · ' + _dlPct(_dlWWR(h)) + '% WR lately' + trend + ownTxt + clashTxt,
        c.fits, {warn: !!clash}));
    }
  });

  function top(arr) { arr.sort(function(a,b){ return b.score - a.score; }); return arr; }
  return {
    label: 'PICK ' + st.n + (needed.length ? ' — NEED ' + needed.join(' / ') : ''),
    kp: null,
    sections: [
      {key:'counter', title:'COUNTER PICK', cls:'ctr', items: top(counter)},
      {key:'combo',   title:'COMBO PICK',   cls:'cmb', items: top(combo)},
      {key:'steal',   title:'STEAL PICK',   cls:'stl', items: top(steal)},
      {key:'meta',    title:'META PICK',    cls:'mta', items: top(meta)}
    ].filter(function(s){ return s.items.length; })
  };
}

function _dlBanSections(st) {
  var E = st.side === 'B' ? 'R' : 'B';           // side being denied
  var S = st.side;
  var enemyTeam = DL_TEAM[E];
  var enemyOpen = dlRoleOpenness(E);
  var enemyDead = dlSeriesDead(E);
  var myPicks = dlPicksFor(S).map(function(p){ return p.hero; });
  var enemyPicks = dlPicksFor(E).map(function(p){ return p.hero; });

  function openFactor(h) {
    if (enemyDead[h]) return 0.05;
    var prob = dlRoleProb(h), f = 0;
    Object.keys(prob).forEach(function(r){ f += prob[r] * (enemyOpen[r] || 0); });
    return f;
  }

  var avail = Object.keys(DL_AGG.heroes).filter(dlAvailable);

  // our 'plan': locked picks, else top meta candidates for roles we need
  var plan = myPicks.slice();
  if (!plan.length) {
    var myRoles = dlComputedRoles(S), cov = {};
    Object.keys(myRoles).forEach(function(n){ cov[myRoles[n]] = 1; });
    var need = _DL_ROLES.filter(function(r){ return !cov[r]; });
    plan = avail.filter(function(h) {
      return dlFlexRoles(h).some(function(r){ return need.indexOf(r) >= 0; });
    }).sort(function(a,b){ return _dlWPresence(b) * _dlWWR(b) - _dlWPresence(a) * _dlWWR(a); })
      .slice(0, 5);
  }

  var protect = [], breakC = [], target = [], flex = [], metaB = [];
  var kp = dlKeyPlayer(enemyTeam);

  avail.forEach(function(h) {
    var f = openFactor(h);
    if (f < 0.15) return;                        // they can't really use it

    // PROTECT OUR PLAN — h would counter what we have / intend
    var bestP = null;
    plan.forEach(function(our) {
      var C = dlCounterLift(h, our);
      if (C && C.lift >= 0.04 && (!bestP || C.lift > bestP.C.lift)) bestP = {our:our, C:C};
    });
    if (bestP) {
      protect.push(_dlItem(h, bestP.C.lift * f,
        'Counters our ' + bestP.our + ' — ' + _dlPct(bestP.C.wr) + '% in ' + bestP.C.g + 'G',
        null, {thin: bestP.C.thin}));
    }

    // BREAK THEIR COMBO — h pairs hard with what they've locked
    if (enemyPicks.length) {
      var bestB = null;
      enemyPicks.forEach(function(ep) {
        var L = dlExcessLift(h, ep);
        if (L && L.lift >= 0.05 && (!bestB || L.excess > bestB.L.excess)) bestB = {ep:ep, L:L};
      });
      if (bestB && bestB.L.excess >= 0.02) {
        breakC.push(_dlItem(h, bestB.L.excess * f,
          'Combos with their ' + bestB.ep + ' — ' + _dlPct(bestB.L.wr) + '% in ' + bestB.L.g + 'G',
          null, {}));
      }
    }

    // TARGET key player — his comfort pool
    if (kp && enemyTeam && DL_AGG.teams[enemyTeam]) {
      var hs = DL_AGG.teams[enemyTeam].players[kp.ign].heroes[h];
      if (hs && hs.g >= 4) {
        target.push(_dlItem(h, Math.min(hs.g / 12, 1) * _dlShrunkWR(hs.w, hs.g) * f,
          kp.ign + "'s pool — " + hs.g + 'G ' + _dlPct(hs.w / hs.g) + '%',
          null, {}));
      }
    }

    // DENY FLEX — kill their draft flexibility
    if (dlIsFlex(h)) {
      flex.push(_dlItem(h, _dlWPresence(h) * _dlWWR(h) * f,
        'Flex ' + dlFlexRoles(h).join('/') + ' · ' + _dlPct(_dlWPresence(h)) + '% presence',
        null, {}));
    }

    // META BAN — recency-weighted power (v2 formula, weighted stats)
    var score = (_dlWPresence(h) * 0.55 + _dlWWR(h) * 0.45) * (0.15 + 0.85 * f);
    var reason = _dlPct(_dlWPresence(h)) + '% presence · ' + _dlPct(_dlWWR(h)) + '% WR lately';
    var cf = _dlTeamComfort(enemyTeam, h);
    if (cf && cf.w / cf.g >= 0.5) {
      score += 0.22 * Math.min(cf.g / 10, 1) * f;
      reason += ' · ' + cf.ign + ' ' + cf.g + 'G';
    }
    if (_dlWPresence(h) >= 0.05) metaB.push(_dlItem(h, score, reason, null, {}));
  });

  function top(arr) { arr.sort(function(a,b){ return b.score - a.score; }); return arr; }
  return {
    label: 'BAN ' + st.n + ' — DENY ' + (enemyTeam || (E === 'B' ? 'BLUE' : 'RED')),
    kp: kp,
    sections: [
      {key:'protect', title:'PROTECT OUR PLAN',  cls:'ctr', items: top(protect)},
      {key:'break',   title:'BREAK THEIR COMBO', cls:'cmb', items: top(breakC)},
      {key:'target',  title: kp ? 'TARGET ' + kp.ign.toUpperCase() : 'TARGET PLAYER', cls:'stl', items: top(target)},
      {key:'flex',    title:'DENY FLEX',         cls:'flx', items: top(flex)},
      {key:'metaban', title:'META BAN',          cls:'mta', items: top(metaB)}
    ].filter(function(s){ return s.items.length; })
  };
}

function dlIntelSections() {
  var st = dlCurStep();
  if (!st || !DL_AGG || DL_VIEW !== null) return null;
  return st.type === 'ban' ? _dlBanSections(st) : _dlPickSections(st);
}

// flat adapter — used for highlighting suggested cards in the grid
function dlSuggestions(limit) {
  var sec = dlIntelSections();
  if (!sec) return {label:'', items:[]};
  var seen = {}, items = [];
  var per = Math.max(1, Math.ceil(limit / Math.max(sec.sections.length, 1)));
  sec.sections.forEach(function(s) {
    s.items.slice(0, per).forEach(function(it) {
      if (seen[it.hero]) return;
      seen[it.hero] = 1;
      items.push(it);
    });
  });
  return {label: sec.label, items: items.slice(0, limit)};
}

function dlOpenThreats(limit) {
  if (!DL_AGG || DL_VIEW !== null) return [];
  var oppSide = DL_US === 'B' ? 'R' : 'B';
  var abbr = DL_TEAM[oppSide];
  if (!abbr || !DL_AGG.teams[abbr]) return [];
  var oppDead = dlSeriesDead(oppSide);
  var rows = [];
  var ps = DL_AGG.teams[abbr].players;
  Object.keys(ps).forEach(function(ign) {
    Object.keys(ps[ign].heroes).forEach(function(h) {
      var hs = ps[ign].heroes[h];
      if (hs.g < 4) return;
      if (dlIsBanned(h) || dlIsPickedAny(h) || oppDead[h]) return;
      rows.push({hero:h, ign:ign, g:hs.g, wr:hs.w / hs.g});
    });
  });
  rows.sort(function(a,b){ return (b.g * (0.5 + b.wr)) - (a.g * (0.5 + a.wr)); });
  return rows.slice(0, limit);
}

// ── Timer (60s pick / 40s ban) ───────────────────────────────

function _dlStepTime() {
  var st = dlCurStep();
  return st && st.type === 'pick' ? _DL_TIME_PICK : _DL_TIME_BAN;
}
function _dlTimerReset() {
  DL_TIMER_LEFT = _dlStepTime();
  _dlTimerStop();
  if (DL_TIMER_ON && DL_STARTED && dlCurStep() && DL_VIEW === null) {
    _DL_TIMER_IV = setInterval(function() {
      DL_TIMER_LEFT = Math.max(0, DL_TIMER_LEFT - 1);
      var el = document.getElementById('dl-timer');
      if (!el) { _dlTimerStop(); return; }
      el.textContent = '0:' + String(DL_TIMER_LEFT).padStart(2, '0');
      el.classList.toggle('low', DL_TIMER_LEFT <= 10);
    }, 1000);
  }
}
function _dlTimerStop() { if (_DL_TIMER_IV) { clearInterval(_DL_TIMER_IV); _DL_TIMER_IV = null; } }
function dlToggleTimer() { DL_TIMER_ON = !DL_TIMER_ON; _dlTimerReset(); dlRender(); }

// ── Scenarios: save the WHOLE series (draft + position order) ─

function _dlScenarios() {
  try { return JSON.parse(localStorage.getItem('dl_scenarios_v2') || '[]'); }
  catch(e) { return []; }
}
function _dlSaveScenarios(list) {
  localStorage.setItem('dl_scenarios_v2', JSON.stringify(list));
}
function dlOpenSaveModal() {
  if (!DL_ACTIONS.length && !DL_SERIES.length) return;
  var m = document.getElementById('dl-modal');
  m.style.display = 'flex';
  m.innerHTML =
    '<div class="dl-modal-box">' +
      '<div class="dl-modal-title">SAVE SERIES</div>' +
      '<input id="dl-scn-name" class="dl-inp" placeholder="e.g. vs FS — playoffs prep" maxlength="60"/>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
        '<button class="tier-mode-btn" onclick="dlCloseModal()">CANCEL</button>' +
        '<button class="tier-mode-btn active" onclick="dlConfirmSave()">SAVE</button>' +
      '</div>' +
    '</div>';
  setTimeout(function(){ var i = document.getElementById('dl-scn-name'); if (i) i.focus(); }, 50);
}
function dlConfirmSave() {
  var name = (document.getElementById('dl-scn-name') || {}).value || '';
  name = name.trim() || 'Unnamed series';
  var list = _dlScenarios();
  list.unshift({
    id: Date.now(), name: name, date: new Date().toISOString().slice(0, 10),
    mode: DL_MODE, format: DL_FORMAT,
    series: DL_SERIES,
    current: {actions: DL_ACTIONS, roleOverride: DL_ROLE_OVERRIDE,
              rolesB: dlComputedRoles('B'), rolesR: dlComputedRoles('R')},
    teams: {B: DL_TEAM.B, R: DL_TEAM.R}, us: DL_US
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
    var nGames = (s.series || []).length + ((s.current && s.current.actions.length) ? 1 : 0);
    return '<div class="dl-scn-row">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _dlEsc(s.name) + '</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">' + s.date + ' · BO' + (s.format || '?') + ' ' + (s.mode === 'global' ? 'GLOBAL' : 'STD') + ' · ' + nGames + ' game' + (nGames === 1 ? '' : 's') + ' · ' + (s.teams.B || '?') + ' vs ' + (s.teams.R || '?') + '</div>' +
      '</div>' +
      '<button class="tier-mode-btn" data-dl-load="' + s.id + '">LOAD</button>' +
      '<button class="tier-mode-btn" data-dl-del="' + s.id + '" style="color:var(--danger);">✕</button>' +
    '</div>';
  }).join('') : '<div style="padding:20px;font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">No saved series yet</div>';
  m.innerHTML =
    '<div class="dl-modal-box" style="max-width:480px;width:92%;">' +
      '<div class="dl-modal-title">SAVED SERIES</div>' +
      '<div style="max-height:340px;overflow-y:auto;">' + rows + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
        '<button class="tier-mode-btn" onclick="dlCloseModal()">CLOSE</button>' +
      '</div>' +
    '</div>';
}
function dlLoadScenario(id) {
  var s = _dlScenarios().find(function(x){ return x.id === id; });
  if (!s) return;
  DL_MODE = s.mode || 'global';
  DL_FORMAT = s.format || 5;
  DL_SERIES = s.series || [];
  DL_ACTIONS = (s.current && s.current.actions) || [];
  DL_ROLE_OVERRIDE = (s.current && s.current.roleOverride) || {B:{}, R:{}};
  DL_TEAM = s.teams || {B:'', R:''};
  DL_US = s.us || 'B';
  DL_STARTED = true;
  DL_VIEW = null;
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
  var tag = _dlPortraitTag(hero);
  var inner = (typeof heroPortraitHtml === 'function')
    ? heroPortraitHtml(hero, size, false)
    : '<div style="width:' + size + 'px;height:' + size + 'px;background:var(--grey-8);"></div>';
  if (!tag) return inner;
  return '<div style="position:relative;display:inline-block;line-height:0;">' + inner +
    '<span class="dl-portrait-tag">' + tag + '</span></div>';
}

// ── Init / data load ─────────────────────────────────────────

function dlInit() {
  _dlInjectCss();
  var root = document.getElementById('dl-root');
  if (!root) return;
  if (!root.dataset.built) {
    root.dataset.built = '1';
    root.innerHTML =
      '<div id="dl-series-bar"></div>' +
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
        .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
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
  _dlRenderSeriesBar();
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
function _dlViewActions() {
  return DL_VIEW !== null ? DL_SERIES[DL_VIEW].actions : DL_ACTIONS;
}

function _dlRenderSeriesBar() {
  var el = document.getElementById('dl-series-bar');
  if (!el) return;
  var tabs = '';
  for (var i = 0; i < DL_FORMAT; i++) {
    var done = i < DL_SERIES.length;
    var isLive = i === DL_SERIES.length;
    var active = (DL_VIEW === i) || (DL_VIEW === null && isLive);
    var w = done ? DL_SERIES[i].winner : null;
    var cls = 'dl-game-tab' + (active ? ' active' : '') + (done ? ' done' : '') + (isLive ? ' live' : '');
    var mark = w === 'B' ? '<span class="dl-w-dot blue"></span>' : w === 'R' ? '<span class="dl-w-dot red"></span>' : '';
    var click = done ? 'dlViewGame(' + i + ')' : isLive ? 'dlViewGame(-1)' : '';
    tabs += '<button class="' + cls + '"' + (click ? ' onclick="' + click + '"' : ' disabled') + '>G' + (i + 1) + mark + '</button>';
  }
  var score = {B:0, R:0};
  DL_SERIES.forEach(function(g){ if (g.winner) score[g.winner]++; });

  el.innerHTML =
    '<div class="dl-series-row">' +
      '<div class="dl-mode-tgl">' +
        '<button class="tier-mode-btn' + (DL_MODE === 'standard' ? ' active' : '') + '" onclick="dlSetMode(\'standard\')" title="Every game starts fresh">STANDARD</button>' +
        '<button class="tier-mode-btn' + (DL_MODE === 'global' ? ' active' : '') + '" onclick="dlSetMode(\'global\')" title="Own picks from earlier games are dead; opponent\'s remain open to you. Bans fresh each game.">GLOBAL BP</button>' +
      '</div>' +
      '<select class="dl-team-sel" style="border:var(--border);padding:3px 6px;" onchange="DL_FORMAT=+this.value;dlRender()">' +
        [1,3,5,7].map(function(n){ return '<option value="' + n + '"' + (DL_FORMAT === n ? ' selected' : '') + '>BO' + n + '</option>'; }).join('') +
      '</select>' +
      '<div class="dl-game-tabs">' + tabs + '</div>' +
      '<div class="dl-series-score"><span style="color:rgba(100,180,255,1);">' + score.B + '</span><span style="color:var(--grey-5);"> — </span><span style="color:rgba(255,110,110,1);">' + score.R + '</span></div>' +
      (DL_VIEW !== null ?
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span class="dl-review-tag">REVIEWING G' + (DL_VIEW + 1) + '</span>' +
          '<button class="tier-mode-btn" onclick="dlSetWinner(' + DL_VIEW + ',\'B\')">BLUE W</button>' +
          '<button class="tier-mode-btn" onclick="dlSetWinner(' + DL_VIEW + ',\'R\')">RED W</button>' +
          '<button class="tier-mode-btn active" onclick="dlViewGame(-1)">BACK TO LIVE</button>' +
        '</div>' : '') +
    '</div>';
}

function _dlTeamOptions(sel) {
  var teams = DL_AGG ? Object.keys(DL_AGG.teams).sort() : [];
  return '<option value="">— TEAM —</option>' + teams.map(function(t) {
    return '<option value="' + _dlEsc(t) + '"' + (t === sel ? ' selected' : '') + '>' + _dlEsc(t) + '</option>';
  }).join('');
}

// ── UI icons — clean inline SVGs to replace emoji glyphs on buttons ──
var _DL_ICON_SVG = {
  play:  '<path d="M8 5v14l11-7z"/>',
  next:  '<path d="M4 11h11.2l-4.6-4.6L12 5l7 7-7 7-1.4-1.4 4.6-4.6H4z"/>',
  undo:  '<path d="M10 9V5l-7 6 7 6v-4h4.5a3.5 3.5 0 0 1 0 7H9v2h5.5a5.5 5.5 0 0 0 0-11z"/>',
  skip:  '<path d="M5 5l8 7-8 7zM14 5l6 7-6 7z"/>',
  bolt:  '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  swap:  '<path d="M7 6h9l-2.6-2.6L14.8 2 20 7l-5.2 5-1.4-1.4L16 8H7zM17 18H8l2.6 2.6L9.2 22 4 17l5.2-5 1.4 1.4L8 16h9z"/>',
  timer: '<path d="M9.5 1h5v2h-5zM12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 9V7h-2v8h6v-2z"/>',
  book:  '<path d="M3.5 4.5h7.5v15H6.2a2.7 2.7 0 0 0-2.7 1.2zM13 4.5h7.5v16.2A2.7 2.7 0 0 0 17.8 19.5H13z"/>',
  save:  '<path d="M4 4h12l4 4v12H4zM8 4v5h7V4zM7 13h10v6H7z"/>'
};
function _dlIcon(name, size) {
  size = size || 13;
  var p = _DL_ICON_SVG[name];
  if (!p) return '';
  return '<svg class="dl-ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor">' + p + '</svg>';
}

// ── Team crest for a selected team (blank if no logo available) ──
function _dlTeamLogo(abbr, size) {
  size = size || 28;
  var url = (typeof DLC_TEAM_LOGOS !== 'undefined' && DLC_TEAM_LOGOS) ? DLC_TEAM_LOGOS[abbr] : null;
  if (!abbr || !url) return '';
  return '<span class="dl-team-logo" style="width:' + size + 'px;height:' + size + 'px;">' +
    '<img src="' + url + '" alt="' + _dlEsc(abbr) + '" onerror="this.parentNode.style.display=\'none\';"/></span>';
}

function _dlRenderBar() {
  var el = document.getElementById('dl-bar');
  if (!el) return;
  var st = dlCurStep();
  var live = DL_VIEW === null;
  var done = DL_STARTED && !st && live;
  var seriesOver = DL_SERIES.length >= DL_FORMAT;

  var actions = _dlViewActions();
  var seqHtml = _DL_SEQ.map(function(s, i) {
    var cls = 'dl-seq-dot' + (s.side === 'B' ? ' blue' : ' red') + (s.type === 'ban' ? ' ban' : '');
    if (i < actions.length) cls += ' done';
    if (live && i === DL_ACTIONS.length && DL_STARTED) cls += ' cur';
    return '<div class="' + cls + '" title="' + _dlStepLabel(_DL_SEQ[i]) + '"></div>';
  }).join('');

  var stepCls = !DL_STARTED || !live ? '' : st ? (st.side === 'B' ? ' dl-step-blue' : ' dl-step-red') : ' dl-step-done';
  var stepText = !live ? ('GAME ' + (DL_VIEW + 1) + ' REVIEW')
    : !DL_STARTED ? (seriesOver ? 'SERIES OVER' : 'PRESS NEW DRAFT')
    : st ? _dlStepLabel(st) : 'DRAFT COMPLETE';

  el.innerHTML =
    '<div class="dl-bar-row">' +
      '<div class="dl-team-box blue">' +
        _dlTeamLogo(DL_TEAM.B, 30) +
        '<select class="dl-team-sel" onchange="DL_TEAM.B=this.value;dlRender()">' + _dlTeamOptions(DL_TEAM.B) + '</select>' +
        (DL_US === 'B' ? '<span class="dl-us-badge">US</span>' : '<span class="dl-us-badge opp">OPP</span>') +
      '</div>' +
      '<button class="tier-mode-btn dl-icon-btn" onclick="dlSwapSides()" title="Swap sides">' + _dlIcon('swap', 14) + '</button>' +
      '<div class="dl-step-box' + stepCls + '">' +
        '<div class="dl-step-main">' + stepText + '</div>' +
        (live && DL_STARTED && st ? '<div id="dl-timer" class="dl-step-timer"' + (DL_TIMER_ON ? '' : ' style="display:none;"') + '>0:' + String(DL_TIMER_LEFT).padStart(2, '0') + '</div>' : '') +
      '</div>' +
      '<div class="dl-team-box red">' +
        (DL_US === 'R' ? '<span class="dl-us-badge">US</span>' : '<span class="dl-us-badge opp">OPP</span>') +
        '<select class="dl-team-sel" onchange="DL_TEAM.R=this.value;dlRender()">' + _dlTeamOptions(DL_TEAM.R) + '</select>' +
        _dlTeamLogo(DL_TEAM.R, 30) +
      '</div>' +
    '</div>' +
    '<div class="dl-seq-row">' + seqHtml + '</div>' +
    '<div class="dl-ctrl-row">' +
      '<button class="tier-mode-btn active" onclick="dlNewDraft()"' + (seriesOver && !DL_STARTED ? ' disabled' : '') + '>' + _dlIcon('play') + (DL_ACTIONS.length ? 'RESTART GAME' : 'NEW DRAFT') + '</button>' +
      (done ? '<button class="tier-mode-btn dl-next-btn" onclick="dlNextGame()">NEXT GAME' + _dlIcon('next') + '</button>' : '') +
      '<button class="tier-mode-btn" onclick="dlUndo()"' + (DL_ACTIONS.length && live ? '' : ' disabled') + '>' + _dlIcon('undo') + 'UNDO</button>' +
      '<button class="tier-mode-btn" onclick="dlSkipBan()"' + (st && st.type === 'ban' && live ? '' : ' disabled') + '>' + _dlIcon('skip') + 'SKIP BAN</button>' +
      '<button class="tier-mode-btn" onclick="dlAutoSwap(\'B\');dlAutoSwap(\'R\')" title="Best-fit positions from pro data">' + _dlIcon('bolt') + 'AUTO-SWAP</button>' +
      '<button class="tier-mode-btn" onclick="dlResetSeries()">RESET SERIES</button>' +
      '<span style="flex:1;"></span>' +
      '<button class="tier-mode-btn dl-icon-btn' + (DL_TIMER_ON ? ' active' : '') + '" onclick="dlToggleTimer()" title="60s pick / 40s ban">' + _dlIcon('timer', 15) + '</button>' +
      '<button class="tier-mode-btn dl-icon-btn" onclick="dlOpenScenarios()" title="Scenarios">' + _dlIcon('book', 15) + '</button>' +
      '<button class="tier-mode-btn" onclick="dlOpenSaveModal()"' + (DL_ACTIONS.length || DL_SERIES.length ? '' : ' disabled') + '>' + _dlIcon('save') + 'SAVE</button>' +
      (done ? '<span class="dl-done-hint">tap two role tags to swap positions, then NEXT GAME</span>' : '') +
    '</div>';
}

function _dlRenderIntel() {
  var el = document.getElementById('dl-intel');
  if (!el) return;
  if (!DL_STARTED || !DL_AGG || !DL_AGG.total || DL_VIEW !== null) { el.innerHTML = ''; return; }
  var st = dlCurStep();

  if (!st) {
    var sumHtml = ['B','R'].map(function(S) {
      var picks = dlPicksFor(S);
      var ws = picks.map(function(p) {
        var x = DL_AGG.heroes[p.hero];
        return x ? _dlShrunkWR(x.w, x.g) : 0.5;
      });
      // pair synergy bonus across the comp
      var liftSum = 0, liftN = 0;
      for (var i = 0; i < picks.length; i++) for (var j = i + 1; j < picks.length; j++) {
        var L = dlAllyLift(picks[i].hero, picks[j].hero);
        if (L) { liftSum += L.lift; liftN++; }
      }
      var avg = ws.length ? ws.reduce(function(a,b){ return a + b; }, 0) / ws.length : 0.5;
      var idx = Math.round(avg * 100 + (liftN ? (liftSum / liftN) * 50 : 0));
      return '<div class="dl-intel-chip" style="cursor:default;">' +
        '<div class="dl-intel-chip-body"><div class="dl-intel-chip-name" style="color:' + (S === 'B' ? 'rgba(100,180,255,1)' : 'rgba(255,110,110,1)') + ';">' + (DL_TEAM[S] || (S === 'B' ? 'BLUE' : 'RED')) + '</div>' +
        '<div class="dl-intel-chip-sub">comp index ' + idx + (liftN ? ' · synergy ' + (liftSum / liftN >= 0 ? '+' : '') + Math.round((liftSum / liftN) * 100) : '') + '</div></div></div>';
    }).join('');
    el.innerHTML = '<div class="dl-intel-inner"><div class="dl-intel-label">DRAFT SUMMARY <span style="color:var(--grey-5);">(pro-data index incl. synergy)</span></div><div class="dl-intel-chips">' + sumHtml + '</div></div>';
    return;
  }

  var sec = dlIntelSections();
  if (!sec) { el.innerHTML = ''; return; }
  var perSec = DL_INTEL_EXP ? 6 : 3;

  function rowHtml(it) {
    return '<div class="dl3-row' + (it.warn ? ' warn' : '') + '" data-dl-hero="' + _dlEsc(it.hero) + '" title="Click to apply">' +
      '<div class="dl3-row-img">' + _dlPortrait(it.hero, 34) + '</div>' +
      '<div class="dl3-row-body">' +
        '<div class="dl3-row-name">' + _dlEsc(it.hero) +
          (it.roles.length ? ' <span class="dl-role-mini">' + it.roles.join('/') + '</span>' : '') +
          (it.flex ? ' <span class="dl-flex-tag">FLEX</span>' : '') +
          (it.thin ? ' <span class="dl3-thin-tag" title="4–7 shared games — treat with care">THIN</span>' : '') +
        '</div>' +
        '<div class="dl3-row-sub">' + it.reason + '</div>' +
      '</div>' +
    '</div>';
  }

  var secHtml = sec.sections.map(function(s) {
    return '<div class="dl3-sec">' +
      '<div class="dl3-sec-head ' + s.cls + '"><span class="dl3-sec-dot"></span>' + _dlEsc(s.title) + '</div>' +
      '<div class="dl3-sec-body">' + s.items.slice(0, perSec).map(rowHtml).join('') + '</div>' +
    '</div>';
  }).join('') || '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding:10px;">No data-backed suggestions</div>';

  // key-player card during bans
  var kpHtml = sec.kp ?
    '<span class="dl3-kp" title="Most bannable: narrow signature pool × winrate × volume">' +
      'TARGET <b>' + _dlEsc(sec.kp.ign) + '</b> — ' + _dlPct(sec.kp.conc) + '% of games on 3 heroes · ' +
      _dlPct(sec.kp.wr) + '% WR (' + sec.kp.g + 'G)</span>' : '';

  // 'answer this' banner — flagged enemy picks + best available answers
  var threats = dlThreats();
  var st2 = dlCurStep();
  var canApply = st2 && st2.type === 'pick' && st2.side === DL_US;
  var threatHtml = threats.length ?
    '<div class="dl3-alert">' +
      '<span class="dl3-alert-tag">⚠ ANSWER THIS</span>' +
      threats.map(function(t) {
        return '<div class="dl3-alert-item">' +
          _dlPortrait(t.hero, 22) +
          '<span class="dl3-alert-name">' + _dlEsc(t.hero) + '</span>' +
          '<span class="dl3-alert-why">' + _dlEsc(t.why) + '</span>' +
          (t.answers.length ?
            '<span class="dl3-alert-ans">→ ' + t.answers.map(function(a) {
              return '<span class="dl3-ans-chip"' + (canApply ? ' data-dl-hero="' + _dlEsc(a.hero) + '" title="Click to pick"' : '') + '>' +
                _dlEsc(a.hero) + ' ' + _dlPct(a.C.wr) + '%' + (a.C.thin ? '*' : '') + '</span>';
            }).join(' ') + '</span>' : '<span class="dl3-alert-ans">no data-backed answer open</span>') +
        '</div>';
      }).join('') +
    '</div>' : '';

  // opponent comfort still open (compact strip)
  var open = dlOpenThreats(4);
  var openHtml = open.length ?
    '<div class="dl-threats">' +
      '<div class="dl-intel-label" style="color:var(--warn);">OPP COMFORT OPEN</div>' +
      open.map(function(t) {
        return '<div class="dl-threat-row">' + _dlPortrait(t.hero, 20) +
          '<span class="dl-threat-name">' + _dlEsc(t.hero) + '</span>' +
          '<span class="dl-threat-meta">' + _dlEsc(t.ign) + ' ' + t.g + 'G ' + Math.round(t.wr * 100) + '%</span></div>';
      }).join('') +
    '</div>' : '';

  el.innerHTML =
    '<div class="dl-intel-inner">' +
      '<div class="dl-intel-head">' +
        '<div class="dl-intel-label">' + sec.label + '</div>' +
        kpHtml +
        '<button class="tier-mode-btn" style="font-size:7px;padding:2px 8px;" onclick="DL_INTEL_EXP=!DL_INTEL_EXP;dlRender()">' + (DL_INTEL_EXP ? 'LESS' : 'MORE') + '</button>' +
      '</div>' +
      '<div class="dl3-secs">' + secHtml + '</div>' +
    '</div>' + threatHtml + openHtml;
}

function _dlRenderSide(S) {
  var el = document.getElementById('dl-side-' + S);
  if (!el) return;
  var live = DL_VIEW === null;
  var actions = _dlViewActions();
  var st = live ? dlCurStep() : null;
  var bans = dlBansFor(S, actions);
  var picks = dlPicksFor(S, actions);
  var roles = live ? dlComputedRoles(S) : (S === 'B' ? DL_SERIES[DL_VIEW].rolesB : DL_SERIES[DL_VIEW].rolesR);

  var bansHtml = [1,2,3,4].map(function(n) {
    var a = bans.find(function(x){ return x.n === n; });
    var isCur = st && st.type === 'ban' && st.side === S && st.n === n && DL_STARTED;
    if (a && a.hero) {
      return '<div class="dl-ban-slot filled" title="' + _dlEsc(a.hero) + '">' + _dlPortrait(a.hero, 36) + '<div class="dl-ban-x">✕</div></div>';
    }
    if (a) return '<div class="dl-ban-slot skipped">SKIP</div>';
    return '<div class="dl-ban-slot' + (isCur ? ' cur' : '') + '">B' + n + '</div>';
  }).join('');

  // threat flags only decorate the OPPONENT side (from US perspective)
  var threatMap = {};
  if (live && S !== DL_US) {
    dlThreats().forEach(function(t){ threatMap[t.hero] = t.why; });
  }

  var picksHtml = [1,2,3,4,5].map(function(n) {
    var a = picks.find(function(x){ return x.n === n; });
    var isCur = st && st.type === 'pick' && st.side === S && st.n === n && DL_STARTED;
    var selSwap = DL_SWAP_SEL && DL_SWAP_SEL.side === S && DL_SWAP_SEL.n === n;
    if (a) {
      var role = (roles && roles[n]) || '—';
      var flex = dlIsFlex(a.hero);
      var threat = threatMap[a.hero];
      return '<div class="dl-pick-slot filled side-' + S + (threat ? ' threat' : '') + '">' +
        _dlPortrait(a.hero, 46) +
        '<div class="dl-pick-body">' +
          '<div class="dl-pick-name">' + _dlEsc(a.hero) + (flex ? ' <span class="dl-flex-tag">FLEX</span>' : '') + '</div>' +
          '<button class="dl-role-badge' + (selSwap ? ' sel' : '') + '" data-dl-role="' + S + ':' + n + '" title="Tap two role tags to swap">' + role + '</button>' +
        '</div>' +
        '<span class="dl-pick-order">P' + n + '</span>' +
        (threat ? '<span class="dl3-threat-tag" title="' + _dlEsc(threat) + '">⚠ ANSWER</span>' : '') +
      '</div>';
    }
    return '<div class="dl-pick-slot' + (isCur ? ' cur' : '') + '"><div class="dl-pick-ph">P' + n + '</div></div>';
  }).join('');

  // series-dead heroes (global BP)
  var dead = Object.keys(dlSeriesDead(S));
  var deadHtml = dead.length && live ?
    '<div class="dl-side-sec">USED THIS SERIES</div>' +
    '<div class="dl-dead-row">' + dead.map(function(h) {
      return '<div class="dl-dead-chip" title="' + _dlEsc(h) + ' — dead for ' + (S === 'B' ? 'Blue' : 'Red') + '">' + _dlPortrait(h, 24) + '</div>';
    }).join('') + '</div>' : '';

  el.innerHTML =
    '<div class="dl-side-title">' + (S === 'B' ? 'BLUE SIDE' : 'RED SIDE') + (DL_TEAM[S] ? ' · ' + _dlEsc(DL_TEAM[S]) : '') + '</div>' +
    '<div class="dl-side-sec">BANS</div>' +
    '<div class="dl-bans">' + bansHtml + '</div>' +
    '<div class="dl-side-sec">PICKS</div>' +
    '<div class="dl-picks">' + picksHtml + '</div>' +
    deadHtml;
}

// canonical, deduped hero list for the grid
function _dlAllGridHeroes() {
  var set = {};
  if (DL_AGG) Object.keys(DL_AGG.heroes).forEach(function(h) {
    var k = _dlNormKey(h);
    if (_DL_HIDDEN[k]) return;
    set[k] = set[k] || h;
  });
  if (typeof getHeroList === 'function') (getHeroList() || []).forEach(function(n) {
    var c = dlCanon(n);
    var k = _dlNormKey(c);
    if (_DL_HIDDEN[k]) return;
    if (!set[k]) set[k] = c;
  });
  return Object.keys(set).map(function(k){ return set[k]; }).sort();
}

function _dlRenderCenter() {
  var el = document.getElementById('dl-center');
  if (!el) return;
  var live = DL_VIEW === null;
  var st = live ? dlCurStep() : null;
  var heroes = _dlAllGridHeroes();
  var sq = DL_SEARCH.trim().toLowerCase();
  if (sq) heroes = heroes.filter(function(h){ return h.toLowerCase().indexOf(sq) >= 0; });
  if (DL_GRID_ROLE !== 'All') {
    heroes = heroes.filter(function(h){ return dlFlexRoles(h).indexOf(DL_GRID_ROLE) >= 0; });
  }

  var sugSet = {};
  if (st && DL_AGG) dlSuggestions(6).items.forEach(function(it){ sugSet[it.hero] = 1; });
  var myDead = st ? dlSeriesDead(st.side) : {};
  var oppDead = st ? dlSeriesDead(st.side === 'B' ? 'R' : 'B') : {};

  var cards = heroes.map(function(h) {
    var avail = live && dlAvailable(h);
    var pres = _dlPresence(h);
    var flex = dlFlexRoles(h);
    var cls = 'dl-card' + (avail ? '' : ' dim') + (sugSet[h] ? ' sug' : '');
    var deadTag = '';
    if (live && st && st.type === 'pick' && myDead[h]) deadTag = '<span class="dl-dead-tag">USED</span>';
    else if (live && oppDead[h]) deadTag = '<span class="dl-dead-tag opp">OPP USED</span>';
    return '<div class="' + cls + '"' + (avail ? ' data-dl-hero="' + _dlEsc(h) + '"' : '') + ' title="' + _dlEsc(h) + (pres ? ' · ' + Math.round(pres * 100) + '% presence' : '') + '">' +
      _dlPortrait(h, 58) + deadTag +
      '<div class="dl-card-name">' + _dlEsc(h) + '</div>' +
      '<div class="dl-card-sub">' + (flex.length ? flex.join('/') : '&nbsp;') + (pres >= 0.005 ? ' · ' + Math.round(pres * 100) + '%' : '') + '</div>' +
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

// ── CSS ──────────────────────────────────────────────────────

function _dlInjectCss() {
  if (_DL_CSS_DONE) return;
  _DL_CSS_DONE = true;
  var css =
  '#dl-root{display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;}' +
  /* series bar */
  '.dl-series-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:var(--border);flex-wrap:wrap;background:linear-gradient(180deg,rgba(255,255,255,0.025),transparent);}' +
  '.dl-mode-tgl{display:flex;gap:2px;}' +
  '.dl-game-tabs{display:flex;gap:3px;}' +
  '.dl-game-tab{font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;padding:4px 9px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:var(--grey-5);cursor:pointer;display:flex;align-items:center;gap:4px;}' +
  '.dl-game-tab.done{color:var(--white);}' +
  '.dl-game-tab.live{border-style:dashed;}' +
  '.dl-game-tab.active{border-color:var(--white);color:var(--white);background:rgba(255,255,255,0.06);}' +
  '.dl-game-tab:disabled{opacity:0.3;cursor:default;}' +
  '.dl-w-dot{width:6px;height:6px;border-radius:50%;}' +
  '.dl-w-dot.blue{background:rgba(100,180,255,1);}' +
  '.dl-w-dot.red{background:rgba(255,110,110,1);}' +
  '.dl-series-score{font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;}' +
  '.dl-review-tag{font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--warn);border:1px solid rgba(255,204,68,0.4);padding:3px 8px;}' +
  /* main bar */
  '.dl-bar-row{display:flex;align-items:center;gap:8px;padding:10px 12px 4px;}' +
  '.dl-team-box{display:flex;align-items:center;gap:6px;padding:4px 8px;border:var(--border);}' +
  '.dl-team-box.blue{border-left:3px solid rgba(100,180,255,0.8);box-shadow:inset 8px 0 18px -12px rgba(100,180,255,0.5);}' +
  '.dl-team-box.red{border-right:3px solid rgba(255,110,110,0.8);box-shadow:inset -8px 0 18px -12px rgba(255,110,110,0.5);}' +
  '.dl-team-sel{background:transparent;color:var(--white);border:none;font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;outline:none;cursor:pointer;}' +
  '.dl-team-sel option{background:#111;}' +
  '.dl-us-badge{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1px;padding:2px 6px;background:rgba(80,220,140,0.15);color:var(--success);border:1px solid rgba(80,220,140,0.4);}' +
  '.dl-us-badge.opp{background:rgba(255,255,255,0.05);color:var(--grey-5);border-color:rgba(255,255,255,0.15);}' +
  '.dl-step-box{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:6px;border:var(--border);min-height:42px;position:relative;overflow:hidden;}' +
  '.dl-step-box::before{content:"";position:absolute;inset:0;opacity:0;transition:opacity .3s;}' +
  '.dl-step-blue::before{opacity:1;background:linear-gradient(90deg,rgba(100,180,255,0.16),transparent 55%);}' +
  '.dl-step-red::before{opacity:1;background:linear-gradient(270deg,rgba(255,110,110,0.16),transparent 55%);}' +
  '.dl-step-main{font-family:\'Bebas Neue\',sans-serif;font-size:25px;letter-spacing:3px;color:var(--grey-5);position:relative;animation:dlStepIn .25s ease;}' +
  '.dl-step-blue .dl-step-main{color:rgba(100,180,255,1);text-shadow:0 0 18px rgba(100,180,255,0.45);}' +
  '.dl-step-red .dl-step-main{color:rgba(255,110,110,1);text-shadow:0 0 18px rgba(255,110,110,0.45);}' +
  '.dl-step-done .dl-step-main{color:var(--success);text-shadow:0 0 18px rgba(80,220,140,0.4);}' +
  '.dl-step-timer{font-family:\'DM Mono\',monospace;font-size:14px;color:var(--white);position:relative;}' +
  '.dl-step-timer.low{color:var(--danger);animation:dlBlink 1s infinite;}' +
  '.dl-seq-row{display:flex;gap:3px;padding:4px 12px;align-items:center;}' +
  '.dl-seq-dot{width:14px;height:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);flex-shrink:0;transition:all .2s;}' +
  '.dl-seq-dot.ban{height:5px;}' +
  '.dl-seq-dot.blue.done{background:rgba(100,180,255,0.75);border-color:rgba(100,180,255,0.9);}' +
  '.dl-seq-dot.red.done{background:rgba(255,110,110,0.75);border-color:rgba(255,110,110,0.9);}' +
  '.dl-seq-dot.cur{outline:1px solid var(--white);outline-offset:1px;animation:dlPulse 1.2s infinite;}' +
  '.dl-ctrl-row{display:flex;align-items:center;gap:6px;padding:4px 12px 8px;border-bottom:var(--border);flex-wrap:wrap;}' +
  '.dl-next-btn{border-color:rgba(80,220,140,0.6)!important;color:var(--success)!important;animation:dlGlow 1.6s infinite;}' +
  '.dl-done-hint{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--success);letter-spacing:1px;}' +
  /* intel */
  '#dl-intel{flex-shrink:0;}' +
  '.dl-intel-inner{padding:6px 12px;border-bottom:var(--border);}' +
  '.dl-intel-head{display:flex;align-items:center;justify-content:space-between;}' +
  '.dl-intel-label{font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-6);padding:2px 0;}' +
  '.dl-intel-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;}' +
  '.dl-intel-chip{display:flex;align-items:center;gap:6px;padding:4px 8px 4px 4px;border:1px solid rgba(255,255,255,0.12);cursor:pointer;background:rgba(255,255,255,0.02);transition:all .15s;}' +
  '.dl-intel-chip:hover{border-color:rgba(100,180,255,0.6);background:rgba(100,180,255,0.07);transform:translateY(-1px);}' +
  '.dl-intel-chip.warn{border-color:rgba(255,204,68,0.45);}' +
  '.dl-intel-chip-name{font-family:\'Bebas Neue\',sans-serif;font-size:13px;color:var(--white);white-space:nowrap;}' +
  '.dl-intel-chip-sub{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-6);white-space:nowrap;}' +
  '.dl-role-mini{font-family:\'DM Mono\',monospace;font-size:7px;color:rgba(100,180,255,0.9);letter-spacing:0;}' +
  '.dl-flex-tag{font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;padding:1px 4px;background:rgba(188,140,255,0.15);color:rgba(188,140,255,0.95);border:1px solid rgba(188,140,255,0.4);vertical-align:middle;}' +
  /* v3 categorized intel — Roster-style section cards */
  '.dl3-secs{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:flex-start;}' +
  '.dl3-sec{flex:1 1 230px;min-width:215px;background:var(--grey-1);border:1px solid var(--grey-3);border-radius:3px;overflow:hidden;}' +
  '.dl3-sec-head{display:flex;align-items:center;gap:6px;padding:5px 9px;background:var(--black);border-bottom:1px solid var(--grey-3);font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-6);}' +
  '.dl3-sec-dot{width:6px;height:6px;border-radius:50%;background:var(--grey-5);flex-shrink:0;}' +
  '.dl3-sec-head.ctr{color:var(--warn);} .dl3-sec-head.ctr .dl3-sec-dot{background:var(--warn);}' +
  '.dl3-sec-head.cmb{color:var(--success);} .dl3-sec-head.cmb .dl3-sec-dot{background:var(--success);}' +
  '.dl3-sec-head.stl{color:rgba(188,140,255,0.95);} .dl3-sec-head.stl .dl3-sec-dot{background:rgba(188,140,255,0.95);}' +
  '.dl3-sec-head.flx{color:rgba(255,150,80,0.95);} .dl3-sec-head.flx .dl3-sec-dot{background:rgba(255,150,80,0.95);}' +
  '.dl3-sec-head.mta{color:rgba(100,180,255,0.95);} .dl3-sec-head.mta .dl3-sec-dot{background:rgba(100,180,255,0.95);}' +
  '.dl3-row{display:flex;align-items:center;gap:8px;padding:6px 9px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;border-left:2px solid transparent;transition:background .12s,border-left-color .12s;}' +
  '.dl3-row:last-child{border-bottom:none;}' +
  '.dl3-row:hover{background:rgba(100,180,255,0.07);border-left-color:rgba(100,180,255,0.8);}' +
  '.dl3-row.warn{border-left-color:rgba(255,204,68,0.6);}' +
  '.dl3-row-img{flex-shrink:0;line-height:0;}' +
  '.dl3-row-body{flex:1;min-width:0;}' +
  '.dl3-row-name{font-family:\'Bebas Neue\',sans-serif;font-size:14px;letter-spacing:0.5px;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
  '.dl3-row-sub{font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-6);margin-top:2px;line-height:1.35;}' +
  '.dl3-thin-tag{font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;padding:1px 4px;background:rgba(255,204,68,0.12);color:var(--warn);border:1px solid rgba(255,204,68,0.4);vertical-align:middle;}' +
  '.dl3-kp{font-family:\'DM Mono\',monospace;font-size:9px;color:rgba(188,140,255,0.95);border:1px solid rgba(188,140,255,0.4);background:rgba(188,140,255,0.08);padding:3px 9px;margin:0 8px;white-space:nowrap;}' +
  '.dl3-kp b{color:var(--white);font-weight:600;}' +
  '.dl3-alert{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 12px;border-bottom:var(--border);background:rgba(255,90,90,0.05);}' +
  '.dl3-alert-tag{font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--danger);border:1px solid rgba(255,90,90,0.5);padding:3px 8px;background:rgba(255,90,90,0.1);}' +
  '.dl3-alert-item{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
  '.dl3-alert-name{font-family:\'Bebas Neue\',sans-serif;font-size:13px;}' +
  '.dl3-alert-why{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--danger);}' +
  '.dl3-alert-ans{font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-6);display:flex;gap:4px;align-items:center;flex-wrap:wrap;}' +
  '.dl3-ans-chip{border:1px solid rgba(80,220,140,0.4);color:var(--success);padding:1px 6px;background:rgba(80,220,140,0.07);}' +
  '.dl3-ans-chip[data-dl-hero]{cursor:pointer;}' +
  '.dl3-ans-chip[data-dl-hero]:hover{background:rgba(80,220,140,0.18);}' +
  '.dl3-threat-tag{position:absolute;bottom:2px;right:4px;font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;padding:1px 4px;background:rgba(255,90,90,0.15);color:var(--danger);border:1px solid rgba(255,90,90,0.5);}' +
  '.dl-pick-slot.threat{border-color:rgba(255,90,90,0.55)!important;}' +
  '.dl-threats{padding:4px 12px 6px;border-bottom:var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
  '.dl-threat-row{display:flex;align-items:center;gap:5px;}' +
  '.dl-threat-name{font-family:\'Bebas Neue\',sans-serif;font-size:11px;}' +
  '.dl-threat-meta{font-family:\'DM Mono\',monospace;font-size:7px;color:var(--warn);}' +
  /* columns */
  '.dl-cols{display:flex;flex:1;overflow:hidden;min-height:0;}' +
  '.dl-side{width:200px;flex-shrink:0;overflow-y:auto;padding:8px;}' +
  '.dl-side-blue{border-right:var(--border);background:linear-gradient(90deg,rgba(100,180,255,0.04),transparent 70%);}' +
  '.dl-side-red{border-left:var(--border);background:linear-gradient(270deg,rgba(255,110,110,0.04),transparent 70%);}' +
  '.dl-side-title{font-family:\'Bebas Neue\',sans-serif;font-size:17px;letter-spacing:1px;margin-bottom:6px;}' +
  '.dl-side-blue .dl-side-title{color:rgba(100,180,255,1);}' +
  '.dl-side-red .dl-side-title{color:rgba(255,110,110,1);}' +
  '.dl-side-sec{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:2px;color:var(--grey-5);margin:8px 0 4px;}' +
  '.dl-bans{display:flex;gap:4px;flex-wrap:wrap;}' +
  '.dl-ban-slot{width:40px;height:40px;border:1px dashed rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);position:relative;transition:all .2s;}' +
  '.dl-ban-slot.filled{border-style:solid;animation:dlPop .25s ease;}' +
  '.dl-ban-slot.filled img,.dl-ban-slot.filled>div:first-child img{filter:grayscale(1) brightness(0.55);}' +
  '.dl-ban-x{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--danger);font-size:15px;font-weight:bold;text-shadow:0 0 4px #000;}' +
  '.dl-ban-slot.skipped{color:var(--grey-5);font-size:6px;letter-spacing:1px;}' +
  '.dl-ban-slot.cur{border-color:var(--white);animation:dlPulse 1.2s infinite;}' +
  '.dl-picks{display:flex;flex-direction:column;gap:5px;}' +
  '.dl-pick-slot{display:flex;align-items:center;gap:8px;border:1px dashed rgba(255,255,255,0.18);min-height:56px;padding:4px;position:relative;transition:all .2s;}' +
  '.dl-pick-slot.filled{border-style:solid;animation:dlPop .25s ease;}' +
  '.dl-pick-slot.filled.side-B{background:linear-gradient(90deg,rgba(100,180,255,0.08),rgba(255,255,255,0.02));border-color:rgba(100,180,255,0.35);}' +
  '.dl-pick-slot.filled.side-R{background:linear-gradient(270deg,rgba(255,110,110,0.08),rgba(255,255,255,0.02));border-color:rgba(255,110,110,0.35);}' +
  '.dl-pick-slot.cur{border-color:var(--white);animation:dlPulse 1.2s infinite;}' +
  '.dl-pick-ph{font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding-left:6px;}' +
  '.dl-pick-body{flex:1;min-width:0;}' +
  '.dl-pick-name{font-family:\'Bebas Neue\',sans-serif;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
  '.dl-pick-order{position:absolute;top:2px;right:4px;font-family:\'DM Mono\',monospace;font-size:6px;color:var(--grey-5);letter-spacing:1px;}' +
  '.dl-role-badge{font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1px;padding:2px 7px;margin-top:2px;background:rgba(255,255,255,0.05);color:var(--grey-4);border:1px solid rgba(255,255,255,0.15);cursor:pointer;transition:all .15s;}' +
  '.dl-role-badge:hover{border-color:var(--white);color:var(--white);}' +
  '.dl-role-badge.sel{border-color:var(--warn);color:var(--warn);background:rgba(255,204,68,0.1);box-shadow:0 0 8px rgba(255,204,68,0.3);}' +
  '.dl-dead-row{display:flex;gap:3px;flex-wrap:wrap;}' +
  '.dl-dead-chip{position:relative;opacity:0.55;}' +
  '.dl-dead-chip img{filter:grayscale(1);}' +
  /* center grid */
  '#dl-center{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;}' +
  '.dl-grid-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:var(--border);flex-wrap:wrap;flex-shrink:0;}' +
  '.dl-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;padding:10px;align-content:start;}' +
  '.dl-card{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 3px 6px;border:1px solid rgba(255,255,255,0.08);cursor:pointer;text-align:center;position:relative;transition:all .15s;background:linear-gradient(180deg,rgba(255,255,255,0.025),transparent);}' +
  '.dl-card:hover{border-color:rgba(100,180,255,0.7);background:rgba(100,180,255,0.07);transform:translateY(-2px);box-shadow:0 4px 14px rgba(0,0,0,0.5);}' +
  '.dl-card.dim{opacity:0.22;cursor:default;pointer-events:none;}' +
  '.dl-card.sug{border-color:rgba(80,220,140,0.55);box-shadow:inset 0 0 14px rgba(80,220,140,0.08);}' +
  '.dl-card-name{font-family:\'Bebas Neue\',sans-serif;font-size:11px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
  '.dl-card-sub{font-family:\'DM Mono\',monospace;font-size:6.5px;color:var(--grey-5);letter-spacing:0;}' +
  '.dl-dead-tag{position:absolute;top:4px;left:4px;font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;padding:1px 4px;background:rgba(255,90,90,0.2);color:var(--danger);border:1px solid rgba(255,90,90,0.5);}' +
  '.dl-dead-tag.opp{background:rgba(100,180,255,0.15);color:rgba(100,180,255,1);border-color:rgba(100,180,255,0.5);}' +
  '.dl-portrait-tag{position:absolute;bottom:0;right:0;font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:0.5px;padding:1px 3px;background:rgba(0,0,0,0.85);color:var(--warn);border:1px solid rgba(255,204,68,0.5);line-height:1.4;}' +
  /* inputs / modal */
  '.dl-inp{background:rgba(255,255,255,0.04);border:var(--border);color:var(--white);font-family:\'DM Mono\',monospace;font-size:10px;padding:6px 10px;width:100%;outline:none;box-sizing:border-box;}' +
  '.dl-inp:focus{border-color:rgba(100,180,255,0.6);}' +
  '.dl-modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:300;align-items:center;justify-content:center;}' +
  '.dl-modal-box{background:#101010;border:var(--border);padding:18px;max-width:380px;width:90%;animation:dlStepIn .2s ease;}' +
  '.dl-modal-title{font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:1px;margin-bottom:12px;}' +
  '.dl-scn-row{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:var(--border);}' +
  /* === redesign: larger controls, ui button icons, team logos, pinned draft === */
  '#dl-root .tier-mode-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:10.5px;padding:8px 13px;border-radius:3px;line-height:1;}' +
  '#dl-root .dl-game-tab{font-size:10.5px;padding:7px 12px;gap:5px;}' +
  '#dl-root .dl-team-sel{font-size:11.5px;}' +
  '.dl-series-row{padding:9px 12px;gap:11px;}' +
  '.dl-ctrl-row{gap:7px;padding:6px 12px 10px;}' +
  '.dl-ic{display:inline-block;vertical-align:middle;flex-shrink:0;}' +
  '.dl-icon-btn{min-width:38px;min-height:34px;padding:7px 10px!important;}' +
  '.dl-team-logo{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}' +
  '.dl-team-logo img{width:100%;height:100%;object-fit:contain;display:block;}' +
  /* pinned draft — capped, internally-scrolling intel never shrinks the picks/bans */
  '#dl-intel{flex-shrink:0;max-height:30vh;overflow-y:auto;overflow-x:hidden;}' +
  '.dl-cols{min-height:0;}' +
  '.dl-side{padding:6px 8px;}' +
  '.dl-side-sec{margin:6px 0 4px;}' +
  '.dl-picks{gap:4px;}' +
  '.dl-pick-slot{min-height:50px;}' +
  /* anims */
  '@keyframes dlPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0.25);}50%{box-shadow:0 0 0 3px rgba(255,255,255,0.08);}}' +
  '@keyframes dlPop{0%{transform:scale(0.92);opacity:0.4;}100%{transform:scale(1);opacity:1;}}' +
  '@keyframes dlStepIn{0%{transform:translateY(4px);opacity:0;}100%{transform:translateY(0);opacity:1;}}' +
  '@keyframes dlBlink{0%,100%{opacity:1;}50%{opacity:0.35;}}' +
  '@keyframes dlGlow{0%,100%{box-shadow:0 0 4px rgba(80,220,140,0.25);}50%{box-shadow:0 0 12px rgba(80,220,140,0.5);}}' +
  /* mobile */
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

// ── Nav integration ──────────────────────────────────────────

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
