import { describe, expect, it } from "vitest";
import { countDrawPositions, pointEditMode, selectMode } from "./editModes";

// These run the real mapbox-gl-draw mode code with our overrides on top,
// against a stand-in for the draw tool's context: the gestures a phone
// sends (touch start, drag, tap, touch end) and what they may and may
// not do to a boundary.

type Handler = (...args: unknown[]) => unknown;

// A polygon as the draw tool holds it (rings stored open).
function polygonFeature(ring: number[][]) {
  return {
    id: "f1",
    type: "Polygon",
    coordinates: [ring.map((p) => [...p])],
    movedWhole: 0,
    getCoordinates() {
      return this.coordinates.map((r) => r.concat([r[0]]));
    },
    getCoordinate(path: string) {
      const [r, i] = path.split(".").map(Number);
      return [...this.coordinates[r][i]];
    },
    updateCoordinate(path: string, lng: number, lat: number) {
      const [r, i] = path.split(".").map(Number);
      this.coordinates[r][i] = [lng, lat];
    },
    removeCoordinate(path: string) {
      const [r, i] = path.split(".").map(Number);
      this.coordinates[r].splice(i, 1);
      if (this.coordinates[r].length < 3) this.coordinates.splice(r, 1);
    },
    // moveFeatures (the whole-shape drag) writes through this.
    incomingCoords(coords: number[][][]) {
      this.movedWhole += 1;
      this.coordinates = coords.map((r) => r.slice(0, -1));
    },
    changed() {},
    isValid() {
      return this.coordinates.length > 0 && this.coordinates.every((r) => r.length > 2);
    },
    toGeoJSON() {
      return { type: "Feature", geometry: { type: "Polygon", coordinates: this.getCoordinates() } };
    },
  };
}

function start(modeObject: object, feature: ReturnType<typeof polygonFeature>, options: object) {
  const calls: string[] = [];
  const dragPan = {
    on: true,
    isEnabled() {
      return this.on;
    },
    enable() {
      this.on = true;
    },
    disable() {
      this.on = false;
    },
  };
  const mode: Record<string, unknown> = {
    map: { dragPan, doubleClickZoom: { enable() {}, disable() {} } },
    drawConfig: { boxSelect: false },
    setSelectedCoordinates() {},
    clearSelectedCoordinates() {},
    setSelected() {},
    getSelected: () => [feature],
    getSelectedIds: () => [feature.id],
    getFeature: () => feature,
    isSelected: () => true,
    isInstanceOf: () => false,
    setActionableState() {},
    fire() {},
    changeMode: (name: string) => calls.push(`changeMode:${name}`),
    deleteFeature: () => calls.push("deleteFeature"),
    updateUIClasses() {},
    doRender() {},
  };
  // The same way the draw tool builds a mode from its object.
  for (const [key, value] of Object.entries(modeObject)) mode[key] = value;
  const call = (name: string, ...args: unknown[]) => (mode[name] as Handler).call(mode, ...args);
  const state = call("onSetup", options) as {
    canDragMove: boolean;
    initialDragPanState: boolean | null;
    dragMoveLocation: unknown;
    selectedCoordPaths: string[];
  };
  return { call, state, dragPan, calls };
}

const square = [[0, 0], [1, 0], [1, 1], [0, 1]];

function event(target: "body" | "vertex:0.2" | "none", lng: number, lat: number) {
  const originalEvent = { stopped: false, stopPropagation() { this.stopped = true; } };
  const featureTarget =
    target === "none"
      ? undefined
      : target === "body"
        ? { properties: { meta: "feature", active: "true", id: "f1" } }
        : { properties: { meta: "vertex", coord_path: target.slice("vertex:".length), parent: "f1" } };
  return { lngLat: { lng, lat }, originalEvent, featureTarget };
}

describe("pointEditMode (boundary editing)", () => {
  it("leaves a one-finger drag on the shape's body to the map", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    m.call("onTouchStart", m.state, event("body", 0.5, 0.5));
    expect(m.dragPan.on).toBe(true); // the map can pan
    const drag = event("body", 0.7, 0.7);
    m.call("onDrag", m.state, drag);
    expect(f.coordinates[0]).toEqual(square);
    expect(f.movedWhole).toBe(0);
    expect(drag.originalEvent.stopped).toBe(false); // gesture not taken from the map
  });

  it("never moves the whole shape, even from a drag state left behind", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    Object.assign(m.state, { canDragMove: true, initialDragPanState: true, dragMoveLocation: { lng: 0, lat: 0 } });
    m.dragPan.on = false;
    m.call("onDrag", m.state, event("none", 5, 5));
    expect(f.coordinates[0]).toEqual(square);
    expect(f.movedWhole).toBe(0);
    expect(m.dragPan.on).toBe(true); // and panning is handed back
  });

  it("selects a tapped point without arming it for the next swipe", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    m.call("onTouchStart", m.state, event("vertex:0.2", 1, 1));
    m.call("onTap", m.state, event("vertex:0.2", 1, 1));
    expect(m.state.selectedCoordPaths).toEqual(["0.2"]);
    expect(m.dragPan.on).toBe(true);
    m.call("onDrag", m.state, event("none", 3, 3));
    expect(f.coordinates[0]).toEqual(square);
  });

  it("still moves one point when that point is dragged", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    m.call("onTouchStart", m.state, event("vertex:0.2", 1, 1));
    m.call("onDrag", m.state, event("vertex:0.2", 1.5, 1.25));
    m.call("onTouchEnd", m.state, event("vertex:0.2", 1.5, 1.25));
    expect(f.coordinates[0]).toEqual([[0, 0], [1, 0], [1.5, 1.25], [0, 1]]);
    expect(m.dragPan.on).toBe(true);
  });

  it("deletes the selected point, but never takes a ring under three points", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    m.state.selectedCoordPaths = ["0.2"];
    m.call("onTrash", m.state);
    expect(f.coordinates[0]).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(m.state.selectedCoordPaths).toEqual([]);

    m.state.selectedCoordPaths = ["0.1"];
    m.call("onTrash", m.state);
    expect(f.coordinates[0]).toHaveLength(3); // refused
    expect(m.calls).toEqual([]); // the shape is not deleted, the editor is not left
  });

  it("stays in the editor when the map is tapped away from the shape", () => {
    const f = polygonFeature(square);
    const m = start(pointEditMode, f, { featureId: "f1" });
    m.state.selectedCoordPaths = ["0.2"];
    m.call("onTap", m.state, event("none", 9, 9));
    expect(m.state.selectedCoordPaths).toEqual([]);
    expect(m.calls).toEqual([]);
  });
});

describe("selectMode", () => {
  it("does not drag a selected shape as a whole", () => {
    const f = polygonFeature(square);
    const m = start(selectMode, f, { featureIds: ["f1"] });
    m.call("onTouchStart", m.state, event("body", 0.5, 0.5));
    m.call("onMouseDown", m.state, event("body", 0.5, 0.5));
    expect(m.dragPan.on).toBe(true);
    const drag = event("body", 0.8, 0.8);
    m.call("onDrag", m.state, drag);
    expect(f.movedWhole).toBe(0);
    expect(drag.originalEvent.stopped).toBe(false);
  });
});

describe("countDrawPositions", () => {
  it("counts every position on the canvas", () => {
    expect(
      countDrawPositions({
        features: [
          { geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
          { geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
          { geometry: null },
        ],
      })
    ).toBe(6);
  });
});
