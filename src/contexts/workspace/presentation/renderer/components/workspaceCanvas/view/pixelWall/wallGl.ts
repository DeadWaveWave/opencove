import type { WallGlCallbacks } from './wallController'
import type { WallFrame, WallSurface } from './wallFrame'
import { FROST_FRAGMENT, FROST_VERTEX, WALL_FRAGMENT, WALL_VERTEX } from './wallGlShaders'

interface GlResources {
  wall: WebGLProgram
  wallVao: WebGLVertexArrayObject
  wallBuffer: WebGLBuffer
  frost: WebGLProgram
  frostVao: WebGLVertexArrayObject
  rectBuffer: WebGLBuffer
  rectCapacity: number
  texture: WebGLTexture
  /** The frost reads the same cells with linear filtering; the wall reads them sharp. */
  linear: WebGLSampler
  wallUniforms: Record<string, WebGLUniformLocation | null>
  frostUniforms: Record<string, WebGLUniformLocation | null>
  textureWidth: number
  textureHeight: number
}

const SHARED_UNIFORMS = ['uCells', 'uGrid', 'uDpr', 'uOrigin', 'uCell', 'uGap', 'uGapColor']

function compile(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
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
  const vertex = shader(gl.VERTEX_SHADER, vertexSource)
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource)
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

function uniformsOf(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]))
}

function createResources(gl: WebGL2RenderingContext): GlResources {
  const wall = compile(gl, WALL_VERTEX, WALL_FRAGMENT)
  const frost = compile(gl, FROST_VERTEX, FROST_FRAGMENT)
  const wallVao = gl.createVertexArray()!
  const wallBuffer = gl.createBuffer()!
  gl.bindVertexArray(wallVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, wallBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(wall, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const frostVao = gl.createVertexArray()!
  const rectBuffer = gl.createBuffer()!
  const rectCapacity = 64
  gl.bindVertexArray(frostVao)
  gl.bindBuffer(gl.ARRAY_BUFFER, rectBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, rectCapacity * 16, gl.DYNAMIC_DRAW)
  const rect = gl.getAttribLocation(frost, 'rect')
  gl.enableVertexAttribArray(rect)
  gl.vertexAttribPointer(rect, 4, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(rect, 1)
  gl.bindVertexArray(null)
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  const linear = gl.createSampler()!
  gl.samplerParameteri(linear, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.samplerParameteri(linear, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.samplerParameteri(linear, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.samplerParameteri(linear, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return {
    wall,
    wallVao,
    wallBuffer,
    frost,
    frostVao,
    rectBuffer,
    rectCapacity,
    texture,
    linear,
    wallUniforms: uniformsOf(gl, wall, [...SHARED_UNIFORMS, 'uHeight']),
    frostUniforms: uniformsOf(gl, frost, [...SHARED_UNIFORMS, 'uSize', 'uRadius']),
    textureWidth: 0,
    textureHeight: 0,
  }
}

/**
 * The wall on WebGL2: the CPU uploads one colour per cell as a small texture and the GPU draws
 * cells and seams in one pass, then the frosted glass behind every window in one instanced pass
 * whose cost follows window area. Returns null when WebGL2 is unavailable or would only run in
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
      const shared = (uniforms: Record<string, WebGLUniformLocation | null>) => {
        gl.uniform1i(uniforms.uCells!, 0)
        gl.uniform2f(uniforms.uGrid!, grid.columns, grid.rows)
        gl.uniform1f(uniforms.uDpr!, frame.dpr)
        gl.uniform2f(uniforms.uOrigin!, grid.originX, grid.originY)
        gl.uniform1f(uniforms.uCell!, grid.screenCell)
        gl.uniform1f(uniforms.uGap!, grid.gap)
        gl.uniform3f(uniforms.uGapColor!, gapColor[0] / 255, gapColor[1] / 255, gapColor[2] / 255)
      }
      gl.disable(gl.BLEND)
      gl.useProgram(r.wall)
      shared(r.wallUniforms)
      gl.uniform1f(r.wallUniforms.uHeight!, frame.height)
      gl.bindVertexArray(r.wallVao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      // Windows, then the shell's chrome: one instanced frost draw each, as their corners differ.
      for (const glass of [frame.glass, frame.chrome]) {
        if (glass.count === 0) {
          continue
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, r.rectBuffer)
        if (glass.count > r.rectCapacity) {
          r.rectCapacity = Math.max(glass.count, r.rectCapacity * 2)
          gl.bufferData(gl.ARRAY_BUFFER, r.rectCapacity * 16, gl.DYNAMIC_DRAW)
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, glass.rects, 0, glass.count * 4)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.useProgram(r.frost)
        shared(r.frostUniforms)
        gl.uniform2f(r.frostUniforms.uSize!, frame.width, frame.height)
        gl.uniform1f(r.frostUniforms.uRadius!, glass.radius)
        gl.bindSampler(0, r.linear)
        gl.bindVertexArray(r.frostVao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, glass.count)
        gl.bindSampler(0, null)
        gl.disable(gl.BLEND)
      }
      gl.bindVertexArray(null)
    },
    dispose(): void {
      disposed = true
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (resources && !gl.isContextLost()) {
        gl.deleteTexture(resources.texture)
        gl.deleteSampler(resources.linear)
        gl.deleteBuffer(resources.wallBuffer)
        gl.deleteBuffer(resources.rectBuffer)
        gl.deleteVertexArray(resources.wallVao)
        gl.deleteVertexArray(resources.frostVao)
        gl.deleteProgram(resources.wall)
        gl.deleteProgram(resources.frost)
      }
      resources = null
      // Give the context back now rather than at garbage collection: terminals share the budget.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
