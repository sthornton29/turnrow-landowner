import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { canDeleteVertices } from "@/lib/geo/vertexDelete";

// The map's own versions of mapbox-gl-draw's two select modes, used for
// ALL boundary and line editing (MapView registers them under the stock
// names, so every changeMode("direct_select") lands here).
//
// Why: in the stock modes, pressing on a shape's body and dragging moves
// the WHOLE shape (direct_select with no point selected, simple_select
// with the shape selected). On a phone that is an ordinary one-finger
// pan: the property line slides across the county and Save writes it.
// Here a shape is never dragged as a whole. Only its points move, one
// at a time, and a drag anywhere else pans the map.

interface PointEditState {
  featureId: string;
  feature: { type: string; getCoordinates: () => unknown; changed: () => void };
  selectedCoordPaths: string[];
}

// The stock mode's own helpers, which the published types leave out.
type PointEditThis = MapboxDraw.DrawCustomModeThis & {
  stopDragging: (state: PointEditState) => void;
};

type StockHandlers = Record<string, (this: unknown, ...args: unknown[]) => unknown>;
const stockDirectSelect = MapboxDraw.modes.direct_select as unknown as StockHandlers;

// Let go of any selected point and of the drag the stock mode may still
// be holding (it keeps the map's own panning switched off until then).
function releasePoints(this: PointEditThis, state: PointEditState) {
  state.selectedCoordPaths = [];
  this.clearSelectedCoordinates();
  state.feature.changed();
  this.stopDragging(state);
}

export const pointEditMode = {
  ...MapboxDraw.modes.direct_select,

  // A press on the shape's body starts nothing: the map pans.
  onFeature(this: PointEditThis, state: PointEditState) {
    this.stopDragging(state);
  },
  dragFeature() {},
  // Only a selected point may be dragged. Without one, hand the gesture
  // back to the map.
  onDrag(this: PointEditThis, state: PointEditState, e: unknown) {
    if (state.selectedCoordPaths.length === 0) {
      this.stopDragging(state);
      return;
    }
    stockDirectSelect.onDrag.call(this, state, e);
  },
  // A tap on a point selects it and nothing more. The stock mode ends a
  // mouse click by letting go of the drag but not a touch tap, so after
  // a tap the next swipe anywhere on the map would move that point.
  onTap(this: PointEditThis, state: PointEditState, e: unknown) {
    stockDirectSelect.onTap.call(this, state, e);
    this.stopDragging(state);
  },

  // A tap off the shape lets go of the selected point and stays in the
  // editor. (The stock mode drops to simple_select, which hides the
  // points until the shape is tapped twice more.)
  clickNoTarget(this: PointEditThis, state: PointEditState) {
    releasePoints.call(this, state);
  },
  clickInactive(this: PointEditThis, state: PointEditState) {
    releasePoints.call(this, state);
  },

  // Delete point. The stock mode deletes the WHOLE shape when a ring
  // falls under three points; refuse that delete instead.
  onTrash(this: PointEditThis, state: PointEditState) {
    if (
      !canDeleteVertices(
        state.feature.type,
        state.feature.getCoordinates(),
        state.selectedCoordPaths
      )
    ) {
      return;
    }
    stockDirectSelect.onTrash.call(this, state);
    this.stopDragging(state);
  },
} as unknown as MapboxDraw.DrawCustomMode;

export const selectMode = {
  ...MapboxDraw.modes.simple_select,
  // A selected shape is never dragged as a whole either: these two are
  // the stock mode's whole-shape move.
  startOnActiveFeature() {},
  dragMove() {},
} as unknown as MapboxDraw.DrawCustomMode;

// Total positions on the draw canvas, for telling whether Delete point
// took a point away or was refused.
export function countDrawPositions(fc: { features: Array<{ geometry: unknown }> }): number {
  let n = 0;
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") n += 1;
    else c.forEach(walk);
  };
  for (const f of fc.features) walk((f.geometry as { coordinates?: unknown } | null)?.coordinates);
  return n;
}
