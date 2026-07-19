import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { Renderer, type StretchDirection } from './renderer'
import { ACCEPT, FpsEstimator, loadMedia, releaseMedia, type Media } from './media'
import { exportStill, type StillFormat } from './export/stills'
import { EASINGS, lerp, type EasingName } from './easing'
import { chooseDestination, saveToDestination, SAVE_TYPES } from './export/save'
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
const pickControl = $<HTMLElement>('pickControl')
const pickSlider = $<HTMLInputElement>('pick')
const pickLabel = $<HTMLSpanElement>('pickLabel')
const pickValueOut = $<HTMLOutputElement>('pickValue')
const resetPickBtn = $<HTMLButtonElement>('resetPick')
const animateControl = $<HTMLElement>('animateControl')
const animateGroup = $<HTMLDivElement>('animateGroup')
const animatePanel = $<HTMLDivElement>('animatePanel')
const animStartSlider = $<HTMLInputElement>('animStart')
const animStartLabel = $<HTMLSpanElement>('animStartLabel')
const animStartValue = $<HTMLOutputElement>('animStartValue')
const animEndSlider = $<HTMLInputElement>('animEnd')
const animEndLabel = $<HTMLSpanElement>('animEndLabel')
const animEndValue = $<HTMLOutputElement>('animEndValue')
const animDurationSlider = $<HTMLInputElement>('animDuration')
const animDurationValue = $<HTMLOutputElement>('animDurationValue')
const animEasingSelect = $<HTMLSelectElement>('animEasing')
const animPlayPauseBtn = $<HTMLButtonElement>('animPlayPause')
const resetAnimBtn = $<HTMLButtonElement>('resetAnim')
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
let sourceBaseName = 'pixel-stretch'
let direction: StretchDirection = 'horizontal'
let pick = DEFAULT_PICK
let scale = 1
let exporting = false
let fpsEstimator: FpsEstimator | null = null
let rafId = 0

// Animate mode (image input only; OFF by default — v2 behavior when off).
let animate = false
let animStart = 0
let animEnd = 1
let animDuration = 2 // seconds
let animEasing: EasingName = 'ease-in-out'
let animPlaying = false
let animRafId = 0
let animT = 0 // current normalized position in the sweep, survives pause

function setStatus(message: string): void {
  statusEl.textContent = message
}

function radioInputs(group: HTMLElement, name: string): HTMLInputElement[] {
  return [...group.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]
}

const scaleInputs = (): HTMLInputElement[] => radioInputs(scaleGroup, 'scale')
const directionInputs = (): HTMLInputElement[] => radioInputs(directionGroup, 'direction')

const animateInputs = (): HTMLInputElement[] => radioInputs(animateGroup, 'animate')

function setControlsEnabled(enabled: boolean): void {
  pickSlider.disabled = !enabled
  resetPickBtn.disabled = !enabled
  formatSelect.disabled = !enabled
  exportBtn.disabled = !enabled
  uploadBtn.disabled = !enabled && exporting
  animStartSlider.disabled = !enabled
  animEndSlider.disabled = !enabled
  animDurationSlider.disabled = !enabled
  animEasingSelect.disabled = !enabled
  animPlayPauseBtn.disabled = !enabled
  resetAnimBtn.disabled = !enabled
  const radios = [...scaleInputs(), ...directionInputs(), ...animateInputs()]
  for (const input of radios) input.disabled = !enabled
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
  const list =
    kind === 'image' && animate
      ? [
          { value: 'mp4', label: '.mp4' },
          { value: 'webm', label: '.webm' },
          { value: 'png', label: '.png (current frame)' },
          { value: 'webp', label: '.webp (current frame)' },
        ]
      : FORMATS[kind]
  formatSelect.replaceChildren(...list.map(({ value, label }) => new Option(label, value)))
}

const animPickAt = (t: number): number => lerp(animStart, animEnd, EASINGS[animEasing](t))

function renderFrame(): void {
  if (!renderer.hasSource) return
  renderer.render(animate ? animPickAt(animT) : pick)
}

// --- animate preview loop (image input) -------------------------------------

