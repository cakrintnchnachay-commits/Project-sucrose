// ═══════════════════════════════════════════════════════════
// META LAB ENGINE (pro hero hub, reads data_2.csv)
// ═══════════════════════════════════════════════════════════

var ML_GAMES    = null;        // parsed games array (cached after first load)
var ML_TOUR     = 'All';       // active tournament filter
var ML_SORT     = 'presence';  // 'presence' | 'winrate' | 'games'
var ML_ROLE     = 'All';       // role filter
var ML_SELECTED = null;        // selected hero name
var ML_DETAIL_TAB    = 'overview';
var ML_MATCHUP_MODE  = 'allies';
var ML_MATCHUP_EXP   = false;
var ML_PLAYERS_EXP   = {};     // playerName → boolean (expanded)

var _ML_TOURS = ['All', 'RPL Summer', 'GCS Spring', 'AOG Spring', 'APL'];
var _ML_ROLES = ['All', 'DSL', 'JUG', 'MID', 'ADL', 'SUP'];
var _ML_PICK_ROLES = ['DSL', 'JUG', 'MID', 'ADL', 'SUP'];

// ── Init (fetch + cache) ────────────────────────────────────

function mlInit() {
  if (ML_GAMES !== null) { mlRenderBars(); mlRenderList(); return; }
  var listEl = document.getElementById('ml-hero-list');
  var detEl  = document.getElementById('ml-detail');
  if (listEl) listEl.innerHTML = '<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;">Loading pro data…</div>';
  if (detEl)  detEl.innerHTML  = '';
  fetch('data/game_results_detailed.csv', {cache: 'no-store'})
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(txt) {
      ML_GAMES = mlBuildGames(txt);
      mlRenderBars();
      mlRenderList();
    })
    .catch(function(err) {
      if (listEl) listEl.innerHTML = '<div style="padding:20px;color:var(--danger);font-family:\'DM Mono\',monospace;font-size:10px;">Failed to load data.<br>' + err.message + '</div>';
      if (detEl)  detEl.innerHTML  = '<div style="padding:20px;"><div style="color:var(--danger);margin-bottom:12px;">' + err.message + '</div><button class="btn btn-sm" onclick="ML_GAMES=null;mlInit()">Retry</button></div>';
    });
}

// ── CSV parsing ─────────────────────────────────────────────

function _mlSplitCSV(line) {
  var fields = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else { cur += c; }
  }
  fields.push(cur);
  return fields;
}

function _mlStr(row, idx) {
  return idx >= 0 && idx < row.length ? row[idx].trim().replace(/^"|"$/g, '') : '';
}

function _mlNum(s) {
  if (s == null) return NaN;
  return parseFloat(String(s).replace(/,/g, '').trim());
}

