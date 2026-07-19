import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import type { Renderer } from '../renderer'
import { estimateBitrate, seekTo, type PickAt, type VideoExportOptions } from './webm'

// H.264 codec strings, preferred first (High -> Main -> Baseline profile,
// generous levels first so large/high-fps renders fit).
const AVC_CANDIDATES = [
  'avc1.640034', // High 5.2
  'avc1.64002a', // High 4.2
  'avc1.640028', // High 4.0
  'avc1.4d0034', // Main 5.2
  'avc1.4d002a', // Main 4.2
  'avc1.420034', // Baseline 5.2
  'avc1.42002a', // Baseline 4.2
  'avc1.42001f', // Baseline 3.1
]

export type MP4Engine = 'webcodecs' | 'ffmpeg'

/**
 * A deterministic offline frame walk: renderFrame(i) must leave frame i on
 * the renderer's canvas. Both MP4 engines (WebCodecs and ffmpeg.wasm) encode
 * whatever the loop renders — video seeking and image animation are just
 * different renderFrame implementations.
 */
export interface FrameLoop {
  fps: number
  frameCount: number
  renderFrame: (i: number) => Promise<void> | void
  onProgress: (fraction: number) => void
}

/**
 * Export the effect over a full source video as .mp4 (H.264), driven offline
 * frame-by-frame via seeking — deterministic timing and exact render-target
 * scale. WebCodecs VideoEncoder + mp4-muxer when available, ffmpeg.wasm
 * (lazily loaded) otherwise.
 */
export async function exportMP4(
  renderer: Renderer,
  video: HTMLVideoElement,
  pickAt: PickAt,
  options: VideoExportOptions & { onEngine?: (engine: MP4Engine) => void },
): Promise<Blob> {
  const { fps } = options
  const duration = video.duration
  const frameCount = Math.max(1, Math.round(duration * fps))
  const wasLooping = video.loop
  video.loop = false
  video.pause()
  try {
    return await encodeMP4(renderer, options.onEngine, {
      fps,
      frameCount,
      onProgress: options.onProgress,
      renderFrame: async (i) => {
        await seekTo(video, Math.min(i / fps, Math.max(0, duration - 1e-3)))
        renderer.uploadFrame(video)
        renderer.render(pickAt(frameCount > 1 ? i / (frameCount - 1) : 0))
      },
    })
  } finally {
    video.loop = wasLooping
  }
}

/**
 * Export an animated pick sweep over a STILL image as .mp4: frameCount
 * frames of pick = pickAt(t), t = i/(frameCount-1). No seeking, no frame
 * uploads — the source texture never changes, only u_pick.
 */
export async function exportAnimationMP4(
  renderer: Renderer,
  pickAt: PickAt,
  options: VideoExportOptions & {
    durationSec: number
    onEngine?: (engine: MP4Engine) => void
  },
): Promise<Blob> {
  const { fps, durationSec, onProgress } = options
  const frameCount = Math.max(2, Math.round(durationSec * fps))
  return encodeMP4(renderer, options.onEngine, {
    fps,
    frameCount,
    onProgress,
    renderFrame: (i) => renderer.render(pickAt(i / (frameCount - 1))),
  })
}

async function encodeMP4(
  renderer: Renderer,
  onEngine: ((engine: MP4Engine) => void) | undefined,
  loop: FrameLoop,
): Promise<Blob> {
  const { width, height } = renderer.canvas
  const config = await probeAvcConfig(width, height, loop.fps)
  if (config) {
    onEngine?.('webcodecs')
    return encodeMP4WebCodecs(renderer, loop, config)
  }
  onEngine?.('ffmpeg')
  const { encodeMP4Ffmpeg } = await import('./mp4-ffmpeg')
  return encodeMP4Ffmpeg(renderer, loop)
}

async function probeAvcConfig(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null
  for (const codec of AVC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: estimateBitrate(width, height, fps),
      framerate: fps,
      avc: { format: 'avc' }, // length-prefixed NALUs + description, as mp4 expects
    }
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config)
      if (supported) return config
    } catch {
      // malformed/unknown codec string on this browser — try the next one
    }
  }
  return null
}

async function encodeMP4WebCodecs(
  renderer: Renderer,
  { fps, frameCount, renderFrame, onProgress }: FrameLoop,
  config: VideoEncoderConfig,
): Promise<Blob> {
  const { width, height } = renderer.canvas
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })
  encoder.configure(config)

  try {
    const frameMicros = Math.round(1e6 / fps)
    const keyEvery = Math.max(1, Math.round(fps * 2))

    for (let i = 0; i < frameCount; i++) {
      if (encoderError) throw encoderError
      await renderFrame(i)
      const frame = new VideoFrame(renderer.canvas, {
        timestamp: i * frameMicros,
        duration: frameMicros,
      })
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 })
      frame.close()
      if (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) =>
          encoder.addEventListener('dequeue', () => resolve(), { once: true }),
        )
      }
      onProgress(i / frameCount)
    }

    await encoder.flush()
    if (encoderError) throw encoderError
    muxer.finalize()
    onProgress(1)
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    encoder.close()
  }
}
