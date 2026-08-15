declare module "@terraformer/arcgis" {
  // Converts Esri JSON geometry/feature structures to GeoJSON.
  export function arcgisToGeoJSON(arcgis: unknown, idAttribute?: string): GeoJSON.GeoJSON;
  export function geojsonToArcGIS(geojson: unknown, idAttribute?: string): unknown;
}
