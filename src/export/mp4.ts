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

/**
 * Export the effect over the full video as .mp4 (H.264).
 *
 * Primary path: WebCodecs VideoEncoder + mp4-muxer, driven offline
 * frame-by-frame via seeking — deterministic timing and exact render-target
 * scale, independent of playback speed. Falls back to ffmpeg.wasm (lazily
 * loaded) when WebCodecs or an AVC encoder isn't available.
 */
export async function exportMP4(
  renderer: Renderer,
  video: HTMLVideoElement,
  pickAt: PickAt,
  options: VideoExportOptions & { onEngine?: (engine: 'webcodecs' | 'ffmpeg') => void },
): Promise<Blob> {
  const { width, height } = renderer.canvas
  const config = await probeAvcConfig(width, height, options.fps)
  if (config) {
    options.onEngine?.('webcodecs')
    return exportMP4WebCodecs(renderer, video, pickAt, options, config)
  }
  options.onEngine?.('ffmpeg')
  const { exportMP4Ffmpeg } = await import('./mp4-ffmpeg')
  return exportMP4Ffmpeg(renderer, video, pickAt, options)
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

async function exportMP4WebCodecs(
  renderer: Renderer,
  video: HTMLVideoElement,
  pickAt: PickAt,
  { fps, onProgress }: VideoExportOptions,
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

  const wasLooping = video.loop
  video.loop = false
  video.pause()

  try {
    const duration = video.duration
    const frameCount = Math.max(1, Math.round(duration * fps))
    const frameMicros = Math.round(1e6 / fps)
    const keyEvery = Math.max(1, Math.round(fps * 2))

    for (let i = 0; i < frameCount; i++) {
      if (encoderError) throw encoderError
      await seekTo(video, Math.min(i / fps, Math.max(0, duration - 1e-3)))
      renderer.uploadFrame(video)
      renderer.render(pickAt(frameCount > 1 ? i / (frameCount - 1) : 0))
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
    video.loop = wasLooping
  }
}
