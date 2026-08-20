"use client";

import { useEffect, useRef } from "react";
import mapboxgl, { GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { bboxOf } from "@/lib/geo/normalize";

const KELLY = "#39b54a";

// Satellite map for the plotting flow: the plotted polygon (kelly), the
// existing boundary it is compared with (white), optional extra shapes
// (PLSS section candidates, amber), and a draggable point-of-beginning
// marker. Tap the map to move the POB when onPobChange is given.
export default function PlotMap({
  plotted,
  existing,
  extras = [],
  pob = null,
  onPobChange,
  fitKey,
  height = "h-72 md:h-96",
}: {
  plotted: Geometry | null;
  existing: Geometry | null;
  extras?: Array<{ geometry: Geometry; label?: string; highlighted?: boolean }>;
  pob?: [number, number] | null;
  onPobChange?: (p: [number, number]) => void;
  // Change this value to re-fit the view (e.g. when a target is picked).
  fitKey?: string;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const loadedRef = useRef(false);
  const onPobRef = useRef(onPobChange);
  onPobRef.current = onPobChange;
  const lastFitRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-87.0, 34.5],
      zoom: 5,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of ["existing", "plotted", "extras"]) {
        map.addSource(id, { type: "geojson", data: empty });
      }
      map.addLayer({ id: "extras-fill", type: "fill", source: "extras",
        paint: { "fill-color": "#f59e0b",
          "fill-opacity": ["case", ["get", "highlighted"], 0.22, 0.08] } });
      map.addLayer({ id: "extras-line", type: "line", source: "extras",
        paint: { "line-color": "#f59e0b", "line-width": 1.5, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "extras-label", type: "symbol", source: "extras",
        layout: { "text-field": ["get", "label"], "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "#78350f", "text-halo-width": 1.2 } });
      map.addLayer({ id: "existing-fill", type: "fill", source: "existing",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 } });
      map.addLayer({ id: "existing-line", type: "line", source: "existing",
        paint: { "line-color": "#ffffff", "line-width": 2.5 } });
      map.addLayer({ id: "plotted-fill", type: "fill", source: "plotted",
        paint: { "fill-color": KELLY, "fill-opacity": 0.25 } });
      map.addLayer({ id: "plotted-line", type: "line", source: "plotted",
        paint: { "line-color": KELLY, "line-width": 3 } });
      loadedRef.current = true;
      map.fire("turnrow.ready");
    });
    map.on("click", (e) => {
      if (onPobRef.current) onPobRef.current([e.lngLat.lng, e.lngLat.lat]);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // Data sync (waits for style load).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const set = (id: string, fc: FeatureCollection) =>
        (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
      const fc = (g: Geometry | null, props: Record<string, unknown> = {}): FeatureCollection => ({
        type: "FeatureCollection",
        features: g ? [{ type: "Feature", properties: props, geometry: g } as Feature] : [],
      });
      set("plotted", fc(plotted));
      set("existing", fc(existing));
      set("extras", {
        type: "FeatureCollection",
        features: extras.map((x) => ({
          type: "Feature",
          properties: { label: x.label ?? "", highlighted: !!x.highlighted },
          geometry: x.geometry,
        })),
      });
      if (fitKey !== lastFitRef.current) {
        lastFitRef.current = fitKey;
        const geoms = [plotted, existing, ...extras.map((x) => x.geometry)].filter(
          (g): g is Geometry => !!g
        );
        const box = geoms.length > 0 ? bboxOf(geoms) : null;
        if (box) map.fitBounds(box, { padding: 40, maxZoom: 17, duration: 400 });
      }
    };
    if (loadedRef.current) apply();
    else map.once("turnrow.ready", apply);
  }, [plotted, existing, extras, fitKey]);

  // Draggable POB marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pob) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.style.width = "22px";
      el.style.height = "22px";
      el.style.borderRadius = "9999px";
      el.style.background = "#ffffff";
      el.style.border = "4px solid " + KELLY;
      el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.35)";
      el.style.cursor = "grab";
      el.title = "Point of beginning (drag to move)";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat(pob)
        .addTo(map);
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        onPobRef.current?.([ll.lng, ll.lat]);
      });
      markerRef.current = marker;
    } else {
      const cur = markerRef.current.getLngLat();
      if (Math.abs(cur.lng - pob[0]) > 1e-9 || Math.abs(cur.lat - pob[1]) > 1e-9) {
        markerRef.current.setLngLat(pob);
      }
    }
  }, [pob]);

  return (
    <div
      ref={containerRef}
      className={"w-full overflow-hidden rounded-xl border border-gray-200 " + height}
    />
  );
}
