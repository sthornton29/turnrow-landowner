import type { MultiPolygon } from "geojson";

// Lightweight inline-SVG sketch of a group of parcel outlines for the
// owner-group cards. Instant and free (no map tiles, no API calls),
// which matters when a search can produce a dozen cards on a phone.
export default function MiniParcelSketch({ shapes }: { shapes: MultiPolygon[] }) {
  const W = 120;
  const H = 72;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const polygon of shape.coordinates) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (!isFinite(minX)) return null;

  // Longitude degrees shrink with latitude; correct so shapes keep
  // their real proportions.
  const midLat = (minY + maxY) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxX - minX) * lonScale, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((W * 0.88) / spanX, (H * 0.88) / spanY);
  const offsetX = (W - spanX * scale) / 2;
  const offsetY = (H - spanY * scale) / 2;

  const project = ([x, y]: number[]) => {
    const px = offsetX + (x - minX) * lonScale * scale;
    const py = offsetY + (maxY - y) * scale;
    return `${px.toFixed(1)} ${py.toFixed(1)}`;
  };

  const path = shapes
    .flatMap((shape) =>
      shape.coordinates.flatMap((polygon) =>
        polygon.map(
          (ring) =>
            `M ${ring.map(project).join(" L ")} Z`
        )
      )
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-18 w-full rounded-lg bg-gray-50"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="#39b54a"
        fillOpacity={0.14}
        stroke="#39b54a"
        strokeWidth={1.2}
        strokeLinejoin="round"
        fillRule="evenodd"
      />
    </svg>
  );
}
