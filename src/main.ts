import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { Renderer, type StretchDirection } from './renderer'
import { ACCEPT, FpsEstimator, loadMedia, releaseMedia, type Media } from './media'
import { downloadBlob, exportStill, type StillFormat } from './export/stills'
import { exportWebM } from './export/webm'
import { exportMP4 } from './export/mp4'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

const stage = $<HTMLDivElement>('stage')
const canvas = $<HTMLCanvasElement>('view')
const dropHint = $<HTMLDivElement>('dropHint')
const fileInput = $<HTMLInputElement>('fileInput')
const uploadBtn = $<HTMLButtonElement>('uploadBtn')
const browseBtn = $<HTMLButtonElement>('browseBtn')
const mediaInfo = $<HTMLDivElement>('mediaInfo')
const directionGroup = $<HTMLDivElement>('directionGroup')
const pickSlider = $<HTMLInputElement>('pick')
const pickLabel = $<HTMLSpanElement>('pickLabel')
const pickValueOut = $<HTMLOutputElement>('pickValue')
const resetPickBtn = $<HTMLButtonElement>('resetPick')
const scaleGroup = $<HTMLDivElement>('scaleGroup')
const sizeInfo = $<HTMLDivElement>('sizeInfo')
const formatSelect = $<HTMLSelectElement>('format')
const exportBtn = $<HTMLButtonElement>('exportBtn')
const progress = $<HTMLDivElement>('progress')
const progressBar = $<HTMLDivElement>('progressBar')
const statusEl = $<HTMLDivElement>('status')

fileInput.accept = ACCEPT

const renderer = new Renderer(canvas)

const DEFAULT_PICK = 0.5

let media: Media | null = null
let direction: StretchDirection = 'horizontal'
let pick = DEFAULT_PICK
let scale = 1
let exporting = false
let fpsEstimator: FpsEstimator | null = null
let rafId = 0

function setStatus(message: string): void {
  statusEl.textContent = message
}

function radioInputs(group: HTMLElement, name: string): HTMLInputElement[] {
  return [...group.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]
}

const scaleInputs = (): HTMLInputElement[] => radioInputs(scaleGroup, 'scale')
const directionInputs = (): HTMLInputElement[] => radioInputs(directionGroup, 'direction')

function setControlsEnabled(enabled: boolean): void {
  pickSlider.disabled = !enabled
  resetPickBtn.disabled = !enabled
  formatSelect.disabled = !enabled
  exportBtn.disabled = !enabled
  uploadBtn.disabled = !enabled && exporting
  for (const input of [...scaleInputs(), ...directionInputs()]) input.disabled = !enabled
}

function applyScale(): void {
  if (!renderer.hasSource || !media) return
  const size = renderer.setScale(scale)
  sizeInfo.textContent =
    `${size.width}×${size.height}` + (size.clamped ? ' (clamped to GPU limit)' : '')
  renderFrame()
}

const FORMATS: Record<Media['kind'], { value: string; label: string }[]> = {
  image: [
    { value: 'png', label: '.png' },
    { value: 'webp', label: '.webp' },
  ],
  video: [
    { value: 'mp4', label: '.mp4' },
    { value: 'webm', label: '.webm' },
    { value: 'png', label: '.png (current frame)' },
    { value: 'webp', label: '.webp (current frame)' },
  ],
}

function populateFormats(kind: Media['kind']): void {
  formatSelect.replaceChildren(
    ...FORMATS[kind].map(({ value, label }) => new Option(label, value)),
  )
}

function renderFrame(): void {
  if (!renderer.hasSource) return
  renderer.render(pick)
}

