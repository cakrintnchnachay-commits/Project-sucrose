// ═══════════════════════════════════════════════════════════
// PLAYER LAB ENGINE (pro player hub, reads game_results_detailed.csv)
// ═══════════════════════════════════════════════════════════

var PL_GAMES    = null;
var PL_TOUR     = 'All';
var PL_SORT     = 'wr';
var PL_ROLE     = 'All';
var PL_SELECTED = null;
var PL_DETAIL_TAB    = 'overview';
var PL_HEROES_EXP    = {};
var PL_RADAR_COMPARE = false;

var _PL_TOURS = ['All', 'RPL Summer', 'GCS Spring', 'AOG Spring', 'APL'];
var _PL_ROLES = ['All', 'DSL', 'JUG', 'MID', 'ADL', 'SUP'];
var _PL_PICK_ROLES = ['DSL', 'JUG', 'MID', 'ADL', 'SUP'];

// ── Init ────────────────────────────────────────────────────

function plInit() {
  if (PL_GAMES !== null) { plRenderBars(); plRenderList(); return; }
  var listEl = document.getElementById('pl-player-list');
  var detEl  = document.getElementById('pl-detail');
  if (listEl) listEl.innerHTML = '<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:1px;">Loading pro data…</div>';
  if (detEl)  detEl.innerHTML  = '';
  fetch('data/game_results_detailed.csv', {cache: 'no-store'})
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(txt) {
      PL_GAMES = plBuildGames(txt);
      plRenderBars();
      plRenderList();
    })
    .catch(function(err) {
      if (listEl) listEl.innerHTML = '<div style="padding:20px;color:var(--danger);font-family:\'DM Mono\',monospace;font-size:10px;">Failed to load data.<br>' + err.message + '</div>';
      if (detEl)  detEl.innerHTML  = '<div style="padding:20px;"><div style="color:var(--danger);margin-bottom:12px;">' + err.message + '</div><button class="btn btn-sm" onclick="PL_GAMES=null;plInit()">Retry</button></div>';
    });
}

// ── CSV parsing ─────────────────────────────────────────────

function _plSplitCSV(line) {
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

function _plStr(row, idx) {
  return idx >= 0 && idx < row.length ? row[idx].trim().replace(/^"|"$/g, '') : '';
}

function _plNormalize(name) {
  if (!name) return name;
  if (name === 'FlowbornMarksman') return 'Flowborn Marksman';
  return name;
}

function _plNum(s) {
  if (s == null) return NaN;
  return parseFloat(String(s).replace(/,/g, '').trim());
}

function plBuildGames(csvText) {
  var lines = csvText.split(/\r?\n/);
  if (!lines.length) return [];
  var headers = _plSplitCSV(lines[0]).map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
  function ci(name) { return headers.indexOf(name); }
  function get(row, name) { return _plStr(row, ci(name)); }
  function getNum(row, name) { return _plNum(get(row, name)); }

  var games = [];
  for (var li = 1; li < lines.length; li++) {
    var line = lines[li].trim();
    if (!line) continue;
    var row = _plSplitCSV(line);

    if (isNaN(_plNum(get(row, 'A DSL KILL')))) continue;

    var dur = getNum(row, 'END TIME');
    if (isNaN(dur) || dur <= 0) continue;

    var teamA    = get(row, 'Team A');
    var teamB    = get(row, 'Team B');
    var matchWin = get(row, 'MATCH WIN');
    var winSide  = (matchWin === teamA) ? 'A' : 'B';
    var tour     = get(row, 'TYPE');

    var bansA = [], bansB = [];
    for (var b = 1; b <= 4; b++) { var bn = _plNormalize(get(row, 'A BAN ' + b)); if (bn) bansA.push(bn); }
    for (var b = 1; b <= 4; b++) { var bn = _plNormalize(get(row, 'B BAN ' + b)); if (bn) bansB.push(bn); }

    var goldA = _plNum(get(row, 'A Gold'));
    var goldB = _plNum(get(row, 'B Gold'));
    if (isNaN(goldA)) goldA = 0;
    if (isNaN(goldB)) goldB = 0;

    var picks = [];
    var teamKills = {A: 0, B: 0};

    ['A', 'B'].forEach(function(S) {
      _PL_PICK_ROLES.forEach(function(R) {
        var hero   = _plNormalize(get(row, S + ' ' + R));
        var player = get(row, S + ' P ' + R);
        var k  = _plNum(get(row, S + ' ' + R + ' KILL'));
        var d  = _plNum(get(row, S + ' ' + R + ' DEATH'));
        var a  = _plNum(get(row, S + ' ' + R + ' ASSIST'));
        var dm = _plNum(get(row, S + ' ' + R + ' DMG'));
        var dt = _plNum(get(row, S + ' ' + R + ' DTK'));
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
      mvpHero:   _plNormalize(get(row, 'MVP Hero')),
      mvpPlayer: get(row, 'MVP')
    });
  }
  return games;
}

// ── Filtered set ────────────────────────────────────────────

function plFilteredGames() {
  if (!PL_GAMES) return [];
  return PL_GAMES.filter(function(g) { return PL_TOUR === 'All' || g.tour === PL_TOUR; });
}

function _plAllPlayers(games) {
  var set = {};
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.player) set[pk.player] = 1;
    });
  });
  return Object.keys(set).sort();
}

