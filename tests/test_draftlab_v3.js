// Draft Lab v3 — node regression tests
// run: node tests/test_draftlab_v3.js
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

// ── minimal browser stubs ────────────────────────────────────
var ctx = {
  window: {},
  document: {
    getElementById: function(){ return null; },
    addEventListener: function(){},
    createElement: function(){ return {textContent:'', id:''}; },
    head: {appendChild: function(){}}
  },
  localStorage: {getItem: function(){ return null; }, setItem: function(){}},
  setInterval: function(){ return 0; }, clearInterval: function(){},
  setTimeout: function(fn){ return 0; }, console: console, Math: Math,
  fetch: function(){ return {then: function(){ return {then: function(){ return {catch: function(){}}; }}; }}; }
};
ctx.global = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'draftlab.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'metalab.js'), 'utf8'), ctx);

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// ── synthetic game builder ───────────────────────────────────
// picksA/picksB: [[hero, role, player], ...] ×5
function mkGame(winSide, week, teamA, teamB, picksA, picksB, bansA, bansB) {
  var picks = [];
  picksA.forEach(function(p){ picks.push({side:'A', role:p[1], hero:p[0], player:p[2]||''}); });
  picksB.forEach(function(p){ picks.push({side:'B', role:p[1], hero:p[0], player:p[2]||''}); });
  return {winSide: winSide, week: week, teams: {A: teamA, B: teamB},
          bans: {A: bansA||[], B: bansB||[]}, picks: picks};
}
var R = ['DSL','JUG','MID','ADL','SUP'];
// filler comps so every game has 5v5 with role coverage
function comp(prefix, mid, jug, sup, players) {
  players = players || {};
  return [
    [prefix+'Dsl', 'DSL', players.DSL||''],
    [jug || prefix+'Jug', 'JUG', players.JUG||''],
    [mid || prefix+'Mid', 'MID', players.MID||''],
    [prefix+'Adl', 'ADL', players.ADL||''],
    [sup || prefix+'Sup', 'SUP', players.SUP||'']
  ];
}

var games = [];
// 1) Emid: strong meta mid on team ET (12G, 9W), played by Wide
//    Cmid: beats Emid cross-side 6 shared games, 5 wins (thin counter)
for (var i = 0; i < 6; i++) {
  // Cmid (side A, team XX) vs Emid (side B, team ET); A wins 5/6
  games.push(mkGame(i < 5 ? 'A' : 'B', 'w6d1', 'XX', 'ET',
    comp('a', 'Cmid', null, null),
    comp('b', 'Emid', null, null, {MID:'Wide'})));
}
// Emid wins 8 more on other weeks (→ 14G 9W, shrunk WR ≥ .55)
for (var i = 0; i < 8; i++) {
  games.push(mkGame('A', 'w5d2', 'ET', 'YY',
    comp('c', 'Emid', null, null),
    comp('d', 'Dmid', null, null)));
}
// 2) combo data: Duo1+BlueJg ally pair 10G 9W (one dominant duo)…
for (var i = 0; i < 10; i++) {
  games.push(mkGame(i < 9 ? 'A' : 'B', 'w6d2', 'XX', 'YY',
    [['Duo1','ADL',''],['BlueJg','JUG',''],['eMid','MID',''],['eDsl','DSL',''],['eSup','SUP','']],
    comp('f', null, null, null)));
}
// …and each also 8 mediocre games apart (3W) so the duo beats expectation
for (var i = 0; i < 8; i++) {
  games.push(mkGame(i < 3 ? 'A' : 'B', 'w5d1', 'XX', 'YY',
    [['Duo1','ADL',''],[i < 4 ? 'u1' : 'u2','JUG',''],['eMid','MID',''],['eDsl','DSL',''],['eSup','SUP','']],
    comp('f', null, null, null)));
  games.push(mkGame(i < 3 ? 'A' : 'B', 'w5d1', 'XX', 'YY',
    [[i < 4 ? 'u3' : 'u4','ADL',''],['BlueJg','JUG',''],['eMid','MID',''],['eDsl','DSL',''],['eSup','SUP','']],
    comp('f', null, null, null)));
}
// Annette-like 'Anny': positive lift with 4 different partners (8G 6W each;
// partners lose elsewhere so the pairs beat expectation)
['P1','P2','P3','P4'].forEach(function(pn) {
  for (var i = 0; i < 8; i++) {
    games.push(mkGame(i < 6 ? 'A' : 'B', 'w4d1', 'XX', 'YY',
      [['Anny','SUP',''],[pn,'JUG',''],['gMid','MID',''],['gDsl','DSL',''],['gAdl','ADL','']],
      comp('h', null, null, null)));
  }
  for (var i = 0; i < 6; i++) {
    games.push(mkGame('B', 'w4d2', 'XX', 'YY',
      [[pn,'JUG',''],['gSup','SUP',''],['gMid','MID',''],['gDsl','DSL',''],['gAdl','ADL','']],
      comp('h', null, null, null)));
  }
});
// 3) recency: HeroOld 8G only in w1, HeroNew 8G only in po
for (var i = 0; i < 8; i++) {
  games.push(mkGame(i < 4 ? 'A' : 'B', 'w1d1', 'QQ', 'WW',
    [['HeroOld','MID',''],['q2','JUG',''],['q3','DSL',''],['q4','ADL',''],['q5','SUP','']],
    comp('w', null, null, null)));
  games.push(mkGame(i < 4 ? 'A' : 'B', 'po1', 'QQ', 'WW',
    [['HeroNew','MID',''],['q2','JUG',''],['q3','DSL',''],['q4','ADL',''],['q5','SUP','']],
    comp('w', null, null, null)));
}
// 4) key player: ET's 'Star' 12G concentrated on 2 heroes, high WR;
//    'Wide' (mid, above) spread across heroes. Steal hero: Ssup (SUP) comfort of Star.
for (var i = 0; i < 6; i++) {
  games.push(mkGame(i < 5 ? 'A' : 'B', 'w6d3', 'ET', 'ZZ',
    comp('m', null, 'StarJg', null, {JUG:'Star'}),
    comp('n', null, null, null)));
  games.push(mkGame(i < 4 ? 'A' : 'B', 'w7d1', 'ET', 'ZZ',
    comp('m', null, null, 'Ssup', {SUP:'Star'}),
    comp('n', null, null, null)));
}
// 5) flex hero: Flexy ≥5G in two roles
for (var i = 0; i < 5; i++) {
  games.push(mkGame(i < 3 ? 'A' : 'B', 'w6d1', 'QQ', 'WW',
    [['Flexy','DSL',''],['r2','JUG',''],['r3','MID',''],['r4','ADL',''],['r5','SUP','']],
    comp('s', null, null, null)));
  games.push(mkGame(i < 3 ? 'A' : 'B', 'w6d2', 'QQ', 'WW',
    [['Flexy','JUG',''],['r3b','MID',''],['r2b','DSL',''],['r4','ADL',''],['r5','SUP','']],
    comp('s', null, null, null)));
}

