# Compact collapsed cards and projection controls

## Intent

Reduce the shared collapsed frame from 462x96 to 340x80 while retaining the existing expanded responsibility templates. Hide hierarchy controls in fixed Overview and Full projections. Double-clicks in these projections leave expansion unchanged without showing an instruction toast. Structure retains expansion controls. Verify current saved-view restoration and rendered controls in the browser, and run focused model tests and TypeScript checks.

## Result

Shared collapsed cards now use 340x80 frames. Scene handlers expose hierarchy actions only in Structure; both node renderers omit the control when no action exists. The double-click entry and controller guard silently retain fixed projections. Expanded detail templates remain 462x192 and 462x280.

Library and browser TypeScript checks passed; the five focused hierarchy/confirmation tests passed. Native browser inspection of the existing M1 Overview found all six visible cards at 340x80 and zero hierarchy buttons. Double-clicking Provider only selected the node, with no expansion or notice. Structure retained its expansion buttons; Full had zero. Returned to Overview for user review.

## Width adjustment

Owner requested a further width reduction to 240. Change only the shared collapsed width, retain height 80 and the expanded templates, and synchronize the documented dimensions.
