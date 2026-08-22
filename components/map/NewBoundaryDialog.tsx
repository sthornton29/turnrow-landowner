"use client";

import { useState } from "react";
import { formatAcres, formatNumber } from "@/lib/format";
import { STAND_TYPE_LABELS } from "@/lib/assetTypes";
import {
  EASEMENT_RELATIONSHIP_LABELS,
  EASEMENT_TYPES,
  EASEMENT_TYPE_LABELS,
  easementShowsElevation,
  easementShowsProgram,
} from "@/lib/easements";
import type {
  EasementRelationship,
  EasementType,
  EntityType,
  PropertyGeo,
  StandType,
} from "@/types/db";

export type BoundaryType =
  | "field"
  | "pasture"
  | "wetland"
  | "parcel"
  | "property"
  | "timber_stand"
  | "easement"
  | "cemetery";

export interface NewBoundaryPayload {
  entityType: EntityType;
  name: string; // parcel number when entityType is "parcel"
  propertyId: string | null; // required for parcel/field/timber_stand
  county: string | null;
  state: string | null;
  // Timber stand details, saved with the stand in one step (no
  // post-save trip to the detail page). Only standType is required.
  standType: StandType | null;
  species: string | null;
  yearEstablished: number | null;
  standNotes: string | null;
  // Easement details, same one-step pattern.
  easementType: EasementType | null;
  relationship: EasementRelationship | null;
  holder: string | null;
  recordedRef: string | null;
  expirationDate: string | null;
  widthFt: number | null;
  elevationFt: number | null;
  program: string | null;
  restrictions: string | null;
  easementNotes: string | null;
  cemeteryNotes?: string | null;
}

export const BOUNDARY_TYPE_LABEL: Record<BoundaryType, string> = {
  field: "Ag field",
  pasture: "Pasture/Grassland",
  wetland: "Wetland",
  parcel: "Parcel",
  property: "Property",
  timber_stand: "Timber stand",
  easement: "Easement",
  cemetery: "Cemetery",
};

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

