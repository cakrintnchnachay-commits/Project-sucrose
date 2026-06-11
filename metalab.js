// ═══════════════════════════════════════════════════════════
// META LAB ENGINE (pro hero hub, reads data_2.csv)
// ═══════════════════════════════════════════════════════════

var ML_GAMES    = null;        // parsed games array (cached after first load)
var ML_TOUR     = 'All';       // active tournament filter
var ML_SORT     = 'presence';  // 'presence' | 'winrate' | 'games'
var ML_ROLE     = 'All';       // role filter
var ML_SELECTED = null;        // selected hero name
var ML_DETAIL_TAB    = 'overview';
var ML_PLAYERS_EXP   = {};     // playerName → boolean (expanded)
var ML_RADAR_COMPARE = false;  // toggle stats comparison table under radar

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

// Normalize inconsistent hero name spellings from CSV
function _mlNormalize(name) {
  if (!name) return name;
  if (name === 'FlowbornMarksman') return 'Flowborn Marksman';
  return name;
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
    for (var b = 1; b <= 4; b++) { var bn = _mlNormalize(get(row, 'A BAN ' + b)); if (bn) bansA.push(bn); }
    for (var b = 1; b <= 4; b++) { var bn = _mlNormalize(get(row, 'B BAN ' + b)); if (bn) bansB.push(bn); }

    var goldA = _mlNum(get(row, 'A Gold'));
    var goldB = _mlNum(get(row, 'B Gold'));
    if (isNaN(goldA)) goldA = 0;
    if (isNaN(goldB)) goldB = 0;

    var picks = [];
    var teamKills = {A: 0, B: 0};

    ['A', 'B'].forEach(function(S) {
      _ML_PICK_ROLES.forEach(function(R) {
        var hero   = _mlNormalize(get(row, S + ' ' + R));
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
      mvpHero:   _mlNormalize(get(row, 'MVP Hero')),
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
    var wr = Math.round(s.wr * 100);
    var wrColor = s.games > 0 ? (wr >= 60 ? 'var(--success)' : wr >= 50 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';
    var presStr = (s.presence * 100).toFixed(0) + '%';
    return '<div class="hp-item' + (isSel ? ' active' : '') + '" onclick="mlSelectHero(\'' + safeName + '\')">' +
      '<div class="hp-item-img">' + heroPortraitHtml(x.hero, 44, false) + '</div>' +
      '<div class="hp-item-body">' +
        '<div class="hp-item-name">' + x.hero.toUpperCase() +
          (isLow ? '<span style="font-size:7px;color:var(--warn);margin-left:6px;letter-spacing:0;font-family:\'DM Mono\',monospace;vertical-align:middle;">LOW N</span>' : '') +
        '</div>' +
        '<div class="hp-item-meta">' + s.games + 'G' + (s.games > 0 ? ' · ' + presStr + ' PRES' : '') + '</div>' +
      '</div>' +
      '<div class="hp-item-wr-col">' +
        '<div class="hp-item-wr" style="color:' + wrColor + ';">' + wr + '%</div>' +
        '<div class="hp-item-wr-lbl">WR</div>' +
      '</div>' +
      '<div class="hp-item-rtg">' +
        '<div class="hp-item-rtg-val" style="font-size:13px;">' + presStr + '</div>' +
        '<div class="hp-item-rtg-lbl">PRES</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Hero select ──────────────────────────────────────────────

function mlSelectHero(hero) {
  ML_SELECTED      = hero;
  ML_DETAIL_TAB    = 'overview';
  ML_PLAYERS_EXP   = {};
  ML_RADAR_COMPARE = false;
  mlRenderList();
  mlRenderDetail();
}

// ── Detail shell ─────────────────────────────────────────────

function mlRenderDetail() {
  var el = document.getElementById('ml-detail');
  if (!el) return;
  if (!ML_SELECTED) {
    el.innerHTML =
      '<div class="hd-placeholder-inner" style="min-height:300px;">' +
        '<div class="ph-title">META LAB</div>' +
        '<div class="ph-sub">SELECT A HERO FROM THE LIST</div>' +
      '</div>';
    return;
  }

  var games = mlFilteredGames();
  var stats = _mlGetStats(ML_SELECTED, games);
  var init  = ML_SELECTED.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
  var wr    = Math.round(stats.wr * 100);
  var wrColor = stats.games > 0 ? (wr >= 60 ? 'var(--success)' : wr >= 50 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';

  // Pre-compute radar data for top card
  var primaryRole  = _mlHeroPrimaryRole(ML_SELECTED, games);
  var radarCaps    = _mlHeroRadarCaps();
  var refStats     = primaryRole ? _mlProRoleRef(primaryRole, games) : null;
  var heroRadarStats = {
    wr: stats.wr, mvpRate: stats.mvpRate, kda: stats.kda,
    dmgPerMin: stats.dmgPerMin, dtkPerMin: stats.dtkPerMin, kp: stats.kp
  };

  // Compact stat mini-cells for top-left
  function miniStat(lbl, val, col) {
    return '<div>' +
      '<div style="font-family:\'DM Mono\',monospace;font-size:6px;letter-spacing:1.5px;color:var(--grey-5);">' + lbl + '</div>' +
      '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:' + (col || 'var(--white)') + ';">' + val + '</div>' +
    '</div>';
  }

  // Stats comparison table (below radar when toggled)
  var compareHtml = '';
  if (ML_RADAR_COMPARE && refStats) {
    compareHtml =
      '<div style="border-top:var(--border);margin-top:8px;font-family:\'DM Mono\',monospace;font-size:8px;">' +
        '<div style="display:grid;grid-template-columns:1fr 64px 64px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.07);">' +
          '<div style="color:var(--grey-4);font-size:7px;letter-spacing:1px;">STAT</div>' +
          '<div style="color:rgba(100,180,255,0.9);text-align:right;font-size:7px;letter-spacing:1px;">HERO</div>' +
          '<div style="color:rgba(80,220,140,0.9);text-align:right;font-size:7px;letter-spacing:1px;">' + (primaryRole || 'ROLE') + ' AVG</div>' +
        '</div>' +
        _ML_HERO_RADAR_AXES.map(function(ax) {
          var hv = heroRadarStats[ax.key];
          var rv = refStats[ax.key];
          return '<div style="display:grid;grid-template-columns:1fr 64px 64px;padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);">' +
            '<div style="color:var(--grey-5);">' + ax.label.toUpperCase() + '</div>' +
            '<div style="color:rgba(100,180,255,0.9);text-align:right;">' + (hv!=null&&!isNaN(hv)?ax.fmt(hv):'—') + '</div>' +
            '<div style="color:rgba(80,220,140,0.9);text-align:right;">' + (rv!=null&&!isNaN(rv)?ax.fmt(rv):'—') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  // Right column: radar chart
  var radarHtml;
  if (stats.games > 0) {
    radarHtml =
      '<div class="hd-radar-section-hdr">' +
        '<span class="hd-radar-section-title">STYLE PROFILE</span>' +
        (primaryRole ? '<span class="hd-radar-section-sub"> · ' + primaryRole + '</span>' : '') +
      '</div>' +
      '<div class="hd-radar-canvas-wrap" style="flex:1;min-height:220px;position:relative;">' +
        '<canvas id="ml-hero-radar-canvas" width="280" height="280" style="width:100%;max-width:280px;display:block;margin:0 auto;"></canvas>' +
        '<div class="hd-radar-tip" id="ml-hero-radar-tip">' +
          '<div class="hd-radar-tip-lbl" id="ml-hero-radar-tip-lbl"></div>' +
          '<div class="hd-radar-tip-val" id="ml-hero-radar-tip-val"></div>' +
          '<div class="hd-radar-tip-team" id="ml-hero-radar-tip-team" style="display:none;">' +
            '<span class="hd-radar-tip-team-lbl">ROLE AVG</span>' +
            '<span class="hd-radar-tip-team-val" id="ml-hero-radar-tip-teamval"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hd-radar-legend">' +
        '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(100,180,255,0.9);"></div>' + ML_SELECTED.split(' ')[0] + '</div>' +
        (refStats ? '<div class="hd-radar-legend-item"><div class="hd-radar-legend-line" style="background:rgba(80,220,140,0.7);"></div>' + (primaryRole || 'Role') + ' Avg</div>' : '') +
      '</div>' +
      '<div style="text-align:center;margin-top:6px;">' +
        '<button class="tier-mode-btn' + (ML_RADAR_COMPARE ? ' active' : '') + '" style="font-size:7px;padding:4px 10px;" onclick="ML_RADAR_COMPARE=!ML_RADAR_COMPARE;mlRenderDetail();">⇄ COMPARE STATS</button>' +
      '</div>' +
      compareHtml;
  } else {
    radarHtml = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--grey-5);font-family:\'DM Mono\',monospace;font-size:9px;">NO GAMES YET</div>';
  }

  // Top layout — portrait left + radar right
  var topHtml =
    '<div class="hd-top-layout">' +
      '<div class="hd-top-left">' +
        '<div class="hd-square-portrait">' +
          '<div class="hd-square-portrait-fallback">' + init + '</div>' +
          (heroImgUrl(ML_SELECTED) ? '<img class="hd-square-portrait-img" src="' + heroImgUrl(ML_SELECTED) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
        '</div>' +
        '<div class="hd-top-hero-name">' + ML_SELECTED.toUpperCase() + '</div>' +
        '<div class="hd-hdr-meta">' + stats.games + ' games · ' + (stats.presence * 100).toFixed(0) + '% presence</div>' +
        '<div class="hd-top-badges">' +
          '<span class="hd-badge-pool">PRO DATA</span>' +
          (stats.games < 10 ? '<span class="hd-badge-main" style="color:var(--warn);background:rgba(255,204,68,0.1);border-color:rgba(255,204,68,0.35);">LOW SAMPLE</span>' : '') +
        '</div>' +
        '<div style="margin-top:auto;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;">' +
          miniStat('WIN RATE', wr + '%', wrColor) +
          miniStat('PICK RATE', (stats.pickRate * 100).toFixed(0) + '%', 'var(--white)') +
          miniStat('BAN RATE', (stats.banRate * 100).toFixed(0) + '%', 'var(--white)') +
          miniStat('KDA', stats.games > 0 ? stats.kda.toFixed(2) : '—', 'var(--white)') +
        '</div>' +
      '</div>' +
      '<div class="hd-top-right" style="padding:10px 12px;display:flex;flex-direction:column;">' +
        radarHtml +
      '</div>' +
    '</div>';

  // Tab bar — no Style tab
  if (ML_DETAIL_TAB === 'style') ML_DETAIL_TAB = 'overview';
  var tabLabels = {overview:'Overview', stats:'Stats', players:'Players', matchups:'Matchups'};
  var tabBar =
    '<div class="hero-role-tabs">' +
    ['overview','stats','players','matchups'].map(function(t) {
      return '<button class="hero-role-tab' + (t === ML_DETAIL_TAB ? ' active' : '') + '" onclick="ML_DETAIL_TAB=\'' + t + '\';mlRenderDetail();">' + tabLabels[t] + '</button>';
    }).join('') +
    '</div>';

  var body;
  if      (ML_DETAIL_TAB === 'overview')  body = _mlOverview(stats);
  else if (ML_DETAIL_TAB === 'stats')     body = _mlStats(stats);
  else if (ML_DETAIL_TAB === 'players')   body = _mlPlayers(games);
  else if (ML_DETAIL_TAB === 'matchups')  body = _mlMatchups(games);
  else body = '';

  el.innerHTML = topHtml + tabBar + body;

  // Draw radar after DOM update
  if (stats.games > 0) {
    setTimeout(function() { mlDrawHeroRadar(heroRadarStats, refStats, radarCaps); }, 30);
  }
}

// ── Formatters ───────────────────────────────────────────────

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

// ── Shared rendering primitives ───────────────────────────────

function _mlStatBox(lbl, val, sub) {
  return '<div class="hd-stat-box">' +
    '<div class="hd-stat-box-val">' + val + '</div>' +
    '<div class="hd-stat-box-lbl">' + lbl + '</div>' +
    (sub ? '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-4);margin-top:2px;">' + sub + '</div>' : '') +
  '</div>';
}

function _mlAltCell(lbl, val) {
  return '<div class="hd-alltime-cell">' +
    '<div class="hd-alltime-val">' + val + '</div>' +
    '<div class="hd-alltime-lbl">' + lbl + '</div>' +
  '</div>';
}

function _mlSectionHdr(title, sub) {
  return '<div class="hd-alltime-header">' +
    '<span class="hd-alltime-title">' + title + '</span>' +
    (sub ? '<span class="hd-alltime-sub"> · ' + sub + '</span>' : '') +
  '</div>';
}

function _mlSectionLbl(text) {
  return '<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--grey-5);letter-spacing:2px;padding:10px 14px 4px;border-bottom:var(--border);">' + text + '</div>';
}

// ── Overview tab ─────────────────────────────────────────────

function _mlOverview(s) {
  return '<div class="hd-stat-boxes">' +
    _mlStatBox('WIN RATE',   _mlPct(s.wr, 1),       s.wins + '/' + s.games + ' games') +
    _mlStatBox('PICK RATE',  _mlPct(s.pickRate, 1),  s.games + ' picks') +
    _mlStatBox('BAN RATE',   _mlPct(s.banRate, 1),   s.bans + ' bans') +
    _mlStatBox('PRESENCE',   _mlPct(s.presence, 1),  'pick + ban') +
    _mlStatBox('GAMES',      String(s.games),          s.games < 10 ? 'low sample' : '') +
    _mlStatBox('MVP RATE',   _mlPct(s.mvpRate, 1),   '') +
  '</div>';
}

// ── Stats tab ────────────────────────────────────────────────

function _mlStats(s) {
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
      _mlAltCell('WR (BLUE)',    s.wrBlue != null ? _mlPct(s.wrBlue, 1) : '—') +
      _mlAltCell('WR (RED)',     s.wrRed  != null ? _mlPct(s.wrRed,  1) : '—') +
      _mlAltCell('AVG LENGTH',   _mlF(s.avgDur, 1, 'm')) +
      _mlAltCell('PICK RATE',    _mlPct(s.pickRate, 1)) +
      _mlAltCell('BAN RATE',     _mlPct(s.banRate, 1)) +
      _mlAltCell('PRESENCE',     _mlPct(s.presence, 1)) +
    '</div>'
  );
}

// ── Hero card radar (blue-green, position reference) ─────────

var _ML_HERO_RADAR_AXES = [
  {key:'wr',        label:'Win Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'mvpRate',   label:'MVP Rate',  fmt:function(v){return Math.round(v*100)+'%';}},
  {key:'kda',       label:'KDA',       fmt:function(v){return v.toFixed(2);}},
  {key:'dmgPerMin', label:'DMG/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'dtkPerMin', label:'DTK/min',   fmt:function(v){return (v/1000).toFixed(1)+'k';}},
  {key:'kp',        label:'Kill Part', fmt:function(v){return v.toFixed(0)+'%';}}
];

function _mlHeroPrimaryRole(hero, games) {
  var roleCount = {};
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.hero === hero && pk.role) roleCount[pk.role] = (roleCount[pk.role] || 0) + 1;
    });
  });
  var keys = Object.keys(roleCount);
  if (!keys.length) return null;
  return keys.reduce(function(a, b) { return roleCount[a] > roleCount[b] ? a : b; });
}

function _mlProRoleRef(role, games) {
  var allH = _mlAllHeroes(games);
  var keys = ['wr','mvpRate','kda','dmgPerMin','dtkPerMin','kp'];
  var sums = {wr:0,mvpRate:0,kda:0,dmgPerMin:0,dtkPerMin:0,kp:0};
  var cnts = {wr:0,mvpRate:0,kda:0,dmgPerMin:0,dtkPerMin:0,kp:0};
  allH.forEach(function(h) {
    var s = mlHeroStatsForRole(h, games, role);
    if (s.games < 3) return;
    keys.forEach(function(k) {
      if (s[k] != null && !isNaN(s[k])) { sums[k] += s[k]; cnts[k]++; }
    });
  });
  var result = {};
  keys.forEach(function(k) { result[k] = cnts[k] > 0 ? sums[k] / cnts[k] : null; });
  return result;
}

function _mlHeroRadarCaps() {
  return {wr: 0.75, mvpRate: 0.30, kda: 5, dmgPerMin: 7500, dtkPerMin: 7500, kp: 75};
}

function mlDrawHeroRadar(heroStats, refStats, caps) {
  var canvas = document.getElementById('ml-hero-radar-canvas');
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var dW = canvas.offsetWidth || 280, dH = canvas.offsetHeight || 280;
  canvas.width = dW * dpr; canvas.height = dH * dpr;
  canvas.style.width = dW + 'px'; canvas.style.height = dH + 'px';
  var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  var n = _ML_HERO_RADAR_AXES.length;
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
    _ML_HERO_RADAR_AXES.forEach(function(ax,i){var frac=Math.max(norm(vals[ax.key],ax.key),0.03);var p=pt(i,R*frac);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});
    ctx.closePath();ctx.fillStyle=fillCol;ctx.fill();ctx.strokeStyle=strokeCol;ctx.lineWidth=2;ctx.stroke();
    _ML_HERO_RADAR_AXES.forEach(function(ax,i){if(vals[ax.key]==null)return;var frac=Math.max(norm(vals[ax.key],ax.key),0.03);var p=pt(i,R*frac);ctx.beginPath();ctx.arc(p.x,p.y,dotR,0,Math.PI*2);ctx.fillStyle=dotCol;ctx.fill();});
  }
  if(refStats) drawPoly(refStats,'rgba(80,220,140,0.08)','rgba(80,220,140,0.5)','rgba(80,220,140,0.75)',3);
  drawPoly(heroStats,'rgba(100,180,255,0.15)','rgba(100,180,255,0.95)','rgba(100,180,255,1)',4.5);
  // Labels drawn last so they sit above polygons
  _ML_HERO_RADAR_AXES.forEach(function(ax,i){
    var p=pt(i,R+42);var val=heroStats[ax.key];
    ctx.textAlign='center';
    ctx.font='500 9px DM Sans,sans-serif';ctx.fillStyle='rgba(255,255,255,0.6)';ctx.fillText(ax.label,p.x,p.y);
    if(val!=null&&!isNaN(val)){ctx.font='bold 10.5px "Bebas Neue",sans-serif';ctx.fillStyle='rgba(100,180,255,1)';ctx.fillText(ax.fmt(val),p.x,p.y+13);}
  });
  // Store hit zones for hover interactivity
  window._mlHeroRadarHits = _ML_HERO_RADAR_AXES.map(function(ax,i){
    var val = heroStats[ax.key]; if(val==null||isNaN(val)) return null;
    var p = pt(i, R * Math.max(norm(val, ax.key), 0.03));
    return {x:p.x, y:p.y, label:ax.label, value:val, fmt:ax.fmt,
            roleVal:refStats?refStats[ax.key]:null, roleFmt:ax.fmt};
  }).filter(Boolean);
  _mlSetupHeroRadarEvents();
}

function _mlSetupHeroRadarEvents() {
  var canvas = document.getElementById('ml-hero-radar-canvas');
  var tip    = document.getElementById('ml-hero-radar-tip');
  if (!canvas || !tip) return;

  function getHit(mx, my) {
    var hits = window._mlHeroRadarHits || [];
    var best = null, bestD = Infinity;
    hits.forEach(function(h) {
      var d = Math.hypot(h.x - mx, h.y - my);
      if (d < bestD && d < 24) { best = h; bestD = d; }
    });
    return best;
  }

  function showTip(ex, ey, hit) {
    var lblEl    = document.getElementById('ml-hero-radar-tip-lbl');
    var valEl    = document.getElementById('ml-hero-radar-tip-val');
    var teamRow  = document.getElementById('ml-hero-radar-tip-team');
    var teamValEl= document.getElementById('ml-hero-radar-tip-teamval');
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

// ── Players tab ──────────────────────────────────────────────

var _ML_TEAM_LOGOS = {
  BAC: 'https://cdnr.escharts.com/uploads/public/633/180/963/6331809632832834626864.png',
  EA:  'https://cdnr.escharts.com/uploads/public/641/d93/139/641d931390169216480804.png',
  TEN: 'https://cdnr.escharts.com/uploads/public/696/441/177/696441177637d478458365.png',
  HD:  'https://cdnr.escharts.com/uploads/public/65b/8ab/67d/65b8ab67d3130531356310.png',
  FS:  'https://cdnr.escharts.com/uploads/public/670/bcf/c23/670bcfc235e78874074390.png',
  KOG: 'https://cdnr.escharts.com/uploads/public/65b/8ab/2e6/65b8ab2e6c191639738634.png',
  BRU: 'https://cdnr.escharts.com/uploads/public/698/e5d/003/698e5d0030bd1935492008.png',
  SLX: 'https://cdnr.escharts.com/uploads/public/696/19e/221/69619e2214035062986431.png',
  GJC: 'https://cdn-api.pandascore.co/images/team/image/138019/godji_check_allmode.png',
  FW:  'https://cdnr.escharts.com/uploads/public/5e3/9ff/28d/5e39ff28df00d239605591.png',
  BMG: 'https://cdnr.escharts.com/uploads/public/65d/ede/d85/65deded853423327188368.png',
  ONE: 'https://cdnr.escharts.com/uploads/public/632/9e8/1c6/6329e81c623c2125032095.png',
  HKA: 'https://cdnr.escharts.com/uploads/public/5ce/598/81c/5ce59881cbc48326077977.png',
  ANK: 'https://cdnr.escharts.com/uploads/public/65d/edf/029/65dedf029c6ef904387850.png',
  DCG: 'https://cdnr.escharts.com/uploads/public/659/be1/e66/659be1e66fffd240293207.png',
  LIT: 'https://cdnr.escharts.com/uploads/public/696/659/26d/69665926d712f401697976.png',
  SGP: 'https://cdnr.escharts.com/uploads/public/665/232/a25/665232a257ceb043723956.png',
  '1S':'https://cdnr.escharts.com/uploads/public/65d/ef7/7d4/65def77d41f86056197699.png',
  FPT: 'https://cdnr.escharts.com/uploads/public/5ba/238/e7f/5ba238e7f2dca149694156.png',
  GAM: 'https://cdnr.escharts.com/uploads/public/697/d4d/92e/697d4d92e1716581967983.png',
  SPN: 'https://cdnr.escharts.com/uploads/public/682/1ea/474/6821ea474b5b2434399793.png',
  BOX: 'https://cdnr.escharts.com/uploads/public/68d/ecc/251/68decc2513852541929810.png',
  FPL: 'https://cdnr.escharts.com/uploads/public/67b/c39/f27/67bc39f27dcb9554580293.png',
  TS:  'https://cdnr.escharts.com/uploads/public/5ce/819/ef4/5ce819ef4ad89755496819.png'
};

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

  var playerTeam = {};
  games.forEach(function(g) {
    g.picks.forEach(function(pk) {
      if (pk.player && g.teams && g.teams[pk.side]) {
        playerTeam[pk.player] = g.teams[pk.side];
      }
    });
  });

  var rows = Object.keys(playerMap).map(function(k) { return playerMap[k]; })
    .sort(function(a, b) { return b.games - a.games; });

  if (!rows.length) {
    return '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--grey-5);padding:14px;">No picks found</div>';
  }

  var rosterPlayers = (typeof getPlayers === 'function') ? getPlayers() : [];

  return rows.map(function(r, idx) {
    var expanded = ML_PLAYERS_EXP[idx];
    var wr = r.games > 0 ? r.wins / r.games : 0;
    var wrColor = r.games > 0 ? (wr >= 0.6 ? 'var(--success)' : wr >= 0.5 ? 'var(--white)' : 'var(--danger)') : 'var(--grey-5)';
    var rP = rosterPlayers.find(function(p) { return p.ign && p.ign.toLowerCase() === r.player.toLowerCase(); });
    var nameHtml = rP
      ? '<span style="cursor:pointer;color:rgba(100,180,255,0.9);" onclick="event.stopPropagation();showProfile(\'' + rP.id + '\')">' + r.player + '</span>'
      : r.player;

    var ps = expanded ? mlPlayerHeroStats(r.player, ML_SELECTED, games) : null;
    var expBody = '';
    if (expanded && ps) {
      expBody =
        '<div class="hd-alltime-grid" style="border-top:var(--border);margin:0;">' +
          _mlAltCell('WR',         _mlPct(ps.wr, 1)) +
          _mlAltCell('KDA',        _mlF(ps.kda, 2)) +
          _mlAltCell('KILLS/MIN',  _mlF(ps.killsPerMin, 2)) +
          _mlAltCell('DEATHS/MIN', _mlF(ps.deathsPerMin, 2)) +
          _mlAltCell('MIN/DEATH',  _mlF(ps.minPerDeath, 2)) +
          _mlAltCell('DMG/MIN',    _mlFk(ps.dmgPerMin)) +
          _mlAltCell('DTK/MIN',    _mlFk(ps.dtkPerMin)) +
          _mlAltCell('KP%',        _mlPct(ps.kp / 100, 1)) +
          _mlAltCell('MVP RATE',   _mlPct(ps.mvpRate, 1)) +
          _mlAltCell('AVG LEN',    _mlF(ps.avgDur, 1, 'm')) +
        '</div>';
    }

    var teamAbbr = playerTeam[r.player] || '';
    var logoUrl  = _ML_TEAM_LOGOS[teamAbbr] || '';
    var avatarHtml = logoUrl
      ? '<img src="' + logoUrl + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;flex-shrink:0;" onerror="this.style.display=\'none\'">'
      : '<div style="width:28px;height:28px;border-radius:50%;background:var(--grey-8);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--grey-5);margin-right:10px;flex-shrink:0;">' + (r.player[0]||'?') + '</div>';

    return '<div style="border-bottom:var(--border);">' +
      '<div class="hd-player-row" style="padding:10px 14px;cursor:pointer;" onclick="ML_PLAYERS_EXP[' + idx + ']=!ML_PLAYERS_EXP[' + idx + '];mlRenderDetail();">' +
        avatarHtml +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;">' + nameHtml + '</div>' +
          '<div class="hd-wl">' + r.games + ' games · ' + r.wins + 'W / ' + (r.games - r.wins) + 'L</div>' +
        '</div>' +
        '<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:' + wrColor + ';margin-right:10px;">' + Math.round(wr * 100) + '%</div>' +
        '<div style="color:var(--grey-5);font-size:10px;">' + (expanded ? '▲' : '▼') + '</div>' +
      '</div>' +
      expBody +
    '</div>';
  }).join('');
}

// ── Matchups tab — allies and enemies side by side ────────────

function _mlMatchups(games) {
  var allyMap = {}, enemyMap = {};
  games.forEach(function(g) {
    var myPick = null;
    g.picks.forEach(function(pk) { if (pk.hero === ML_SELECTED) myPick = pk; });
    if (!myPick) return;
    var myWon = (g.winSide === myPick.side);
    g.picks.forEach(function(pk) {
      if (pk.hero === ML_SELECTED || !pk.hero) return;
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
