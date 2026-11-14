// "Delete point" in the map's boundary editor (components/map/
// editModes.ts). A polygon ring needs three points and a line needs
// two; mapbox-gl-draw answers a delete that goes below that by throwing
// away the WHOLE shape, every other part of the boundary included. This
// says whether a delete is safe before it is made.
//
// coordPaths are the draw tool's own addresses for the selected points:
// "ring.index" on a Polygon, "index" on a LineString, and one more
// leading index for the Multi kinds ("polygon.ring.index",
// "line.index"). coordinates are GeoJSON coordinates, so polygon rings
// arrive closed (the first point repeated at the end).
export function canDeleteVertices(
  geometryType: string,
  coordinates: unknown,
  coordPaths: string[]
): boolean {
  const isPolygon = geometryType === "Polygon" || geometryType === "MultiPolygon";
  const isLine = geometryType === "LineString" || geometryType === "MultiLineString";
  if ((!isPolygon && !isLine) || coordPaths.length === 0) return false;
  const fewest = isPolygon ? 3 : 2;

  // How many of the selected points sit on each ring (or line).
  const removing = new Map<string, number>();
  for (const path of coordPaths) {
    const cut = path.lastIndexOf(".");
    const part = cut === -1 ? "" : path.slice(0, cut);
    removing.set(part, (removing.get(part) ?? 0) + 1);
  }

  for (const [part, count] of removing) {
    let node: unknown = coordinates;
    if (part !== "") {
      for (const index of part.split(".")) {
        node = Array.isArray(node) ? node[Number(index)] : undefined;
      }
    }
    if (!Array.isArray(node)) return false;
    const points = isPolygon ? node.length - 1 : node.length;
    if (points - count < fewest) return false;
  }
  return true;
}
