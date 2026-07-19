# pixel-stretch-shader

A lightweight web tool that applies a **pixel-stretch** effect (horizontal or vertical) to uploaded media (image or video), with live preview, resolution scaling, and export. The core effect is a **portable fragment shader** that drops into a native iOS/Android renderer and runs in realtime.

## The effect

**Horizontal (default):** pick a single source **column** (normalized X, default `0.5` center) and smear it across the **full width**. Every output row `y` is filled with the color of the source pixel at `(pick, y)` — vertical structure of the picked column is preserved, horizontal structure becomes streaks.

**Vertical (v2):** pick a single source **row** (normalized Y from the top) and smear it across the **full height** — the mirror image of horizontal mode.

The stretch always fills the entire frame; output aspect ratio equals the source aspect ratio in both modes.

The shader is O(1) per pixel — one dependent texture read, no loops, one uniform branch for direction (uniform control flow, effectively free) — which is why it's safe for realtime mobile.

## Running

```sh
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
```

## Using the tool

1. **Upload** an image (`png/jpg/webp`) or video (`mp4/webm`) — picker or drag-and-drop. Type and output dimensions are auto-detected.
2. **Direction toggle** switches between horizontal (column) and vertical (row) stretch; horizontal is the default.
3. **Pick slider** selects the source column or row (`0..1`, default center), updating the preview live (videos render in realtime through the shader). **Reset** snaps it back to center instantly.
4. **Animate** (image input only, off by default) sweeps the pick from a **Start** to an **End** coordinate over a chosen **Duration** (0.25–10s, default 2s) with a chosen **Easing** (linear, ease-in, ease-out, ease-in-out, ease-out-in), looping in the preview with Play/Pause. Reset restores the full 0 → 1 sweep. Exporting mp4/webm renders the sweep at 30fps (`frameCount = duration × 30`); png/webp capture the currently previewed frame.
5. **Preview scale** `1x/2x/3x` multiplies the render-target resolution (supersampled output, not a viewport zoom), clamped to safe GPU/canvas limits and even dimensions.
6. **Export** follows the current preview settings exactly (direction + pick/sweep + scale + chosen format) and opens a **save-destination dialog** (File System Access API; suggested name `<source>-stretch.<ext>`; dismissing aborts silently). Firefox/Safari fall back to a regular download:

| Format | Applies to | Method |
|---|---|---|
| `.png` | image / current video frame | `canvas.toBlob('image/png')` |
| `.webp` | image / current video frame | `canvas.toBlob('image/webp')` |
| `.webm` | video | `MediaRecorder` on `canvas.captureStream()` (realtime pass) |
| `.mp4` | video | WebCodecs `VideoEncoder` (AVC) + `mp4-muxer`, offline frame-by-frame; automatic `ffmpeg.wasm` (libx264) fallback when no AVC encoder is available |

Video exports run at the source's estimated fps (measured from `requestVideoFrameCallback` deltas, 30fps fallback), video-track only (no audio).

## Stack

WebGL2 + Vite + vanilla TypeScript. Single full-screen quad, one texture (source frame), two effect uniforms (`u_pick`, `u_vertical`), render target sized by preview scale. Runtime dependencies: `mp4-muxer`, self-hosted Geist fonts (`@fontsource-variable`), plus lazily-loaded `@ffmpeg/ffmpeg` + `@ffmpeg/core` (fetched only if the WebCodecs path is unavailable). The monochrome theme is a single CSS custom-property block at the top of `src/style.css`.

## Native / mobile portability

The effect lives in [`src/shaders/pixel-stretch.frag.glsl`](src/shaders/pixel-stretch.frag.glsl) — a standalone, framework-agnostic GLSL ES 3.0 fragment shader with documented uniforms (`u_media`, `u_pick`, `u_vertical`) and the Y-orientation convention noted in the header. The web tool imports it verbatim; nothing web-specific leaks into it.

- **iOS:** maps 1:1 to a Metal fragment shader / Core Image kernel / Skia SkSL.
- **Android:** maps to OpenGL ES 3.0 / Vulkan / `RenderEffect` AGSL (API 31+) / Skia SkSL.
- No compute passes, no multi-pass framebuffers, no CPU readback in the hot path.

## Animation architecture (v3)

The animation is **host-side only** — it drives the existing `u_pick` uniform once per frame; the fragment shader is unchanged, so native portability is unaffected (a native port animates `u_pick` the same way: `lerp(start, end, ease(t))`).

- `src/easing.ts`: the five named curves as pure `t -> t'` functions plus `lerp`.
- All video export paths run through a `pickAt(t)` callback over normalized output time; MP4 encoding shares one offline `FrameLoop` (`renderFrame(i)`) between video input (seek + re-upload) and image animation (re-render only), on both the WebCodecs and ffmpeg.wasm engines.

## Out of scope (v4+)
- "Keep original + stretch from line" split mode (the effect always fills the full frame)
- Pointer/touch-driven interactive pick
- Audio passthrough in video exports
