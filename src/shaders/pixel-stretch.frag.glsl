#version 300 es
// ============================================================================
// pixel-stretch.frag.glsl
//
// Pixel-stretch (v2: horizontal + vertical). Portable, framework-agnostic
// reference.
//
// Effect:
//   Horizontal (u_vertical = 0, default): pick a single source COLUMN at
//   normalized X = u_pick and smear it across the full output width. Every
//   output row y takes the color of the source pixel at (u_pick, y).
//   Vertical (u_vertical = 1): pick a single source ROW at normalized
//   Y = u_pick and smear it across the full output height. Every output
//   column x takes the color of the source pixel at (x, u_pick).
//   The stretch always fills the entire frame — no keep-original region.
//
// Uniforms:
//   u_media     sampler2D  Source image or current video frame. Sample with
//                          CLAMP_TO_EDGE; no mipmaps required.
//   u_pick      float      Normalized pick coordinate, 0..1. Column if
//                          horizontal, row if vertical. Default 0.5.
//   u_vertical  int        0 = horizontal (smear across width),
//                          1 = vertical (smear across height).
//
// Varyings:
//   v_uv        vec2       Normalized output coordinates, 0..1 in both axes.
//
// Y-orientation convention: v_uv.y = 0 and u_pick = 0 (in vertical mode) are
// the BOTTOM of the image (OpenGL texture convention). The web tool uploads
// textures with UNPACK_FLIP_Y_WEBGL so image row 0 (top) lands at t = 1, and
// maps its UI row slider (0 = top) to u_pick = 1 - row before setting the
// uniform. If your platform samples with y = 0 at the TOP (e.g. Metal /
// Core Image / most decoded video surfaces), keep input and output
// conventions consistent and map the host-side row coordinate the same way —
// the shader itself needs no change.
//
// Cost: O(1) per pixel — one dependent texture read, no loops, one uniform
// branch (uniform control flow, free on mobile GPUs). Ports 1:1 to Metal
// (MSL), OpenGL ES / Vulkan, AGSL (RenderEffect, API 31+), and Skia SkSL.
// Safe for realtime mobile.
// ============================================================================
precision highp float;

uniform sampler2D u_media;    // source image OR current video frame
uniform float     u_pick;     // 0..1 — column if horizontal, row if vertical
uniform int       u_vertical; // 0 = horizontal, 1 = vertical

in  vec2 v_uv;                // 0..1 output coords (mind texture Y orientation)
out vec4 fragColor;

void main() {
    vec2 uv = (u_vertical == 1) ? vec2(v_uv.x, u_pick) : vec2(u_pick, v_uv.y);
    fragColor = texture(u_media, uv);
}
