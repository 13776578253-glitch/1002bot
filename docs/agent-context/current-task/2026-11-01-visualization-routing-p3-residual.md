# Visualization routing P3 residual: cache, hover, fallback notice

## Scope

- Reuse unchanged star groups instead of re-solving every group on each geometry change.
- Reveal `space-exhausted` labels on edge hover.
- Explain group-mode fallback instead of silently switching engines.

## Implementation

- `src/react/model/group-route-cache.ts` keeps per-group records with signature, route bounds, routes and plan. A full solve is forced on cold start, node-set change or `routingRevision` change. Otherwise group signatures, endpoint geometry and moved obstacles inside cached route bounds mark dirty groups; groups sharing a node are invalidated for one coordination pass. Dirty groups solve with a shared allocator while unchanged groups are passed as fixed routes and reserved paths, preserving route object identity.
- `use-canvas-controller.ts` increments `routingRevision` on drag release; the scene passes it to the cache. Drag frames still use the legacy incremental cache.
- `route-groups.ts` accepts an explicit `groups` list and exports `buildRouteGroups`; hidden labels receive a `labelFallback` box from `measureLabel`.
- `relation-edge.tsx` keeps hidden capsules out of the DOM until the edge is hovered, with a 140 ms leave delay for moving from path to label. `labelIsVisible` in `labels.ts` owns the state rule.
- `routing-status.ts` derives fallback reasons and messages. The canvas renders an info/warning notice for protected routes, frozen groups, aggregated edges, incomplete solves and errors; dragging/preview are silent. The canvas exposes `data-routing-engine`, `data-routing-fallback` and `data-routing-cache`.

## Acceptance evidence

- `tests/group-route-cache.test.ts`: cold full; unchanged hit returns the same outcome and routes map; moving one leaf solves 1/2 groups and keeps the other route objects; revision bump forces full; groups sharing a node re-solve together.
- `tests/p3-residual.test.ts`: hidden labels only show on hover and keep a >= 44 px fallback box; fallback messages and silent drag/preview states.
- Browser `?routing=group`: initial `group / full:0/1`; during drag `legacy / dragging` with no notice; release returns `group / full:0/1`; pinning a path switches to `legacy / protected-routes` and shows "存在固定/锁定路径，组求解暂不接管。"; no console exceptions.
- Package tests 291/291; typecheck green at the time of writing.

## Limitations

- The group cache re-solves dirty groups and their shared-node neighbors; a path crossing a changed group without sharing a node relies on reserved paths and can fall back to full.
- Hidden-label hover is unit-verified; the authored graph has no `space-exhausted` label for a browser fixture.
- The fallback notice is suppressed while a canvas message is visible, except when the connection panel owns that message.
- The switch remains a URL development flag.
