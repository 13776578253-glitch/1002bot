# Visualization routing P3: canvas integration

## Scope

- Dev switch between the legacy candidate router and the offline group solver on the same canvas.
- Render physical slot handles whose DOM anchors match the allocator fractions.
- Keep drag interaction on the legacy incremental cache and re-solve the group on release.
- Hide `space-exhausted` labels and fall back to the legal legacy routes on any incomplete group transaction.

## Implementation

- `src/react/components/ports.tsx` renders `side:role:index` handles from `slotFractions(DEFAULT_SLOT_RULES)`. The four side fractions match the allocator, including the six-slot long side and three-slot short side.
- `use-canvas-controller.ts` reads `?routing=group`; the scene takes `engine` and `dragging`. The main canvas exposes `data-routing-engine`.
- `use-canvas-scene.ts` runs `solveRouteGroups` only when the view has no stored pinned/locked routes, no frozen groups, no aggregated display edges, is not in preview, and is not dragging. Dragging keeps the legacy cache; release re-runs the group solver.
- `route-selection.ts` accepts a group solution only when `ok` and every expected edge is present; otherwise it returns the identical legacy map. `tests/route-selection.test.ts` asserts complete, partial, failed and absent solutions.
- `relation-edge.tsx` omits the capsule when `labelState === 'space-exhausted'` and exposes `data-label-state` for normal/adjusted labels.

## Acceptance evidence

- Browser at `/?routing=group`: engine `group`, 6 nodes, 5 edges, 5 labels, `labelOverlaps: 0`, 216 slot handles plus 48 legacy handles. First node slots: top/bottom `[0.061, 0.237, 0.412, 0.588, 0.763, 0.938]`, left/right `[0.174, 0.5, 0.826]`; these match `slotFractions` for the measured width/height.
- Drag: engine `legacy` during the drag, `group` after release, node transform changed, no console exceptions.
- Browser at `/?routing=legacy`: engine `legacy`, 5 edges, 5 labels.
- Package tests 284/284, typecheck green. Build and root gates recorded at commit time.

## Limitations

- The group engine is disabled when stored pinned/locked paths, frozen groups, aggregated edges or preview state exist; those cases keep the old engine and its protections.
- Release re-solves the whole local group set; there is no group-level incremental cache yet.
- `space-exhausted` labels are hidden, not yet revealed on hover or in the connection panel.
- The switch is a URL development flag, not a production toolbar control.
