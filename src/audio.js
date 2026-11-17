// WebAudio synth — no external files. All sounds generated.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.padTimer = 0;
    this.padChord = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // engine hum: two detuned saws through a lowpass
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 55;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'square'; osc2.frequency.value = 55;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.4;
    this.engineOsc.connect(filt); osc2.connect(g2); g2.connect(filt);
    filt.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); osc2.start();
    // police siren
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0.0;
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'sine'; this.sirenOsc.frequency.value = 720;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.startPad();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  setEngine(speed01, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.06 : 0.0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + speed01 * 110, t, 0.08);
  }

  setSiren(on, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.045 : 0.0, t, 0.2);
    if (on) {
      this.sirenTimer += dt;
      const f = Math.sin(this.sirenTimer * 5.2) > 0 ? 880 : 660;
      this.sirenOsc.frequency.setTargetAtTime(f, t, 0.05);
    }
  }

  blip(freq = 660, dur = 0.09, type = 'sine', vol = 0.16) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  thud() { this.blip(90, 0.18, 'triangle', 0.3); }
  punch() { this.blip(140, 0.12, 'square', 0.2); }
  pickup() { this.blip(880, 0.1); setTimeout(() => this.blip(1320, 0.14), 90); }

  jingle() {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.22, 'triangle', 0.2), i * 110));
  }

  fail() {
    if (!this.ctx) return;
    [330, 262, 196].forEach((n, i) => setTimeout(() => this.blip(n, 0.25, 'sawtooth', 0.12), i * 130));
  }

  // slow ambient pad: a low chord that changes every ~9s
  startPad() {
    const chords = [[110, 164.8, 220], [98, 146.8, 196], [87.3, 130.8, 174.6], [103.8, 155.6, 207.7]];
    const play = () => {
      if (!this.ctx) return;
      const chord = chords[this.padChord % chords.length];
      this.padChord++;
      const t = this.ctx.currentTime;
      for (const f of chord) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 2.5);
        g.gain.linearRampToValueAtTime(0.0001, t + 9);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + 9.2);
      }
      setTimeout(play, 9000);
    };
    setTimeout(play, 1500);
  }
}
