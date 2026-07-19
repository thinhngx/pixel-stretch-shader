// Export destination handling. Chromium: File System Access API save dialog,
// chosen up-front at click time (transient user activation would expire
// during a long video encode). Firefox/Safari: anchor download to Downloads.

export interface SaveType {
  description: string
  mime: string
  ext: string
}

export const SAVE_TYPES: Record<string, SaveType> = {
  png: { description: 'PNG image', mime: 'image/png', ext: 'png' },
  webp: { description: 'WebP image', mime: 'image/webp', ext: 'webp' },
  webm: { description: 'WebM video', mime: 'video/webm', ext: 'webm' },
  mp4: { description: 'MP4 video', mime: 'video/mp4', ext: 'mp4' },
}

export type SaveDestination =
  | { kind: 'handle'; handle: FileSystemFileHandle; filename: string }
  | { kind: 'download'; filename: string }

interface SaveFilePicker {
  (options: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle>
}

function savePicker(): SaveFilePicker | undefined {
  return (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
}

/**
 * Ask the user where to save. Returns null if they dismissed the dialog
 * (silent abort — no error state, no partial file). Falls back to a plain
 * anchor-download destination when the File System Access API is missing.
 */
export async function chooseDestination(
  suggestedName: string,
  type: SaveType,
): Promise<SaveDestination | null> {
  const picker = savePicker()
  if (!picker) return { kind: 'download', filename: suggestedName }
  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: type.description, accept: { [type.mime]: [`.${type.ext}`] } }],
    })
    return { kind: 'handle', handle, filename: handle.name }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}

/** Write a finished blob to a previously chosen destination. */
export async function saveToDestination(dest: SaveDestination, blob: Blob): Promise<void> {
  if (dest.kind === 'handle') {
    const writable = await dest.handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dest.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
