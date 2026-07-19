import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import type { Renderer } from '../renderer'
import type { FrameLoop } from './mp4'

// Frame extraction is 0..N% of the progress bar, x264 encode the rest.
const EXTRACT_SHARE = 0.7

/**
 * .mp4 encode fallback for browsers without a usable WebCodecs AVC encoder:
 * run the frame loop, hand the PNG frames to ffmpeg.wasm (libx264). Slower
 * and memory-hungrier than WebCodecs, but dependency-light for the caller —
 * everything here is lazily loaded.
 */
export async function encodeMP4Ffmpeg(
  renderer: Renderer,
  { fps, frameCount, renderFrame, onProgress }: FrameLoop,
): Promise<Blob> {
  const ffmpeg = new FFmpeg()
  const loaded = await ffmpeg.load({ coreURL, wasmURL })
  if (!loaded) throw new Error('Failed to load ffmpeg.wasm.')

  try {
    for (let i = 0; i < frameCount; i++) {
      await renderFrame(i)
      const blob = await new Promise<Blob>((resolve, reject) => {
        renderer.canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Frame encode failed.'))),
          'image/png',
        )
      })
      await ffmpeg.writeFile(frameName(i), await fetchFile(blob))
      onProgress(((i + 1) / frameCount) * EXTRACT_SHARE)
    }

    ffmpeg.on('progress', ({ progress }) => {
      onProgress(EXTRACT_SHARE + Math.min(1, Math.max(0, progress)) * (1 - EXTRACT_SHARE))
    })
    const code = await ffmpeg.exec([
      '-framerate', String(fps),
      '-i', 'f%06d.png',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      'out.mp4',
    ])
    if (code !== 0) throw new Error(`ffmpeg.wasm encode failed (exit ${code}).`)

    const data = await ffmpeg.readFile('out.mp4')
    onProgress(1)
    return new Blob([(data as Uint8Array).slice().buffer], { type: 'video/mp4' })
  } finally {
    ffmpeg.terminate()
  }
}

function frameName(i: number): string {
  return `f${String(i).padStart(6, '0')}.png`
}
