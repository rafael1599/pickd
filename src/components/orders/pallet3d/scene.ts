/**
 * El armado de una tarima en 3D, en WebGL2 puro (Rafael, 29 sep 2026: «que se
 * vea en 3D con medidas reales… interactivo, como si fuese videojuego», y sin
 * three.js).
 *
 * Todo es una caja: el piso, las tablas de la madera, las cajas de las bicis y
 * la caja «fantasma» que marca dónde va la siguiente. Un cubo unitario y una
 * instancia por caja (centro, tamaño, color, efectos): una llamada de dibujo
 * para lo opaco y otra para lo translúcido. Lo que da el aspecto —el cartón,
 * la cinta, la veta, las aristas, la cuadrícula del piso, la sombra— lo pinta
 * el shader a partir de coordenadas en pulgadas, sin texturas que cargar.
 *
 * Se dibuja sólo cuando algo cambia o se mueve: quieto no gasta batería.
 */
import {
  add,
  cross,
  lookAt,
  multiply,
  normalize,
  perspective,
  project,
  rayBox,
  scale,
  sub,
  type Vec3,
} from './math';

export type BoxKind = 'big' | 'kid' | 'electric';

export interface SceneBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Giro sobre el eje largo (z), en radianes: una caja ladeada. */
  tilt: number;
  kind: BoxKind;
  /** Acostada: su frente queda apaisado y su costado mira arriba. */
  flat: boolean;
}

/** Dónde está la etiqueta de una caja en la textura; `heightIn / widthIn` es su proporción. */
export interface SceneLabel {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** A lo largo de la caja y a lo alto de su cara. */
  widthIn: number;
  heightIn: number;
}

/** Media altura de una caja ya girada: una ladeada llega más arriba que su mitad. */
export const halfHeight = (b: { sx: number; sy: number; tilt: number }) =>
  Math.abs((b.sx / 2) * Math.sin(b.tilt)) + (b.sy / 2) * Math.cos(b.tilt);

export interface SceneSize {
  length: number;
  width: number;
  height: number;
}

interface Options {
  reducedMotion: boolean;
  /** Una caja acaba de asentarse (para el zumbido y el HUD). */
  onLand?: (index: number) => void;
  /** Un toque sin arrastrar: la caja tocada, o `null` si fue al vacío. */
  onTap?: (index: number | null) => void;
}

const FLOATS_PER_INSTANCE = 23;
const DROP_S = 0.62;
const DROP_HEIGHT_IN = 46;
const MAX_HEIGHT_IN = 90;