function mlBuildGames(csvText) {
  var lines = csvText.split(/\r?\n/);
  if (!lines.length) return [];
  var headers = _mlSplitCSV(lines[0]).map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
  function ci(name) { return headers.indexOf(name); }
  function get(row, name) { return _mlStr(row, ci(name)); }
  function getNum(row, name) { return _mlNum(get(row, name)); }

  var games = [];
  for (var li = 1; li < lines.length; li++) {
    var line = lines[li].trim();
    if (!line) continue;
    var row = _mlSplitCSV(line);

    // Drop incomplete rows
    if (isNaN(_mlNum(get(row, 'A DSL KILL')))) continue;

    var dur = getNum(row, 'END TIME');
    if (isNaN(dur) || dur <= 0) continue;

    var teamA   = get(row, 'Team A');
    var teamB   = get(row, 'Team B');
    var matchWin = get(row, 'MATCH WIN');
    var winSide  = (matchWin === teamA) ? 'A' : 'B';
    var tour     = get(row, 'TYPE');

    var bansA = [], bansB = [];
    for (var b = 1; b <= 4; b++) { var bn = get(row, 'A BAN ' + b); if (bn) bansA.push(bn); }
    for (var b = 1; b <= 4; b++) { var bn = get(row, 'B BAN ' + b); if (bn) bansB.push(bn); }

    var goldA = _mlNum(get(row, 'A Gold'));
    var goldB = _mlNum(get(row, 'B Gold'));
    if (isNaN(goldA)) goldA = 0;
    if (isNaN(goldB)) goldB = 0;

    var picks = [];
    var teamKills = {A: 0, B: 0};

    ['A', 'B'].forEach(function(S) {
      _ML_PICK_ROLES.forEach(function(R) {
        var hero   = get(row, S + ' ' + R);
        var player = get(row, S + ' P ' + R);
        var k  = _mlNum(get(row, S + ' ' + R + ' KILL'));
        var d  = _mlNum(get(row, S + ' ' + R + ' DEATH'));
        var a  = _mlNum(get(row, S + ' ' + R + ' ASSIST'));
        var dm = _mlNum(get(row, S + ' ' + R + ' DMG'));
        var dt = _mlNum(get(row, S + ' ' + R + ' DTK'));
        if (isNaN(k)) k = 0;
        if (isNaN(d)) d = 0;
        if (isNaN(a)) a = 0;
        if (isNaN(dm)) dm = 0;
        if (isNaN(dt)) dt = 0;
        teamKills[S] += k;
        picks.push({side: S, role: R, hero: hero, player: player,
          k: k, d: d, a: a, dmg: dm, dtk: dt});
      });
    });

    games.push({
      tour: tour, dur: dur, winSide: winSide,
      teams: {A: teamA, B: teamB},
      bans:  {A: bansA, B: bansB},
      picks: picks, teamKills: teamKills,
      goldA: goldA, goldB: goldB,
      mvpHero:   get(row, 'MVP Hero'),
      mvpPlayer: get(row, 'MVP')
    });
  }
  return games;
}

// ── Filtered set ────────────────────────────────────────────

function mlFilteredGames() {
  if (!ML_GAMES) return [];
  return ML_GAMES.filter(function(g) { return ML_TOUR === 'All' || g.tour === ML_TOUR; });
}

function _mlAllHeroes(games) {
  var set = {};
  games.forEach(function(g) {
    g.picks.forEach(function(pk) { if (pk.hero) set[pk.hero] = 1; });
    g.bans.A.forEach(function(h) { if (h) set[h] = 1; });
    g.bans.B.forEach(function(h) { if (h) set[h] = 1; });
  });
  return Object.keys(set).sort();
}

// ── Stats computation ────────────────────────────────────────

function _mlStatsFromPicks(picks, games, totalGames, bans) {
  // picks = pre-filtered array of {pick, game} pairs
  var n = picks.length;
  var wins = 0;
  var sumK=0,sumD=0,sumA=0,sumDmg=0,sumDtk=0,sumDur=0;
  var kpSum=0,kpCount=0,mvpCount=0;
  var picksA=0,winsA=0,picksB=0,winsB=0;
  var winGoldDiffs=[];

  picks.forEach(function(entry) {
    var pk = entry.pk, g = entry.g;
    var won = (g.winSide === pk.side);
    if (won) wins++;
    sumK+=pk.k; sumD+=pk.d; sumA+=pk.a; sumDmg+=pk.dmg; sumDtk+=pk.dtk; sumDur+=g.dur;
    var tk = g.teamKills[pk.side];
    if (tk > 0) { kpSum += Math.min((pk.k + pk.a) / tk, 1.0); kpCount++; }
    if (g.mvpHero === pk.hero) mvpCount++;
    if (pk.side === 'A') { picksA++; if (won) winsA++; }
    else                 { picksB++; if (won) winsB++; }
    if (won) {
      var og = pk.side==='A' ? g.goldA : g.goldB;
      var op = pk.side==='A' ? g.goldB : g.goldA;
      if (og > 0 || op > 0) winGoldDiffs.push((og - op) / (5 * g.dur));
    }
  });

  var kda = (sumK + sumA) / Math.max(sumD, 1);
  return {
    games:     n,
    wins:      wins,
    bans:      bans,
    totalGames: totalGames,
    wr:        n > 0 ? wins / n : 0,
    pickRate:  totalGames > 0 ? n / totalGames : 0,
    banRate:   totalGames > 0 ? bans / totalGames : 0,
    presence:  totalGames > 0 ? (n + bans) / totalGames : 0,
    kda:       kda,
    killsPerMin:  sumDur > 0 ? sumK  / sumDur : 0,
    deathsPerMin: sumDur > 0 ? sumD  / sumDur : 0,
    minPerDeath:  sumD > 0   ? sumDur / sumD  : (sumDur > 0 ? sumDur : 0),
    dmgPerMin:    sumDur > 0 ? sumDmg / sumDur : 0,
    dtkPerMin:    sumDur > 0 ? sumDtk / sumDur : 0,
    kp:        kpCount > 0 ? (kpSum / kpCount) * 100 : 0,
    mvpRate:   n > 0 ? mvpCount / n : 0,
    avgDur:    n > 0 ? sumDur / n : 0,
    wgdpm:     winGoldDiffs.length > 0 ? winGoldDiffs.reduce(function(a,b){return a+b;},0)/winGoldDiffs.length : null,
    wrBlue:    picksA > 0 ? winsA / picksA : null,
    wrRed:     picksB > 0 ? winsB / picksB : null
  };
}

