// Every sound is synthesized live with the Web Audio API. No audio files.

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.nextChirp = 0;
    this.nextChime = 0;
    this.nextBeat = 0;
    this.nextBass = 0;
    this.bassStep = 0;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(comp);
    // meter-only mode (tests): measure loudness without making any sound
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    if (!this.meterOnly) comp.connect(ctx.destination);

    this.revIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(4.2, 2.4);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.revIn.connect(conv).connect(revOut).connect(this.master);

    this.white = this.noiseBuffer(5, 'white');
    this.pink = this.noiseBuffer(5, 'pink');
    this.brown = this.noiseBuffer(5, 'brown');

    this.beds = {};
    this.buildBeds();
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, ctx.currentTime, 1.2);
    this.ready = true;
  }

  // RMS and peak of the output, in dBFS
  meter() {
    if (!this.ready) return null;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (const v of buf) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
    return { rms: db(Math.sqrt(sum / buf.length)), peak: db(peak) };
  }

  setMuted(m) {
    this.muted = m;
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.3);
  }

  // ------------------------------------------------------------------ helpers
  impulse(sec, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer(sec, type) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  src(buf, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop;
    if (loop) s.loopStart = Math.random() * 2;
    return s;
  }

  bus(rev = 0.2) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    if (rev > 0) { const s = this.ctx.createGain(); s.gain.value = rev; g.connect(s).connect(this.revIn); }
    return g;
  }

  filter(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  osc(type, f, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    return o;
  }

  out(rev = 0.3, pan = 0) {
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.master);
    if (rev > 0) { const s = this.ctx.createGain(); s.gain.value = rev; p.connect(s).connect(this.revIn); }
    return g;
  }

  // ------------------------------------------------------------------ beds
  buildBeds() {
    const ctx = this.ctx, B = this.beds;

    // forest wind
    B.wind = this.bus(0.15);
    this.windFilter = this.filter('bandpass', 500, 0.5);
    const wn = this.src(this.pink); wn.connect(this.windFilter).connect(B.wind); wn.start();

    // river
    B.river = this.bus(0.1);
    const rn = this.src(this.white); rn.connect(this.filter('highpass', 900)).connect(this.filter('lowpass', 4500)).connect(B.river); rn.start();

    // drone motor (the camera)
    B.motor = this.bus(0);
    this.motorF = this.filter('lowpass', 380, 2);
    this.motorOsc = [this.osc('sawtooth', 92), this.osc('sawtooth', 92.6), this.osc('sine', 184)];
    this.motorOsc.forEach((o) => { o.connect(this.motorF); o.start(); });
    this.whine = this.osc('sine', 1320);
    const wg = ctx.createGain(); wg.gain.value = 0.015;
    this.whine.connect(wg).connect(this.motorF); this.whine.start();
    this.motorF.connect(B.motor);

    // space pad
    B.space = this.bus(0.6);
    const spF = this.filter('lowpass', 900, 0.5);
    this.spaceF = spF;
    [55, 82.41, 110, 164.81, 220, 329.63].forEach((f, i) => {
      const o = this.osc(i % 2 ? 'triangle' : 'sine', f, (Math.random() - 0.5) * 12);
      const g = ctx.createGain(); g.gain.value = 0.16 / (1 + i * 0.4);
      o.connect(g).connect(spF); o.start();
    });
    spF.connect(B.space);
    // shimmer
    B.shimmer = this.bus(0.9);
    [1318.5, 1760, 2637].forEach((f, i) => {
      const o = this.osc('sine', f);
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = this.osc('sine', 0.13 + i * 0.07);
      const lg = ctx.createGain(); lg.gain.value = 0.03;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(B.shimmer); o.start(); lfo.start();
    });

    // black hole rumble
    B.rumble = this.bus(0.2);
    const bn = this.src(this.brown); bn.connect(this.filter('lowpass', 110)).connect(B.rumble); bn.start();
    const sub = this.osc('sine', 31); const sg = ctx.createGain(); sg.gain.value = 0.6; sub.connect(sg).connect(B.rumble); sub.start();

    // magic choir pad (D major add9)
    B.magic = this.bus(0.7);
    const mf = this.filter('lowpass', 1500, 0.6);
    [146.83, 220, 293.66, 369.99, 440, 554.37, 659.25].forEach((f, i) => {
      for (const det of [-7, 7]) {
        const o = this.osc('sawtooth', f, det);
        const g = ctx.createGain(); g.gain.value = 0.022 / (1 + i * 0.25);
        o.connect(g).connect(mf); o.start();
      }
    });
    const formant = this.filter('peaking', 800, 2); formant.gain.value = 6;
    mf.connect(formant).connect(B.magic);
    this.magicF = mf;

    // city rain + hum
    B.rain = this.bus(0.15);
    const rain = this.src(this.white); rain.connect(this.filter('highpass', 2200)).connect(this.filter('lowpass', 9000)).connect(B.rain); rain.start();
    B.hum = this.bus(0.3);
    const hum = this.osc('sawtooth', 55); hum.connect(this.filter('lowpass', 160)).connect(B.hum); hum.start();
    B.bass = this.bus(0.25);
    this.bassF = this.filter('lowpass', 700, 4);
    this.bassF.connect(B.bass);

    // orbit / eye: low drone + air
    B.deep = this.bus(0.6);
    const d1 = this.osc('sine', 36.7), d2 = this.osc('sine', 55.1);
    const dg = ctx.createGain(); dg.gain.value = 0.5;
    d1.connect(dg); d2.connect(dg); dg.connect(B.deep); d1.start(); d2.start();
    const air = this.src(this.pink); const ag = ctx.createGain(); ag.gain.value = 0.25;
    air.connect(this.filter('bandpass', 900, 0.4)).connect(ag).connect(B.deep); air.start();
  }

  level(name, v, tc = 0.4) {
    this.beds[name].gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // w: weights per world, vel: scroll speed
  update(u, vel, w, time) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(1, Math.abs(vel) / 10);
    const forest = w.forest || 0;
    this.level('wind', forest * 0.12);
    this.level('river', forest * (u < 190 ? 0.035 : 0.01));
    this.windFilter.frequency.setTargetAtTime(380 + Math.sin(time * 0.31) * 140 + Math.sin(time * 0.13) * 90, t, 0.5);
    this.level('motor', 0.035 + sp * 0.05, 0.2);
    this.motorOsc[0].frequency.setTargetAtTime(88 + sp * 40, t, 0.2);
    this.motorOsc[1].frequency.setTargetAtTime(88.6 + sp * 40, t, 0.2);
    this.whine.frequency.setTargetAtTime(1200 + sp * 500, t, 0.2);
    this.motorF.frequency.setTargetAtTime(300 + sp * 900, t, 0.2);

    const space = w.space || 0;
    this.level('space', space * 0.3 + (w.orbit || 0) * 0.18 + (w.eyeIn || 0) * 0.08);
    this.level('shimmer', space * 0.9 + (w.orbit || 0) * 0.5);
    this.spaceF.frequency.setTargetAtTime(600 + Math.sin(time * 0.07) * 300, t, 1);
    const bh = Math.max(0, Math.min(1, (u - 440) / 70)) * (u < 532 ? 1 : 0);
    this.level('rumble', space * bh * bh * 0.4, 0.3);
    this.level('magic', (w.magic || 0) * 0.32);
    this.magicF.frequency.setTargetAtTime(1100 + Math.sin(time * 0.2) * 500, t, 1);
    const city = w.city || 0;
    this.level('rain', city * (u > 775 && u < 862 ? 0.06 : 0.01));
    this.level('hum', city * 0.12);
    this.level('bass', city * (u > 765 && u < 858 ? 0.5 : 0));
    this.level('deep', (w.eyeIn || 0) * 0.16 + (w.eyeOut || 0) * 0.18 + (w.orbit || 0) * 0.06);

    // scheduled textures
    if (forest > 0.3 && u < 200 && t > this.nextChirp) { this.chirps(t, (Math.random() - 0.5) * 1.6); this.nextChirp = t + 0.6 + Math.random() * 2.2; }
    if ((w.magic || 0) > 0.3 && t > this.nextChime) { this.chime(t, [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51][Math.floor(Math.random() * 7)], 0.05, (Math.random() - 0.5) * 1.6); this.nextChime = t + 0.35 + Math.random() * 1.2; }
    const eye = Math.max(w.eyeIn || 0, w.eyeOut || 0);
    if (eye > 0.4 && t > this.nextBeat && u < 969) { this.heartbeat(t, 0.5 * eye); this.nextBeat = t + (u > 900 ? 1.25 : 1.0); }
    if (city > 0.3 && u > 765 && u < 858) {
      if (this.nextBass < t) this.nextBass = t + 0.05;
      while (this.nextBass < t + 0.2) { this.bassNote(this.nextBass); this.nextBass += 60 / 104 / 2; }
    }
  }

  // ------------------------------------------------------------------ one-shots
  fire(name) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'flutter': this.flutter(t); break;
      case 'snort': this.snort(t); break;
      case 'howl': this.howl(t, { pitch: 1, pan: 0.35, gain: 0.55 }); break;
      case 'howlFar1': this.howl(t, { pitch: 0.92, pan: -0.8, gain: 0.25, far: true }); break;
      case 'howlFar2': this.howl(t, { pitch: 1.08, pan: 0.85, gain: 0.2, far: true }); break;
      case 'howlFar3': this.howl(t, { pitch: 0.85, pan: -0.3, gain: 0.16, far: true }); break;
      case 'howlCosmic': this.howl(t, { pitch: 0.75, pan: 0.5, gain: 0.3, far: true }); break;
      case 'sparkle': for (let i = 0; i < 9; i++) this.chime(t + i * 0.09, 880 * Math.pow(1.122, i), 0.04, (Math.random() - 0.5)); break;
      case 'roar': this.roar(t); break;
      case 'riser': this.riser(t, 3.2, 0.25); break;
      case 'riserLong': this.riser(t, 6, 0.3); break;
      case 'boom': this.boom(t, 0.9); this.whoosh(t - 0.4, 1.4, 0.3); break;
      case 'boomSoft': this.boom(t, 0.5); break;
      case 'whoosh': this.whoosh(t, 2.2, 0.35); break;
      case 'whooshSoft': this.whoosh(t, 2.5, 0.2); break;
      case 'chimeSwell': for (let i = 0; i < 14; i++) this.chime(t + i * 0.07, [587.33, 739.99, 880, 1108.73, 1318.51][i % 5] * (i > 6 ? 2 : 1), 0.06, Math.sin(i) * 0.8); break;
      case 'zap': this.zap(t); break;
      case 'blink': this.boom(t, 0.35); break;
      default: break;
    }
  }

  chirps(t, pan) {
    const out = this.out(0.25, pan);
    out.gain.value = 0.035 + Math.random() * 0.03;
    const base = 2200 + Math.random() * 2200;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.09 + Math.random() * 0.08);
      const o = this.osc('sine', base);
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.frequency.setValueAtTime(base * (0.8 + Math.random() * 0.3), s);
      o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.5), s + 0.06);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(1, s + 0.01); g.gain.exponentialRampToValueAtTime(0.001, s + 0.09);
      o.connect(g).connect(out); o.start(s); o.stop(s + 0.12);
    }
  }

  flutter(t) {
    for (let i = 0; i < 60; i++) {
      const s = t + Math.random() * 2.4;
      const n = this.src(this.white, false);
      const f = this.filter('bandpass', 600 + Math.random() * 1400, 1.2);
      const out = this.out(0.15, (Math.random() - 0.5) * 1.8);
      out.gain.setValueAtTime(0, s); out.gain.linearRampToValueAtTime(0.09, s + 0.01); out.gain.exponentialRampToValueAtTime(0.001, s + 0.07);
      n.connect(f).connect(out); n.start(s, Math.random() * 4); n.stop(s + 0.1);
    }
  }

  snort(t) {
    const n = this.src(this.white, false);
    const f = this.filter('bandpass', 700, 1.5);
    const out = this.out(0.3, -0.5);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.25, t + 0.03); out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(f).connect(out); n.start(t); n.stop(t + 0.4);
  }

  howl(t, { pitch = 1, pan = 0, gain = 0.5, far = false }) {
    const ctx = this.ctx;
    const out = this.out(far ? 1.2 : 0.55, pan);
    const env = ctx.createGain(); env.gain.value = 0;
    const lp = this.filter('lowpass', far ? 1100 : 2400, 0.7);
    const bp = this.filter('peaking', 900 * pitch, 1.5); bp.gain.value = 5;
    env.connect(bp).connect(lp).connect(out);
    out.gain.value = gain;
    const o1 = this.osc('sine', 300), o2 = this.osc('triangle', 300), o3 = this.osc('sine', 600);
    const g1 = ctx.createGain(); g1.gain.value = 0.7;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g3 = ctx.createGain(); g3.gain.value = 0.08;
    const vib = this.osc('sine', 5.2); const vg = ctx.createGain(); vg.gain.value = 0;
    vib.connect(vg);
    const dur = 4.2;
    for (const [o, mul] of [[o1, 1], [o2, 1], [o3, 2]]) {
      const f = (v) => v * pitch * mul;
      o.frequency.setValueAtTime(f(290), t);
      o.frequency.linearRampToValueAtTime(f(500), t + 0.6);
      o.frequency.linearRampToValueAtTime(f(560), t + 1.7);
      o.frequency.linearRampToValueAtTime(f(545), t + 2.8);
      o.frequency.linearRampToValueAtTime(f(400), t + 3.8);
      o.frequency.linearRampToValueAtTime(f(330), t + dur);
      vg.connect(o.frequency);
      o.start(t); o.stop(t + dur + 0.2);
    }
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(9 * pitch, t + 1.2);
    vib.start(t); vib.stop(t + dur + 0.2);
    o1.connect(g1).connect(env); o2.connect(g2).connect(env); o3.connect(g3).connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.45);
    env.gain.linearRampToValueAtTime(0.75, t + 2.8);
    env.gain.linearRampToValueAtTime(0, t + dur);
  }

  roar(t) {
    const ctx = this.ctx;
    const out = this.out(0.45, 0);
    out.gain.value = 0.9;
    const env = ctx.createGain(); env.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 4); }
    shaper.curve = curve;
    const lp = this.filter('lowpass', 500, 1.2);
    env.connect(shaper).connect(lp).connect(out);
    // growl: amplitude modulation
    const am = ctx.createGain(); am.gain.value = 0.6;
    const lfo = this.osc('square', 26); const lg = ctx.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(am.gain);
    am.connect(env);
    const n = this.src(this.brown, false);
    const nb = this.filter('bandpass', 400, 0.8);
    n.connect(nb).connect(am);
    const s1 = this.osc('sawtooth', 58), s2 = this.osc('sawtooth', 87);
    const sg = ctx.createGain(); sg.gain.value = 0.45;
    s1.connect(sg); s2.connect(sg); sg.connect(am);
    const dur = 2.9;
    nb.frequency.setValueAtTime(250, t); nb.frequency.linearRampToValueAtTime(900, t + 0.5); nb.frequency.linearRampToValueAtTime(600, t + 1.8); nb.frequency.linearRampToValueAtTime(220, t + dur);
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.45); lp.frequency.linearRampToValueAtTime(1500, t + 1.9); lp.frequency.linearRampToValueAtTime(300, t + dur);
    s1.frequency.setValueAtTime(52, t); s1.frequency.linearRampToValueAtTime(78, t + 0.5); s1.frequency.linearRampToValueAtTime(64, t + dur);
    s2.frequency.setValueAtTime(80, t); s2.frequency.linearRampToValueAtTime(118, t + 0.5); s2.frequency.linearRampToValueAtTime(90, t + dur);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.25); env.gain.setValueAtTime(1, t + 1.7); env.gain.linearRampToValueAtTime(0, t + dur);
    for (const s of [n, s1, s2, lfo]) { s.start(t); s.stop(t + dur + 0.1); }
    this.boom(t + 0.05, 0.6);
  }

  boom(t, gain = 0.8) {
    const ctx = this.ctx;
    const out = this.out(0.5, 0);
    out.gain.value = gain;
    const o = this.osc('sine', 70);
    const g = ctx.createGain(); g.gain.value = 0;
    o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(g).connect(out); o.start(t); o.stop(t + 2.4);
    const n = this.src(this.brown, false);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    n.connect(this.filter('lowpass', 240)).connect(ng).connect(out); n.start(t); n.stop(t + 1);
  }

  whoosh(t, dur, gain) {
    const n = this.src(this.white, false);
    const f = this.filter('bandpass', 200, 1.4);
    const out = this.out(0.5, 0);
    f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(3800, t + dur * 0.7); f.frequency.exponentialRampToValueAtTime(900, t + dur);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(gain, t + dur * 0.6); out.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(out); n.start(t, Math.random()); n.stop(t + dur + 0.1);
  }

  riser(t, dur, gain) {
    const n = this.src(this.white, false);
    const f = this.filter('bandpass', 300, 3);
    const out = this.out(0.6, 0);
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(5000, t + dur);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(gain, t + dur * 0.95); out.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(f).connect(out); n.start(t); n.stop(t + dur + 0.2);
    const o = this.osc('sawtooth', 60);
    o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(220, t + dur);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(gain * 0.15, t + dur); og.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.connect(this.filter('lowpass', 900)).connect(og).connect(out); o.start(t); o.stop(t + dur + 0.2);
  }

  chime(t, f, gain, pan) {
    const ctx = this.ctx;
    const out = this.out(0.9, pan);
    out.gain.value = gain;
    const c = this.osc('sine', f), m = this.osc('sine', f * 2.76);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.5, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
    m.connect(mg).connect(c.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    c.connect(g).connect(out);
    c.start(t); m.start(t); c.stop(t + 3.1); m.stop(t + 3.1);
  }

  heartbeat(t, gain) {
    for (const [dt, k] of [[0, 1], [0.27, 0.65]]) {
      const s = t + dt;
      const o = this.osc('sine', 58);
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(62, s); o.frequency.exponentialRampToValueAtTime(34, s + 0.14);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(gain * k, s + 0.012); g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
      const out = this.out(0.1, 0);
      o.connect(g).connect(out); o.start(s); o.stop(s + 0.3);
    }
  }

  bassNote(t) {
    const seq = [55, 55, 65.41, 55, 82.41, 55, 73.42, 65.41];
    const f = seq[this.bassStep % seq.length] * (this.bassStep % 16 > 11 ? 1.5 : 1);
    this.bassStep++;
    const ctx = this.ctx;
    const o = this.osc('sawtooth', f), o2 = this.osc('square', f * 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    this.bassF.frequency.setValueAtTime(1600, t); this.bassF.frequency.exponentialRampToValueAtTime(160, t + 0.22);
    o.connect(g); o2.connect(g); g.connect(this.bassF);
    o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
  }

  zap(t) {
    const out = this.out(0.4, 0);
    out.gain.value = 0.12;
    const o = this.osc('square', 900);
    for (let i = 0; i < 14; i++) o.frequency.setValueAtTime(200 + Math.random() * 2400, t + i * 0.03);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t); g.gain.linearRampToValueAtTime(0, t + 0.45);
    o.connect(this.filter('bandpass', 1800, 0.8)).connect(g).connect(out); o.start(t); o.stop(t + 0.5);
    this.whoosh(t, 1.2, 0.25);
  }
}