const FOG: Vec3 = [0.055, 0.067, 0.09];
const KRAFT: Record<BoxKind, Vec3> = {
  big: [0.76, 0.58, 0.37],
  kid: [0.84, 0.69, 0.47],
  electric: [0.62, 0.66, 0.5],
};

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iCenter;
layout(location=3) in vec3 iScale;
layout(location=4) in vec4 iColor;
layout(location=5) in vec4 iFx;
layout(location=6) in float iTilt;
layout(location=7) in vec4 iLabel;
layout(location=8) in vec4 iLabelSize;
uniform mat4 uVP;
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec3 vScale; out vec4 vColor; out vec4 vFx;
out vec3 vFaceNormal; out vec4 vLabel; out vec4 vLabelSize;
void main() {
  vec3 p = aPos * iScale;
  float c = cos(iTilt), s = sin(iTilt);
  vec3 w = iCenter + vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  vec3 n = vec3(aNormal.x * c - aNormal.y * s, aNormal.x * s + aNormal.y * c, aNormal.z);
  vWorld = w; vNormal = n; vLocal = aPos; vScale = iScale; vColor = iColor; vFx = iFx;
  vFaceNormal = aNormal; vLabel = iLabel; vLabelSize = iLabelSize;
  gl_Position = uVP * vec4(w, 1.0);
}`;

// iFx: x = tipo (0 cartón, 1 madera, 2 fantasma, 3 piso, 4 tope de 90"),
//      y = destello al asentarse, z = seleccionada, w = lleva cinta.
const FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec3 vScale; in vec4 vColor; in vec4 vFx;
in vec3 vFaceNormal; in vec4 vLabel; in vec4 vLabelSize;
uniform vec3 uEye; uniform vec3 uFog; uniform float uTime; uniform vec2 uShadow;
uniform sampler2D uAtlas; uniform float uHasAtlas; uniform vec4 uLogo;

// Un rectángulo de la textura pegado en una cara. p en pulgadas: x a la derecha
// de quien mira la cara, y hacia arriba. turned = la celda cae girada a derechas
// (su lado largo hacia arriba): así se lee de pie lo que en la celda va de lado.
vec4 decal(vec2 p, vec2 center, vec2 size, vec4 rect, bool turned) {
  vec2 q = (p - center) / size + 0.5;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  vec2 t = turned ? vec2(1.0 - q.y, 1.0 - q.x) : vec2(q.x, 1.0 - q.y);
  return texture(uAtlas, vec2(mix(rect.x, rect.z, t.x), mix(rect.y, rect.w, t.y)));
}
out vec4 outColor;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 d = (0.5 - abs(vLocal)) * vScale;
  float edge = abs(n.x) > 0.5 ? min(d.y, d.z) : abs(n.y) > 0.5 ? min(d.x, d.z) : min(d.x, d.y);
  float line = 1.0 - smoothstep(0.12, 0.42, edge);
  float kind = vFx.x;
  vec3 base = vColor.rgb;
  float alpha = vColor.a;

  if (kind > 2.5 && kind < 3.5) {
    // Piso de concreto: cuadrícula de 1 pie, línea de seguridad y la sombra de la tarima.
    vec2 p = vWorld.xz;
    base = vec3(0.13, 0.145, 0.17) * (0.9 + 0.2 * noise(vec3(p * 0.35, 0.0)));
    vec2 g = abs(fract(p / 12.0 - 0.5) - 0.5) * 12.0;
    base += vec3(0.05) * (1.0 - smoothstep(0.0, 0.25, min(g.x, g.y)));
    vec2 r = abs(p) - vec2(34.0, 40.0);
    float border = abs(max(r.x, r.y));
    float dash = step(0.5, fract((p.x + p.y) / 10.0));
    base = mix(base, vec3(0.95, 0.74, 0.12), (1.0 - smoothstep(0.7, 1.1, border)) * dash * 0.9);
    vec2 q = abs(p) - uShadow;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    base *= 1.0 - 0.6 * (1.0 - smoothstep(-2.0, 16.0, sd));
    float dist = length(vWorld - uEye);
    outColor = vec4(mix(base, uFog, smoothstep(140.0, 380.0, dist)), 1.0);
    return;
  }

  if (kind < 0.5) {
    // Cartón: fibra, cinta por el centro de la tapa y bajando por las puntas.
    base *= 0.93 + 0.07 * noise(vWorld * vec3(0.9, 0.12, 0.9)) + 0.05 * noise(vWorld * 3.0);
    bool tapeBand = abs(vLocal.x * vScale.x) < 0.9;
    if (vFx.w > 0.5 && tapeBand && (n.y > 0.5 || (abs(n.z) > 0.5 && vLocal.y > 0.38))) {
      base = mix(base, vec3(0.86, 0.78, 0.62), 0.75);
    }
    // Como el cartón de verdad (Rafael, 29 sep 2026): la etiqueta y un logo
    // JAMIS BIKES chico van al frente —las puntas de la caja—; los costados
    // sólo llevan el logo grande. p siempre a la derecha y arriba de quien mira
    // esa cara, para que nada salga en espejo.
    bool flatBox = vLabelSize.z > 0.5;
    vec3 fn = vFaceNormal;
    if (uHasAtlas > 0.5) {
      vec4 logo = vec4(0.0);
      vec4 label = vec4(0.0);
      float aspect = vLabelSize.y / max(vLabelSize.x, 0.001);
      if (abs(fn.z) > 0.5) {
        vec2 p = vec2(vLocal.x * vScale.x * (fn.z > 0.0 ? 1.0 : -1.0), vLocal.y * vScale.y);
        float W = vScale.x;
        float H = vScale.y;
        if (!flatBox) {
          // De pie: la etiqueta derecha, el logo chico encima (fotos 2 y 3).
          float L = min(10.0, 0.42 * H);
          float S = L * aspect;
          float k = min(1.0, 0.8 * W / S);
          L *= k; S *= k;
          // Logo + hueco + etiqueta, un solo bloque centrado en la punta.
          float lw = min(0.8 * W, 7.0);
          float gap = 1.2;
          float block = lw / 4.0 + gap + L;
          vec2 lc = vec2(0.0, -block * 0.5 + L * 0.5);
          logo = decal(p, vec2(0.0, block * 0.5 - lw / 8.0), vec2(lw, lw / 4.0), uLogo, true);
          if (vLabelSize.w > 0.5) label = decal(p, lc, vec2(S, L), vLabel, true);
        } else {
          // Acostada: la etiqueta a lo largo y el logo chico a su izquierda (foto 1).
          float L = min(10.0, 0.4 * W);
          float S = L * aspect;
          float k = min(1.0, 0.8 * H / S);
          L *= k; S *= k;
          // Logo + hueco + etiqueta, un solo bloque centrado en la punta.
          float lh = min(0.85 * H, 7.0);
          float gap = 1.5;
          float block = lh / 4.0 + gap + L;
          vec2 lc = vec2(block * 0.5 - L * 0.5, 0.0);
          logo = decal(p, vec2(-block * 0.5 + lh / 8.0, 0.0), vec2(lh / 4.0, lh), uLogo, false);
          if (vLabelSize.w > 0.5) label = decal(p, lc, vec2(L, S), vLabel, false);
        }
      } else if (flatBox ? fn.y > 0.5 : abs(fn.x) > 0.5) {
        // Costado: el logo grande, de pie, a lo largo de la caja.
        float along = vLocal.z * vScale.z * (flatBox ? 1.0 : (fn.x > 0.0 ? -1.0 : 1.0));
        float up = flatBox ? vLocal.x * vScale.x : vLocal.y * vScale.y;
        float tall = flatBox ? vScale.x : vScale.y;
        float lw = min(0.55 * vScale.z, 3.4 * tall);
        logo = decal(vec2(along, up), vec2(0.0), vec2(lw, lw / 4.0), uLogo, true);
      }
      base = mix(base, logo.rgb, logo.a * 0.95);
      base = mix(base, label.rgb * 1.05, label.a);
    }
  } else if (kind < 1.5) {
    // Madera: veta a lo largo de la tabla.
    float grain = noise(vec3(vWorld.x * 0.25, vWorld.y * 3.0, vWorld.z * 2.2) + noise(vWorld * 0.5) * 2.0);
    base *= 0.78 + 0.34 * grain;
  }

  vec3 L1 = normalize(vec3(0.45, 0.9, 0.3));
  vec3 L2 = normalize(vec3(-0.6, 0.35, -0.7));
  float diff = max(dot(n, L1), 0.0) * 0.8 + max(dot(n, L2), 0.0) * 0.28;
  float hemi = 0.5 + 0.5 * n.y;
  vec3 col = base * (0.26 + 0.2 * hemi + diff * 0.72);
  col *= mix(0.7, 1.0, smoothstep(0.0, 5.0, (vLocal.y + 0.5) * vScale.y));
  col = mix(col, col * 0.42, line * 0.9);
  col += vec3(1.0, 0.82, 0.38) * vFx.y * 0.55;
  if (vFx.z > 0.5) col = mix(col, vec3(0.3, 0.82, 1.0), 0.32 + 0.12 * sin(uTime * 6.0));

  if (kind > 1.5 && kind < 2.5) {
    float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
    col = vec3(0.32, 0.86, 1.0);
    alpha = 0.1 + 0.1 * pulse + line * (0.55 + 0.35 * pulse);
  } else if (kind > 3.5) {
    col = vec3(1.0, 0.25, 0.3);
    alpha = 0.08 + line * 0.5;
  }

  float dist = length(vWorld - uEye);
  outColor = vec4(mix(col, uFog, smoothstep(140.0, 380.0, dist)), alpha);
}`;