// Realtime preview loop for video: re-upload the current frame each tick.
function startPreviewLoop(video: HTMLVideoElement): void {
  stopPreviewLoop()
  const tick = (): void => {
    rafId = requestAnimationFrame(tick)
    if (exporting || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    renderer.uploadFrame(video)
    renderer.render(pick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopPreviewLoop(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

async function onFile(file: File): Promise<void> {
  try {
    const next = await loadMedia(file)
    if (media) releaseMedia(media)
    stopPreviewLoop()
    fpsEstimator?.stop()
    fpsEstimator = null
    media = next
    if (next.kind === 'video') {
      fpsEstimator = new FpsEstimator(next.element)
      await next.element.play().catch(() => {})
      startPreviewLoop(next.element)
    }
    renderer.setSource(next.element, next.width, next.height)
    canvas.hidden = false
    dropHint.hidden = true
    mediaInfo.textContent = `${file.name} — ${next.width}×${next.height}`
    populateFormats(next.kind)
    setControlsEnabled(true)
    setStatus('')
    applyScale()
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err))
  }
}

// --- upload wiring ---------------------------------------------------------

const openPicker = (): void => fileInput.click()
uploadBtn.addEventListener('click', openPicker)
browseBtn.addEventListener('click', openPicker)

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void onFile(file)
  fileInput.value = ''
})

stage.addEventListener('dragover', (e) => {
  e.preventDefault()
  stage.classList.add('dragover')
})
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'))
stage.addEventListener('drop', (e) => {
  e.preventDefault()
  stage.classList.remove('dragover')
  const file = e.dataTransfer?.files?.[0]
  if (file) void onFile(file)
})

// --- direction toggle ------------------------------------------------------

directionGroup.addEventListener('change', () => {
  const checked = directionInputs().find((input) => input.checked)
  if (!checked) return
  direction = checked.value as StretchDirection
  pickLabel.textContent = direction === 'vertical' ? 'Row' : 'Column'
  renderer.setDirection(direction)
  renderFrame()
})

// --- pick slider (column / row) --------------------------------------------

function setPick(value: number): void {
  pick = Math.min(1, Math.max(0, value))
  pickSlider.value = String(pick)
  pickValueOut.textContent = pick.toFixed(3)
  renderFrame()
}

pickSlider.addEventListener('input', () => setPick(pickSlider.valueAsNumber))

resetPickBtn.addEventListener('click', () => setPick(DEFAULT_PICK))

// --- preview scale ---------------------------------------------------------

scaleGroup.addEventListener('change', () => {
  const checked = scaleInputs().find((input) => input.checked)
  if (!checked) return
  scale = Number(checked.value)
  applyScale()
})

// --- export ----------------------------------------------------------------
// Export always follows the current preview settings: pick + scale + format.

exportBtn.addEventListener('click', () => void onExport())

function onProgress(fraction: number): void {
  progressBar.style.width = `${Math.round(fraction * 100)}%`
}

async function onExport(): Promise<void> {
  if (!media || exporting) return
  exporting = true
  setControlsEnabled(false)
  const format = formatSelect.value
  const filename = `pixel-stretch-${Date.now()}.${format}`
  const wasPlaying = media.kind === 'video' && !media.element.paused
  try {
    if (format === 'png' || format === 'webp') {
      renderFrame()
      const blob = await exportStill(renderer, format as StillFormat)
      downloadBlob(blob, filename)
      setStatus(`Exported ${filename}`)
    } else if (media.kind === 'video') {
      const fps = fpsEstimator?.fps ?? 30
      progress.hidden = false
      onProgress(0)
      setStatus(`Rendering .${format} at ${fps} fps…`)
      const opts = { fps, onProgress }
      // v2: constant pick over the whole clip. v3 swaps this callback for
      // lerp(start, end, ease(t)) — see src/easing.ts.
      const pickAt = (): number => pick
      let blob: Blob
      if (format === 'webm') {
        blob = await exportWebM(renderer, media.element, pickAt, opts)
      } else if (format === 'mp4') {
        blob = await exportMP4(renderer, media.element, pickAt, {
          ...opts,
          onEngine: (engine) =>
            setStatus(
              engine === 'webcodecs'
                ? `Rendering .mp4 at ${fps} fps (WebCodecs)…`
                : `Rendering .mp4 at ${fps} fps (ffmpeg.wasm fallback — slower)…`,
            ),
        })
      } else {
        throw new Error(`Unsupported format: ${format}`)
      }
      downloadBlob(blob, filename)
      setStatus(`Exported ${filename} (${(blob.size / 1e6).toFixed(1)} MB)`)
    } else {
      throw new Error(`Unsupported format: ${format}`)
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err))
  } finally {
    progress.hidden = true
    exporting = false
    setControlsEnabled(true)
    if (media?.kind === 'video' && wasPlaying) void media.element.play().catch(() => {})
  }
}