function mlHeroStats(hero, games) {
  var totalGames = games.length;
  var bans = 0;
  games.forEach(function(g) {
    if (g.bans.A.indexOf(hero) >= 0 || g.bans.B.indexOf(hero) >= 0) bans++;
  });
  var pairs = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero === hero && g.dur > 0) pairs.push({pk: pk, g: g});
    });
  });
  return _mlStatsFromPicks(pairs, games, totalGames, bans);
}

function mlHeroStatsForRole(hero, games, role) {
  var totalGames = games.length;
  var bans = 0;
  games.forEach(function(g) {
    if (g.bans.A.indexOf(hero) >= 0 || g.bans.B.indexOf(hero) >= 0) bans++;
  });
  var pairs = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero === hero && pk.role === role && g.dur > 0) pairs.push({pk: pk, g: g});
    });
  });
  return _mlStatsFromPicks(pairs, games, totalGames, bans);
}

function _mlGetStats(hero, games) {
  return ML_ROLE !== 'All' ? mlHeroStatsForRole(hero, games, ML_ROLE) : mlHeroStats(hero, games);
}

function mlPlayerHeroStats(playerName, hero, games) {
  var pairs = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero === hero && pk.player === playerName && g.dur > 0) pairs.push({pk: pk, g: g});
    });
  });
  if (!pairs.length) return null;
  var n = pairs.length, wins = 0;
  var sumK=0,sumD=0,sumA=0,sumDmg=0,sumDtk=0,sumDur=0;
  var kpSum=0,kpCount=0,mvpCount=0;
  pairs.forEach(function(entry) {
    var pk=entry.pk, g=entry.g;
    var won=(g.winSide===pk.side);
    if(won) wins++;
    sumK+=pk.k;sumD+=pk.d;sumA+=pk.a;sumDmg+=pk.dmg;sumDtk+=pk.dtk;sumDur+=g.dur;
    var tk=g.teamKills[pk.side];
    if(tk>0){kpSum+=Math.min((pk.k+pk.a)/tk,1.0);kpCount++;}
    if(g.mvpHero===hero&&g.mvpPlayer===playerName) mvpCount++;
  });
  return {
    games:n,wins:wins,wr:wins/n,
    kda:(sumK+sumA)/Math.max(sumD,1),
    killsPerMin:sumDur>0?sumK/sumDur:0,
    deathsPerMin:sumDur>0?sumD/sumDur:0,
    minPerDeath:sumD>0?sumDur/sumD:sumDur,
    dmgPerMin:sumDur>0?sumDmg/sumDur:0,
    dtkPerMin:sumDur>0?sumDtk/sumDur:0,
    kp:kpCount>0?(kpSum/kpCount)*100:0,
    mvpRate:mvpCount/n,
    avgDur:sumDur/n
  };
}

