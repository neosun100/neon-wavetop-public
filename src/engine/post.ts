/* GENERATED from gameforge/src/post.ts — do not edit. Change ~/Code/gameforge, then run: node ~/Code/gameforge/sync.mjs <game>. Checked by tests/engine.test.ts. */
/**
 * WebGL2 post-processing. The 2D scene is drawn on an offscreen canvas with a transparent
 * background, uploaded as a texture, then composited over a procedural nebula with:
 * dual-Kawase bloom, shockwave refraction, chromatic aberration, block glitch,
 * afterimage persistence, scanlines, vignette, grain and a scanline wipe transition.
 */

export interface Shock {
  /** Centre in UV space (0..1, y up). */
  x: number;
  y: number;
  /** 0..1 progress. */
  age: number;
  strength: number;
}

export interface PostParams {
  time: number;
  shocks: Shock[];
  aberration: number;
  glitch: number;
  bloom: number;
  persistence: number;
  vignette: number;
  wipe: number;
  /** Additive tint, already flash-limited by the caller. */
  flash: [number, number, number];
  /** Music beat envelope 0..1 — breathes the background. */
  beat: number;
  hue: number;
  /**
   * Bloom threshold [start, full] (default [0.35, 0.85]) and how brightness is judged:
   * 0 = brightest channel (default; right for thin neon lines), 1 = luminance. Large saturated
   * colour areas (gems) need luminance: by brightest channel a pure red is "bright", so whole
   * colour areas bloom and the dark gaps between them fill with haze.
   */
  bloomKnee?: [number, number];
  bloomLuma?: number;
  /** Scanline depth and film grain, 1 = default. Lower them for large saturated colour areas,
   *  where the stripes and the grain read as a grey veil. */
  scanlines?: number;
  grain?: number;
  /** Bloom radius in chain levels (1–5, default 5 = widest) and bloom saturation (1 = as is,
   *  >1 re-saturates the blurred light so a glow keeps its hue instead of spreading grey). */
  bloomLevels?: number;
  bloomSat?: number;
  /** Hue-preserving highlight shoulder, 0 = off (default, hard clip). With 1, a colour about to
   *  exceed 1.0 is scaled down as a whole above a 0.8 knee, so an explosion reads as brighter
   *  red / gold instead of every channel clipping to white. */
  tonemap?: number;
}

const MAX_SHOCKS = 6;
const BLOOM_LEVELS = 5;

const VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_THRESHOLD = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uKnee; uniform vec2 uLuma;
void main() {
  vec4 c = texture(uTex, vUv);
  float l = mix(max(c.r, max(c.g, c.b)), dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), uLuma.x);
  o = vec4(c.rgb * smoothstep(uKnee.x, uKnee.y, l), 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uHalf;
void main() {
  vec4 s = texture(uTex, vUv) * 4.0;
  s += texture(uTex, vUv - uHalf);
  s += texture(uTex, vUv + uHalf);
  s += texture(uTex, vUv + vec2(uHalf.x, -uHalf.y));
  s += texture(uTex, vUv - vec2(uHalf.x, -uHalf.y));
  o = s / 8.0;
}`;

const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uHalf;
void main() {
  vec2 h = uHalf;
  vec4 s = texture(uTex, vUv + vec2(-h.x * 2.0, 0.0));
  s += texture(uTex, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uTex, vUv + vec2(0.0, h.y * 2.0));
  s += texture(uTex, vUv + vec2(h.x, h.y)) * 2.0;
  s += texture(uTex, vUv + vec2(h.x * 2.0, 0.0));
  s += texture(uTex, vUv + vec2(h.x, -h.y)) * 2.0;
  s += texture(uTex, vUv + vec2(0.0, -h.y * 2.0));
  s += texture(uTex, vUv + vec2(-h.x, -h.y)) * 2.0;
  o = s / 12.0;
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom, uPrev;
uniform vec2 uRes;
uniform float uTime, uAberr, uGlitch, uBloomAmt, uPersist, uVig, uWipe, uBeat, uHue, uScan, uGrain, uBloomSat, uTone;
uniform vec3 uFlash;
uniform vec4 uShock[${MAX_SHOCKS}];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
vec3 hueShift(vec3 c, float h) {
  const vec3 k = vec3(0.57735);
  float ca = cos(h);
  return c * ca + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ca);
}
vec3 background(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.03;
  float n = fbm(p * 2.2 + vec2(t, -t * 0.7));
  float m = fbm(p * 4.0 - vec2(t * 1.3, t) + n);
  vec3 deep = vec3(0.012, 0.015, 0.045);
  vec3 c1 = vec3(0.18, 0.02, 0.32);
  vec3 c2 = vec3(0.0, 0.22, 0.32);
  vec3 col = deep + c1 * pow(m, 3.0) * 1.1 + c2 * pow(n, 4.0) * 0.9;
  // starfield: two parallax layers, twinkling
  for (int l = 0; l < 2; l++) {
    float s = l == 0 ? 90.0 : 180.0;
    vec2 g = p * s + vec2(uTime * (l == 0 ? 0.6 : 0.25), 0.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash(id + float(l) * 7.0);
    if (h > 0.985) {
      float tw = 0.5 + 0.5 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
      col += vec3(0.6, 0.8, 1.0) * smoothstep(0.08, 0.0, length(f)) * tw * (l == 0 ? 0.9 : 0.5);
    }
  }
  // perspective floor grid at the bottom, breathing with the beat
  float horizon = 0.28;
  if (uv.y < horizon) {
    float z = horizon / max(horizon - uv.y, 0.001);
    vec2 gp = vec2(p.x * z, z + uTime * 0.6);
    vec2 gl = abs(fract(gp * 1.2) - 0.5) / fwidth(gp * 1.2);
    float line = 1.0 - min(min(gl.x, gl.y), 1.0);
    float fade = smoothstep(0.0, horizon, uv.y) * smoothstep(horizon, horizon - 0.12, uv.y);
    col += vec3(0.9, 0.15, 0.85) * line * fade * (0.25 + 0.35 * uBeat);
  }
  return hueShift(col, uHue);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  // shockwave refraction
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.0) continue;
    vec2 d = (uv - s.xy) * vec2(aspect, 1.0);
    float r = length(d);
    float ring = s.z * 0.45;
    float w = 0.035 + s.z * 0.03;
    float f = exp(-pow((r - ring) / w, 2.0)) * s.w * (1.0 - s.z);
    uv -= normalize(d + 1e-5) / vec2(aspect, 1.0) * f * 0.018;
  }
  // block glitch
  if (uGlitch > 0.0) {
    float row = floor(uv.y * 36.0);
    float n = hash(vec2(row, floor(uTime * 24.0)));
    if (n < uGlitch * 0.6) uv.x += (hash(vec2(row * 3.1, uTime)) - 0.5) * 0.12 * uGlitch;
  }
  vec2 off = (uv - 0.5) * (uAberr + uGlitch * 0.02);
  vec4 sc = texture(uScene, uv);
  float r = texture(uScene, uv + off).r;
  float b = texture(uScene, uv - off).b;
  vec3 scene = vec3(r, sc.g, b);
  float a = max(sc.a, max(r, b) * 0.9);
  vec3 col = background(uv) * (1.0 - clamp(a, 0.0, 1.0)) + scene;
  vec3 bl = texture(uBloom, uv).rgb;
  float bll = dot(bl, vec3(0.2126, 0.7152, 0.0722));
  col += max(mix(vec3(bll), bl, uBloomSat), 0.0) * uBloomAmt;
  col = max(col, texture(uPrev, vUv).rgb * uPersist);
  if (uTone > 0.0) {
    float m = max(col.r, max(col.g, col.b));
    if (m > 0.8) {
      float nm = 0.8 + 0.2 * (1.0 - exp(-(m - 0.8) / 0.2));
      col *= mix(1.0, nm / m, uTone);
    }
  }
  // scanlines + vignette + grain
  col *= 1.0 - uScan * 0.07 * (1.0 - sin(gl_FragCoord.y * 3.14159 * 0.5));
  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
  col *= mix(1.0, smoothstep(1.15, 0.25, length(v)), uVig);
  col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.025 * uGrain;
  col += uFlash;
  // scanline wipe: dark band sweeping down with a hot leading edge
  if (uWipe > 0.0) {
    float y = 1.0 - vUv.y;
    float e = uWipe * 1.2 - 0.1;
    float mask = smoothstep(e, e - 0.1, y);
    col = mix(col, vec3(0.0), mask * (1.0 - smoothstep(0.9, 1.0, uWipe)));
    col += vec3(0.2, 0.9, 1.0) * exp(-pow((y - e) * 60.0, 2.0)) * (1.0 - uWipe);
  }
  o = vec4(col, 1.0);
}`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class Post {
  private readonly gl: WebGL2RenderingContext;
  private readonly sceneTex: WebGLTexture;
  private readonly progs: Record<'threshold' | 'down' | 'up' | 'composite' | 'blit', Prog>;
  private bloom: Target[] = [];
  private accum: Target[] = [];
  private ping = 0;
  private w = 0;
  private h = 0;

  /** Throws if WebGL2 is unavailable; the caller falls back to plain 2D (and says so). */
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.sceneTex = this.makeTex();
    this.progs = {
      threshold: this.program(FS_THRESHOLD),
      down: this.program(FS_DOWN),
      up: this.program(FS_UP),
      composite: this.program(FS_COMPOSITE),
      blit: this.program(FS_BLIT),
    };
    gl.bindVertexArray(gl.createVertexArray());
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const gl = this.gl;
    for (const t of [...this.bloom, ...this.accum]) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.bloom = [];
    let bw = w >> 1;
    let bh = h >> 1;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloom.push(this.target(Math.max(1, bw), Math.max(1, bh)));
      bw >>= 1;
      bh >>= 1;
    }
    this.accum = [this.target(w, h), this.target(w, h)];
  }

  render(src: HTMLCanvasElement, p: PostParams): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

    // bloom: threshold → down chain → up chain (result lands in bloom[0])
    this.pass(this.progs.threshold, this.bloom[0], [this.sceneTex], { uKnee: p.bloomKnee ?? [0.35, 0.85], uLuma: [p.bloomLuma ?? 0, 0] });
    const levels = Math.max(1, Math.min(BLOOM_LEVELS, Math.round(p.bloomLevels ?? BLOOM_LEVELS)));
    for (let i = 1; i < levels; i++) {
      const s = this.bloom[i - 1];
      this.pass(this.progs.down, this.bloom[i], [s.tex], { uHalf: [0.5 / s.w, 0.5 / s.h] });
    }
    for (let i = levels - 1; i > 0; i--) {
      const s = this.bloom[i];
      this.pass(this.progs.up, this.bloom[i - 1], [s.tex], { uHalf: [0.5 / s.w, 0.5 / s.h] });
    }

    const prev = this.accum[this.ping];
    const out = this.accum[1 - this.ping];
    const c = this.progs.composite;
    gl.useProgram(c.p);
    gl.uniform2f(c.u.uRes, this.w, this.h);
    gl.uniform1f(c.u.uTime, p.time);
    gl.uniform1f(c.u.uAberr, p.aberration);
    gl.uniform1f(c.u.uGlitch, p.glitch);
    gl.uniform1f(c.u.uBloomAmt, p.bloom);
    gl.uniform1f(c.u.uScan, p.scanlines ?? 1);
    gl.uniform1f(c.u.uGrain, p.grain ?? 1);
    gl.uniform1f(c.u.uBloomSat, p.bloomSat ?? 1);
    gl.uniform1f(c.u.uTone, p.tonemap ?? 0);
    gl.uniform1f(c.u.uPersist, p.persistence);
    gl.uniform1f(c.u.uVig, p.vignette);
    gl.uniform1f(c.u.uWipe, p.wipe);
    gl.uniform1f(c.u.uBeat, p.beat);
    gl.uniform1f(c.u.uHue, p.hue);
    gl.uniform3f(c.u.uFlash, p.flash[0], p.flash[1], p.flash[2]);
    const sh = new Float32Array(MAX_SHOCKS * 4);
    p.shocks.slice(0, MAX_SHOCKS).forEach((s, i) => sh.set([s.x, s.y, s.age, s.strength], i * 4));
    gl.uniform4fv(c.u['uShock[0]'], sh);
    this.pass(c, out, [this.sceneTex, this.bloom[0].tex, prev.tex], undefined, ['uScene', 'uBloom', 'uPrev']);
    this.pass(this.progs.blit, null, [out.tex]);
    this.ping = 1 - this.ping;
  }

  private pass(prog: Prog, dst: Target | null, texs: WebGLTexture[], uniforms?: Record<string, number[]>, names = ['uTex']): void {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
    texs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(prog.u[names[i]], i);
    });
    if (uniforms) for (const [k, v] of Object.entries(uniforms)) gl.uniform2f(prog.u[k], v[0], v[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.makeTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('createFramebuffer failed');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private program(fs: string): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('createShader failed');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader compile: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram failed');
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program link: ${gl.getProgramInfoLog(p)}`);
    const u: Record<string, WebGLUniformLocation | null> = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info) u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
}