// ── Stats computation ────────────────────────────────────────

function plPlayerStats(playerIGN, games) {
  var ign = playerIGN.toLowerCase();
  var picks = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.player && pk.player.toLowerCase() === ign && g.dur > 0) picks.push({pk: pk, g: g});
    });
  });
  return _plStatsFromPicks(picks, playerIGN, games);
}

function plPlayerStatsForRole(playerIGN, games, role) {
  var ign = playerIGN.toLowerCase();
  var picks = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.player && pk.player.toLowerCase() === ign && pk.role === role && g.dur > 0) picks.push({pk: pk, g: g});
    });
  });
  return _plStatsFromPicks(picks, playerIGN, games);
}

function _plStatsFromPicks(pairs, playerIGN, games) {
  var n = pairs.length;
  var wins = 0;
  var sumK=0,sumD=0,sumA=0,sumDmg=0,sumDtk=0,sumDur=0;
  var kpSum=0,kpCount=0,mvpCount=0;
  var picksA=0,winsA=0,picksB=0,winsB=0;
  var winGoldDiffs = [];
  var roleCounts = {};

  pairs.forEach(function(entry) {
    var pk = entry.pk, g = entry.g;
    var won = (g.winSide === pk.side);
    if (won) wins++;
    sumK+=pk.k; sumD+=pk.d; sumA+=pk.a; sumDmg+=pk.dmg; sumDtk+=pk.dtk; sumDur+=g.dur;
    var tk = g.teamKills[pk.side];
    if (tk > 0) { kpSum += Math.min((pk.k + pk.a) / tk, 1.0); kpCount++; }
    if (g.mvpPlayer === pk.player && g.mvpHero === pk.hero) mvpCount++;
    if (pk.side === 'A') { picksA++; if (won) winsA++; }
    else                 { picksB++; if (won) winsB++; }
    if (won) {
      var og = pk.side==='A' ? g.goldA : g.goldB;
      var op = pk.side==='A' ? g.goldB : g.goldA;
      if (og > 0 || op > 0) winGoldDiffs.push((og - op) / (5 * g.dur));
    }
    if (pk.role) roleCounts[pk.role] = (roleCounts[pk.role] || 0) + 1;
  });

  var roleKeys = Object.keys(roleCounts);
  var primaryRole = roleKeys.length
    ? roleKeys.reduce(function(a, b) { return roleCounts[a] > roleCounts[b] ? a : b; })
    : null;

  var playerTeam = null;
  var ign = playerIGN.toLowerCase();
  for (var gi = games.length - 1; gi >= 0; gi--) {
    var g = games[gi];
    for (var pi = 0; pi < g.picks.length; pi++) {
      var pk = g.picks[pi];
      if (pk.player && pk.player.toLowerCase() === ign && g.teams && g.teams[pk.side]) {
        playerTeam = g.teams[pk.side];
        break;
      }
    }
    if (playerTeam) break;
  }

  var kda = (sumK + sumA) / Math.max(sumD, 1);
  return {
    games:        n,
    wins:         wins,
    wr:           n > 0 ? wins / n : 0,
    kda:          kda,
    killsPerMin:  sumDur > 0 ? sumK  / sumDur : 0,
    deathsPerMin: sumDur > 0 ? sumD  / sumDur : 0,
    minPerDeath:  sumD > 0   ? sumDur / sumD  : (sumDur > 0 ? sumDur : 0),
    dmgPerMin:    sumDur > 0 ? sumDmg / sumDur : 0,
    dtkPerMin:    sumDur > 0 ? sumDtk / sumDur : 0,
    kp:           kpCount > 0 ? (kpSum / kpCount) * 100 : 0,
    mvpRate:      n > 0 ? mvpCount / n : 0,
    avgDur:       n > 0 ? sumDur / n : 0,
    wrBlue:       picksA > 0 ? winsA / picksA : null,
    wrRed:        picksB > 0 ? winsB / picksB : null,
    wgdpm:        winGoldDiffs.length > 0 ? winGoldDiffs.reduce(function(a,b){return a+b;},0)/winGoldDiffs.length : null,
    role:         primaryRole,
    team:         playerTeam
  };
}

function _plGetStats(playerIGN, games) {
  return PL_ROLE !== 'All' ? plPlayerStatsForRole(playerIGN, games, PL_ROLE) : plPlayerStats(playerIGN, games);
}

