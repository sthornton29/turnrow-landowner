"use client";

import { useEffect, useRef } from "react";
import mapboxgl, { GeoJSONSource } from "mapbox-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import { bboxOf } from "@/lib/geo/normalize";
import type { EntityType } from "@/types/db";

export interface PreviewFeature {
  localId: string;
  geometry: Geometry;
  entityType: EntityType;
  included: boolean;
}

const COLOR: Record<EntityType, string> = {
  property: "#ffffff",
  parcel: "#fbd38d",
  field: "#39b54a",
  pasture: "#d2b48c",
  timber_stand: "#a7f3d0",
  road: "#e5e7eb",
  asset: "#bae6fd",
};

// Read-only satellite map showing parsed features colored by assigned type.
export default function PreviewMap({ features }: { features: PreviewFeature[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-91.0, 33.5],
      zoom: 4,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("preview", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "preview-fill",
        type: "fill",
        source: "preview",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "included"], 0.2, 0.05],
        },
      });
      map.addLayer({
        id: "preview-line",
        type: "line",
        source: "preview",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": ["case", ["get", "included"], 1, 0.3],
        },
      });
      map.addLayer({
        id: "preview-point",
        type: "circle",
        source: "preview",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#14532d",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["get", "included"], 1, 0.3],
        },
      });
      loadedRef.current = true;
      syncRef.current();
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
          geometry: f.geometry,
          properties: {
            color: COLOR[f.entityType],
            included: f.included,
          },
        })
      ),
    };
    (map.getSource("preview") as GeoJSONSource)?.setData(fc);
    const box = bboxOf(features.map((f) => f.geometry));
    if (box) map.fitBounds(box, { padding: 40, duration: 0 });
  };

  useEffect(() => {
    syncRef.current();
  }, [features]);

  return <div ref={containerRef} className="h-64 w-full rounded-lg md:h-96" />;
}
