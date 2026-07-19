import type { Renderer } from '../renderer'

export type StillFormat = 'png' | 'webp'

const MIME: Record<StillFormat, string> = {
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Export the current canvas contents (already rendered at the current
 * pickX + preview scale) as a still image. Callers must render the frame
 * they want immediately before calling this.
 */
export function exportStill(renderer: Renderer, format: StillFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    renderer.canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error(`Failed to encode ${format} — the browser may not support it.`))
    }, MIME[format])
  })
}

/** Trigger a browser download for a finished export. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