// 6) MY-TEAM comfort: our team XX's player 'Ace' on 'TeamPick' (MID) 6G 5W
//    (good WR → boosted); 'Bad' on 'XXLowWR' (DSL) 8G 2W (poor → demoted)
for (var i = 0; i < 6; i++) {
  games.push(mkGame(i < 5 ? 'A' : 'B', 'w6d4', 'XX', 'YY',
    [['xDsl','DSL',''],['xJug','JUG',''],['TeamPick','MID','Ace'],['xAdl','ADL',''],['xSup','SUP','']],
    comp('tp', null, null, null)));
}
for (var i = 0; i < 8; i++) {
  games.push(mkGame(i < 2 ? 'A' : 'B', 'w6d4', 'XX', 'YY',
    [['XXLowWR','DSL','Bad'],['xJug2','JUG',''],['xMid2','MID',''],['xAdl2','ADL',''],['xSup2','SUP','']],
    comp('lw', null, null, null)));
}
// 7) breadth: 'Multi' (side A, XX) faces 'En1' & 'En2' (side B) 5 shared G, A wins 4
//    → Multi counters both enemies (utility = 2 when both are enemy picks)
for (var i = 0; i < 5; i++) {
  games.push(mkGame(i < 4 ? 'A' : 'B', 'w6d5', 'XX', 'YY',
    [['Multi','ADL',''],['m2','JUG',''],['m3','MID',''],['m4','DSL',''],['m5','SUP','']],
    [['En1','SUP',''],['En2','MID',''],['n3','JUG',''],['n4','DSL',''],['n5','ADL','']]));
}

// ── boot draft lab on synthetic data ─────────────────────────
ctx.DL_GAMES = games;
ctx.DL_AGG = ctx._dlBuildAgg(games);
ctx.DL_TIMER_ON = false;

console.log('— canonical names —');
eq(ctx.dlCanon('WuKong'), 'Wukong', 'WuKong → Wukong');
eq(ctx.dlCanon('Diao chan'), 'Diaochan', 'Diao chan → Diaochan');
eq(ctx.dlCanon('FlowbornMage'), 'Flowborn (Mage)', 'Flowborn alias intact');
eq(ctx._mlNormalize('WuKong'), 'Wukong', 'metalab WuKong → Wukong');
eq(ctx._mlNormalize('Diao chan'), 'Diaochan', 'metalab Diao chan → Diaochan');

