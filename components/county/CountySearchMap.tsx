"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, { GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import type { Feature, FeatureCollection } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { bboxOf, labelPointOf, toMultiPolygon } from "@/lib/geo/normalize";

export interface SearchMapFeature {
  localId: string;
  geometry: GeoJSON.Geometry;
  selected: boolean;
  // Already in the user's records: imported earlier this session, or
  // matching a parcel that existed before the session.
  imported: boolean;
  // Parcel number, shown as a map label (toggleable).
  label: string;
}

// Satellite preview of county search results. Clicking a polygon reports
// its id; selected parcels fill kelly green; parcels already imported
// fill dark pine with a mint outline (with a small legend when any
// exist); the highlighted parcel gets a bright outline and the map
// zooms to it.
export default function CountySearchMap({
  features,
  highlightedId,
  onFeatureClick,
}: {
  features: SearchMapFeature[];
  highlightedId: string | null;
  onFeatureClick: (localId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);
  const clickRef = useRef(onFeatureClick);
  clickRef.current = onFeatureClick;
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-87.3, 34.5],
      zoom: 8,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      map.addSource("results", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Selection beats the imported tint so update-geometry picks still
      // read as selected while working through duplicates.
      map.addLayer({
        id: "results-fill",
        type: "fill",
        source: "results",
        paint: {
          "fill-color": [
            "case",
            ["get", "selected"], "#39b54a",
            ["get", "imported"], "#14532d",
            "#39b54a",
          ],
          "fill-opacity": [
            "case",
            ["get", "selected"], 0.35,
            ["get", "imported"], 0.45,
            0.08,
          ],
        },
      });
      map.addLayer({
        id: "results-line",
        type: "line",
        source: "results",
        paint: {
          "line-color": [
            "case",
            ["get", "selected"], "#39b54a",
            ["get", "imported"], "#a7f3d0",
            "#ffffff",
          ],
          "line-width": [
            "case",
            ["get", "selected"], 2.5,
            ["get", "imported"], 2,
            1.5,
          ],
        },
      });
      map.addLayer({
        id: "results-highlight",
        type: "line",
        source: "results",
        paint: { "line-color": "#ffffff", "line-width": 4.5 },
        filter: ["==", ["get", "localId"], ""],
      });
      // Parcel numbers at each polygon's label point (toggleable).
      map.addSource("result-labels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "result-labels",
        type: "symbol",
        source: "result-labels",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 10.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#374151",
          "text-halo-width": 1.2,
        },
      });
      loadedRef.current = true;
      syncRef.current();
      visibilityRef.current();
    });

    map.on("click", (e: MapMouseEvent) => {
      if (!map.getLayer("results-fill")) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ["results-fill"] });
      if (hits.length > 0) {
        clickRef.current(String(hits[0].properties?.localId));
      }
    });
    map.on("mouseenter", "results-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "results-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: features.map(
        (f): Feature => ({
          type: "Feature",
          geometry: f.geometry as GeoJSON.Geometry,
          properties: {
            localId: f.localId,
            selected: f.selected,
            imported: f.imported,
          },
        })
      ),
    };
    (map.getSource("results") as GeoJSONSource)?.setData(fc);

    const labels: FeatureCollection = {
      type: "FeatureCollection",
      features: features.flatMap((f): Feature[] => {
        if (!f.label) return [];
        const mp = toMultiPolygon(f.geometry);
        const pt = mp ? labelPointOf(mp) : null;
        if (!pt) return [];
        return [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: pt },
            properties: { label: f.label },
          },
        ];
      }),
    };
    (map.getSource("result-labels") as GeoJSONSource)?.setData(labels);
  };

  // Boundaries and parcel numbers are independently toggleable so the
  // bare satellite imagery can be inspected. The fill stays technically
  // visible at zero opacity so polygon clicks keep working.
  const visibilityRef = useRef<() => void>(() => {});
  visibilityRef.current = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ["results-line", "results-highlight"]) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(
          layer,
          "visibility",
          showBoundaries ? "visible" : "none"
        );
      }
    }
    if (map.getLayer("results-fill")) {
      map.setPaintProperty(
        "results-fill",
        "fill-opacity",
        showBoundaries
          ? [
              "case",
              ["get", "selected"], 0.35,
              ["get", "imported"], 0.45,
              0.08,
            ]
          : 0
      );
    }
    if (map.getLayer("result-labels")) {
      map.setLayoutProperty(
        "result-labels",
        "visibility",
        showNumbers ? "visible" : "none"
      );
    }
  };
  useEffect(() => {
    visibilityRef.current();
  }, [showBoundaries, showNumbers]);

  // Sync data, and refit when the result set changes
  const countRef = useRef(0);
  useEffect(() => {
    syncRef.current();
    const map = mapRef.current;
    if (map && loadedRef.current && features.length !== countRef.current) {
      countRef.current = features.length;
      const box = bboxOf(features.map((f) => f.geometry));
      if (box) map.fitBounds(box, { padding: 40, duration: 300 });
    }
  }, [features]);

  // Highlight + zoom to one parcel
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (map.getLayer("results-highlight")) {
      map.setFilter("results-highlight", ["==", ["get", "localId"], highlightedId ?? ""]);
    }
    if (highlightedId) {
      const feature = features.find((f) => f.localId === highlightedId);
      if (feature) {
        const box = bboxOf([feature.geometry]);
        if (box) map.fitBounds(box, { padding: 100, maxZoom: 16, duration: 400 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId]);

  const anyImported = features.some((f) => f.imported);

  return (
    <div className="relative">
      <div ref={containerRef} className="h-72 w-full rounded-xl md:h-96" />
      <div className="absolute left-2 top-2 space-y-1 rounded-lg bg-white/95 px-2.5 py-1.5 shadow-md">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-800">
          <input
            type="checkbox"
            checked={showBoundaries}
            onChange={(e) => setShowBoundaries(e.target.checked)}
            className="h-3.5 w-3.5 accent-kelly-500"
          />
          Boundaries
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-800">
          <input
            type="checkbox"
            checked={showNumbers}
            onChange={(e) => setShowNumbers(e.target.checked)}
            className="h-3.5 w-3.5 accent-kelly-500"
          />
          Parcel numbers
        </label>
      </div>
      {anyImported ? (
        <div className="absolute bottom-2 left-2 space-y-0.5 rounded-lg bg-white/95 px-2.5 py-1.5 shadow-md">
          <p className="flex items-center gap-1.5 text-xs text-gray-700">
            <span className="h-3 w-3 rounded-[2px] border border-[#a7f3d0] bg-[#14532d]/70" />
            Already imported
          </p>
          <p className="flex items-center gap-1.5 text-xs text-gray-700">
            <span className="h-3 w-3 rounded-[2px] border border-kelly-500 bg-kelly-500/40" />
            Selected
          </p>
        </div>
      ) : null}
    </div>
  );
}
