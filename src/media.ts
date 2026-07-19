export type Media =
  | { kind: 'image'; element: HTMLImageElement; width: number; height: number }
  | { kind: 'video'; element: HTMLVideoElement; width: number; height: number; duration: number }

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']

export const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(',')

/** Load an uploaded file as image or video, auto-detected from its MIME type. */
export async function loadMedia(file: File): Promise<Media> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('image/')) {
      const element = new Image()
      element.src = url
      await element.decode()
      return { kind: 'image', element, width: element.naturalWidth, height: element.naturalHeight }
    }
    if (file.type.startsWith('video/')) {
      const element = document.createElement('video')
      element.src = url
      element.muted = true
      element.loop = true
      element.playsInline = true
      element.preload = 'auto'
      await new Promise<void>((resolve, reject) => {
        element.addEventListener('loadedmetadata', () => resolve(), { once: true })
        element.addEventListener('error', () => reject(new Error('Failed to load video.')), { once: true })
      })
      if (!element.videoWidth || !element.videoHeight) {
        throw new Error('Video has no decodable dimensions.')
      }
      return {
        kind: 'video',
        element,
        width: element.videoWidth,
        height: element.videoHeight,
        duration: element.duration,
      }
    }
    throw new Error(`Unsupported file type: ${file.type || 'unknown'}`)
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

export function releaseMedia(media: Media): void {
  if (media.kind === 'video') media.element.pause()
  URL.revokeObjectURL(media.element.src)
  media.element.removeAttribute('src')
}

/**
 * Estimates a video's frame rate from requestVideoFrameCallback mediaTime
 * deltas observed during playback. Falls back to 30 fps until enough samples
 * arrive (or when rVFC is unavailable).
 */
export class FpsEstimator {
  private deltas: number[] = []
  private lastMediaTime = -1
  private stopped = false

  constructor(private video: HTMLVideoElement) {
    if ('requestVideoFrameCallback' in video) this.tick()
  }

  private tick = (): void => {
    if (this.stopped) return
    this.video.requestVideoFrameCallback((_now, meta) => {
      if (this.lastMediaTime >= 0) {
        const delta = meta.mediaTime - this.lastMediaTime
        if (delta > 1 / 121 && delta < 1) this.deltas.push(delta)
        if (this.deltas.length > 60) this.deltas.shift()
      }
      this.lastMediaTime = meta.mediaTime
      this.tick()
    })
  }

  stop(): void {
    this.stopped = true
  }

  /** Median-based estimate, clamped to 1..120; 30 when unknown. */
  get fps(): number {
    if (this.deltas.length < 5) return 30
    const sorted = [...this.deltas].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    return Math.min(120, Math.max(1, Math.round(1 / median)))
  }
}