function animTick(now: number, anchor: number): void {
  animRafId = requestAnimationFrame((n) => animTick(n, anchor))
  if (exporting) return
  const durMs = animDuration * 1000
  animT = ((now - anchor) % durMs) / durMs
  renderFrame()
}

function playAnim(): void {
  if (animPlaying) return
  animPlaying = true
  animPlayPauseBtn.textContent = 'Pause'
  const anchor = performance.now() - animT * animDuration * 1000
  animRafId = requestAnimationFrame((n) => animTick(n, anchor))
}

function pauseAnim(): void {
  animPlaying = false
  animPlayPauseBtn.textContent = 'Play'
  cancelAnimationFrame(animRafId)
}

function setAnimate(on: boolean): void {
  animate = on
  animatePanel.hidden = !on
  pickControl.hidden = on
  if (media) populateFormats(media.kind)
  if (on) {
    animT = 0
    playAnim()
  } else {
    pauseAnim()
    renderFrame()
  }
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
    // Animate is only offered for image input, and always starts OFF.
    if (animate) setAnimate(false)
    for (const input of animateInputs()) input.checked = input.value === 'off'
    animateControl.hidden = next.kind !== 'image'
    if (next.kind === 'video') {
      fpsEstimator = new FpsEstimator(next.element)
      await next.element.play().catch(() => {})
      startPreviewLoop(next.element)
    }
    renderer.setSource(next.element, next.width, next.height)
    canvas.hidden = false
    dropHint.hidden = true
    sourceBaseName = (file.name.replace(/\.[^.]+$/, '') || 'pixel-stretch').slice(0, 80)
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
  const axis = direction === 'vertical' ? 'Row' : 'Column'
  pickLabel.textContent = axis
  animStartLabel.textContent = `Start ${axis.toLowerCase()}`
  animEndLabel.textContent = `End ${axis.toLowerCase()}`
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

// --- animate controls --------------------------------------------------------

animateGroup.addEventListener('change', () => {
  const checked = animateInputs().find((input) => input.checked)
  if (checked) setAnimate(checked.value === 'on')
})

function setAnimRange(start: number, end: number): void {
  animStart = Math.min(1, Math.max(0, start))
  animEnd = Math.min(1, Math.max(0, end))
  animStartSlider.value = String(animStart)
  animEndSlider.value = String(animEnd)
  animStartValue.textContent = animStart.toFixed(3)
  animEndValue.textContent = animEnd.toFixed(3)
  renderFrame()
}

animStartSlider.addEventListener('input', () => setAnimRange(animStartSlider.valueAsNumber, animEnd))
animEndSlider.addEventListener('input', () => setAnimRange(animStart, animEndSlider.valueAsNumber))

resetAnimBtn.addEventListener('click', () => setAnimRange(0, 1))

animDurationSlider.addEventListener('input', () => {
  animDuration = animDurationSlider.valueAsNumber
  animDurationValue.textContent = `${animDuration.toFixed(2).replace(/0$/, '')}s`
  if (animPlaying) {
    // re-anchor so the loop keeps its current phase under the new duration
    pauseAnim()
    playAnim()
  }
})

animEasingSelect.addEventListener('change', () => {
  animEasing = animEasingSelect.value as EasingName
  renderFrame()
})

animPlayPauseBtn.addEventListener('click', () => {
  if (animPlaying) pauseAnim()
  else playAnim()
})

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
  const format = formatSelect.value

  // Choose the destination first, while transient user activation from the
  // Export click is still valid (it expires during long video encodes).
  // A dismissed picker aborts silently — no error, no partial file.
  const destination = await chooseDestination(
    `${sourceBaseName}-stretch.${format}`,
    SAVE_TYPES[format],
  )
  if (!destination) return

  exporting = true
  setControlsEnabled(false)
  const wasPlaying = media.kind === 'video' && !media.element.paused
  try {
    if (format === 'png' || format === 'webp') {
      renderFrame()
      const blob = await exportStill(renderer, format as StillFormat)
      await saveToDestination(destination, blob)
      setStatus(`Saved ${destination.filename}`)
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
      await saveToDestination(destination, blob)
      setStatus(`Saved ${destination.filename} (${(blob.size / 1e6).toFixed(1)} MB)`)
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
