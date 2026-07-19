import fragSource from './shaders/pixel-stretch.frag.glsl?raw'

// Direction is a host-side parameter so v2 can add 'vertical' without a
// rewrite (the shader gains a uniform/branch; this API doesn't change shape).
export type StretchDirection = 'horizontal'

const VERT_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

/** Hard cap on any render-target dimension, on top of the GPU's own limit. */
const SAFE_MAX_DIM = 8192

export interface RenderSize {
  width: number
  height: number
  /** True if the requested scale was clamped to fit GPU/canvas limits. */
  clamped: boolean
}

export class Renderer {
  readonly canvas: HTMLCanvasElement
  readonly direction: StretchDirection = 'horizontal'

  private gl: WebGL2RenderingContext
  private uPickX: WebGLUniformLocation
  private texture: WebGLTexture
  private sourceWidth = 0
  private sourceHeight = 0
  private maxDim: number

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      // Keeps the drawing buffer readable for toBlob()/captureStream()
      // regardless of compositing timing.
      preserveDrawingBuffer: true,
    })
    if (!gl) throw new Error('WebGL2 is not supported in this browser.')
    this.gl = gl
    this.maxDim = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, SAFE_MAX_DIM)

    const program = createProgram(gl, VERT_SOURCE, fragSource)
    gl.useProgram(program)
    const uPickX = gl.getUniformLocation(program, 'u_pickX')
    if (!uPickX) throw new Error('u_pickX uniform not found')
    this.uPickX = uPickX
    gl.uniform1i(gl.getUniformLocation(program, 'u_media'), 0)

    // Full-screen quad (triangle strip).
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const texture = gl.createTexture()
    if (!texture) throw new Error('Failed to create texture')
    this.texture = texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // Image row 0 (top) lands at t = 1, matching the shader's GL convention
    // (v_uv.y = 0 is the bottom). Documented in pixel-stretch.frag.glsl.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  }

  get hasSource(): boolean {
    return this.sourceWidth > 0
  }

  /** Upload a source frame and remember its intrinsic dimensions. */
  setSource(source: TexImageSource, width: number, height: number): void {
    this.sourceWidth = width
    this.sourceHeight = height
    // A video element with no decoded frame yet can't be uploaded; the
    // playback loop uploads it as soon as data is available.
    if (source instanceof HTMLVideoElement && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return
    }
    this.uploadFrame(source)
  }

  /** Re-upload the current frame of an already-set source (video playback). */
  uploadFrame(source: TexImageSource): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  /**
   * Size the render target to sourceBase × scale, clamped to GPU/canvas
   * limits (aspect ratio always preserved, dimensions kept even so H.264
   * yuv420p encoding never has to crop).
   */
  setScale(scale: number): RenderSize {
    let w = this.sourceWidth * scale
    let h = this.sourceHeight * scale
    const factor = Math.min(1, this.maxDim / Math.max(w, h))
    const clamped = factor < 1
    w = Math.max(2, toEven(w * factor))
    h = Math.max(2, toEven(h * factor))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    return { width: w, height: h, clamped }
  }

  /** Draw the stretch effect for the current frame at the current size. */
  render(pickX: number): void {
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.uPickX, Math.min(1, Math.max(0, pickX)))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to create program')
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertSrc))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function toEven(n: number): number {
  return Math.round(n) & ~1
}