// The save form for a pick-first draw session. The type was chosen
// BEFORE drawing, so it is fixed here and the type's inline fields show
// from the first render. Mounted (css-hidden) through a whole
// multi-area session so nothing typed resets when another area is
// drawn.
export default function NewBoundaryDialog({
  fixedType,
  shape,
  approxAcres,
  approxLengthFt = null,
  areaCount = 1,
  properties,
  suggestedPropertyId = null,
  saving,
  error,
  onSave,
  onCancel,
  onAddArea,
  onCutArea,
  hidden = false,
}: {
  fixedType: BoundaryType;
  shape: "polygon" | "line"; // line only for easements
  approxAcres: number | null;
  approxLengthFt?: number | null;
  // How many separate areas make up the boundary (per-shape acres show
  // on the map; this figure is the total).
  areaCount?: number;
  properties: PropertyGeo[];
  suggestedPropertyId?: string | null;
  saving: boolean;
  error: string | null;
  onSave: (payload: NewBoundaryPayload) => void;
  onCancel: () => void;
  onAddArea?: () => void; // draw another polygon and merge it in
  onCutArea?: () => void; // draw a polygon and cut it out
  hidden?: boolean;
}) {
  const entityType = fixedType;
  const [propertyId, setPropertyId] = useState(
    suggestedPropertyId ?? properties[0]?.id ?? ""
  );
  // Timber stand fields: state (not form values) so they survive the
  // whole multi-area session like name/property do.
  const [standType, setStandType] = useState<StandType | null>(null);
  const [species, setSpecies] = useState("");
  const [easementType, setEasementType] = useState<EasementType>("powerline");
  const [relationship, setRelationship] =
    useState<EasementRelationship>("burdens_this_property");
  const isEasement = entityType === "easement";
  // Easements often cross property lines, so their property is optional.
  const needsProperty = entityType !== "property" && !isEasement;
  const isTimber = entityType === "timber_stand";

  function pickStandType(t: StandType) {
    setStandType(t);
    // Prefill the dominant species for pine, but never stomp a hand
    // -typed value (only replace empty or the other prefill).
    if (
      (t === "planted_pine" || t === "natural_pine") &&
      (species.trim() === "" || species === "Loblolly pine")
    ) {
      setSpecies("Loblolly pine");
    }
  }

  function handleSubmit(formData: FormData) {
    const str = (k: string) => String(formData.get(k) ?? "").trim() || null;
    const num = (k: string) => {
      const v = str(k);
      return v === null ? null : Number(v);
    };
    onSave({
      entityType,
      name: String(formData.get("name") ?? "").trim(),
      propertyId:
        needsProperty || isEasement
          ? String(formData.get("property_id") ?? "") || null
          : null,
      county: str("county"),
      state: str("state"),
      standType: isTimber ? standType : null,
      species: isTimber ? species.trim() || null : null,
      yearEstablished: isTimber ? num("year_established") : null,
      standNotes: isTimber ? str("stand_notes") : null,
      easementType: isEasement ? easementType : null,
      relationship: isEasement ? relationship : null,
      holder: isEasement ? str("holder") : null,
      recordedRef: isEasement ? str("recorded_ref") : null,
      expirationDate: isEasement ? str("expiration_date") : null,
      widthFt: isEasement && shape === "line" ? num("width_ft") : null,
      elevationFt:
        isEasement && easementShowsElevation(easementType) ? num("elevation_ft") : null,
      program: isEasement && easementShowsProgram(easementType) ? str("program") : null,
      restrictions:
        isEasement && easementShowsProgram(easementType) ? str("restrictions") : null,
      easementNotes: isEasement ? str("easement_notes") : null,
      cemeteryNotes: entityType === "cemetery" ? str("cemetery_notes") : null,
    });
  }

  const sizeLine =
    shape === "line"
      ? approxLengthFt !== null
        ? `About ${formatNumber(Math.round(approxLengthFt))} ft (exact length computed on save)`
        : null
      : approxAcres !== null
        ? areaCount > 1
          ? `Total of ${areaCount} areas: ${formatAcres(approxAcres)} acres (exact acres computed on save)`
          : `About ${formatAcres(approxAcres)} acres (exact acres computed on save)`
        : null;

  return (
    <div
      className={
        "pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-4 md:top-4 md:bottom-auto md:w-80 md:rounded-xl md:border" +
        (hidden ? " hidden" : "")
      }
    >
      <h2 className="text-lg font-semibold text-gray-900">
        Save {BOUNDARY_TYPE_LABEL[entityType].toLowerCase()}
        {isEasement ? (shape === "line" ? " (line)" : " (area)") : ""}
      </h2>
      {sizeLine ? <p className="mt-0.5 text-sm text-gray-500">{sizeLine}</p> : null}
      {shape === "polygon" && (onAddArea || onCutArea) ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
          {onAddArea ? (
            <button
              type="button"
              onClick={onAddArea}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              + Add area
            </button>
          ) : null}
          {onCutArea ? (
            <button
              type="button"
              onClick={onCutArea}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cut area out
            </button>
          ) : null}
          <span className="text-xs text-gray-500">Areas do not need to touch.</span>
        </p>
      ) : null}

      <form action={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className={labelClass}>
            {entityType === "parcel"
              ? "Parcel number"
              : entityType === "timber_stand"
                ? "Stand name or number"
                : "Name"}
          </label>
          <input name="name" required autoFocus className={inputClass} />
        </div>

        {entityType === "cemetery" ? (
          <div>
            <label className={labelClass}>Notes</label>
            <input name="cemetery_notes" placeholder="Family names, church, markers (optional)" className={inputClass} />
          </div>
        ) : null}

        {entityType === "wetland" ? (
          <p className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
            Open wetlands: marsh, sloughs, duck holes, WRP/easement ground.
            Forested bottomland stays a timber stand (hardwood with a wetland
            note).
          </p>
        ) : null}

        {isEasement ? (
          <>
            <div>
              <label className={labelClass}>Easement type</label>
              <select
                value={easementType}
                onChange={(e) => setEasementType(e.target.value as EasementType)}
                className={inputClass}
              >
                {EASEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EASEMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {easementType === "pipeline" ? (
                <p className="mt-1 text-xs text-gray-500">
                  The company{"'"}s corridor. Your own buried irrigation pipe
                  is an asset, not an easement.
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelClass}>Relationship</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(EASEMENT_RELATIONSHIP_LABELS) as EasementRelationship[]).map(
                  (r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRelationship(r)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (relationship === r
                          ? "border-kelly-500 bg-kelly-50 text-pine-900"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      {r === "burdens_this_property" ? "Burdens my land" : "Benefits my land"}
                    </button>
                  )
                )}
              </div>
              {relationship === "benefits_this_property" ? (
                <p className="mt-1 text-xs text-gray-500">
                  A right you hold over a neighbor (access lane, utility
                  route). Drawing it outside your boundary is expected.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Holder</label>
                <input name="holder" placeholder="Utility, company, neighbor" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Recorded ref</label>
                <input name="recorded_ref" placeholder="Book/page" className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Expires</label>
                <input name="expiration_date" type="date" className={inputClass} />
                <p className="mt-0.5 text-[11px] text-gray-500">Blank = permanent</p>
              </div>
              {shape === "line" ? (
                <div>
                  <label className={labelClass}>Width (ft)</label>
                  <input name="width_ft" type="number" step="any" placeholder="Optional" className={inputClass} />
                  <p className="mt-0.5 text-[11px] text-gray-500">Informational; draw an area for the strip</p>
                </div>
              ) : null}
              {easementShowsElevation(easementType) ? (
                <div>
                  <label className={labelClass}>Flowage elevation (ft)</label>
                  <input name="elevation_ft" type="number" step="any" placeholder="Contour" className={inputClass} />
                </div>
              ) : null}
            </div>
            {easementShowsProgram(easementType) ? (
              <>
                <div>
                  <label className={labelClass}>Program / holder detail</label>
                  <input
                    name="program"
                    placeholder="Land trust, NRCS WRE, ALE..."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Restrictions</label>
                  <textarea
                    name="restrictions"
                    rows={2}
                    placeholder="What the easement prohibits or requires"
                    className={inputClass}
                  />
                </div>
              </>
            ) : null}
            <div>
              <label className={labelClass}>Notes</label>
              <input name="easement_notes" placeholder="Optional" className={inputClass} />
            </div>
          </>
        ) : null}

        {isTimber ? (
          <>
            <div>
              <label className={labelClass}>Stand type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(STAND_TYPE_LABELS) as StandType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pickStandType(t)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (standType === t
                        ? "border-kelly-500 bg-kelly-50 text-pine-900"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50")
                    }
                  >
                    {STAND_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Species</label>
                <input
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Year established</label>
                <input name="year_established" type="number" placeholder="Optional" className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input name="stand_notes" placeholder="Optional" className={inputClass} />
            </div>
          </>
        ) : null}

        {needsProperty || isEasement ? (
          <div>
            <label className={labelClass}>
              Property{isEasement ? " (optional; easements cross lines)" : ""}
              {suggestedPropertyId && propertyId === suggestedPropertyId ? (
                <span
                  className="ml-1.5 rounded-full bg-kelly-100 px-2 py-0.5 text-[10px] font-medium text-kelly-700"
                  title="The drawing sits inside this property; confirm or change it"
                >
                  Suggested from location
                </span>
              ) : null}
            </label>
            {properties.length === 0 && !isEasement ? (
              <p className="text-sm text-red-600">
                Create a property first; this must belong to one.
              </p>
            ) : (
              <select
                name="property_id"
                required={!isEasement}
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className={inputClass}
              >
                {isEasement ? <option value="">None</option> : null}
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>County</label>
              <input name="county" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <input name="state" className={inputClass} />
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={
              saving ||
              (needsProperty && properties.length === 0) ||
              (isTimber && !standType)
            }
            title={isTimber && !standType ? "Pick a stand type first" : undefined}
            className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Discard
          </button>
        </div>
      </form>
    </div>
  );
}
