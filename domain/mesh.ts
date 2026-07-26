/**
 * Chunk data -> per-layer face lists.
 *
 * FIRST CUT (叩き台) — AND THE GREEDY MERGE IS NOT IMPLEMENTED YET.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it deliberately is not
 * ---------------------------------------------------------------------------
 *
 * This is the NAIVE face extraction: one quad per exposed block face, no
 * merging of coplanar runs. It establishes the parts that greedy meshing must
 * not change — the layer routing, the canonical face order, the occlusion rule,
 * the boundary behaviour — and it gives the greedy implementation an oracle to
 * be checked against, since greedy meshing must cover exactly the same surface
 * area with fewer quads.
 *
 * The greedy merge is the substance of this repository and it is the next piece
 * of work. It is not stubbed out with a `throw`, and it is not faked: what is
 * here is correct, just not yet fast. See README 現状 and docs/testing.md.
 *
 * ---------------------------------------------------------------------------
 * The output shape
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.3 specifies `mesh(chunk, neighbors, config) -> {opaque, water,
 * transparentSolid}`, and that is exactly what `meshChunk` returns. The
 * reference reaches the same three buckets by a different route: its
 * `greedyMeshChunk` returns `GreedyMeshResult` with `opaqueRaw` / `waterRaw` /
 * `transparentSolidRaw` as zero-copy subarray VIEWS into a shared accumulator,
 * plus a lazy `toMeshed()` that slices owned copies
 * (`greedy-meshing-types.ts:70-80`). Those views are invalidated by the next
 * call, which is a real hazard and the reason the reference has a comment about
 * it. This repository returns owned data and will add the pooled, view-based
 * fast path behind an explicit opt-in once there is a benchmark to justify it.
 * See docs/design-notes.md, regression `meshing-result-is-owned-not-aliased`.
 */
import {
  AIR,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  getBlock,
  getBlockAcrossBoundary,
  type ChunkNeighbours,
  type ChunkView,
} from './chunk-view'
import { FACES, type FaceDirection, type FaceRole } from './faces'
import { buildLayerLookup, layerOfBlockId, occludes, type MeshConfig, type MeshLayer } from './opacity'

/** One emitted quad. Positions are chunk-local; mc-render applies the offset. */
export type Quad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  /** Extent along the face's first tangent axis. Always 1 until greedy merging lands. */
  readonly width: number
  /** Extent along the face's second tangent axis. Always 1 until greedy merging lands. */
  readonly height: number
}

export type MeshLayers = {
  readonly [K in MeshLayer]: ReadonlyArray<Quad>
}

/**
 * Total quads across all layers. The thing a face-count property test asserts
 * on, and the thing greedy merging must reduce without changing the surface.
 */
export const totalQuadCount = (layers: MeshLayers): number =>
  layers.opaque.length + layers.water.length + layers.transparentSolid.length

/**
 * Mesh one chunk.
 *
 * Faces are emitted in the canonical direction order (`FACES`), and within a
 * direction in `lx` then `lz` then `y` order. Both are load-bearing for golden
 * hashes; see docs/design-notes.md, regression `meshing-face-order-is-canonical`.
 *
 * A face is emitted when the cell is non-air and its neighbour across that face
 * does not occlude. `occludes` is false for air, for water and for transparent
 * solids alike, which is what makes the underside of a lake and the far pane of
 * a glass box render at all.
 *
 * `let` + `for` throughout, and a plain mutable array per layer. Same exemption
 * as the octave loop in mc-noise: this walks 16 x 256 x 16 cells six times.
 */
export const meshChunk = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
): MeshLayers => {
  const lookup = buildLayerLookup(config)
  const opaque: Array<Quad> = []
  const water: Array<Quad> = []
  const transparentSolid: Array<Quad> = []

  const push = (quad: Quad): void => {
    const layer = layerOfBlockId(config, quad.blockId)
    if (layer === 'transparentSolid') {
      transparentSolid.push(quad)
      return
    }
    if (layer === 'water') {
      water.push(quad)
      return
    }
    opaque.push(quad)
  }

  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          const blockId = getBlock(chunk.blocks, lx, y, lz)
          if (blockId === AIR) {
            continue
          }
          const neighbourId = getBlockAcrossBoundary(
            chunk,
            neighbours,
            lx + face.nx,
            y + face.ny,
            lz + face.nz,
          )
          if (occludes(lookup, neighbourId)) {
            continue
          }
          // A block never emits a face against another block of its own layer:
          // two adjacent water cells have no surface between them, and neither
          // do two panes of glass. Without this the inside of a lake is a solid
          // wall of quads, which is both wrong and ruinously expensive.
          if (neighbourId !== AIR && layerOfBlockId(config, neighbourId) === layerOfBlockId(config, blockId)) {
            continue
          }
          push({
            blockId,
            direction: face.direction,
            role: face.role,
            lx,
            y,
            lz,
            width: 1,
            height: 1,
          })
        }
      }
    }
  }

  return { opaque, water, transparentSolid }
}
