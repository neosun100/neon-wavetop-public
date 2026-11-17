/** Sound: everything is synthesised here (no audio files): blips, an engine note that follows the speed, and a
 *  small generated tune per chapter. Created on the first gesture; if the browser has no Web Audio the game is
 *  silent and nothing else depends on it. */
const SCALES = [
  [0, 4, 7, 11, 12, 11, 7, 4], // day: major seventh
  [0, 3, 7, 10, 12, 10, 7, 3], // reef: minor seventh
  [0, 5, 7, 10, 12, 10, 7, 5], // dusk: suspended
  [0, 3, 7, 8, 12, 8, 7, 3], // night: minor sixth
];

/** What the page plays for music: the track in ./bgm/ when one is shipped, else the tune generated here. */
export type BgmState = 'none' | 'loading' | 'playing' | 'failed';
interface BgmEntry { file: string; loopStart: number; loopEnd: number; credit?: string }

export class Audio {
  muted = false;
  /** true at high autopilot speeds: blips would be a buzz, so they are dropped (the music stays) */
  quiet = false;
  /** none: no track is shipped with this build (the generated tune plays) · failed: one is listed but did not load */
  bgm: BgmState = 'none';
  /** the attribution line of the track that is playing (a CC BY track must be credited where it is used) */
  credit = '';
  private bgmGain: GainNode | null = null;
  private bgmAsked = false;
  private ac: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private beatAt = 0;
  private beat = 0;

  wake(): void {
    try {
      this.ac ??= new AudioContext();
      if (this.ac.state === 'suspended') void this.ac.resume();
      if (!this.engine) {
        const o = this.ac.createOscillator();
        const f = this.ac.createBiquadFilter();
        const g = this.ac.createGain();
        o.type = 'sawtooth';
        f.type = 'lowpass';
        f.frequency.value = 420;
        g.gain.value = 0;
        o.connect(f).connect(g).connect(this.ac.destination);
        o.start();
        this.engine = o;
        this.engineGain = g;
      }
    } catch {
      this.ac = null; // no audio device / no Web Audio: silent game
    }
    if (this.ac && !this.bgmAsked) {
      this.bgmAsked = true;
      void this.loadBgm(this.ac);
    }
  }

  /** The recorded track, fetched only after the first gesture. A build without one (BGM=local deploys strip it)
   *  answers this path with the index page, so anything that is not a JSON manifest means "no track". */
  private async loadBgm(ac: AudioContext): Promise<void> {
    let entry: BgmEntry | undefined;
    try {
      const res = await fetch('./bgm/bgm.json', { cache: 'no-cache' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return; // none shipped: stays 'none'
      entry = ((await res.json()) as { game?: BgmEntry }).game;
    } catch {
      return; // offline, or not JSON: no track, the generated tune plays
    }
    if (!entry || typeof entry.file !== 'string' || !/^[\w.-]+$/.test(entry.file)) return;
    this.bgm = 'loading';
    try {
      const buf = await ac.decodeAudioData(await (await fetch(`./bgm/${entry.file}`)).arrayBuffer());
      const src = ac.createBufferSource();
      const g = ac.createGain();
      src.buffer = buf;
      src.loop = true;
      if (entry.loopEnd > entry.loopStart) { src.loopStart = entry.loopStart; src.loopEnd = Math.min(entry.loopEnd, buf.duration); }
      g.gain.value = 0;
      src.connect(g).connect(ac.destination);
      src.start();
      this.bgmGain = g;
      this.bgm = 'playing';
      this.credit = typeof entry.credit === 'string' ? entry.credit.slice(0, 200) : '';
    } catch {
      this.bgm = 'failed'; // listed but undecodable / missing: say so (state), fall back to the generated tune
    }
  }

  tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slide = 1, delay = 0): void {
    const ac = this.ac;
    if (!ac || this.muted || this.quiet) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A note of the generated tune: like `tone`, but not dropped at high speed. */
  private note(freq: number, dur: number, type: OscillatorType, vol: number, slide: number, delay: number): void {
    const q = this.quiet;
    this.quiet = false;
    this.tone(freq, dur, type, vol, slide, delay);
    this.quiet = q;
  }

  /** Called every frame while flying: the engine note, and the next notes of the tune. */
  fly(speed: number, boost: number, chapter: number, on: boolean): void {
    const ac = this.ac;
    if (!ac || !this.engine || !this.engineGain) return;
    const live = on && !this.muted;
    this.engineGain.gain.setTargetAtTime(live ? 0.018 + 0.03 * boost : 0, ac.currentTime, 0.08);
    this.engine.frequency.setTargetAtTime(48 + speed * 0.42, ac.currentTime, 0.1);
    // the recorded track plays in the menus too, a little lower; the generated tune only while flying
    this.bgmGain?.gain.setTargetAtTime(this.muted ? 0 : on ? 0.5 : 0.32, ac.currentTime, 0.4);
    if (!live || this.bgm === 'playing') { this.beatAt = 0; return; }
    // schedule a little ahead of the audio clock, so a slow frame never drops a note
    if (this.beatAt < ac.currentTime) this.beatAt = ac.currentTime + 0.05;
    const step = 0.21 - 0.05 * boost;
    while (this.beatAt < ac.currentTime + 0.25) {
      const sc = SCALES[chapter % SCALES.length];
      const root = 110 * 2 ** ((chapter * 2) / 12);
      const n = sc[this.beat % sc.length] + (Math.floor(this.beat / 16) % 2 ? 5 : 0);
      const d = this.beatAt - ac.currentTime;
      this.note(root * 2 * 2 ** (n / 12), step * 0.9, 'triangle', 0.022, 1, d);
      if (this.beat % 4 === 0) this.note(root * 2 ** ((sc[0] + (Math.floor(this.beat / 16) % 2 ? 5 : 0)) / 12), step * 3.6, 'sine', 0.05, 1, d);
      if (this.beat % 2 === 1) this.note(4200, 0.03, 'square', 0.006, 0.6, d);
      this.beat++;
      this.beatAt += step;
    }
  }
}