console.log('— week buckets & recency —');
eq(ctx._dlWeekBucket('w3d2'), 'W3', 'w3d2 → W3');
eq(ctx._dlWeekBucket('po2'), 'PO', 'po2 → PO');
eq(ctx._dlWeekBucket(''), null, 'empty → null');
ok(ctx._dlWPresence('HeroNew') > ctx._dlWPresence('HeroOld') * 1.5,
   'PO hero outweighs W1 hero in weighted presence');
ok(Math.abs(ctx._dlPresence('HeroNew') - ctx._dlPresence('HeroOld')) < 1e-9,
   'unweighted presence equal for equal games');

console.log('— counter lift thresholds —');
var C = ctx.dlCounterLift('Cmid', 'Emid');
ok(C && C.lift > 0.04, 'Cmid counters Emid (lift ' + (C && C.lift.toFixed(3)) + ')');
ok(C && C.thin === true, '6 shared games marked thin');
ok(ctx.dlCounterLift('Cmid', 'Dmid') === null, '<4 shared games → null');

console.log('— combo excess lift (Annette fix) —');
var Lduo = ctx.dlExcessLift('Duo1', 'BlueJg');
var Lann = ctx.dlExcessLift('Anny', 'P1');
ok(Lduo && Lduo.lift > 0.05, 'Duo1+BlueJg raw lift positive');
ok(Lduo && Lduo.excess > Lduo.lift * 0.5, 'single dominant duo keeps most of its lift');
ok(Lann && Lann.excess < Lann.lift * 0.7, 'lifts-everyone hero gets centred down');
ok(Lduo.excess > Lann.excess, 'specific duo outranks generic synergy hero');

console.log('— key player detection —');
var kp = ctx.dlKeyPlayer('ET');
ok(kp && kp.ign === 'Star', 'Star (narrow pool, high WR) is the ban target, got ' + (kp && kp.ign));

console.log('— draft engine regression —');
ctx.DL_FORMAT = 1; ctx.DL_MODE = 'standard';
ctx.dlResetSeries(); ctx.dlNewDraft();
ctx.DL_TEAM.B = 'XX'; ctx.DL_TEAM.R = 'ET'; ctx.DL_US = 'B';
ctx.dlSkipBan(); ctx.dlSkipBan(); ctx.dlSkipBan(); ctx.dlSkipBan();  // 4 bans
eq(ctx.dlCurStep().type, 'pick', 'after 4 bans → pick phase');
ctx.dlApply('BlueJg');                       // BP1
ctx.dlApply('Emid'); ctx.dlApply('bSup');    // RP1 RP2
eq(ctx.dlCurStep().side, 'B', 'sequence reaches BP2');
ok(!ctx.dlAvailable('BlueJg'), 'no mirror picks');
ok(!ctx.dlAvailable('Emid'), 'enemy pick dead for us too');

console.log('— pick sections —');
var sec = ctx.dlIntelSections();
ok(sec && sec.sections.length >= 2, 'pick step has ≥2 sections');
function findSec(s, key){ return s.sections.find(function(x){ return x.key === key; }); }
var ctr = findSec(sec, 'counter');
ok(ctr && ctr.items.some(function(it){ return it.hero === 'Cmid'; }), 'COUNTER section lists Cmid vs Emid');
ok(ctr && ctr.items.every(function(it){ return it.reason.indexOf('Beats') === 0 || it.reason.indexOf('Beats') > 0; }), 'counter reasons in plain language');
var cmb = findSec(sec, 'combo');
ok(cmb && cmb.items.some(function(it){ return it.hero === 'Duo1'; }), 'COMBO section lists Duo1 with BlueJg');
var mta = findSec(sec, 'meta');
ok(mta && mta.items.length > 0, 'META section non-empty');
var stl = findSec(sec, 'steal');
ok(stl && stl.items.some(function(it){ return it.hero === 'Ssup'; }), 'STEAL section lists Ssup (Star comfort, SUP open)');
// role-need filter: JUG taken by BlueJg → no JUG-only candidates
ok(sec.sections.every(function(s) {
  return s.items.every(function(it){ return it.roles.some(function(r){ return ['DSL','MID','ADL','SUP'].indexOf(r) >= 0; }); });
}), 'suggestions respect remaining roles');