// ── Sort ────────────────────────────────────────────────────

function mlSortHeroes(list) {
  var key = ML_SORT === 'winrate' ? 'wr' : ML_SORT === 'games' ? 'games' : 'presence';
  return list.slice().sort(function(a, b) {
    var aLow = a.stats.games < 10, bLow = b.stats.games < 10;
    if (aLow !== bLow) return aLow ? 1 : -1;
    return (b.stats[key] || 0) - (a.stats[key] || 0);
  });
}

// ── Bar rendering ────────────────────────────────────────────

function mlRenderBars() {
  var tourEl = document.getElementById('ml-tour-bar');
  if (tourEl) {
    tourEl.innerHTML = _ML_TOURS.map(function(t) {
      return '<button class="tier-mode-btn' + (t === ML_TOUR ? ' active' : '') + '" onclick="ML_TOUR=\'' + t + '\';mlRenderBars();mlRenderList();">' + t + '</button>';
    }).join('');
  }
  var sortEl = document.getElementById('ml-sort-bar');
  if (sortEl) {
    sortEl.innerHTML = [['presence','Presence'],['winrate','Win Rate'],['games','Games']].map(function(s) {
      return '<button class="tier-mode-btn' + (s[0] === ML_SORT ? ' active' : '') + '" onclick="ML_SORT=\'' + s[0] + '\';mlRenderBars();mlRenderList();">' + s[1] + '</button>';
    }).join('');
  }
  var roleEl = document.getElementById('ml-role-tabs');
  if (roleEl) {
    roleEl.innerHTML = _ML_ROLES.map(function(r) {
      return '<button class="tier-mode-btn' + (r === ML_ROLE ? ' active' : '') + '" onclick="ML_ROLE=\'' + r + '\';mlRenderBars();mlRenderList();">' + r + '</button>';
    }).join('');
  }
}

// ── Hero list ────────────────────────────────────────────────

