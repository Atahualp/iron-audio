#!/usr/bin/env python3
# Iron Audio v20.1.0 -> v20.1.1 audit fixes. Usage: p2011.py <in index.html> <out index.html>
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'expected {count} match(es), found {n}: {old[:70]!r}'
    s = s.replace(old, new)

# ── P1: one header writer; renderWorkout always sets the title ─────────
rep("""function renderWorkout(exercises, meta) {
  document.getElementById('timeBadge').textContent = meta.badge;
  document.getElementById('muscleBadge').textContent = meta.label;
""", """// V20.1.1: one writer for the results header. Restore and history-load used to
// replace .res-meta innerHTML, deleting #timeBadge/#muscleBadge, so the next
// KICKOFF threw on line 1 of renderWorkout and the overlay never cleared.
function setResultsHeader(title, badge, label) {
  var t = document.querySelector('#results .res-title');
  var b = document.getElementById('timeBadge');
  var m = document.getElementById('muscleBadge');
  if (t) t.textContent = title;
  if (b) b.textContent = badge;
  if (m) m.textContent = label;
}
function musclesLabel(list) {
  return (list || []).map(function(m){ return String(m).toUpperCase(); }).join(' \\u00b7 ');
}

function renderWorkout(exercises, meta) {
  // V20.1.1: always write the title — a 5 Basics title used to stick to the next KICKOFF.
  setResultsHeader(meta.title || 'YOUR WORKOUT', meta.badge, meta.label);
""")
rep("""  var t = document.querySelector('#results .res-title');
  if (t) t.textContent = '5 BASICS \\u00b7 DAY ' + day;
""", "")

# ── P2: session restore uses the header writer (keeps the badge nodes) ─
rep("""        // Restore results header (M1: query by class — there are no resTitle/resMeta IDs)
        var resTitle = document.querySelector('#results .res-title');
        if (resTitle) {
          resTitle.textContent = session.title || muscles.map(function(m){ return m.charAt(0).toUpperCase()+m.slice(1); }).join(' + ');
        }
        var resMeta = document.querySelector('#results .res-meta');
        if (resMeta) {
          resMeta.innerHTML =
            '<span class="badge badge-t">' + (session.perMuscleCount||2) + 'ex/muscle</span>' +
            '<span class="badge badge-m">' + muscles.length + ' MUSCLE' + (muscles.length > 1 ? 'S' : '') + '</span>';
        }
""", """        // V20.1.1: same header as at generation; never rebuild .res-meta.
        if (session.program === 'basics5') {
          setResultsHeader(session.title || '5 BASICS', '5 PATTERNS', session.title || '5 BASICS');
        } else {
          setResultsHeader(session.title || 'YOUR WORKOUT', (session.perMuscleCount || 2) + 'ex/muscle', musclesLabel(muscles));
        }
""")

# ── P3: history load — header writer, chip repaint, 5 Basics keeps user picks
rep("""  if (entry.muscles)    { muscles = [...entry.muscles]; document.querySelectorAll('.mg-chip').forEach(c => { const m = c.getAttribute('onclick')?.match(/'([^']+)'/)?.[1]; if(m) c.classList.toggle('on', muscles.includes(m)); }); }
""", """  if (entry.muscles) {
    // V20.1.1: a 5 Basics entry's legs/chest/back are session-only — park the
    // user's own picks so Back restores them instead of leaving 5 Basics muscles selected.
    if (entry.program === 'basics5' && !window._cfgMusclesBackup) window._cfgMusclesBackup = muscles.slice();
    muscles = [...entry.muscles];
    paintMuscleChips();
  }
""")
rep("""  var resTitle = document.querySelector('#results .res-title');
  if (resTitle) resTitle.textContent = (entry.muscles || []).map(function(m){ return m.charAt(0).toUpperCase()+m.slice(1); }).join(' + ') || 'Workout';
  var resMeta = document.querySelector('#results .res-meta');
  if (resMeta) resMeta.innerHTML =
    '<span class="badge badge-m">' + (entry.muscles ? entry.muscles.length : 0) + ' MUSCLE' + ((entry.muscles && entry.muscles.length > 1) ? 'S' : '') + '</span>';
""", """  if (entry.program === 'basics5') {
    var b5t = '5 BASICS' + (entry.b5Day ? ' \\u00b7 DAY ' + entry.b5Day : '');
    setResultsHeader(b5t, '5 PATTERNS', entry.date || b5t);
  } else {
    setResultsHeader(musclesLabel(entry.muscles) || 'WORKOUT', entry.date || '', (entry.muscles || []).length + ' MUSCLE' + ((entry.muscles || []).length === 1 ? '' : 'S'));
  }
""")

# ── P4: chips always mirror `muscles` when the config view comes back ─
rep("""function showCfg(){if(window._cfgMusclesBackup){muscles=window._cfgMusclesBackup;window._cfgMusclesBackup=null;}stopSpeech();""",
"""// V20.1.1: after a restore the chips were blank while `muscles` still held the
// old selection, so taps toggled the wrong way and hidden groups leaked into KICKOFF.
function paintMuscleChips() {
  document.querySelectorAll('.mg-chip').forEach(function(c) {
    var m = (c.getAttribute('onclick') || '').match(/'([^']+)'/);
    if (m) c.classList.toggle('on', muscles.indexOf(m[1]) !== -1);
  });
}
function showCfg(){if(window._cfgMusclesBackup){muscles=window._cfgMusclesBackup;window._cfgMusclesBackup=null;}try{paintMuscleChips();renderArnold();renderFreqRead();}catch(e){}stopSpeech();""")