console.log('— threat flags —');
var th = ctx.dlThreats();
ok(th.some(function(t){ return t.hero === 'Emid'; }), 'high-WR unanswered Emid flagged');
var tE = th.find(function(t){ return t.hero === 'Emid'; });
ok(tE && tE.answers.some(function(a){ return a.hero === 'Cmid'; }), 'Cmid offered as answer');

console.log('— ban sections —');
ctx.dlNewDraft();                            // back to BB1
ctx.DL_TEAM.B = 'XX'; ctx.DL_TEAM.R = 'ET'; ctx.DL_US = 'B';
var bsec = ctx.dlIntelSections();
ok(bsec && bsec.label.indexOf('DENY ET') >= 0, 'ban label names the denied team');
ok(bsec.kp && bsec.kp.ign === 'Star', 'key player shown on ban step');
var tgt = findSec(bsec, 'target');
ok(tgt && tgt.items.length > 0, 'TARGET section non-empty');
ok(tgt && tgt.items.every(function(it){ return it.reason.indexOf("Star's pool") === 0; }), 'target reasons reference Star');
var fx = findSec(bsec, 'flex');
ok(fx && fx.items.some(function(it){ return it.hero === 'Flexy'; }), 'DENY FLEX lists Flexy');
var mb = findSec(bsec, 'metaban');
ok(mb && mb.items.length > 0, 'META BAN non-empty');
// phase-1: no enemy picks → no BREAK section
ok(!findSec(bsec, 'break'), 'no BREAK COMBO before enemy picks');

console.log('— flat adapter (grid highlight) —');
var flat = ctx.dlSuggestions(6);
ok(flat.items.length > 0 && flat.items.length <= 6, 'flat suggestions bounded');
ok(flat.items.every(function(it){ return it.hero; }), 'flat items carry hero names');

console.log('— breadth (Part A: always on, no team mode) —');
ctx.DL_TEAM_MODE = false;
ctx.DL_FORMAT = 1; ctx.DL_MODE = 'standard';
ctx.dlResetSeries(); ctx.dlNewDraft();
ctx.DL_TEAM.B = 'XX'; ctx.DL_TEAM.R = 'YY'; ctx.DL_US = 'B';
ctx.dlSkipBan(); ctx.dlSkipBan(); ctx.dlSkipBan(); ctx.dlSkipBan();
ctx.dlApply('m2');                            // BP1 (our jungle)
ctx.dlApply('En1'); ctx.dlApply('En2');       // RP1 RP2 (enemy locks)
eq(ctx._dlUtilityCount('Multi', 'B'), 2, 'Multi counters 2 enemy locks');
ok(ctx._dlPickAdjust('Multi', 'B') > 1, 'breadth boosts adjust with team mode OFF');
ok(Math.abs(ctx._dlPickAdjust('HeroOld', 'B') - 1) < 1e-9, 'no breadth + no team → adjust = 1');

console.log('— My Team comfort (Part B: toggle) —');
ctx.DL_TEAM_MODE = false;
ok(!findSec(ctx.dlIntelSections(), 'team'), 'no TEAM section when mode off');
var cOff = findSec(ctx.dlIntelSections(), 'counter');
ctx.DL_TEAM_MODE = true;
var secTM = ctx.dlIntelSections();
var tmSec = findSec(secTM, 'team');
ok(tmSec, 'TEAM section present in My Team mode');
ok(tmSec && tmSec.items.some(function(it){ return it.hero === 'TeamPick'; }), 'TEAM lists our comfort TeamPick');
var keys = secTM.sections.map(function(s){ return s.key; });
ok(keys.indexOf('team') > keys.indexOf('counter'), 'TEAM sits after COUNTER (comfort never leads)');
var cOn = findSec(secTM, 'counter');
ok(cOff && cOn && cOff.items.length === cOn.items.length, 're-ranks but never drops a counter hero');

console.log('— team proficiency + centered/bounded tiebreaker —');
var tp = ctx._dlTeamProf('XX', 'TeamPick');
ok(tp && tp.g === 6 && tp.w === 5, 'team prof sums games/wins across roster');
ok(ctx._dlTeamProf('XX', 'nope') === null, 'hero with no team history → null');
ok(ctx._dlPickAdjust('TeamPick', 'B') > 1, 'good-WR comfort hero boosted');
ok(ctx._dlPickAdjust('XXLowWR', 'B') < 1, 'bad-WR comfort hero demoted (penalised)');
ok(ctx._dlPickAdjust('TeamPick', 'B') < 1.15, 'comfort boost bounded — a tiebreaker, not an override');
ok(ctx._dlPickAdjust('XXLowWR', 'B') > 0.85, 'comfort penalty bounded');
ctx.DL_TEAM_MODE = false;

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
