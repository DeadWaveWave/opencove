/** The full-screen pass: one triangle covering the viewport. */
export const WALL_VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

// Each fragment finds its cell, samples that cell's colour and blends toward the seam colour
// near the cell's edges.
export const WALL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCells;
uniform vec2 uGrid;
uniform float uHeight;
uniform float uDpr;
uniform vec2 uOrigin;
uniform float uCell;
uniform float uGap;
uniform vec3 uGapColor;
out vec4 color;
void main() {
  vec2 css = vec2(gl_FragCoord.x, uHeight * uDpr - gl_FragCoord.y) / uDpr;
  vec2 g = (css - uOrigin) / uCell;
  vec2 id = floor(g);
  vec2 f = g - id;
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * uCell;
  float aa = 0.6 / uDpr;
  vec3 cell = texture(uCells, (id + 0.5) / uGrid).rgb;
  float seam = 1.0 - smoothstep(uGap * 0.5 - aa, uGap * 0.5 + aa, edge);
  color = vec4(mix(cell, uGapColor, seam), 1.0);
}`

// One instance per window: a unit quad scaled to the window's screen rect.
export const FROST_VERTEX = `#version 300 es
in vec4 rect;
uniform vec2 uSize;
out vec2 vCss;
flat out vec4 vRect;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 css = rect.xy + corner * rect.zw;
  vCss = css;
  vRect = rect;
  gl_Position = vec4(css.x / uSize.x * 2.0 - 1.0, 1.0 - css.y / uSize.y * 2.0, 0.0, 1.0);
}`

// Frosted glass (Tide): inside each window's rounded frame the cells are not drawn sharp. Four
// filtered taps between texel centres read the cell image at about half resolution, smoothly
// scaled; a very faint grid stays on top. Premultiplied, so the frame's corners blend.
export const FROST_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCells;
uniform vec2 uGrid;
uniform float uDpr;
uniform vec2 uOrigin;
uniform float uCell;
uniform float uGap;
uniform vec3 uGapColor;
uniform float uRadius;
in vec2 vCss;
flat in vec4 vRect;
out vec4 color;
void main() {
  vec2 half_size = vRect.zw * 0.5;
  vec2 q = abs(vCss - vRect.xy - half_size) - half_size + uRadius;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float aa = 0.6 / uDpr;
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  vec2 g = (vCss - uOrigin) / uCell;
  vec2 t = g / uGrid;
  vec2 off = 0.75 / uGrid;
  vec3 frost = 0.25 * (
    texture(uCells, t - off).rgb + texture(uCells, t + off).rgb +
    texture(uCells, t + vec2(off.x, -off.y)).rgb + texture(uCells, t + vec2(-off.x, off.y)).rgb
  );
  vec2 f = fract(g);
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * uCell;
  frost = mix(frost, uGapColor, 0.16 * (1.0 - smoothstep(uGap * 1.2 - aa, uGap * 1.2 + aa, edge)));
  color = vec4(frost * inside, inside);
}`
