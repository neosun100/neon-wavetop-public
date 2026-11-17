/* GENERATED from gameforge/src/synth.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * Procedural audio: a generative synthwave loop plus event SFX, all synthesised with
 * WebAudio, and an optional recorded BGM (bgm/bgm.json) that downloads only after the first
 * user gesture. The beat clock is exposed so visuals pulse on the music. Games extend this
 * class for their own SFX using the protected primitives (tone, noiseHit, kick, budget …).
 */

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note
// Am – F – C – G, one bar each; MIDI roots
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
export const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
export const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export type BgmScene = 'menu' | 'game';
/** loopStart/loopEnd come from scripts/find_loop.py: bar-aligned, seam pre-crossfaded. */
type BgmEntry = { file: string; bpm?: number; offset?: number; loopStart?: number; loopEnd?: number; sfxRoot?: number };
type BgmManifest = Partial<Record<BgmScene, BgmEntry>>;
type Track = { file: string; buf: AudioBuffer; bpm: number | null; offset: number; loopStart: number; loopEnd: number; sfxRoot: number | null };

export class Synth {
  protected ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  /** Procedural sequencer output; faded out while a recorded BGM track plays. */
  private synthBus!: GainNode;
  protected sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private nextStep = 0;
  private step = 0;
  private timer = 0;
  private sfxStamps: number[] = [];
  muted = false;
  /** 0 = menu (pads, bass, soft arp), 1 = game (driving arp + full drums). */
  private intensity = 0;
  /** MIDI root of the SFX scale (A4 for the built-in synth; follows a recorded track's key). */
  protected root = 69;
  private scene: BgmScene = 'menu';
  private manifest: BgmManifest | null = null;
  private base = '';
  private fetching = false;
  private raw = new Map<BgmScene, ArrayBuffer>();
  private tracks = new Map<BgmScene, Track>();
  private playing: { scene: BgmScene; src: AudioBufferSourceNode; gain: GainNode; t0: number } | null = null;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** True when a recorded track (not the synth) is the current music. */
  get usingTrack(): boolean {
    return this.playing !== null;
  }