function mlRenderList() {
  var listEl = document.getElementById('ml-hero-list');
  if (!listEl || !ML_GAMES) return;
  var games = mlFilteredGames();
  var heroes = _mlAllHeroes(games);

  if (ML_ROLE !== 'All') {
    heroes = heroes.filter(function(h) {
      return games.some(function(g) {
        return g.picks.some(function(pk) { return pk.hero === h && pk.role === ML_ROLE; });
      });
    });
  }

  var sq = ((document.getElementById('ml-search') || {}).value || '').trim().toLowerCase();
  var list = heroes.map(function(h) { return {hero: h, stats: _mlGetStats(h, games)}; });
  if (sq) list = list.filter(function(x) { return x.hero.toLowerCase().indexOf(sq) >= 0; });
  list = mlSortHeroes(list);

  if (!list.length) {
    listEl.innerHTML = '<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;">No heroes found</div>';
    return;
  }

  listEl.innerHTML = list.map(function(x) {
    var s = x.stats;
    var isLow = s.games < 10;
    var isSel = x.hero === ML_SELECTED;
    var safeName = x.hero.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return '<div style="padding:10px 14px;border-bottom:var(--border);cursor:pointer;display:flex;align-items:center;gap:8px;' +
      (isSel ? 'background:var(--grey-1);' : '') + '" onclick="mlSelectHero(\'' + safeName + '\')">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:15px;line-height:1.2;">' + x.hero +
          (isLow ? '<span style="font-size:8px;color:var(--warn);margin-left:5px;font-family:\'DM Mono\',monospace;vertical-align:middle;">low n</span>' : '') +
        '</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-top:2px;">' + s.games + ' games</div>' +
      '</div>' +
      '<div style="text-align:right;flex-shrink:0;">' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:10px;">' + (s.wr * 100).toFixed(0) + '% WR</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">' + (s.presence * 100).toFixed(0) + '% pres</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Hero select + detail shell ───────────────────────────────

function mlSelectHero(hero) {
  ML_SELECTED    = hero;
  ML_DETAIL_TAB  = 'overview';
  ML_PLAYERS_EXP = {};
  ML_MATCHUP_EXP = false;
  ML_MATCHUP_MODE = 'allies';
  mlRenderList();
  mlRenderDetail();
}

function mlRenderDetail() {
  var el = document.getElementById('ml-detail');
  if (!el) return;
  if (!ML_SELECTED) {
    el.innerHTML = '<div style="padding:24px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;">SELECT A HERO</div>';
    return;
  }
  var games = mlFilteredGames();
  var stats = _mlGetStats(ML_SELECTED, games);

  var tabBar = ['overview','stats','style','players','matchups'].map(function(t) {
    var label = t.charAt(0).toUpperCase() + t.slice(1);
    return '<button class="tier-mode-btn' + (t === ML_DETAIL_TAB ? ' active' : '') + '" onclick="ML_DETAIL_TAB=\'' + t + '\';mlRenderDetail();">' + label + '</button>';
  }).join('');

  var body;
  if      (ML_DETAIL_TAB === 'overview')  body = _mlOverview(stats);
  else if (ML_DETAIL_TAB === 'stats')     body = _mlStats(stats);
  else if (ML_DETAIL_TAB === 'style')     body = _mlStyleShell();
  else if (ML_DETAIL_TAB === 'players')   body = _mlPlayers(games);
  else if (ML_DETAIL_TAB === 'matchups')  body = _mlMatchups(games);
  else body = '';

  el.innerHTML =
    '<div style="padding:12px 14px;border-bottom:var(--border);">' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;margin-bottom:8px;">' + ML_SELECTED + '</div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + tabBar + '</div>' +
    '</div>' +
    '<div style="padding:14px;">' + body + '</div>';

  if (ML_DETAIL_TAB === 'style') {
    setTimeout(function() { _mlDrawRadar(stats, games); }, 30);
  }
}

// ── Detail helpers ───────────────────────────────────────────

function _mlPct(v, d) {
  if (v == null || isNaN(v)) return '—';
  return (v * 100).toFixed(d != null ? d : 0) + '%';
}
function _mlF(v, d, suf) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(d != null ? d : 2) + (suf || '');
}
function _mlFk(v) {
  if (v == null || isNaN(v)) return '—';
  return (v / 1000).toFixed(1) + 'k';
}

function _mlCard(label, value, sub) {
  return '<div style="background:var(--grey-1);border:var(--border);padding:12px;border-radius:2px;">' +
    '<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;color:var(--grey-5);margin-bottom:6px;">' + label + '</div>' +
    '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;line-height:1;">' + value + '</div>' +
    (sub ? '<div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);margin-top:4px;">' + sub + '</div>' : '') +
  '</div>';
}

function _mlStatRow(label, value, note) {
  return '<div style="display:flex;align-items:baseline;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
    '<span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);">' + label + '</span>' +
    '<span style="font-family:\'DM Mono\',monospace;font-size:11px;">' +
      (note ? '<span style="font-size:8px;color:var(--grey-4);margin-right:5px;">' + note + '</span>' : '') +
      value +
    '</span>' +
  '</div>';
}

function _mlGrpHdr(label) {
  return '<div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--grey-4);margin:14px 0 4px;padding-top:4px;">' + label + '</div>';
}

// ── Overview tab ─────────────────────────────────────────────

function _mlOverview(s) {
  return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">' +
    _mlCard('WIN RATE',  _mlPct(s.wr, 1),       s.wins + '/' + s.games + ' games') +
    _mlCard('PICK RATE', _mlPct(s.pickRate, 1),  s.games + ' picks') +
    _mlCard('BAN RATE',  _mlPct(s.banRate, 1),   s.bans + ' bans') +
    _mlCard('PRESENCE',  _mlPct(s.presence, 1),  'pick+ban') +
    _mlCard('GAMES',     String(s.games),          s.games < 10 ? 'low sample' : '') +
    _mlCard('MVP RATE',  _mlPct(s.mvpRate, 1),   '') +
  '</div>';
}

// ── Stats tab ────────────────────────────────────────────────

function _mlStats(s) {
  return _mlGrpHdr('COMBAT') +
    _mlStatRow('KDA',               _mlF(s.kda, 2)) +
    _mlStatRow('Kills / min',       _mlF(s.killsPerMin, 2)) +
    _mlStatRow('Deaths / min',      _mlF(s.deathsPerMin, 2)) +
    _mlStatRow('Min / death',       _mlF(s.minPerDeath, 2), 'higher=better') +
    _mlStatRow('Damage / min',      _mlFk(s.dmgPerMin)) +
    _mlStatRow('Damage taken / min',_mlFk(s.dtkPerMin)) +
    _mlStatRow('Kill Participation', _mlPct(s.kp / 100, 1)) +
    _mlGrpHdr('IMPACT') +
    _mlStatRow('MVP Rate',           _mlPct(s.mvpRate, 1)) +
    _mlStatRow('Win Gold Diff / min', s.wgdpm != null ? _mlFk(s.wgdpm) : '—') +
    _mlGrpHdr('CONTEXT') +
    _mlStatRow('Win Rate (Blue)',    s.wrBlue != null ? _mlPct(s.wrBlue, 1) : '—') +
    _mlStatRow('Win Rate (Red)',     s.wrRed  != null ? _mlPct(s.wrRed,  1) : '—') +
    _mlStatRow('Avg Game Length',    _mlF(s.avgDur, 1, 'm')) +
    _mlStatRow('Pick Rate',          _mlPct(s.pickRate, 1)) +
    _mlStatRow('Ban Rate',           _mlPct(s.banRate, 1)) +
    _mlStatRow('Presence',           _mlPct(s.presence, 1));
}

// ── Style tab (radar) ────────────────────────────────────────

var _ML_RADAR_AXES = [
  {key:'dmgPerMin',   label:'DMG/min',   fmt:_mlFk},
  {key:'dtkPerMin',   label:'DTK/min',   fmt:_mlFk},
  {key:'kda',         label:'KDA',       fmt:function(v){return v.toFixed(2);}},
  {key:'avgDur',      label:'Game Len',  fmt:function(v){return v.toFixed(1)+'m';}},
  {key:'minPerDeath', label:'Min/death', fmt:function(v){return v.toFixed(1);}},
  {key:'mvpRate',     label:'MVP Rate',  fmt:function(v){return (v*100).toFixed(0)+'%';}}
];

function _mlStyleShell() {
  return '<canvas id="ml-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;display:block;margin:0 auto;"></canvas>' +
    '<div style="margin-top:6px;text-align:center;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-4);">Percentile within filtered pool (heroes ≥10 games)</div>';
}

function _mlDrawRadar(heroStats, games) {
  var canvas = document.getElementById('ml-radar-canvas');
  if (!canvas) return;

  // Build normalization pool: all heroes ≥10 games
  var allH = _mlAllHeroes(games);
  var pool = allH.map(function(h) { return _mlGetStats(h, games); }).filter(function(s) { return s.games >= 10; });

  function percentileRank(val, key) {
    if (!pool.length) return 0.5;
    var vals = pool.map(function(s) { return s[key]; })
      .filter(function(v) { return v != null && !isNaN(v); })
      .sort(function(a, b) { return a - b; });
    if (!vals.length) return 0.5;
    return vals.filter(function(v) { return v < val; }).length / vals.length;
  }

  var fracs = _ML_RADAR_AXES.map(function(ax) { return percentileRank(heroStats[ax.key], ax.key); });

  var dpr = window.devicePixelRatio || 1;
  var W = canvas.offsetWidth || 280, H = canvas.offsetHeight || 280;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var n = _ML_RADAR_AXES.length;
  var cx = W/2, cy = H/2, R = Math.min(W,H)/2 - 54;

  function ang(i) { return (Math.PI * 2 * i / n) - Math.PI / 2; }
  function pt(i, r) { return {x: cx + r * Math.cos(ang(i)), y: cy + r * Math.sin(ang(i))}; }

  ctx.clearRect(0, 0, W, H);

  // Grid rings
  [0.25, 0.5, 0.75, 1].forEach(function(f) {
    ctx.beginPath();
    for (var i = 0; i < n; i++) { var p = pt(i, R*f); i === 0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y); }
    ctx.closePath();
    ctx.strokeStyle = f === 1 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1; ctx.stroke();
  });
  // Spokes
  for (var i = 0; i < n; i++) {
    var ep = pt(i, R);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ep.x, ep.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // Hero polygon
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var p = pt(i, R * Math.max(fracs[i], 0.04));
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(100,180,255,0.15)'; ctx.fill();
  ctx.strokeStyle = 'rgba(100,180,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
  // Dots
  for (var i = 0; i < n; i++) {
    var p = pt(i, R * Math.max(fracs[i], 0.04));
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(100,180,255,1)'; ctx.fill();
  }
  // Labels
  _ML_RADAR_AXES.forEach(function(ax, i) {
    var p = pt(i, R + 40);
    ctx.textAlign = 'center';
    ctx.font = '500 8.5px DM Sans,sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(ax.label, p.x, p.y);
    var rawVal = heroStats[ax.key];
    if (rawVal != null && !isNaN(rawVal)) {
      ctx.font = 'bold 10px "Bebas Neue",sans-serif';
      ctx.fillStyle = 'rgba(100,180,255,1)';
      ctx.fillText(ax.fmt(rawVal), p.x, p.y + 12);
    }
    ctx.font = '500 7.5px DM Sans,sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(Math.round(fracs[i] * 100) + 'th', p.x, p.y + 23);
  });
}

// ── Players tab ──────────────────────────────────────────────

function _mlPlayers(games) {
  var playerMap = {};
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero !== ML_SELECTED || !pk.player) return;
      if (!playerMap[pk.player]) playerMap[pk.player] = {player: pk.player, games: 0, wins: 0};
      playerMap[pk.player].games++;
      if (g.winSide === pk.side) playerMap[pk.player].wins++;
    });
  });

  var rows = Object.keys(playerMap).map(function(k) { return playerMap[k]; })
    .sort(function(a, b) { return b.games - a.games; });

  if (!rows.length) return '<div style="color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;padding:8px 0;">No picks found</div>';

  var rosterPlayers = (typeof getPlayers === 'function') ? getPlayers() : [];

  return rows.map(function(r, idx) {
    var expanded = ML_PLAYERS_EXP[idx];
    var wr = r.games > 0 ? r.wins / r.games : 0;
    var rP = rosterPlayers.find(function(p) { return p.ign && p.ign.toLowerCase() === r.player.toLowerCase(); });
    var nameHtml = rP
      ? '<span style="cursor:pointer;color:rgba(100,180,255,0.9);" onclick="event.stopPropagation();showProfile(\'' + rP.id + '\')">' + r.player + '</span>'
      : r.player;

    var expBody = '';
    if (expanded) {
      var ps = mlPlayerHeroStats(r.player, ML_SELECTED, games);
      if (ps) {
        expBody = '<div style="padding:8px 12px 4px;background:var(--black);border-top:var(--border);">' +
          _mlStatRow('Win Rate',          _mlPct(ps.wr, 1)) +
          _mlStatRow('KDA',               _mlF(ps.kda, 2)) +
          _mlStatRow('Kills / min',       _mlF(ps.killsPerMin, 2)) +
          _mlStatRow('Deaths / min',      _mlF(ps.deathsPerMin, 2)) +
          _mlStatRow('Min / death',       _mlF(ps.minPerDeath, 2)) +
          _mlStatRow('Damage / min',      _mlFk(ps.dmgPerMin)) +
          _mlStatRow('Damage taken / min',_mlFk(ps.dtkPerMin)) +
          _mlStatRow('Kill Participation',_mlPct(ps.kp / 100, 1)) +
          _mlStatRow('MVP Rate',          _mlPct(ps.mvpRate, 1)) +
          _mlStatRow('Avg Game Length',   _mlF(ps.avgDur, 1, 'm')) +
        '</div>';
      }
    }

    return '<div style="border:var(--border);margin-bottom:6px;background:var(--grey-1);">' +
      '<div style="padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;" onclick="ML_PLAYERS_EXP[' + idx + ']=!ML_PLAYERS_EXP[' + idx + '];mlRenderDetail();">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">' + nameHtml + '</div>' +
        '</div>' +
        '<div style="text-align:right;font-family:\'DM Mono\',monospace;font-size:10px;">' +
          '<div>' + r.games + ' games</div>' +
          '<div style="color:var(--grey-5);font-size:8px;">' + _mlPct(wr, 1) + ' WR</div>' +
        '</div>' +
        '<div style="color:var(--grey-5);font-size:10px;margin-left:4px;">' + (expanded ? '▲' : '▼') + '</div>' +
      '</div>' +
      expBody +
    '</div>';
  }).join('');
}

