// Frozen PLSS section polygons from the BLM CadNSDI section layer
// (fetched 2026-08-20, geometryPrecision 6, WGS84) so the plotting tests
// never touch the network. Centroids are simple vertex means, enough
// for county and distance assertions.

import type { Polygon } from "geojson";

export interface PlssFixture {
  name: string;
  plssid: string;
  section: number;
  meridian: string; // HU / SS key
  county: string;
  state: string;
  centroid: [number, number]; // lon, lat
  polygon: Polygon;
}

// Huntsville PM, T4S R7W, Section 31: south of Courtland, Lawrence County (the deed that plotted wrong)
export const courtlandSouthSec31: PlssFixture = {
  name: "courtlandSouthSec31",
  plssid: "AL160040S0070W0",
  section: 31,
  meridian: "HU",
  county: "Lawrence",
  state: "AL",
  centroid: [-87.30679, 34.65815],
  polygon: {"type": "Polygon", "coordinates": [[[-87.299898, 34.663773], [-87.317405, 34.664338], [-87.3172, 34.649628], [-87.29953, 34.649256], [-87.299898, 34.663773]]]} as Polygon,
};

// Huntsville PM, T4S R8W, Section 12: Courtland area, Lawrence County
export const courtlandSec12: PlssFixture = {
  name: "courtlandSec12",
  plssid: "AL160040S0080W0",
  section: 12,
  meridian: "HU",
  county: "Lawrence",
  state: "AL",
  centroid: [-87.32523, 34.71705],
  polygon: {"type": "Polygon", "coordinates": [[[-87.318192, 34.722785], [-87.335574, 34.723272], [-87.335895, 34.708505], [-87.318288, 34.707912], [-87.318192, 34.722785]]]} as Polygon,
};

// Huntsville PM, T5S R9W, Section 16: west of Courtland toward Town Creek, Lawrence County
export const townCreekSec16: PlssFixture = {
  name: "townCreekSec16",
  plssid: "AL160050S0090W0",
  section: 16,
  meridian: "HU",
  county: "Lawrence",
  state: "AL",
  centroid: [-87.48333, 34.61859],
  polygon: {"type": "Polygon", "coordinates": [[[-87.476199, 34.62434], [-87.493794, 34.624583], [-87.494035, 34.610044], [-87.476422, 34.609665], [-87.476199, 34.62434]]]} as Polygon,
};

// St. Stephens PM, T4S R7E, Section 31: Baldwin County. What the Courtland deed resolves to when R7W is misread as R7E (direction flip)
export const baldwinFlippedSec31: PlssFixture = {
  name: "baldwinFlippedSec31",
  plssid: "AL250040S0070E0",
  section: 31,
  meridian: "SS",
  county: "Baldwin",
  state: "AL",
  centroid: [-87.40055, 30.65636],
  polygon: {"type": "Polygon", "coordinates": [[[-87.39682, 30.648845], [-87.395946, 30.650088], [-87.395963, 30.650568], [-87.396246, 30.651605], [-87.39657, 30.652012], [-87.39667, 30.652506], [-87.396588, 30.653064], [-87.396597, 30.654391], [-87.396923, 30.654914], [-87.398119, 30.655891], [-87.398389, 30.656286], [-87.398749, 30.656371], [-87.39904, 30.65614], [-87.39946, 30.655754], [-87.399803, 30.6559], [-87.399863, 30.656174], [-87.399838, 30.656695], [-87.399889, 30.657066], [-87.400223, 30.657229], [-87.400492, 30.657039], [-87.400601, 30.656869], [-87.400746, 30.65632], [-87.400858, 30.656114], [-87.401123, 30.6562], [-87.401672, 30.656783], [-87.402889, 30.657186], [-87.403249, 30.657856], [-87.403284, 30.658112], [-87.402898, 30.658866], [-87.402881, 30.659552], [-87.402255, 30.660195], [-87.402221, 30.660615], [-87.402255, 30.661146], [-87.402409, 30.661583], [-87.403061, 30.662106], [-87.403249, 30.662766], [-87.403263, 30.663086], [-87.411648, 30.663041], [-87.412619, 30.648813], [-87.39682, 30.648845]]]} as Polygon,
};

export const COURTLAND_FIXTURES: PlssFixture[] = [courtlandSouthSec31, courtlandSec12, townCreekSec16];
