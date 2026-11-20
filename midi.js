/**
 * MIDI motif support: reduces a MIDI melody to a looping lead line on a 16th-note grid.
 * A player may load a MIDI file they are entitled to use; only a reduced list of
 * lead notes is kept in this browser's localStorage. It is never uploaded and
 * is not part of the Google-synced save document.
 */
export const MOTIF_KEY = 'pdp.motif.v1';
const MAX_BYTES = 512 * 1024;
const MAX_STEPS = 256; // 16 bars of 16ths: a full chorus loop fits (the built-in lead uses the whole chorus)

function readVar(d, p) {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    if (p.i >= d.length) throw new Error('Truncated MIDI data');
    const b = d[p.i++];
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error('Bad MIDI variable-length value');
}

export function parseMidi(buffer) {
  const d = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (d.length > MAX_BYTES) throw new Error('MIDI file is too large (limit 512 KB)');
  const u32 = i => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  const u16 = i => (d[i] << 8) | d[i + 1];
  const tag = i => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
  if (d.length < 14 || tag(0) !== 'MThd') throw new Error('Not a standard MIDI file');
  const hdrLen = u32(4), ntrks = u16(10), ppq = u16(12);
  if (ppq & 0x8000 || ppq === 0) throw new Error('SMPTE-timed MIDI is not supported');
  let pos = 8 + hdrLen;
  const tracks = [];
  for (let t = 0; t < ntrks && pos + 8 <= d.length; t++) {
    const len = u32(pos + 4);
    const type = tag(pos);
    const start = pos + 8, end = Math.min(d.length, start + len);
    pos = start + len;
    if (type !== 'MTrk') continue;
    const p = { i: start };
    let tick = 0, status = 0;
    const open = new Map(), notes = [];
    while (p.i < end) {
      tick += readVar(d, p);
      let b = d[p.i];
      if (b === undefined) break;
      if (b === 0xff) { p.i += 2; const l = readVar(d, p); p.i += l; continue; }
      if (b === 0xf0 || b === 0xf7) { const l = (p.i++, readVar(d, p)); p.i += l; continue; }
      if (b & 0x80) { status = b; p.i++; }
      else if (!status) throw new Error('Bad MIDI running status');
      const kind = status >> 4, ch = status & 15;
      const two = kind === 0xc || kind === 0xd ? 1 : 2;
      const a = d[p.i], v = two === 2 ? d[p.i + 1] : 0;
      p.i += two;
      if (ch === 9) continue; // drum channel is not a melody
      if (kind === 0x9 && v > 0) open.set(ch * 128 + a, tick);
      else if (kind === 0x8 || (kind === 0x9 && v === 0)) {
        const s = open.get(ch * 128 + a);
        if (s !== undefined) { notes.push({ tick: s, dur: Math.max(1, tick - s), midi: a }); open.delete(ch * 128 + a); }
      }
    }
    if (notes.length) tracks.push({ notes: notes.sort((x, y) => x.tick - y.tick || y.midi - x.midi) });
  }
  if (!tracks.length) throw new Error('No melodic notes found in this MIDI file');
  return { ppq, tracks };
}

/** Reduce a parsed file to one looping lead line on a 16th-note grid. */
export function buildMotif(parsed, maxSteps = MAX_STEPS, trackIndex = -1) {
  const mean = t => t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length;
  const candidates = parsed.tracks.filter(t => t.notes.length >= 8 && mean(t) >= 58);
  const pool = candidates.length ? candidates : parsed.tracks;
  const track = parsed.tracks[trackIndex] || pool.reduce((best, t) => (t.notes.length > best.notes.length ? t : best));
  const stepTicks = parsed.ppq / 4;
  const origin = track.notes[0].tick;
  const byStep = new Map();
  for (const n of track.notes) {
    const step = Math.round((n.tick - origin) / stepTicks);
    if (step >= maxSteps) break;
    const prev = byStep.get(step);
    if (!prev || n.midi > prev.midi) byStep.set(step, { step, midi: n.midi, len: Math.max(1, Math.round(n.dur / stepTicks)) });
  }
  const notes = [...byStep.values()].sort((a, b) => a.step - b.step);
  if (notes.length < 4) throw new Error('Too few melody notes to build a lead line');
  const sorted = notes.map(n => n.midi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const shift = Math.round((72 - median) / 12) * 12; // centre the line near C5
  const weight = new Array(12).fill(0);
  for (const n of notes) { n.midi += shift; weight[n.midi % 12] += n.len; }
  const tonic = weight.indexOf(Math.max(...weight));
  const last = notes[notes.length - 1];
  const length = Math.min(maxSteps, Math.ceil((last.step + last.len) / 16) * 16);
  return { notes, length, tonicPitchClass: tonic };
}

export function motifFromMidiBytes(bytes, maxSteps = MAX_STEPS, trackIndex = -1) { return buildMotif(parseMidi(bytes), maxSteps, trackIndex); }

export function validMotif(m) {
  return !!m && Array.isArray(m.notes) && m.notes.length >= 4 && m.notes.length <= MAX_STEPS
    && Number.isInteger(m.length) && m.length >= 16 && m.length <= MAX_STEPS
    && Number.isInteger(m.tonicPitchClass) && m.tonicPitchClass >= 0 && m.tonicPitchClass < 12
    && m.notes.every(n => Number.isInteger(n.step) && n.step >= 0 && n.step < m.length
      && Number.isInteger(n.midi) && n.midi >= 24 && n.midi <= 108 && Number.isInteger(n.len) && n.len >= 1);
}

export function loadMotif(storage = globalThis.localStorage) {
  try { const m = JSON.parse(storage.getItem(MOTIF_KEY)); return validMotif(m) ? m : null; } catch { return null; }
}
export function saveMotif(m, storage = globalThis.localStorage) {
  try { if (m) storage.setItem(MOTIF_KEY, JSON.stringify(m)); else storage.removeItem(MOTIF_KEY); return true; } catch { return false; }
}
