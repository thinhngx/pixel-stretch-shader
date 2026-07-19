import { Renderer } from './renderer'
import { ACCEPT, FpsEstimator, loadMedia, releaseMedia, type Media } from './media'
import { downloadBlob, exportStill, type StillFormat } from './export/stills'

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
const pickXSlider = $<HTMLInputElement>('pickX')
const pickXValue = $<HTMLOutputElement>('pickXValue')
const scaleGroup = $<HTMLDivElement>('scaleGroup')
const sizeInfo = $<HTMLDivElement>('sizeInfo')
const formatSelect = $<HTMLSelectElement>('format')
const exportBtn = $<HTMLButtonElement>('exportBtn')
const statusEl = $<HTMLDivElement>('status')

fileInput.accept = ACCEPT

const renderer = new Renderer(canvas)

let media: Media | null = null
let pickX = 0.5
let scale = 1
let exporting = false
let fpsEstimator: FpsEstimator | null = null
let rafId = 0

function setStatus(message: string): void {
  statusEl.textContent = message
}

function scaleInputs(): HTMLInputElement[] {
  return [...scaleGroup.querySelectorAll<HTMLInputElement>('input[name="scale"]')]
}

function setControlsEnabled(enabled: boolean): void {
  pickXSlider.disabled = !enabled
  formatSelect.disabled = !enabled
  exportBtn.disabled = !enabled
  uploadBtn.disabled = !enabled && exporting
  for (const input of scaleInputs()) input.disabled = !enabled
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
  renderer.render(pickX)
}

// Realtime preview loop for video: re-upload the current frame each tick.
function startPreviewLoop(video: HTMLVideoElement): void {
  stopPreviewLoop()
  const tick = (): void => {
    rafId = requestAnimationFrame(tick)
    if (exporting || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    renderer.uploadFrame(video)
    renderer.render(pickX)
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

// --- column slider ---------------------------------------------------------

pickXSlider.addEventListener('input', () => {
  pickX = pickXSlider.valueAsNumber
  pickXValue.textContent = pickX.toFixed(3)
  renderFrame()
})

// --- preview scale ---------------------------------------------------------

scaleGroup.addEventListener('change', () => {
  const checked = scaleInputs().find((input) => input.checked)
  if (!checked) return
  scale = Number(checked.value)
  applyScale()
})

// --- export ----------------------------------------------------------------
// Export always follows the current preview settings: pickX + scale + format.

exportBtn.addEventListener('click', () => void onExport())

async function onExport(): Promise<void> {
  if (!media || exporting) return
  exporting = true
  setControlsEnabled(false)
  const format = formatSelect.value
  const filename = `pixel-stretch-${Date.now()}.${format}`
  try {
    if (format === 'png' || format === 'webp') {
      renderFrame()
      const blob = await exportStill(renderer, format as StillFormat)
      downloadBlob(blob, filename)
      setStatus(`Exported ${filename}`)
    } else {
      throw new Error(`Unsupported format: ${format}`)
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err))
  } finally {
    exporting = false
    setControlsEnabled(true)
  }
}