  /**
   * Optional recorded BGM: `bgm/bgm.json` = { "menu": {"file": "menu.mp3", "bpm": 110}, "game": {...} }.
   * Missing manifest ⇒ procedural music (logged, not an error: the public build ships without files).
   */
  async preloadTracks(base: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${base}bgm.json`, { cache: 'no-cache' });
    } catch (e) {
      console.info('[bgm] no manifest reachable, using synthesized music', e);
      return;
    }
    if (!res.ok) {
      console.info(`[bgm] no manifest (${res.status}), using synthesized music`);
      return;
    }
    // Static hosts (Cloudflare Pages) answer unknown paths with index.html + 200,
    // so a missing manifest shows up as HTML, not as a 404.
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
      console.info('[bgm] no manifest (non-JSON response), using synthesized music');
      return;
    }
    let manifest: BgmManifest;
    try {
      manifest = (await res.json()) as BgmManifest;
    } catch (e) {
      console.warn('[bgm] bgm.json is not valid JSON, using synthesized music', e);
      return;
    }
    this.manifest = manifest;
    this.base = base;
    // The audio itself downloads only after the first user gesture (see unlock): visitors who
    // never enable sound never fetch the file.
    if (this.ctx) await this.fetchTracks();
  }

  private async fetchTracks(): Promise<void> {
    const manifest = this.manifest;
    if (!manifest || this.fetching) return;
    this.fetching = true;
    const base = this.base;
    const byFile = new Map<string, ArrayBuffer | null>(); // one download per file, shared by scenes
    for (const scene of ['menu', 'game'] as BgmScene[]) {
      const e = manifest[scene];
      if (!e) continue;
      if (!byFile.has(e.file)) {
        // offline / blocked: degrade to the synth with a trace (this runs on the gesture path,
        // so an uncaught rejection would surface as an unhandled error)
        try {
          const r = await fetch(base + e.file);
          if (!r.ok) console.warn(`[bgm] ${scene}: ${e.file} → HTTP ${r.status}; that scene falls back to synth`);
          byFile.set(e.file, r.ok ? await r.arrayBuffer() : null);
        } catch (err) {
          console.warn(`[bgm] ${scene}: ${e.file} unreachable; that scene falls back to synth`, err);
          byFile.set(e.file, null);
        }
      }
      const buf = byFile.get(e.file);
      if (buf) this.raw.set(scene, buf);
    }
    await this.decodeTracks();
  }

  private async decodeTracks(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.manifest) return;
    const decoded = new Map<string, AudioBuffer>();
    for (const [scene, buf] of this.raw) {
      const e = this.manifest[scene];
      if (!e) continue;
      try {
        const audio = decoded.get(e.file) ?? (await ctx.decodeAudioData(buf.slice(0)));
        decoded.set(e.file, audio);
        const loopEnd = Math.min(e.loopEnd ?? audio.duration, audio.duration);
        const loopStart = Math.max(0, Math.min(e.loopStart ?? 0, loopEnd - 1));
        if (e.loopEnd === undefined) console.info(`[bgm] ${scene}: no loop points, looping the whole file`);
        this.tracks.set(scene, { file: e.file, buf: audio, bpm: e.bpm ?? null, offset: e.offset ?? 0, loopStart, loopEnd, sfxRoot: e.sfxRoot ?? null });
      } catch (err) {
        console.warn(`[bgm] ${scene}: cannot decode ${e.file}; falling back to synth`, err);
      }
    }
    this.raw.clear();
    this.applyScene(1.2); // crossfade from the synth into the track once it is ready
  }

  /** Switch music between menu and in-game, crossfading recorded tracks when present. */
  setScene(scene: BgmScene): void {
    this.scene = scene;
    this.intensity = scene === 'game' ? 1 : 0;
    this.applyScene(1.2);
  }

  private applyScene(fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const track = this.tracks.get(this.scene);
    // same file for both scenes ⇒ keep it playing: the loop should never restart audibly
    if (this.playing && this.playing.scene !== this.scene && track && this.tracks.get(this.playing.scene)?.file === track.file) {
      this.playing.scene = this.scene;
    }
    if (this.playing && this.playing.scene !== this.scene) {
      const old = this.playing;
      old.gain.gain.setTargetAtTime(0, now, fade / 3);
      old.src.stop(now + fade * 2);
      this.playing = null;
    }
    if (track && !this.playing) {
      const src = ctx.createBufferSource();
      src.buffer = track.buf;
      // intro plays once, then the [loopStart, loopEnd) section repeats sample-accurately
      src.loop = true;
      src.loopStart = track.loopStart;
      src.loopEnd = track.loopEnd;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.setTargetAtTime(1, now, fade / 3);
      src.connect(gain).connect(this.musicBus);
      src.start(now);
      this.playing = { scene: this.scene, src, gain, t0: now };
    }
    this.synthBus.gain.setTargetAtTime(this.playing ? 0 : 1, now, fade / 3);
    // tune SFX to the track: minor-pentatonic root nearest to A4 so the register stays put
    const r = this.playing ? this.tracks.get(this.playing.scene)?.sfxRoot : null;
    this.root = r == null ? 69 : [60 + r, 72 + r].reduce((a, b) => (Math.abs(b - 69) < Math.abs(a - 69) ? b : a));
  }

  /** Must be called from a user gesture (autoplay policy). Idempotent. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      console.warn('[synth] WebAudio unavailable — running silent');
      return;
    }
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.42;
    this.musicBus.connect(this.master);
    this.synthBus = ctx.createGain();
    this.synthBus.connect(this.musicBus);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.nextStep = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
    void this.fetchTracks();
    this.applyScene(0.01);
    // power-on sting so the first tap is audibly acknowledged
    [57, 64, 69, 76].forEach((m, i) => this.tone(midi(m), ctx.currentTime + 0.05 + i * 0.07, 0.6, 'sawtooth', 0.05, this.sfxBus, 2400));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** 0..1 envelope that peaks on each beat (quarter note). */
  beat(): number {
    if (!this.ctx) return 0.5 + 0.5 * Math.sin(performance.now() / 1000 * Math.PI * 2 * (BPM / 60));
    let bpm = BPM;
    let time = this.ctx.currentTime;
    if (this.playing) {
      const tr = this.tracks.get(this.playing.scene);
      // unknown tempo ⇒ a gentle pulse rather than a fake beat that drifts off the music
      if (!tr?.bpm) return 0.5 + 0.25 * Math.sin(time * 2.2);
      bpm = tr.bpm;
      // position inside the file, folding playback time back into the loop section
      let pos = time - this.playing.t0;
      if (pos >= tr.loopEnd) pos = tr.loopStart + ((pos - tr.loopStart) % (tr.loopEnd - tr.loopStart));
      time = pos - tr.offset;
    }
    const t = time / (60 / bpm);
    return Math.pow(1 - (t - Math.floor(t)), 3);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    void this.ctx?.close();
  }

  // ───────────── music ─────────────

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextStep < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStep);
      this.nextStep += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(s: number, t: number): void {
    const chord = CHORDS[Math.floor(s / 16) % 4];
    const inBar = s % 16;
    // bass: driving 8ths on the root
    if (inBar % 2 === 0) this.tone(midi(chord[0] - 24), t, STEP * 1.6, 'sawtooth', 0.22, this.synthBus, 420 + 260 * (inBar % 4 === 0 ? 1 : 0));
    if (inBar === 0) for (const m of chord) this.tone(midi(m), t, STEP * 15, 'triangle', 0.05, this.synthBus, 1800, 0.4);
    if (this.intensity === 0) {
      // menu: airy 8th-note arp, half-time kick and soft off-beat hats — alive but not pushy
      if (inBar % 2 === 0) {
        const arp = [0, 1, 2, 1, 2, 1, 0, 2][(inBar / 2) % 8];
        this.tone(midi(chord[arp] + 12), t, STEP * 3, 'triangle', 0.05, this.synthBus, 1600 + 900 * Math.sin(s / 10));
      }
      if (inBar === 0 || inBar === 10) this.kick(t, 0.32);
      if (inBar % 4 === 2) this.hat(t, 0.035);
      if (s % 32 === 28) this.tone(midi(chord[2] + 24), t, STEP * 6, 'sine', 0.04, this.synthBus, 5000, 0.08);
    } else {
      const arp = [0, 1, 2, 1, 2, 0, 2, 1][inBar % 8];
      this.tone(midi(chord[arp] + 12 + (inBar >= 8 ? 12 : 0)), t, STEP * 0.9, 'square', 0.045, this.synthBus, 2600);
      if (inBar % 4 === 0) this.kick(t);
      if (inBar % 4 === 2) this.hat(t, 0.08);
      if (inBar === 4 || inBar === 12) this.snare(t);
    }
  }

  protected tone(f: number, t: number, dur: number, type: OscillatorType, gain: number, bus: AudioNode, cutoff = 4000, attack = 0.005): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  protected kick(t: number, level = 0.55): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.synthBus);
    o.start(t);
    o.stop(t + 0.32);
  }

  protected noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, bus: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  protected hat(t: number, g: number): void {
    this.noiseHit(t, 0.05, g, 'highpass', 7000, this.synthBus);
  }
  protected snare(t: number): void {
    this.noiseHit(t, 0.18, 0.18, 'bandpass', 1800, this.synthBus);
  }

  // ───────────── sfx ─────────────

  /** SFX rate limiter: at warp speed hundreds of events per second would turn to noise. */
  protected budget(max = 14): boolean {
    const now = performance.now();
    this.sfxStamps = this.sfxStamps.filter((s) => now - s < 1000);
    if (this.sfxStamps.length >= max) return false;
    this.sfxStamps.push(now);
    return true;
  }

  eat(combo: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.budget()) return;
    const t = ctx.currentTime;
    const note = this.root + PENTA[Math.min(combo, PENTA.length - 1)];
    this.tone(midi(note), t, 0.22, 'square', 0.12, this.sfxBus, 5000);
    this.tone(midi(note + 7), t + 0.04, 0.25, 'triangle', 0.1, this.sfxBus, 6000);
    this.noiseHit(t, 0.06, 0.06, 'highpass', 5000, this.sfxBus);
  }

  turn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.budget(10)) return;
    this.tone(1800, ctx.currentTime, 0.03, 'sine', 0.03, this.sfxBus);
  }

  blip(up = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(up ? 880 : 660, ctx.currentTime, 0.08, 'square', 0.06, this.sfxBus, 3000);
  }

  select(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [72, 76, 79, 84].forEach((m, i) => this.tone(midi(m), t + i * 0.05, 0.25, 'square', 0.07, this.sfxBus, 4000));
  }

  milestone(): void {
    const ctx = this.ctx;
    if (!ctx || !this.budget()) return;
    const t = ctx.currentTime;
    [0, 3, 7, 12, 15].map((d) => this.root + d).forEach((m, i) => this.tone(midi(m), t + i * 0.06, 0.5, 'sawtooth', 0.06, this.sfxBus, 3500));
  }

  die(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.9);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 1.05);
    this.noiseHit(t, 0.8, 0.35, 'lowpass', 900, this.sfxBus);
  }

  win(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 16; i++) this.tone(midi(this.root + PENTA[i % PENTA.length] + (i >= 11 ? 12 : 0)), t + i * 0.07, 0.6, 'square', 0.06, this.sfxBus, 5000);
  }
}
