# pixel-stretch-shader

A lightweight web tool that applies a **horizontal pixel-stretch** effect to uploaded media (image or video), with live preview, resolution scaling, and export. The core effect is a **portable fragment shader** that drops into a native iOS/Android renderer and runs in realtime.

## The effect (v1 — horizontal)

Pick a single source **column** (normalized X, default `0.5` center) and smear it across the **full width**. Every output row `y` is filled with the color of the source pixel at `(pickX, y)` — vertical structure of the picked column is preserved, horizontal structure becomes streaks. The stretch always fills the entire frame; output aspect ratio equals the source aspect ratio.

The shader is O(1) per pixel — one dependent texture read, no loops, no branches — which is why it's safe for realtime mobile.

## Running

```sh
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
```

## Using the tool

1. **Upload** an image (`png/jpg/webp`) or video (`mp4/webm`) — picker or drag-and-drop. Type and output dimensions are auto-detected.
2. **Column slider** picks the source column (`0..1`, default center), updating the preview live (videos render in realtime through the shader).
3. **Preview scale** `1x/2x/3x` multiplies the render-target resolution (supersampled output, not a viewport zoom), clamped to safe GPU/canvas limits and even dimensions.
4. **Export** follows the current preview settings exactly (`pickX` + scale + chosen format):

| Format | Applies to | Method |
|---|---|---|
| `.png` | image / current video frame | `canvas.toBlob('image/png')` |
| `.webp` | image / current video frame | `canvas.toBlob('image/webp')` |
| `.webm` | video | `MediaRecorder` on `canvas.captureStream()` (realtime pass) |
| `.mp4` | video | WebCodecs `VideoEncoder` (AVC) + `mp4-muxer`, offline frame-by-frame; automatic `ffmpeg.wasm` (libx264) fallback when no AVC encoder is available |

Video exports run at the source's estimated fps (measured from `requestVideoFrameCallback` deltas, 30fps fallback), video-track only (no audio in v1).

## Stack

WebGL2 + Vite + vanilla TypeScript. Single full-screen quad, one texture (source frame), one uniform (`u_pickX`), render target sized by preview scale. Runtime dependencies: `mp4-muxer`, plus lazily-loaded `@ffmpeg/ffmpeg` + `@ffmpeg/core` (fetched only if the WebCodecs path is unavailable).

## Native / mobile portability

The effect lives in [`src/shaders/pixel-stretch.frag.glsl`](src/shaders/pixel-stretch.frag.glsl) — a standalone, framework-agnostic GLSL ES 3.0 fragment shader with documented uniforms (`u_media`, `u_pickX`) and the Y-orientation convention noted in the header. The web tool imports it verbatim; nothing web-specific leaks into it.

- **iOS:** maps 1:1 to a Metal fragment shader / Core Image kernel / Skia SkSL.
- **Android:** maps to OpenGL ES 3.0 / Vulkan / `RenderEffect` AGSL (API 31+) / Skia SkSL.
- No compute passes, no multi-pass framebuffers, no CPU readback in the hot path.

Direction is kept as a host-side parameter (`StretchDirection` in `src/renderer.ts`) so v2 can add vertical stretch as a shader uniform/branch without a rewrite.

## Out of scope (v2+)

- Vertical stretch direction
- "Keep original + stretch from line" split mode (v1 always fills the full frame)
- Pointer/touch-driven interactive pick
- Audio passthrough in video exports