// ── Matchups tab ─────────────────────────────────────────────

function _mlMatchups(games) {
  var subBar =
    '<div style="display:flex;gap:4px;margin-bottom:12px;">' +
      '<button class="tier-mode-btn' + (ML_MATCHUP_MODE === 'allies'  ? ' active' : '') + '" onclick="ML_MATCHUP_MODE=\'allies\';mlRenderDetail();">Allies</button>' +
      '<button class="tier-mode-btn' + (ML_MATCHUP_MODE === 'enemies' ? ' active' : '') + '" onclick="ML_MATCHUP_MODE=\'enemies\';mlRenderDetail();">Enemies</button>' +
    '</div>';

  var countMap = {};
  games.forEach(function(g) {
    var myPick = null;
    g.picks.forEach(function(pk) { if (pk.hero === ML_SELECTED) myPick = pk; });
    if (!myPick) return;
    var myWon = (g.winSide === myPick.side);
    g.picks.forEach(function(pk) {
      if (pk.hero === ML_SELECTED || !pk.hero) return;
      var isAlly = pk.side === myPick.side;
      if (ML_MATCHUP_MODE === 'allies'  && !isAlly) return;
      if (ML_MATCHUP_MODE === 'enemies' && isAlly)  return;
      if (!countMap[pk.hero]) countMap[pk.hero] = {games: 0, wins: 0};
      countMap[pk.hero].games++;
      if (myWon) countMap[pk.hero].wins++;
    });
  });

  var matchups = Object.keys(countMap).map(function(h) {
    var m = countMap[h];
    return {hero: h, games: m.games, wr: m.games > 0 ? m.wins / m.games : 0};
  }).sort(function(a, b) { return b.games - a.games; });

  if (!matchups.length) return subBar + '<div style="color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;padding:8px 0;">No matchup data</div>';

  function renderRow(m) {
    var bar = Math.round(m.wr * 100);
    var barColor = m.wr >= 0.55 ? 'var(--success)' : m.wr <= 0.45 ? 'var(--danger)' : 'var(--grey-5)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
      '<div style="flex:1;font-family:\'Bebas Neue\',sans-serif;font-size:14px;">' + m.hero + '</div>' +
      '<div style="text-align:right;font-family:\'DM Mono\',monospace;font-size:10px;flex-shrink:0;">' +
        '<div style="color:' + barColor + ';">' + bar + '% WR</div>' +
        '<div style="color:var(--grey-5);font-size:8px;">' + m.games + ' games</div>' +
      '</div>' +
    '</div>';
  }

  var top5 = matchups.slice(0, 5);
  var rest  = matchups.slice(5);
  var html = subBar + top5.map(renderRow).join('');

  if (rest.length) {
    if (ML_MATCHUP_EXP) {
      html += rest.map(renderRow).join('');
      html += '<button class="tier-mode-btn" style="margin-top:8px;" onclick="ML_MATCHUP_EXP=false;mlRenderDetail();">▲ Collapse</button>';
    } else {
      html += '<button class="tier-mode-btn" style="margin-top:8px;" onclick="ML_MATCHUP_EXP=true;mlRenderDetail();">+ Show ' + rest.length + ' more</button>';
    }
  }
  return html;
}
