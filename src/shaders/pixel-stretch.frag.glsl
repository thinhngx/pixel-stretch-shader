#version 300 es
// ============================================================================
// pixel-stretch.frag.glsl
//
// Horizontal pixel-stretch (v1). Portable, framework-agnostic reference.
//
// Effect: pick a single source column at normalized X = u_pickX and smear it
// across the full output width. Every output row y takes the color of the
// source pixel at (u_pickX, y). Vertical structure of the picked column is
// preserved; horizontal structure is discarded. The stretch fills the entire
// frame — there is no keep-original region.
//
// Uniforms:
//   u_media  sampler2D  Source image or current video frame. Sample with
//                       CLAMP_TO_EDGE; no mipmaps required.
//   u_pickX  float      Normalized column to sample, 0..1. Default 0.5.
//
// Varyings:
//   v_uv     vec2       Normalized output coordinates, 0..1 in both axes.
//
// Y-orientation convention: v_uv.y = 0 is the BOTTOM of the image (OpenGL
// texture convention). The web tool uploads textures with UNPACK_FLIP_Y_WEBGL
// so image row 0 (top) lands at t = 1. If your platform samples with y = 0 at
// the TOP (e.g. Metal / Core Image / most decoded video surfaces), either
// flip v_uv.y in the vertex stage or leave it as-is — this effect only ever
// samples row y at row y, so a consistent flip on both input and output
// cancels out and no code change is needed.
//
// Cost: O(1) per pixel — one dependent texture read, no loops, no branches.
// Ports 1:1 to Metal (MSL), OpenGL ES / Vulkan, AGSL (RenderEffect, API 31+),
// and Skia SkSL. Safe for realtime mobile.
//
// v2 note: vertical stretch is the mirror image — sample (v_uv.x, u_pickY).
// Add a direction uniform/branch here; keep the host-side API
// direction-parameterized so no rewrite is needed.
// ============================================================================
precision highp float;

uniform sampler2D u_media;   // source image OR current video frame
uniform float     u_pickX;   // 0..1 normalized column, default 0.5

in  vec2 v_uv;               // 0..1 output coords (mind texture Y orientation)
out vec4 fragColor;

void main() {
    // ignore v_uv.x — sample the picked column, keep the row
    fragColor = texture(u_media, vec2(u_pickX, v_uv.y));
}
