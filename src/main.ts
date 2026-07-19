import { Renderer } from './renderer'
import { ACCEPT, loadMedia, releaseMedia, type Media } from './media'

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
const statusEl = $<HTMLDivElement>('status')

fileInput.accept = ACCEPT

const renderer = new Renderer(canvas)

let media: Media | null = null
let pickX = 0.5

function setStatus(message: string): void {
  statusEl.textContent = message
}

function renderFrame(): void {
  if (!renderer.hasSource) return
  renderer.render(pickX)
}

async function onFile(file: File): Promise<void> {
  try {
    const next = await loadMedia(file)
    if (next.kind === 'video') {
      releaseMedia(next)
      setStatus('Video input lands in a later phase — images only for now.')
      return
    }
    if (media) releaseMedia(media)
    media = next
    renderer.setSource(next.element, next.width, next.height)
    renderer.setScale(1)
    canvas.hidden = false
    dropHint.hidden = true
    pickXSlider.disabled = false
    mediaInfo.textContent = `${file.name} — ${next.width}×${next.height}`
    setStatus('')
    renderFrame()
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
