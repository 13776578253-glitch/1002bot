Owner: `packages/visualization/src/themes/default.css`

# Default theme

`default.css` is the visual contract for the React Flow card, aggregate, and
orthogonal-edge components. It has no runtime dependencies.

Import the stylesheet once in the application entry point and put `av-theme` on
the React Flow container or an ancestor.

| Variable | Purpose |
| --- | --- |
| `--av-font-family` | UI font stack |
| `--av-grid-size` | Canvas grid spacing |
| `--av-grid-color` | Canvas grid line color |
| `--av-canvas-bg` | Canvas background |
| `--av-surface` | Card background |
| `--av-surface-subtle` | Hover and secondary surface |
| `--av-surface-aggregate` | Translucent aggregate background |
| `--av-border` | Default border |
| `--av-border-strong` | Hover and selected border |
| `--av-shadow` | Card elevation |
| `--av-text` | Primary text |
| `--av-text-muted` | Secondary text |
| `--av-text-faint` | Metadata text |
| `--av-radius-card` | Card corner radius |
| `--av-radius-aggregate` | Aggregate corner radius |
| `--av-radius-pill` | Status and edge-label radius |
| `--av-card-width` | Leaf card width |
| `--av-card-padding` | Leaf card padding |
| `--av-status-{kind}` | State foreground color |
| `--av-status-{kind}-bg` | State background color |
| `--av-edge` | Default edge stroke |
| `--av-edge-strong` | Hover and selected edge stroke |
| `--av-edge-label-text` | Edge label text |
| `--av-edge-label-bg` | Edge label background |
| `--av-focus` | Keyboard focus outline |

## State classes

Apply one `av-delta-*` class to the root card or edge. Apply `av-planned` on
the root `.av-card` or `.av-aggregate`.

| NodeDeltaKind | Class | Label | Visual |
| --- | --- | --- | --- |
| `baseline` | `av-delta-baseline` | none | neutral |
| `inherited` | `av-delta-inherited` | none | neutral |
| `added` | `av-delta-added` | 新增 | green |
| `modified` | `av-delta-modified` | 修改 | amber |
| `moved` | `av-delta-moved` | 迁移 | blue |
| `split` | `av-delta-split` | 拆分 | violet |
| `merged` | `av-delta-merged` | 合并 | teal |
| `removed` | `av-delta-removed` | 移除 | muted red, translucent |
| design state | `av-planned` | 待设计 | gray dashed border |

`av-delta-baseline` and `av-delta-inherited` do not add a marker by
themselves. Leave the status element empty or omit it.

Use `data-status-label` with an empty `.av-card-status` element to select
status copy without changing component logic. The theme maps the core kinds
to `新增`, `修改`, `迁移`, `拆分`, `合并`, `移除`, and `待设计`.
`baseline` and `inherited` have no mapped copy:

```tsx
<article
  className={`av-card av-delta-${node.data.deltaKind}`}
  data-status-label={node.data.deltaKind}
>
  <div className="av-card-status" />
</article>
```

For edges, use the edge's `EdgeDeltaKind`: `av-edge-added`,
`av-edge-removed`, and `av-edge-rewired`. The default and inherited edge use
the base stroke.

## Classes

- `.av-card`, `.av-card-status`, `.av-card-body`, `.av-card-icon`,
  `.av-card-copy`, `.av-card-title`, `.av-card-desc`, `.av-card-meta`
- `.av-card-meta-item`, `.av-card-action` for metadata and the circular
  expand/collapse control
- `.av-aggregate`, `.av-aggregate-header`, `.av-aggregate-icon`,
  `.av-aggregate-title`, `.av-aggregate-count`, `.av-aggregate-content`,
  `.av-aggregate-empty`, `.av-aggregate-actions`, `.av-aggregate-action`
- `.av-edge-label` for the React Flow edge label component
- `.av-theme` for shared variables and the grid background

The grid in `.av-card-body` has icon and copy columns. Keep the title and
description inside `.av-card-copy`. Place `.av-card-meta` after the body.

Run `node tools/check-theme.mjs` from the package directory to validate CSS
bracket pairing. Open `playground/preview-theme.html` directly to inspect a
static rendering without React or a build step.