/** Un cubo de lado 1 centrado en el origen, con sus normales: 36 vértices. */
function cube(): Float32Array {
  const faces: [Vec3, Vec3, Vec3][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
  ];
  const out: number[] = [];
  for (const [n, u, v] of faces) {
    const c = scale(n, 0.5);
    const corner = (a: number, b: number) => add(add(c, scale(u, a * 0.5)), scale(v, b * 0.5));
    const quad = [
      corner(-1, -1),
      corner(1, -1),
      corner(1, 1),
      corner(-1, -1),
      corner(1, 1),
      corner(-1, 1),
    ];
    // Que el triángulo mire hacia afuera: si u × v apunta contra la normal, al revés.
    const flip = cross(u, v).every((x, i) => Math.sign(x) === Math.sign(n[i]) || n[i] === 0)
      ? quad
      : quad.reverse();
    for (const p of flip) out.push(...p, ...n);
  }
  return new Float32Array(out);
}

/** La madera de 48 × 40 × 5: tablas arriba, tres largueros y tres tablas abajo. */
function deckInstances(): { c: Vec3; s: Vec3; tone: number }[] {
  const out: { c: Vec3; s: Vec3; tone: number }[] = [];
  const top = 7;
  const board = 5.5;
  for (let i = 0; i < top; i += 1) {
    const z = -24 + board / 2 + (i * (48 - board)) / (top - 1);
    out.push({ c: [0, 4.625, z], s: [40, 0.75, board], tone: 0.92 + 0.08 * ((i * 37) % 3) });
  }
  for (const x of [-19.25, 0, 19.25]) out.push({ c: [x, 2.5, 0], s: [1.5, 3.5, 48], tone: 0.82 });
  for (const z of [-21.25, 0, 21.25])
    out.push({ c: [0, 0.375, z], s: [40, 0.75, 5.5], tone: 0.86 });
  return out;
}