function _plProRoleRef(role, games) {
  var allP = _plAllPlayers(games);
  var keys = ['wr','mvpRate','kda','dmgPerMin','dtkPerMin','kp'];
  var sums = {wr:0,mvpRate:0,kda:0,dmgPerMin:0,dtkPerMin:0,kp:0};
  var cnts = {wr:0,mvpRate:0,kda:0,dmgPerMin:0,dtkPerMin:0,kp:0};
  allP.forEach(function(p) {
    var s = plPlayerStatsForRole(p, games, role);
    if (s.games < 3) return;
    keys.forEach(function(k) {
      if (s[k] != null && !isNaN(s[k])) { sums[k] += s[k]; cnts[k]++; }
    });
  });
  var result = {};
  keys.forEach(function(k) { result[k] = cnts[k] > 0 ? sums[k] / cnts[k] : null; });
  return result;
}

function plPlayerHeroStats(playerIGN, hero, games) {
  var ign = playerIGN.toLowerCase();
  var pairs = [];
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero === hero && pk.player && pk.player.toLowerCase() === ign && g.dur > 0) pairs.push({pk: pk, g: g});
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
    if(g.mvpHero===hero&&g.mvpPlayer===pk.player) mvpCount++;
  });
  return {
    games:n, wins:wins, wr:wins/n,
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

// ── Radar caps ───────────────────────────────────────────────

function _plRadarCaps() {
  return {wr: 0.75, mvpRate: 0.30, kda: 5, dmgPerMin: 7500, dtkPerMin: 7500, kp: 75};
}

var _PL_RADAR_AXES = [
  {key:'wr',        label:'Win Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'mvpRate',   label:'MVP Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'kda',       label:'KDA',       fmt:function(v){return v.toFixed(2);}},
  {key:'dmgPerMin', label:'DMG/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'dtkPerMin', label:'DTK/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'kp',        label:'Kill Part', fmt:function(v){return v.toFixed(0)+'%';}}
];

// ── Bar rendering ────────────────────────────────────────────

function plRenderBars() {
  var tourEl = document.getElementById('pl-tour-bar');
  if (tourEl) {
    tourEl.innerHTML = _PL_TOURS.map(function(t) {
      return '<button class="tier-mode-btn' + (t === PL_TOUR ? ' active' : '') + '" onclick="PL_TOUR=\'' + t + '\';plRenderBars();plRenderList();">' + t + '</button>';
    }).join('');
  }
  var sortEl = document.getElementById('pl-sort-bar');
  if (sortEl) {
    sortEl.innerHTML = [['wr','Win Rate'],['kda','KDA'],['games','Games']].map(function(s) {
      return '<button class="tier-mode-btn' + (s[0] === PL_SORT ? ' active' : '') + '" onclick="PL_SORT=\'' + s[0] + '\';plRenderBars();plRenderList();">' + s[1] + '</button>';
    }).join('');
  }
  var roleEl = document.getElementById('pl-role-tabs');
  if (roleEl) {
    roleEl.innerHTML = _PL_ROLES.map(function(r) {
      return '<button class="tier-mode-btn' + (r === PL_ROLE ? ' active' : '') + '" onclick="PL_ROLE=\'' + r + '\';plRenderBars();plRenderList();">' + r + '</button>';
    }).join('');
  }
}

// ── Player list ──────────────────────────────────────────────

function plRenderList() {
  var listEl = document.getElementById('pl-player-list');
  if (!listEl || !PL_GAMES) return;
  var games = plFilteredGames();
  var players = _plAllPlayers(games);

  if (PL_ROLE !== 'All') {
    players = players.filter(function(p) {
      return games.some(function(g) {
        return g.picks.some(function(pk) { return pk.player === p && pk.role === PL_ROLE; });
      });
    });
  }

  var list = players.map(function(p) { return {player: p, stats: _plGetStats(p, games)}; });
  list = list.filter(function(x) { return x.stats.games >= 1; });

  list.sort(function(a, b) {
    var aLow = a.stats.games < 10, bLow = b.stats.games < 10;
    if (aLow !== bLow) return aLow ? 1 : -1;
    var key = PL_SORT === 'kda' ? 'kda' : PL_SORT === 'games' ? 'games' : 'wr';
    return (b.stats[key] || 0) - (a.stats[key] || 0);
  });

  if (!list.length) {
    listEl.innerHTML = '<div style="padding:20px;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:10px;">No players found</div>';
    return;
  }

  listEl.innerHTML = list.map(function(x) {
    var s = x.stats;
    var isLow = s.games < 10;
    var isSel = x.player === PL_SELECTED;
    var safeName = x.player.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var wr = Math.round(s.wr * 100);
    var wrColor = s.games > 0 ? (wr >= 60 ? 'var(--success)' : wr >= 50 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';
    var teamAbbr = s.team || '';
    var logoUrl  = (window._ML_TEAM_LOGOS || {})[teamAbbr] || '';
    var avatarHtml = logoUrl
      ? '<img src="' + logoUrl + '" style="width:32px;height:32px;object-fit:contain;background:var(--grey-8);padding:3px;box-sizing:border-box;flex-shrink:0;" onerror="this.style.display=\'none\'">'
      : '<div style="width:32px;height:32px;background:var(--grey-8);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--grey-5);flex-shrink:0;">' + (x.player[0]||'?') + '</div>';
    var roleTag = s.role ? '<span style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1px;color:var(--grey-5);margin-left:4px;">' + s.role + '</span>' : '';
    return '<div class="hp-item' + (isSel ? ' active' : '') + '" onclick="plSelectPlayer(\'' + safeName + '\')" style="padding:8px 10px;">' +
      avatarHtml +
      '<div class="hp-item-body" style="margin-left:8px;">' +
        '<div class="hp-item-name">' + x.player.toUpperCase() +
          (isLow ? '<span style="font-size:7px;color:var(--warn);margin-left:6px;letter-spacing:0;font-family:\'DM Mono\',monospace;vertical-align:middle;">LOW N</span>' : '') +
        '</div>' +
        '<div class="hp-item-meta">' + s.games + 'G' + roleTag + '</div>' +
      '</div>' +
      '<div class="hp-item-wr-col">' +
        '<div class="hp-item-wr" style="color:' + wrColor + ';">' + wr + '%</div>' +
        '<div class="hp-item-wr-lbl">WR</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Player select ────────────────────────────────────────────

function plSelectPlayer(player) {
  PL_SELECTED      = player;
  PL_DETAIL_TAB    = 'overview';
  PL_HEROES_EXP    = {};
  PL_RADAR_COMPARE = false;
  plRenderList();
  plRenderDetail();
}

// ── Detail shell ─────────────────────────────────────────────

function plRenderDetail() {
  var el = document.getElementById('pl-detail');
  if (!el) return;
  if (!PL_SELECTED) {
    el.innerHTML =
      '<div class="hd-placeholder-inner" style="min-height:300px;">' +
        '<div class="ph-title">PLAYER LAB</div>' +
        '<div class="ph-sub">SELECT A PLAYER FROM THE LIST</div>' +
      '</div>';
    return;
  }

  var games  = plFilteredGames();
  var stats  = _plGetStats(PL_SELECTED, games);
  var initials = PL_SELECTED.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase() || PL_SELECTED.slice(0, 2).toUpperCase();
  var wr    = Math.round(stats.wr * 100);
  var wrColor = stats.games > 0 ? (wr >= 60 ? 'var(--success)' : wr >= 50 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';

  var primaryRole = stats.role || null;
  var radarCaps   = _plRadarCaps();
  var refStats    = primaryRole ? _plProRoleRef(primaryRole, games) : null;
  var playerRadarStats = {
    wr: stats.wr, mvpRate: stats.mvpRate, kda: stats.kda,
    dmgPerMin: stats.dmgPerMin, dtkPerMin: stats.dtkPerMin, kp: stats.kp
  };

  var teamAbbr = stats.team || '';
  var logoUrl  = (window._ML_TEAM_LOGOS || {})[teamAbbr] || '';

  function miniStat(lbl, val, col) {
    return '<div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1.5px;color:var(--grey-5);">' + lbl + '</div>' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:' + (col || 'var(--white)') + ';">' + val + '</div>' +
    '</div>';
  }

  var compareHtml = '';
  if (PL_RADAR_COMPARE && refStats) {
    compareHtml =
      '<div style="border-top:var(--border);margin-top:8px;font-family:\'DM Mono\',monospace;font-size:8px;">' +
        '<div style="display:grid;grid-template-columns:1fr 64px 64px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.07);">' +
          '<div style="color:var(--grey-4);font-size:7px;letter-spacing:1px;">STAT</div>' +
          '<div style="color:rgba(100,180,255,0.9);text-align:right;font-size:7px;letter-spacing:1px;">PLAYER</div>' +
          '<div style="color:rgba(80,220,140,0.9);text-align:right;font-size:7px;letter-spacing:1px;">' + (primaryRole || 'ROLE') + ' AVG</div>' +
        '</div>' +
        _PL_RADAR_AXES.map(function(ax) {
          var hv = playerRadarStats[ax.key];
          var rv = refStats[ax.key];
          return '<div style="display:grid;grid-template-columns:1fr 64px 64px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);">' +
            '<div style="color:var(--grey-5);">' + ax.label.toUpperCase() + '</div>' +
            '<div style="color:rgba(100,180,255,0.9);text-align:right;">' + (hv!=null&&!isNaN(hv)?ax.fmt(hv):'—') + '</div>' +
            '<div style="color:rgba(80,220,140,0.9);text-align:right;">' + (rv!=null&&!isNaN(rv)?ax.fmt(rv):'—') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  var radarHtml;
  if (stats.games > 0) {
    radarHtml =
      '<div class="hd-radar-section-hdr">' +
        '<span class="hd-radar-section-title">STYLE PROFILE</span>' +
        (primaryRole ? '<span class="hd-radar-section-sub"> · ' + primaryRole + '</span>' : '') +
      '</div>' +
      '<div class="hd-radar-canvas-wrap" style="flex:1;min-height:220px;position:relative;">' +
        '<canvas id="pl-player-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;display:block;margin:0 auto;"></canvas>' +
        '<div class="hd-radar-tip" id="pl-player-radar-tip">' +
          '<div class="hd-radar-tip-lbl" id="pl-player-radar-tip-lbl"></div>' +
          '<div class="hd-radar-tip-val" id="pl-player-radar-tip-val"></div>' +
          '<div class="hd-radar-tip-team" id="pl-player-radar-tip-team" style="display:none;">' +
            '<span class="hd-radar-tip-team-lbl">ROLE AVG</span>' +
            '<span class="hd-radar-tip-team-val" id="pl-player-radar-tip-teamval"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hd-radar-legend">' +
        '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(100,180,255,0.9);"></div>' + PL_SELECTED.split(' ')[0] + '</div>' +
        (refStats ? '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(80,220,140,0.7);"></div>' + (primaryRole || 'Role') + ' Avg</div>' : '') +
      '</div>' +
      '<div style="text-align:center;margin-top:6px;">' +
        '<button class="tier-mode-btn' + (PL_RADAR_COMPARE ? ' active' : '') + '" style="font-size:7px;padding:4px 10px;" onclick="PL_RADAR_COMPARE=!PL_RADAR_COMPARE;plRenderDetail();">⇄ COMPARE STATS</button>' +
      '</div>' +
      compareHtml;
  } else {
    radarHtml = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:9px;">NO GAMES YET</div>';
  }

  var topHtml =
    '<div class="hd-top-layout">' +
      '<div class="hd-top-left">' +
        '<div class="hd-square-portrait">' +
          '<div class="hd-square-portrait-fallback">' + initials + '</div>' +
          (logoUrl ? '<img class="hd-square-portrait-img" src="' + logoUrl + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
        '</div>' +
        '<div class="hd-top-hero-name">' + PL_SELECTED.toUpperCase() + '</div>' +
        '<div class="hd-hdr-meta">' + stats.games + ' games · ' + (primaryRole || '—') + ' · ' + (teamAbbr || '—') + '</div>' +
        '<div class="hd-top-badges">' +
          (primaryRole ? '<span class="hd-badge-pool">' + primaryRole + '</span>' : '') +
          (stats.games < 10 ? '<span class="hd-badge-main" style="color:var(--warn);background:rgba(255,204,68,0.1);border-color:rgba(255,204,68,0.35);">LOW SAMPLE</span>' : '') +
        '</div>' +
        '<div style="margin-top:auto;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;">' +
          miniStat('WIN RATE', wr + '%', wrColor) +
          miniStat('KDA', stats.games > 0 ? stats.kda.toFixed(2) : '—', 'var(--white)') +
          miniStat('MVP RATE', stats.games > 0 ? Math.round(stats.mvpRate * 100) + '%' : '—', 'var(--white)') +
          miniStat('AVG LENGTH', stats.games > 0 ? stats.avgDur.toFixed(1) + 'm' : '—', 'var(--white)') +
        '</div>' +
      '</div>' +
      '<div class="hd-top-right" style="padding:10px 12px;display:flex;flex-direction:column;">' +
        radarHtml +
      '</div>' +
    '</div>';

  var tabLabels = {overview:'Overview', stats:'Stats', heropool:'Hero Pool', matchups:'Matchups'};
  var tabBar =
    '<div class="hero-role-tabs">' +
    ['overview','stats','heropool','matchups'].map(function(t) {
      return '<button class="hero-role-tab' + (t === PL_DETAIL_TAB ? ' active' : '') + '" onclick="PL_DETAIL_TAB=\'' + t + '\';plRenderDetail();">' + tabLabels[t] + '</button>';
    }).join('') +
    '</div>';

  var body;
  if      (PL_DETAIL_TAB === 'overview')  body = _plOverview(stats);
  else if (PL_DETAIL_TAB === 'stats')     body = _plStats(stats);
  else if (PL_DETAIL_TAB === 'heropool')  body = _plHeroPool(PL_SELECTED, games);
  else if (PL_DETAIL_TAB === 'matchups')  body = _plMatchups(PL_SELECTED, games);
  else body = '';

  el.innerHTML = topHtml + tabBar + body;

  if (stats.games > 0) {
    setTimeout(function() { plDrawPlayerRadar(playerRadarStats, refStats, radarCaps); }, 30);
  }
}

// ── Overview tab ─────────────────────────────────────────────

function _plOverview(s) {
  return '<div class="hd-stat-boxes">' +
    _mlStatBox('WIN RATE',    _mlPct(s.wr, 1),       s.wins + '/' + s.games + ' games') +
    _mlStatBox('KDA',         s.games > 0 ? _mlF(s.kda, 2) : '—', '') +
    _mlStatBox('GAMES',       String(s.games),         s.games < 10 ? 'low sample' : '') +
    _mlStatBox('MVP RATE',    _mlPct(s.mvpRate, 1),   '') +
    _mlStatBox('KILL PART',   _mlPct(s.kp / 100, 1),  '') +
    _mlStatBox('AVG LENGTH',  s.games > 0 ? _mlF(s.avgDur, 1, 'm') : '—', '') +
  '</div>';
}

// ── Stats tab ────────────────────────────────────────────────

function _plStats(s) {
  return (
    _mlSectionHdr('COMBAT') +
    '<div class="hd-alltime-grid">' +
      _mlAltCell('KDA',          _mlF(s.kda, 2)) +
      _mlAltCell('KILLS / MIN',  _mlF(s.killsPerMin, 2)) +
      _mlAltCell('DEATHS / MIN', _mlF(s.deathsPerMin, 2)) +
      _mlAltCell('MIN / DEATH',  _mlF(s.minPerDeath, 2)) +
      _mlAltCell('DMG / MIN',    _mlFk(s.dmgPerMin)) +
      _mlAltCell('DTK / MIN',    _mlFk(s.dtkPerMin)) +
    '</div>' +
    _mlSectionHdr('IMPACT') +
    '<div class="hd-alltime-grid">' +
      _mlAltCell('KILL PART',    _mlPct(s.kp / 100, 1)) +
      _mlAltCell('MVP RATE',     _mlPct(s.mvpRate, 1)) +
      _mlAltCell('WIN GOLD DIFF', s.wgdpm != null ? _mlFk(s.wgdpm) + '/m' : '—') +
    '</div>' +
    _mlSectionHdr('CONTEXT') +
    '<div class="hd-alltime-grid">' +
      _mlAltCell('WR (BLUE)',  s.wrBlue != null ? _mlPct(s.wrBlue, 1) : '—') +
      _mlAltCell('WR (RED)',   s.wrRed  != null ? _mlPct(s.wrRed,  1) : '—') +
      _mlAltCell('AVG LENGTH', _mlF(s.avgDur, 1, 'm')) +
    '</div>'
  );
}

// ── Hero Pool tab ─────────────────────────────────────────────

function _plHeroPool(playerIGN, games) {
  var heroMap = {};
  var ign = playerIGN.toLowerCase();
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.player && pk.player.toLowerCase() === ign && pk.hero) {
        if (!heroMap[pk.hero]) heroMap[pk.hero] = 1;
        else heroMap[pk.hero]++;
      }
    });
  });

  var heroes = Object.keys(heroMap).sort(function(a, b) { return heroMap[b] - heroMap[a]; });

  if (!heroes.length) {
    return '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding:14px;">No hero data found</div>';
  }

  return heroes.map(function(hero, idx) {
    var expanded = PL_HEROES_EXP[idx];
    var hs = plPlayerHeroStats(playerIGN, hero, games);
    if (!hs) return '';
    var wr = Math.round(hs.wr * 100);
    var wrColor = hs.games > 0 ? (wr >= 60 ? 'var(--success)' : wr >= 50 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';

    var expBody = '';
    if (expanded) {
      expBody =
        '<div class="hd-alltime-grid" style="border-top:var(--border);margin:0;">' +
          _mlAltCell('WR',         _mlPct(hs.wr, 1)) +
          _mlAltCell('KDA',        _mlF(hs.kda, 2)) +
          _mlAltCell('KILLS/MIN',  _mlF(hs.killsPerMin, 2)) +
          _mlAltCell('DMG/MIN',    _mlFk(hs.dmgPerMin)) +
          _mlAltCell('DTK/MIN',    _mlFk(hs.dtkPerMin)) +
          _mlAltCell('KP%',        _mlPct(hs.kp / 100, 1)) +
          _mlAltCell('MVP RATE',   _mlPct(hs.mvpRate, 1)) +
          _mlAltCell('AVG LEN',    _mlF(hs.avgDur, 1, 'm')) +
        '</div>';
    }

    return '<div style="border-bottom:var(--border);">' +
      '<div class="hd-player-row" style="padding:8px 14px;cursor:pointer;" onclick="PL_HEROES_EXP[' + idx + ']=!PL_HEROES_EXP[' + idx + '];plRenderDetail();">' +
        '<div style="flex-shrink:0;margin-right:10px;">' + heroPortraitHtml(hero, 28, false) + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">' + hero + '</div>' +
          '<div class="hd-wl">' + hs.games + ' games</div>' +
        '</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:' + wrColor + ';margin-right:10px;">' + wr + '%</div>' +
        '<div style="color:var(--grey-5);font-size:10px;">' + (expanded ? '▲' : '▼') + '</div>' +
      '</div>' +
      expBody +
    '</div>';
  }).join('');
}

// ── Matchups tab ──────────────────────────────────────────────

function _plMatchups(playerIGN, games) {
  var ign = playerIGN.toLowerCase();
  var allyMap = {}, enemyMap = {};

  games.forEach(function(g) {
    var myPick = null;
    g.picks.forEach(function(pk) {
      if (pk.player && pk.player.toLowerCase() === ign) myPick = pk;
    });
    if (!myPick) return;
    var myWon = (g.winSide === myPick.side);
    g.picks.forEach(function(pk) {
      if (pk.player && pk.player.toLowerCase() === ign) return;
      if (!pk.hero) return;
      var isAlly = pk.side === myPick.side;
      var map = isAlly ? allyMap : enemyMap;
      if (!map[pk.hero]) map[pk.hero] = {games: 0, wins: 0};
      map[pk.hero].games++;
      if (myWon) map[pk.hero].wins++;
    });
  });

  function toList(map) {
    return Object.keys(map).map(function(h) {
      var m = map[h];
      return {hero: h, games: m.games, wr: m.games > 0 ? m.wins / m.games : 0};
    }).sort(function(a, b) { return b.games - a.games; });
  }

  var allies  = toList(allyMap);
  var enemies = toList(enemyMap);

  function renderRow(m) {
    var pwr = Math.round(m.wr * 100);
    var pc  = m.wr >= 0.55 ? 'var(--success)' : m.wr <= 0.45 ? 'var(--danger)' : 'var(--grey-5)';
    return '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:var(--border);">' +
      '<div style="flex-shrink:0;">' + heroPortraitHtml(m.hero, 28, false) + '</div>' +
      '<div style="flex:1;font-family:\'Bebas Neue\',sans-serif;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + m.hero + '</div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);flex-shrink:0;">' + m.games + 'G</div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:' + pc + ';flex-shrink:0;min-width:28px;text-align:right;">' + pwr + '%</div>' +
    '</div>';
  }

  var alliesHtml  = allies.length  ? allies.map(renderRow).join('')  : '<div style="padding:12px 10px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">No data</div>';
  var enemiesHtml = enemies.length ? enemies.map(renderRow).join('') : '<div style="padding:12px 10px;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--grey-5);">No data</div>';

  return '<div style="display:grid;grid-template-columns:1fr 1fr;">' +
    '<div style="border-right:var(--border);">' +
      '<div style="padding:7px 10px;border-bottom:var(--border);display:flex;align-items:center;gap:6px;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:var(--success);flex-shrink:0;"></span>' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1.5px;color:var(--success);">ALLIES</span>' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);margin-left:auto;">' + allies.length + ' heroes</span>' +
      '</div>' +
      alliesHtml +
    '</div>' +
    '<div>' +
      '<div style="padding:7px 10px;border-bottom:var(--border);display:flex;align-items:center;gap:6px;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:var(--danger);flex-shrink:0;"></span>' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;letter-spacing:1.5px;color:var(--danger);">ENEMIES</span>' +
        '<span style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);margin-left:auto;">' + enemies.length + ' heroes</span>' +
      '</div>' +
      enemiesHtml +
    '</div>' +
  '</div>';
}

// ── Radar chart ───────────────────────────────────────────────

function plDrawPlayerRadar(playerStats, refStats, caps) {
  var canvas = document.getElementById('pl-player-radar-canvas');
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var dW = canvas.offsetWidth || 280, dH = canvas.offsetHeight || 280;
  canvas.width = dW * dpr; canvas.height = dH * dpr;
  canvas.style.width = dW + 'px'; canvas.style.height = dH + 'px';
  var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  var n = _PL_RADAR_AXES.length;
  var cx = dW/2, cy = dH/2, R = Math.min(dW,dH)/2 - 58;
  ctx.clearRect(0, 0, dW, dH);
  function ang(i) { return (Math.PI*2*i/n) - Math.PI/2; }
  function pt(i, r) { return {x: cx + r*Math.cos(ang(i)), y: cy + r*Math.sin(ang(i))}; }
  [0.25,0.5,0.75,1].forEach(function(f) {
    ctx.beginPath();
    for (var i=0;i<n;i++){var p=pt(i,R*f);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
    ctx.closePath();
    ctx.strokeStyle=f===1?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)';
    ctx.lineWidth=1;ctx.stroke();
  });
  for (var i=0;i<n;i++){var ep=pt(i,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ep.x,ep.y);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.stroke();}
  function norm(val,key){if(val==null||isNaN(val))return 0;return Math.min(val/(caps[key]||1),1);}
  function drawPoly(vals,fillCol,strokeCol,dotCol,dotR){
    ctx.beginPath();
    _PL_RADAR_AXES.forEach(function(ax,i){var frac=Math.max(norm(vals[ax.key],ax.key),0.03);var p=pt(i,R*frac);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});
    ctx.closePath();ctx.fillStyle=fillCol;ctx.fill();ctx.strokeStyle=strokeCol;ctx.lineWidth=2;ctx.stroke();
    _PL_RADAR_AXES.forEach(function(ax,i){if(vals[ax.key]==null)return;var frac=Math.max(norm(vals[ax.key],ax.key),0.03);var p=pt(i,R*frac);ctx.beginPath();ctx.arc(p.x,p.y,dotR,0,Math.PI*2);ctx.fillStyle=dotCol;ctx.fill();});
  }
  if(refStats) drawPoly(refStats,'rgba(80,220,140,0.08)','rgba(80,220,140,0.5)','rgba(80,220,140,0.75)',3);
  drawPoly(playerStats,'rgba(100,180,255,0.15)','rgba(100,180,255,0.95)','rgba(100,180,255,1)',4.5);
  _PL_RADAR_AXES.forEach(function(ax,i){
    var p=pt(i,R+42);var val=playerStats[ax.key];
    ctx.textAlign='center';
    ctx.font='500 9px DM Sans,sans-serif';ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fillText(ax.label,p.x,p.y);
    if(val!=null&&!isNaN(val)){ctx.font='bold 10.5px "Bebas Neue",sans-serif';ctx.fillStyle='rgba(100,180,255,1)';ctx.fillText(ax.fmt(val),p.x,p.y+13);}
  });
  window._plRadarHits = _PL_RADAR_AXES.map(function(ax,i){
    var val = playerStats[ax.key]; if(val==null||isNaN(val)) return null;
    var p = pt(i, R * Math.max(norm(val, ax.key), 0.03));
    return {x:p.x, y:p.y, label:ax.label, value:val, fmt:ax.fmt,
            roleVal:refStats?refStats[ax.key]:null, roleFmt:ax.fmt};
  }).filter(Boolean);
  _plSetupRadarEvents();
}

function _plSetupRadarEvents() {
  var canvas = document.getElementById('pl-player-radar-canvas');
  var tip    = document.getElementById('pl-player-radar-tip');
  if (!canvas || !tip) return;

  function getHit(mx, my) {
    var hits = window._plRadarHits || [];
    var best = null, bestD = Infinity;
    hits.forEach(function(h) {
      var d = Math.hypot(h.x - mx, h.y - my);
      if (d < bestD && d < 24) { best = h; bestD = d; }
    });
    return best;
  }

  function showTip(ex, ey, hit) {
    var lblEl    = document.getElementById('pl-player-radar-tip-lbl');
    var valEl    = document.getElementById('pl-player-radar-tip-val');
    var teamRow  = document.getElementById('pl-player-radar-tip-team');
    var teamValEl= document.getElementById('pl-player-radar-tip-teamval');
    if (lblEl)    lblEl.textContent = hit.label;
    if (valEl)    valEl.textContent = hit.fmt(hit.value);
    if (teamRow)  teamRow.style.display = hit.roleVal != null ? 'flex' : 'none';
    if (teamValEl && hit.roleVal != null) teamValEl.textContent = hit.roleFmt(hit.roleVal);
    var wrapRect   = tip.parentElement.getBoundingClientRect();
    var canvasRect = canvas.getBoundingClientRect();
    var offX = canvasRect.left - wrapRect.left;
    var offY = canvasRect.top  - wrapRect.top;
    var pw = wrapRect.width || 280, ph = wrapRect.height || 280;
    var tw = 155, th = tip.offsetHeight || 90;
    var tx = ex + offX + 14, ty = ey + offY - 40;
    if (tx + tw > pw - 4) tx = ex + offX - tw - 14;
    if (tx < 4) tx = 4;
    if (ty < 4) ty = 4;
    if (ty + th > ph - 4) ty = Math.max(4, ph - th - 4);
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    tip.style.display = 'block'; tip._lastHit = hit;
  }

  function hideTip() { tip.style.display = 'none'; tip._lastHit = null; }

  canvas.addEventListener('mousemove', function(e) {
    var r = canvas.getBoundingClientRect();
    var hit = getHit(e.clientX - r.left, e.clientY - r.top);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (hit) showTip(e.clientX - r.left, e.clientY - r.top, hit);
    else hideTip();
  });
  canvas.addEventListener('mouseleave', function() { hideTip(); canvas.style.cursor = 'default'; });
  canvas.addEventListener('click', function(e) {
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var hit = getHit(mx, my);
    if (hit) { if (tip.style.display !== 'none' && tip._lastHit === hit) hideTip(); else showTip(mx, my, hit); }
    else hideTip();
  });
  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect(); var t = e.touches[0];
    var mx = t.clientX - r.left, my = t.clientY - r.top;
    var hit = getHit(mx, my);
    if (hit) { if (tip.style.display !== 'none' && tip._lastHit === hit) hideTip(); else showTip(mx, my, hit); }
    else hideTip();
  }, {passive: false});
}
