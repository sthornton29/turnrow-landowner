import type { DocType } from "@/lib/documents";
import type { DocumentEntityType } from "@/types/db";

// Where the upload started from (a property, entity, stand, sale, lease
// page...). It is the DEFAULT attachment; the AI pass still runs and
// may note a disagreement, which the user resolves with one tap.
export interface IntakeContextTarget {
  entityType: DocumentEntityType;
  entityId: string;
  label: string;
  propertyId: string | null; // the property this record sits on, when any
}

// A non-property record the document can be attached to as its primary.
export interface AttachOption {
  entityType: DocumentEntityType;
  id: string;
  label: string;
}

export const ATTACH_TYPES: Array<{ key: DocumentEntityType; label: string }> = [
  { key: "parcel", label: "Parcel" },
  { key: "field", label: "Ag field" },
  { key: "timber_stand", label: "Timber stand" },
  { key: "easement", label: "Easement" },
  { key: "asset", label: "Asset" },
  { key: "lease", label: "Lease" },
  { key: "timber_sale", label: "Timber sale" },
  { key: "entity", label: "Entity" },
];

// Everything the confirm or manual form edits; saved together.
export interface Draft {
  docType: DocType;
  title: string;
  propertyIds: string[];
  entityId: string | null; // verified entity attachment (used when no property)
  extra: { entityType: DocumentEntityType; id: string } | null;
  values: Record<string, unknown>;
}