# ── P5: renderArnold reflects the guard; it no longer wipes the saved setting
rep("""  if (ss) ss.classList.toggle('dis', !ok);
  if (!ok && arnold.superset) { arnold.superset = false; setMode('standard'); saveArnold();
    if (ss) ss.classList.remove('on'); }
""", """  if (ss) ss.classList.toggle('dis', !ok);
  // V20.1.1: display-only. This used to set superset=false and SAVE it whenever
  // `muscles` was empty — i.e. on every app open — so the setting never stuck.
  // The pairing engine already emits straight sets when no antagonist exists.
  if (ss && !ok) ss.classList.remove('on');
""")

# ── P6: swaps keep the slot's program (5 Basics tags, reps, superset slot) ─
rep("""  const swapRest = (workoutMode === 'superset' && ex.ssConnector) ? '15s' : restStr;
  return { ...picked, sets: String(s), rest: swapRest, muscleGroup, pat: _pat, ssGroup: ex.ssGroup, ssConnector: ex.ssConnector };
}""", """  // V20.1.1: the connector rest follows the slot, not the global mode — 5 Basics
  // pairs push/pull without switching workoutMode to 'superset'.
  const swapRest = ex.ssConnector ? '15s' : (ex.b5 ? ex.rest : restStr);
  const out = { ...picked, sets: String(s), rest: swapRest, muscleGroup, pat: _pat,
                ssGroup: ex.ssGroup, ssSlot: ex.ssSlot, ssConnector: ex.ssConnector };
  if (ex.b5) Object.assign(out, { b5: ex.b5, b5rp: ex.b5rp, reps: isCarryEx(picked) ? '30 m' : '10\\u201312' });
  return out;
}""")

# ── P7: no shock technique on carries ──────────────────────────────────
rep("""  if (!arnold.on || !arnold.shock || !isIsolation(ex)) return '';
  var t = shockFor(ex.name);""", """  if (!arnold.on || !arnold.shock || !isIsolation(ex) || isCarryEx(ex)) return ''; // V20.1.1: no drop sets on a carry
  var t = shockFor(ex.name);""")

# ── P8: version ────────────────────────────────────────────────────────
rep("IRON AUDIO v20.1.0 · GRIDIRON EDITION", "IRON AUDIO v20.1.1 · GRIDIRON EDITION")

open(dst, 'w', encoding='utf-8').write(s)
print('patched OK')

# ── P5b (appended): superset mode is driven only by the Arnold switch, but
# workoutMode was never restored on open, so supersets died on every reload.
s = open(dst, encoding='utf-8').read()
old = """    if (raw) arnold = Object.assign({ on:false, pyramid:false, superset:false, shock:false }, JSON.parse(raw));
  } catch(e) {}
  renderArnold();"""
assert s.count(old) == 1, 'loadArnold target'
s = s.replace(old, """    if (raw) arnold = Object.assign({ on:false, pyramid:false, superset:false, shock:false }, JSON.parse(raw));
  } catch(e) {}
  setMode(arnold.superset ? 'superset' : 'standard'); // V20.1.1: the switch is the only mode control
  renderArnold();""")
open(dst, 'w', encoding='utf-8').write(s)
print('P5b OK')

# ── P9 (appended): keep the pre-v20.1.1 guard semantics at generation time —
# supersets only when an opposing group is selected (the switch no longer gets
# wiped, so the engine itself must check).
s = open(dst, encoding='utf-8').read()
old = "  if (workoutMode === 'superset' && arnold.on && arnold.superset) {"
assert s.count(old) == 1, 'pairing gate'
s = s.replace(old, "  if (workoutMode === 'superset' && arnold.on && arnold.superset && hasAntagonistPair()) {")

# ── P10: swapping a 5 Basics carry offers carries only (was shrugs/clean pulls)
old = """  if (equipmentMode === 'bodyweight') pool = pool.filter(function(e){ return e.bw; });

  if (!isAdd) {"""
assert s.count(old) == 1, 'swap pool target'
s = s.replace(old, """  if (!isAdd && ex.b5 === 'carry') {
    // V20.1.1: the carry slot stays a carry — pull from every group, one row per name.
    var seen = new Set();
    pool = [];
    Object.keys(DB).forEach(function(g){ (DB[g] || []).forEach(function(e){
      if (isCarryEx(e) && e.name !== ex.name && !currentNames.has(e.name) && !seen.has(e.name)) { seen.add(e.name); pool.push(e); }
    }); });
    if (equipmentMode === 'bodyweight') pool = pool.filter(function(e){ return e.bw || isCarryEx(e); });
    _poolCache = pool; _poolKey = key;
    return pool;
  }
  if (equipmentMode === 'bodyweight') pool = pool.filter(function(e){ return e.bw; });

  if (!isAdd) {""")
open(dst, 'w', encoding='utf-8').write(s)
print('P9/P10 OK')
