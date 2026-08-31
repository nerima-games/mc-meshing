---
"@nerima-games/mc-meshing": patch
---

Pin `@nerima-games/mc-kernel` to `0.7.0` (from `0.4.0`).

The registry properties this package reads for face culling and greedy
meshing — opacity, render kind, and collision shape — are unchanged for every
currently-registered block, so mesh output is unaffected by the block-data
side of the bump.

The one real hazard was `BLOCK_ID_MAX`: the kernel widened it from `255` to
`0xffff` when its own `Chunk` wire format grew a 16-bit element (mc-kernel
0.5.0). This package re-exported that constant as its own `MAX_BLOCK_ID` and
used it both to size several byte-indexed lookup tables and, in the greedy
mesher, to mask a packed `blockId | (ao << 8)` cell back apart. The mask
silently widening past one byte meant a merged quad's reported `blockId`
picked up its ambient-occlusion bits whenever `ao` was non-zero — a real
geometry-affecting corruption caught by the existing id-255 AO regression
test. `MAX_BLOCK_ID` now reflects this package's own storage boundary — the
`Uint8Array` `ChunkView.blocks` always was and remains one byte per cell,
independent of the kernel's wire format — so its value is unchanged from
before the bump (`0xff`) and every existing geometry assertion still holds.