const easeOutBounce = (x: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

export class PalletScene {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private meshBuffer: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private deck = deckInstances();

  private boxes: SceneBox[] = [];
  private size: SceneSize = { length: 48, width: 40, height: 60 };
  private step = 0;
  private placedAt: number[] = [];
  private landed: boolean[] = [];
  private selected: number | null = null;
  private atlas: WebGLTexture | null = null;
  private labels: (SceneLabel | null)[] = [];
  private logo: SceneLabel | null = null;
  private showDims = true;
  /**
   * Lo que declara Ship para esta tarima —la misma cifra de su tabla— y qué ejes
   * salen de la cinta. Las cotas dicen esto, no lo que mide el dibujo.
   */
  private declared: { size: SceneSize; typed: Record<keyof SceneSize, boolean> } | null = null;

  // Cámara: órbita alrededor de la tarima.
  private yaw = 0.72;
  private pitch = 0.36;
  private dist = 150;
  private homeDist = 150;
  private vyaw = 0;
  private vpitch = 0;
  private intro: { start: number; fromDist: number; fromYaw: number } | null = null;
  private shakeAt = -10;
  private vp = new Float32Array(16);
  private eye: Vec3 = [0, 0, 0];

  private raf = 0;
  private start = performance.now();
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: {
    x: number;
    y: number;
    t: number;
    moved: boolean;
    pinch: number | null;
  } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    private opts: Options
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    // Un contexto que alguien perdió antes (un montaje anterior sobre este mismo
    // canvas) se pide de vuelta; si no vuelve, no hay 3D.
    if (gl.isContextLost()) {
      gl.getExtension('WEBGL_lose_context')?.restoreContext();
      if (gl.isContextLost()) throw new Error('WebGL2 context lost');
    }
    this.gl = gl;
    this.program = this.compile();
    for (const name of [
      'uVP',
      'uEye',
      'uFog',
      'uTime',
      'uShadow',
      'uAtlas',
      'uHasAtlas',
      'uLogo',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const mesh = gl.createBuffer()!;
    this.meshBuffer = mesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.bufferData(gl.ARRAY_BUFFER, cube(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = FLOATS_PER_INSTANCE * 4;
    const attr = (loc: number, size: number, offset: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(2, 3, 0);
    attr(3, 3, 3);
    attr(4, 4, 6);
    attr(5, 4, 10);
    attr(6, 1, 14);
    attr(7, 4, 15);
    attr(8, 4, 19);
    gl.bindVertexArray(null);

    this.bindInput();
    const ro = new ResizeObserver(() => this.invalidate());
    ro.observe(canvas);
    this.cleanup.push(() => ro.disconnect());
  }

  private compile(): WebGLProgram {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  /** Una tarima nueva: sus cajas, su medida y —si se puede— el vuelo de entrada. */
  setPallet(boxes: SceneBox[], size: SceneSize, step: number) {
    this.boxes = boxes;
    this.size = size;
    this.placedAt = boxes.map(() => -100);
    this.landed = boxes.map(() => true);
    this.step = Math.min(step, boxes.length);
    this.selected = null;
    const extent = Math.max(size.height, size.length, size.width, 50);
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    this.homeDist = extent * (aspect < 1 ? 2.35 : 2.05);
    if (this.opts.reducedMotion) {
      this.dist = this.homeDist;
    } else {
      this.intro = {
        start: performance.now(),
        fromDist: this.homeDist * 1.9,
        fromYaw: this.yaw - 1.4,
      };
    }
    this.invalidate();
  }

  /** Cuántas cajas están puestas. Las nuevas caen; las que sobran se levantan. */
  setStep(step: number) {
    const now = performance.now();
    const next = Math.max(0, Math.min(step, this.boxes.length));
    for (let i = this.step; i < next; i += 1) {
      this.placedAt[i] = this.opts.reducedMotion ? -100 : now + (i - this.step) * 90;
      this.landed[i] = this.opts.reducedMotion;
    }
    this.step = next;
    if (this.selected != null && this.selected >= next) this.selected = null;
    this.invalidate();
  }

  /** Las etiquetas, caja por caja, y la textura donde están. No reinicia el armado. */
  setLabels(atlas: HTMLCanvasElement, labels: (SceneLabel | null)[], logo: SceneLabel) {
    const gl = this.gl;
    if (!this.atlas) {
      this.atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      gl.texParameterf(
        gl.TEXTURE_2D,
        aniso.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
      );
    }
    this.labels = labels;
    this.logo = logo;
    this.invalidate();
  }

  setSelected(index: number | null) {
    this.selected = index;
    this.invalidate();
  }

  /** La medida de Ship. Cambiarla (alguien tecleó un eje) no vuelve a armar la tarima. */
  setDeclared(size: SceneSize | null, typed: Record<keyof SceneSize, boolean>) {
    this.declared = size ? { size, typed } : null;
    this.invalidate();
  }

  setShowDims(show: boolean) {
    this.showDims = show;
    this.invalidate();
  }

  resetCamera() {
    this.vyaw = 0;
    this.vpitch = 0;
    // Por el camino corto: si alguien dio tres vueltas, no se deshacen las tres.
    const wrapped = 0.72 + Math.atan2(Math.sin(this.yaw - 0.72), Math.cos(this.yaw - 0.72));
    this.yaw = wrapped;
    this.intro = this.opts.reducedMotion
      ? null
      : { start: performance.now(), fromDist: this.dist, fromYaw: wrapped };
    if (this.opts.reducedMotion) this.dist = this.homeDist;
    this.pitch = 0.36;
    this.invalidate();
  }

  /**
   * Suelta lo que creó esta escena, **sin perder el contexto**: el canvas es de
   * React y puede volver a montarse encima —en desarrollo `StrictMode` monta,
   * desmonta y monta otra vez—, y un `loseContext()` aquí dejaba ese segundo
   * montaje con un contexto muerto: el 3D se escondía solo (Rafael, 29 sep 2026,
   * en localhost).
   */
  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const fn of this.cleanup) fn();
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.meshBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  private invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ─── Entrada: arrastrar gira, pellizcar acerca, tocar elige, doble toque recentra ───
  private bindInput() {
    const c = this.canvas;
    let lastTap = 0;
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.intro = null;
      this.vyaw = 0;
      this.vpitch = 0;
      if (this.pointers.size === 1) {
        this.gesture = {
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          moved: false,
          pinch: null,
        };
      } else if (this.gesture) {
        const [a, b] = [...this.pointers.values()];
        this.gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.gesture.moved = true;
      }
    };
    const move = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.gesture) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2 && this.gesture.pinch != null) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.dist = Math.min(
          this.homeDist * 2.6,
          Math.max(this.homeDist * 0.45, this.dist * (this.gesture.pinch / d))
        );
        this.gesture.pinch = d;
      } else {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (Math.hypot(e.clientX - this.gesture.x, e.clientY - this.gesture.y) > 6)
          this.gesture.moved = true;
        this.vyaw = -dx * 0.0085;
        this.vpitch = dy * 0.0065;
        this.yaw += this.vyaw;
        this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + this.vpitch));
      }
      this.invalidate();
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (this.pointers.size > 0) return;
      this.gesture = null;
      if (!g) return;
      if (!g.moved && performance.now() - g.t < 350) {
        const now = performance.now();
        if (now - lastTap < 300) {
          this.resetCamera();
          lastTap = 0;
          return;
        }
        lastTap = now;
        this.opts.onTap?.(this.pick(e.clientX, e.clientY));
        this.vyaw = 0;
        this.vpitch = 0;
      }
      this.invalidate();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.intro = null;
      this.dist = Math.min(
        this.homeDist * 2.6,
        Math.max(this.homeDist * 0.45, this.dist * Math.exp(e.deltaY * 0.0012))
      );
      this.invalidate();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel);
    });
  }

  /** La caja puesta bajo el dedo, o `null`. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const target = this.target();
    const forward = normalize(sub(target, this.eye));
    const right = normalize(cross(forward, [0, 1, 0]));
    const upv = cross(right, forward);
    const t = Math.tan(this.fov() / 2);
    const dir = normalize(
      add(forward, add(scale(right, nx * t * (rect.width / rect.height)), scale(upv, ny * t)))
    );
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i < this.step; i += 1) {
      const b = this.boxes[i];
      const hit = rayBox(
        this.eye,
        dir,
        [b.x - b.sx / 2, b.y - b.sy / 2, b.z - b.sz / 2],
        [b.x + b.sx / 2, b.y + b.sy / 2, b.z + b.sz / 2]
      );
      if (hit != null && (!best || hit < best.d)) best = { i, d: hit };
    }
    return best?.i ?? null;
  }

  private fov = () => (this.canvas.clientWidth < this.canvas.clientHeight ? 0.95 : 0.8);
  // Por debajo del centro de la carga: la tarima sube en pantalla y deja sitio al HUD de abajo.
  private target = (): Vec3 => [0, Math.max(this.size.height, 30) * 0.24, 0];

  // ─── Un cuadro ───
  private frame(time: number) {
    this.raf = 0;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.overlay.width = w;
      this.overlay.height = h;
    }
    const seconds = (time - this.start) / 1000;
    let animating = false;
    let dropping = false;

    // Cámara: vuelo de entrada, inercia al soltar, temblor al asentarse una caja.
    if (this.intro) {
      const k = Math.min(1, (time - this.intro.start) / 1500);
      const e = easeOutCubic(k);
      this.dist = this.intro.fromDist + (this.homeDist - this.intro.fromDist) * e;
      this.yaw = this.intro.fromYaw + (0.72 - this.intro.fromYaw) * e;
      if (k >= 1) this.intro = null;
      animating = true;
    } else if (!this.gesture && (Math.abs(this.vyaw) > 1e-4 || Math.abs(this.vpitch) > 1e-4)) {
      this.yaw += this.vyaw;
      this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + this.vpitch));
      this.vyaw *= 0.92;
      this.vpitch *= 0.88;
      animating = true;
    }
    const shake = Math.exp(-(time - this.shakeAt) / 70) * 0.9;
    const target = this.target();
    this.eye = [
      target[0] + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      target[1] + this.dist * Math.sin(this.pitch) + Math.sin(time * 0.09) * shake,
      target[2] + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    ];
    if (shake > 0.02) animating = true;
    this.vp = multiply(perspective(this.fov(), w / h, 1, 1200), lookAt(this.eye, target));

    // Instancias: piso, madera, cajas puestas, y después lo translúcido.
    const opaque: number[] = [];
    const clear: number[] = [];
    const push = (
      to: number[],
      c: Vec3,
      s: Vec3,
      col: Vec3,
      a: number,
      fx: [number, number, number, number],
      tilt = 0,
      label: SceneLabel | null = null,
      flat = false
    ) =>
      to.push(
        c[0],
        c[1],
        c[2],
        s[0],
        s[1],
        s[2],
        col[0],
        col[1],
        col[2],
        a,
        ...fx,
        tilt,
        label?.u0 ?? 0,
        label?.v0 ?? 0,
        label?.u1 ?? 0,
        label?.v1 ?? 0,
        label?.widthIn ?? 0,
        label?.heightIn ?? 0,
        flat ? 1 : 0,
        label ? 1 : 0
      );

    push(opaque, [0, -0.5, 0], [900, 1, 900], [0, 0, 0], 1, [3, 0, 0, 0]);
    for (const d of this.deck) {
      push(opaque, d.c, d.s, [0.62 * d.tone, 0.45 * d.tone, 0.28 * d.tone], 1, [1, 0, 0, 0]);
    }
    let top = 5;
    for (let i = 0; i < this.step; i += 1) {
      const b = this.boxes[i];
      const t = (time - this.placedAt[i]) / 1000;
      let y = b.y;
      if (t < DROP_S) {
        animating = true;
        dropping = true;
        y += t < 0 ? DROP_HEIGHT_IN * 1.4 : DROP_HEIGHT_IN * (1 - easeOutBounce(t / DROP_S));
        if (t >= DROP_S * 0.36 && !this.landed[i]) {
          this.landed[i] = true;
          this.shakeAt = time;
          this.opts.onLand?.(i);
        }
      } else if (!this.landed[i]) {
        this.landed[i] = true;
        this.opts.onLand?.(i);
      }
      const flash = Math.max(0, 1 - (t - DROP_S * 0.36) / 0.45) * (t >= DROP_S * 0.36 ? 1 : 0);
      if (flash > 0) animating = true;
      if (t >= 0) top = Math.max(top, y + halfHeight(b));
      push(
        opaque,
        [b.x, y, b.z],
        [b.sx, b.sy, b.sz],
        KRAFT[b.kind],
        1,
        [0, flash, this.selected === i ? 1 : 0, 1],
        b.tilt,
        this.labels[i] ?? null,
        b.flat
      );
    }
    if (this.selected != null) animating = true;
    const ghost = this.boxes[this.step];
    if (ghost) {
      push(
        clear,
        [ghost.x, ghost.y, ghost.z],
        [ghost.sx + 0.2, ghost.sy + 0.2, ghost.sz + 0.2],
        [0, 0, 0],
        1,
        [2, 0, 0, 0],
        ghost.tilt
      );
      animating = true;
    }
    if (top > MAX_HEIGHT_IN - 12) {
      push(clear, [0, MAX_HEIGHT_IN, 0], [72, 0.2, 78], [0, 0, 0], 1, [4, 0, 0, 0]);
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp);
    gl.uniform3fv(this.u.uEye, this.eye);
    gl.uniform3fv(this.u.uFog, FOG);
    gl.uniform1f(this.u.uTime, seconds);
    const footprint = this.footprint();
    gl.uniform2f(this.u.uShadow, footprint[0], footprint[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(this.u.uAtlas, 0);
    gl.uniform1f(this.u.uHasAtlas, this.atlas && this.logo ? 1 : 0);
    const logo = this.logo;
    gl.uniform4f(this.u.uLogo, logo?.u0 ?? 0, logo?.v0 ?? 0, logo?.u1 ?? 0, logo?.v1 ?? 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(opaque), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, opaque.length / FLOATS_PER_INSTANCE);

    if (clear.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(clear), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, clear.length / FLOATS_PER_INSTANCE);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);

    this.drawOverlay(w, h, dpr, !dropping);
    if (animating) this.invalidate();
  }

  /** Lo que ocupa la carga en el piso, para la sombra. */
  private footprint(): [number, number] {
    let hx = 20;
    let hz = 24;
    for (let i = 0; i < this.step; i += 1) {
      const b = this.boxes[i];
      hx = Math.max(hx, Math.abs(b.x) + b.sx / 2);
      hz = Math.max(hz, Math.abs(b.z) + b.sz / 2);
    }
    return [hx, hz];
  }

  /** Las cotas: largo, ancho y alto dibujados sobre la esquina que da al ojo. */
  private drawOverlay(w: number, h: number, dpr: number, settled: boolean) {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!this.showDims || this.step < this.boxes.length || !settled || this.boxes.length === 0)
      return;

    let minX = -20;
    let maxX = 20;
    let minZ = -24;
    let maxZ = 24;
    let maxY = 5;
    for (const b of this.boxes) {
      minX = Math.min(minX, b.x - b.sx / 2);
      maxX = Math.max(maxX, b.x + b.sx / 2);
      minZ = Math.min(minZ, b.z - b.sz / 2);
      maxZ = Math.max(maxZ, b.z + b.sz / 2);
      maxY = Math.max(maxY, b.y + halfHeight(b));
    }
    const P = (p: Vec3) => project(this.vp, p, w, h);
    // La esquina de abajo más cercana al ojo: la que cae más abajo en pantalla.
    const corners: Vec3[] = [
      [minX, 0, minZ],
      [minX, 0, maxZ],
      [maxX, 0, minZ],
      [maxX, 0, maxZ],
    ];
    const front = corners
      .map((c) => ({ c, s: P(c) }))
      .filter((c) => c.s)
      .sort((a, b) => b.s!.y - a.s!.y)[0];
    if (!front) return;
    const [cx, , cz] = front.c;
    const ox = cx === minX ? maxX : minX;
    const oz = cz === minZ ? maxZ : minZ;
    const pad = 3;
    const px = cx === minX ? -pad : pad;
    const pz = cz === minZ ? -pad : pad;

    // El alto va en la arista del costado que se ve más a un lado, no en la de
    // delante: ahí la línea cruzaría por encima de las cajas.
    const side = corners
      .filter((c) => c !== front.c)
      .map((c) => ({ c, s: P(c) }))
      .filter((c) => c.s)
      .sort((a, b) => Math.abs(b.s!.x - w / 2) - Math.abs(a.s!.x - w / 2))[0];
    const [hx, , hz] = side?.c ?? front.c;
    const hpx = hx === minX ? -pad : pad;
    const hpz = hz === minZ ? -pad : pad;

    // Las cifras de la tabla de Ship, redondeadas igual (hacia arriba, como se
    // declaran); fuerte lo que midió la cinta, tenue lo calculado.
    const size = this.declared?.size ?? this.size;
    const typed = this.declared?.typed ?? { length: false, width: false, height: false };
    const edges: { a: Vec3; b: Vec3; text: string; tape: boolean }[] = [
      {
        a: [ox, 0, cz + pz],
        b: [cx, 0, cz + pz],
        text: `${Math.ceil(size.width)}″`,
        tape: typed.width,
      },
      {
        a: [cx + px, 0, oz],
        b: [cx + px, 0, cz],
        text: `${Math.ceil(size.length)}″`,
        tape: typed.length,
      },
      {
        a: [hx + hpx, 0, hz + hpz],
        b: [hx + hpx, maxY, hz + hpz],
        text: `${Math.ceil(size.height)}″`,
        tape: typed.height,
      },
    ];
    ctx.lineWidth = 1.5 * dpr;
    ctx.font = `800 ${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const e of edges) {
      const a = P(e.a);
      const b = P(e.b);
      if (!a || !b) continue;
      ctx.strokeStyle = e.tape ? 'rgba(251, 113, 133, 0.95)' : 'rgba(251, 113, 133, 0.55)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * 5 * dpr, p.y + Math.sin(ang) * 5 * dpr);
        ctx.lineTo(p.x - Math.cos(ang) * 5 * dpr, p.y - Math.sin(ang) * 5 * dpr);
        ctx.stroke();
      }
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const tw = ctx.measureText(e.text).width + 12 * dpr;
      ctx.fillStyle = 'rgba(15, 18, 24, 0.85)';
      ctx.beginPath();
      ctx.roundRect(mx - tw / 2, my - 10 * dpr, tw, 20 * dpr, 6 * dpr);
      ctx.fill();
      ctx.fillStyle = e.tape ? '#fb7185' : 'rgba(251, 113, 133, 0.65)';
      ctx.fillText(e.text, mx, my + 0.5 * dpr);
    }
  }
}
