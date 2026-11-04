import type { WallGlCallbacks } from './wallController'
import type { WallFrame, WallSurface } from './wallFrame'

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

// One full-screen pass: each fragment finds its cell, samples that cell's colour and blends
// toward the seam colour near the cell's edges.
const FRAGMENT = `#version 300 es
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

interface GlResources {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  buffer: WebGLBuffer
  texture: WebGLTexture
  uniforms: Record<string, WebGLUniformLocation | null>
  textureWidth: number
  textureHeight: number
}

function compile(gl: WebGL2RenderingContext): WebGLProgram {
  const shader = (type: number, source: string) => {
    const result = gl.createShader(type)
    if (!result) {
      throw new Error('pixel wall: cannot create shader')
    }
    gl.shaderSource(result, source)
    gl.compileShader(result)
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(result) ?? 'pixel wall: shader failed')
    }
    return result
  }
  const program = gl.createProgram()
  if (!program) {
    throw new Error('pixel wall: cannot create program')
  }
  const vertex = shader(gl.VERTEX_SHADER, VERTEX)
  const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'pixel wall: link failed')
  }
  return program
}

function createResources(gl: WebGL2RenderingContext): GlResources {
  const program = compile(gl)
  const vao = gl.createVertexArray()!
  const buffer = gl.createBuffer()!
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  // One triangle that covers the whole viewport.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const location = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  const uniforms = Object.fromEntries(
    ['uCells', 'uGrid', 'uHeight', 'uDpr', 'uOrigin', 'uCell', 'uGap', 'uGapColor'].map(name => [
      name,
      gl.getUniformLocation(program, name),
    ]),
  )
  return { program, vao, buffer, texture, uniforms, textureWidth: 0, textureHeight: 0 }
}

/**
 * The wall on WebGL2: the CPU uploads one colour per cell as a small texture and the GPU draws
 * cells and seams in one pass. Returns null when WebGL2 is unavailable or would only run in
 * software, so the caller falls back to Canvas 2D. A lost context is reported and, once the
 * browser restores it, every resource is rebuilt.
 */
export function createWallGl(
  canvas: HTMLCanvasElement,
  callbacks: WallGlCallbacks,
): WallSurface | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
  })
  if (!gl) {
    return null
  }
  let resources: GlResources | null = createResources(gl)
  let disposed = false

  const onLost = (event: Event) => {
    // Without preventDefault the browser never offers the context back.
    event.preventDefault()
    resources = null
    callbacks.onLost()
  }
  const onRestored = () => {
    if (disposed) {
      return
    }
    try {
      resources = createResources(gl)
    } catch {
      return
    }
    callbacks.onRestored()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    draw(frame: WallFrame): void {
      if (!resources || gl.isContextLost()) {
        return
      }
      const { grid, cells, gapColor } = frame
      const width = Math.round(frame.width * frame.dpr)
      const height = Math.round(frame.height * frame.dpr)
      if (canvas.width !== width) {
        canvas.width = width
      }
      if (canvas.height !== height) {
        canvas.height = height
      }
      if (width === 0 || height === 0 || grid.columns === 0 || grid.rows === 0) {
        return
      }
      const r = resources
      gl.viewport(0, 0, width, height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, r.texture)
      if (r.textureWidth === grid.columns && r.textureHeight === grid.rows) {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          grid.columns,
          grid.rows,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          cells,
        )
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          grid.columns,
          grid.rows,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          cells,
        )
        r.textureWidth = grid.columns
        r.textureHeight = grid.rows
      }
      gl.useProgram(r.program)
      gl.uniform1i(r.uniforms.uCells!, 0)
      gl.uniform2f(r.uniforms.uGrid!, grid.columns, grid.rows)
      gl.uniform1f(r.uniforms.uHeight!, frame.height)
      gl.uniform1f(r.uniforms.uDpr!, frame.dpr)
      gl.uniform2f(r.uniforms.uOrigin!, grid.originX, grid.originY)
      gl.uniform1f(r.uniforms.uCell!, grid.screenCell)
      gl.uniform1f(r.uniforms.uGap!, grid.gap)
      gl.uniform3f(r.uniforms.uGapColor!, gapColor[0] / 255, gapColor[1] / 255, gapColor[2] / 255)
      gl.bindVertexArray(r.vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindVertexArray(null)
    },
    dispose(): void {
      disposed = true
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (resources && !gl.isContextLost()) {
        gl.deleteTexture(resources.texture)
        gl.deleteBuffer(resources.buffer)
        gl.deleteVertexArray(resources.vao)
        gl.deleteProgram(resources.program)
      }
      resources = null
      // Give the context back now rather than at garbage collection: terminals share the budget.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
