import type { Renderer } from '../renderer'

export interface VideoExportOptions {
  fps: number
  onProgress: (fraction: number) => void
}

/**
 * Pick coordinate as a function of normalized output time t (0..1).
 * v2 always passes a constant; v3 animates it (lerp(start, end, ease(t))).
 */
export type PickAt = (t: number) => number

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/**
 * Export the effect over the full video as .webm using MediaRecorder on
 * canvas.captureStream() (no dependencies).
 *
 * MediaRecorder timestamps frames in wall-clock time, so this path plays the
 * video through once in realtime and pushes an explicitly rendered frame per
 * presented source frame (captureStream(0) + requestFrame keeps capture in
 * lockstep with what the shader drew, at the full render-target resolution).
 */
export async function exportWebM(
  renderer: Renderer,
  video: HTMLVideoElement,
  pickAt: PickAt,
  { fps, onProgress }: VideoExportOptions,
): Promise<Blob> {
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
  if (!mimeType) throw new Error('This browser cannot record .webm — try .mp4 instead.')

  const stream = renderer.canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const { width, height } = renderer.canvas
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: estimateBitrate(width, height, fps),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }

  const wasLooping = video.loop
  video.loop = false
  video.pause()

  const tNow = (): number => (video.duration ? Math.min(1, video.currentTime / video.duration) : 0)

  try {
    await seekTo(video, 0)
    renderer.uploadFrame(video)
    renderer.render(pickAt(0))

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('MediaRecorder failed.'))
    })

    recorder.start()
    track.requestFrame()

    await new Promise<void>((resolve, reject) => {
      const onFrame = (): void => {
        renderer.uploadFrame(video)
        renderer.render(pickAt(tNow()))
        track.requestFrame()
        onProgress(tNow())
        if (!video.ended) scheduleFrame()
      }
      const scheduleFrame = (): void => {
        video.requestVideoFrameCallback(() => onFrame())
      }
      video.addEventListener('ended', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('Video playback failed during export.')), { once: true })
      scheduleFrame()
      video.play().catch(reject)
    })

    // Capture the final frame, then stop.
    renderer.uploadFrame(video)
    renderer.render(pickAt(1))
    track.requestFrame()
    recorder.stop()
    await stopped
    onProgress(1)
    return new Blob(chunks, { type: 'video/webm' })
  } finally {
    video.loop = wasLooping
  }
}

/** ~0.15 bits per pixel per frame, clamped to a sane range. */
export function estimateBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(50e6, Math.max(1e6, width * height * fps * 0.15)))
}

export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 1e-4 && !video.seeking) {
      resolve()
      return
    }
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    const onSeeked = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error('Seeking failed during export.'))
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = time
  })
}
