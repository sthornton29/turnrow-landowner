"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ASSET_TYPES, ROUND_ASSET_TYPES } from "@/lib/assetTypes";
import { EASEMENT_CATEGORY_COLORS } from "@/lib/easements";
import {
  ISSUE_DEFAULT_KIND,
  ISSUE_TYPES,
  ISSUE_TYPE_HINTS,
  ISSUE_TYPE_LABELS,
  type IssueGeometryKind,
  type IssueType,
} from "@/lib/maintenance";
import type { AssetType } from "@/types/db";
import {
  ASSET_LIGHT_BLUE,
  CEMETERY_VIOLET,
  ISSUE_AMBER,
  KELLY,
  PASTURE_TAN,
  PINE,
  PIVOT_BLUE,
  POLLINATOR_ROSE,
  WETLAND_BLUE,
} from "./drawColors";

// What is being drawn, chosen BEFORE the first point goes down. The
// session's type is fixed from here: the draw tool (polygon, line, or
// the crosshair pin), the draft color, and the save form's inline
// fields all follow it.
export type DrawType =
  | { kind: "boundary"; entityType: "property" | "parcel" | "field" | "pasture" | "wetland" | "pollinator_habitat" | "timber_stand" | "cemetery" }
  | { kind: "boundary"; entityType: "easement"; shape: "polygon" }
  | { kind: "line"; entityType: "easement"; shape: "line" }
  | { kind: "line"; entityType: "road" | "underground_pipe" | "fence" }
  // A cemetery marker: the crosshair, then the save form.
  | { kind: "pin"; entityType: "cemetery" }
  // Maintenance issues: their own layer; pin, line, or area per issue.
  | { kind: "issue"; entityType: "maintenance_issue"; issueType: IssueType; shape: IssueGeometryKind };

// How a point-capable asset lands on the map: pin is the crosshair,
// outline traces the footprint, circle is center plus diameter.
export type AssetPlacement = "pin" | "outline" | "circle";

// What a main-grid card does when tapped: start a draw session right
// away, open a shape sub-step, open the asset placement sub-step, or
// hand off to the pivot's own crosshair flow.
type MainPick =
  | { t: "draw"; type: DrawType }
  | { t: "sub"; step: "easement" | "cemetery" | "issue" }
  | { t: "asset"; assetType: AssetType }
  | { t: "pivot" };

interface Item {
  key: string;
  label: string;
  hint: string;
  swatch?: { color: string; kind: "fill" | "line" };
  bang?: boolean;
  pick: MainPick;
}

interface Section {
  title: string;
  tone?: "amber";
  items: Item[];
}

// The one Add picker: every addable thing, grouped, in one panel.
// Underground pipe starts its line draw directly (placement is implied)
// and the pivot goes straight to crosshair placement; point assets get
// the placement sub-step after the type is picked.
const SECTIONS: Section[] = [
  {
    title: "Land and boundaries",
    items: [
      { key: "property", label: "Property boundary", hint: "The outer line", swatch: { color: "#ffffff", kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "property" } } },
      { key: "parcel", label: "Parcel", hint: "Tax parcel", swatch: { color: "#e5e7eb", kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "parcel" } } },
      { key: "field", label: "Ag field", hint: "Cropland", swatch: { color: KELLY, kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "field" } } },
      { key: "timber_stand", label: "Timber stand", hint: "Pine, hardwood, mixed", swatch: { color: "#0f766e", kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "timber_stand" } } },
      { key: "pasture", label: "Pasture/Grassland", hint: "Grazing ground, hay, grassland", swatch: { color: PASTURE_TAN, kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "pasture" } } },
      { key: "wetland", label: "Wetland", hint: "Open marsh, sloughs", swatch: { color: WETLAND_BLUE, kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "wetland" } } },
      { key: "pollinator_habitat", label: "Pollinator habitat", hint: "Wildflowers and native grasses for bees and butterflies", swatch: { color: POLLINATOR_ROSE, kind: "fill" },
        pick: { t: "draw", type: { kind: "boundary", entityType: "pollinator_habitat" } } },
      { key: "cemetery", label: "Cemetery", hint: "Family or church plot; draw the plot or drop a pin", swatch: { color: CEMETERY_VIOLET, kind: "fill" },
        pick: { t: "sub", step: "cemetery" } },
    ],
  },
  {
    title: "Lines and corridors",
    items: [
      { key: "road", label: "Road", hint: "Gravel, dirt, turnrow", swatch: { color: "#ffffff", kind: "line" },
        pick: { t: "draw", type: { kind: "line", entityType: "road" } } },
      { key: "easement", label: "Easement", hint: "Line or area", swatch: { color: EASEMENT_CATEGORY_COLORS.utility, kind: "line" },
        pick: { t: "sub", step: "easement" } },
      { key: "fence", label: "Fence", hint: "Your fence line", swatch: { color: ASSET_LIGHT_BLUE, kind: "line" },
        pick: { t: "draw", type: { kind: "line", entityType: "fence" } } },
    ],
  },
  {
    title: "Assets",
    items: [
      { key: "well", label: "Well", hint: "Irrigation or domestic", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "well" } },
      { key: "irrigation_pivot", label: "Irrigation pivot", hint: "Center, then coverage", swatch: { color: PIVOT_BLUE, kind: "fill" },
        pick: { t: "pivot" } },
      { key: "underground_pipe", label: "Underground pipe", hint: "Your irrigation pipe", swatch: { color: ASSET_LIGHT_BLUE, kind: "line" },
        pick: { t: "draw", type: { kind: "line", entityType: "underground_pipe" } } },
      { key: "riser", label: "Riser", hint: "Where the pipe surfaces", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "riser" } },
      { key: "grain_bin_site", label: "Grain bin site", hint: "Groups the bins on it", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "grain_bin_site" } },
      { key: "grain_bin", label: "Grain bin", hint: "Capacity in bushels", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "grain_bin" } },
      { key: "shop", label: "Shop", hint: "Work building", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "shop" } },
      { key: "shed", label: "Shed", hint: "Open or enclosed storage", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "shed" } },
      { key: "barn", label: "Barn", hint: "Hay, stock, equipment", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "barn" } },
      { key: "house", label: "House", hint: "Dwelling on the place", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "house" } },
      { key: "pond_dam", label: "Pond / dam", hint: "Water and its dam", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "pond_dam" } },
      { key: "other_asset", label: "Other", hint: "Anything not listed", swatch: { color: ASSET_LIGHT_BLUE, kind: "fill" },
        pick: { t: "asset", assetType: "other" } },
    ],
  },
  {
    title: "Needs attention",
    tone: "amber",
    items: [
      { key: "maintenance_issue", label: "Maintenance issue", hint: "Wash, sinkhole, broken terrace, road washout, other", bang: true,
        pick: { t: "sub", step: "issue" } },
    ],
  },
];

const SHAPE_OPTIONS: Array<{ key: IssueGeometryKind; label: string; hint: string }> = [
  { key: "point", label: "Pin", hint: "One spot, the crosshair" },
  { key: "line", label: "Line", hint: "Along a terrace or a ditch" },
  { key: "area", label: "Area", hint: "Trace the washed or damaged ground" },
];

const PLACEMENT_OPTIONS: Array<{ key: AssetPlacement; label: string; hint: string }> = [
  { key: "pin", label: "Pin", hint: "One point, the crosshair" },
  { key: "outline", label: "Draw outline", hint: "Trace the footprint" },
  { key: "circle", label: "Circle", hint: "Center plus diameter" },
];

// One picker card. SIZING ASSUMPTION: every title must fit ON ONE LINE
// (whitespace-nowrap, no word breaking) in a 2-column grid at a 360px
// viewport at 13px semibold; the longest current titles are "Property
// boundary", "Pasture/Grassland", and "Underground pipe". Check any new
// type name against those before adding it. The hint clamps to ONE line
// with an ellipsis, with the full text on hover (title tooltip) or
// touch long-press (the bubble). A long-press never also picks.
function PickerCard({
  onClick,
  leading,
  label,
  hint,
  className = "border-gray-300 hover:bg-kelly-50",
}: {
  onClick: () => void;
  leading?: ReactNode;
  label: string;
  hint: string;
  className?: string;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const beginPress = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      suppressClick.current = true;
      setHintOpen(true);
    }, 450);
  };
  const endPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    // Leave the bubble up briefly after the finger lifts so it can be read.
    if (hintOpen && !hideTimer.current) {
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setHintOpen(false);
      }, 2200);
    }
  };

  return (
    <button
      onClick={() => {
        // A long-press opened the hint; that gesture is not a pick.
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onClick();
      }}
      onTouchStart={beginPress}
      onTouchEnd={endPress}
      onTouchMove={endPress}
      onTouchCancel={endPress}
      onContextMenu={(e) => {
        // The long-press hint replaces the browser callout on touch.
        if (hintOpen || pressTimer.current) e.preventDefault();
      }}
      className={
        "relative flex select-none items-start gap-2 rounded-xl border px-2.5 py-2 text-left md:gap-2.5 md:px-3 md:py-2.5 " +
        className
      }
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block whitespace-nowrap text-[13px] font-semibold leading-snug text-gray-900 md:text-sm">
          {label}
        </span>
        <span className="block truncate text-xs text-gray-500" title={hint}>
          {hint}
        </span>
      </span>
      {hintOpen ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-1.5 whitespace-normal rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-normal leading-snug text-white shadow-lg">
          {hint}
        </span>
      ) : null}
    </button>
  );
}

function FillOrLineSwatch({ color, kind }: { color: string; kind: "fill" | "line" }) {
  return (
    <span
      className={
        // Rows align to the top; the thin line swatch nudges down to sit
        // centered on the title line.
        "shrink-0 rounded-[3px] border " + (kind === "fill" ? "h-5 w-5" : "mt-1.5 h-1.5 w-5")
      }
      style={{
        background: kind === "fill" ? color + "66" : color,
        borderColor: color === "#ffffff" ? PINE : color,
      }}
    />
  );
}

function IssueBang() {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: ISSUE_AMBER }}
    >
      !
    </span>
  );
}

export default function AddPicker({
  onPickDraw,
  onPickAsset,
  onPickPivot,
  onCancel,
}: {
  onPickDraw: (type: DrawType) => void;
  onPickAsset: (assetType: AssetType, placement: AssetPlacement) => void;
  onPickPivot: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"main" | "easement" | "cemetery" | "issue" | "asset">("main");
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);

  // Escape returns to the map from any step (Back stays for sub-steps).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Autofocus the filter on desktop only; on a phone it would pop the
  // keyboard over the sheet before anything is read.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) filterRef.current?.focus();
  }, []);

  function doPick(p: MainPick) {
    if (p.t === "draw") onPickDraw(p.type);
    else if (p.t === "pivot") onPickPivot();
    else if (p.t === "asset") {
      setAssetType(p.assetType);
      setStep("asset");
    } else setStep(p.step);
  }

  // Type-to-filter over label and hint; sections with no matches hide.
  const q = query.trim().toLowerCase();
  const visibleSections = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        items: q
          ? s.items.filter(
              (i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)
            )
          : s.items,
      })).filter((s) => s.items.length > 0),
    [q]
  );

  const round = assetType ? ROUND_ASSET_TYPES.includes(assetType) : false;
  // noCircle types (grain bins, bin sites) place as Pin or Draw outline
  // only; the circle editor is not offered for them.
  const noCircle = assetType ? !!ASSET_TYPES[assetType].noCircle : false;

  const heading =
    step === "easement"
      ? "Easement shape"
      : step === "cemetery"
        ? "Cemetery shape"
        : step === "asset" && assetType
          ? ASSET_TYPES[assetType].label
          : step === "issue"
            ? issueType
              ? `${ISSUE_TYPE_LABELS[issueType]}: pin, line, or area?`
              : "What needs attention?"
            : "Add to the map";
  const sub =
    step === "easement"
      ? "A line for a centerline (powerline, pipe, access lane) or an area for the recorded strip, flowage pool, or conservation tract."
      : step === "cemetery"
        ? "Trace the plot when you know its edges, or drop a pin on a single marker."
        : step === "asset"
          ? "How do you want to place it?"
          : step === "issue"
            ? issueType
              ? ISSUE_TYPE_HINTS[issueType]
              : "Problems that need fixing. They show in warning colors on their own layer, not as land."
            : "Pick what to add. The right tool and save form follow, and the type stays fixed for this session.";

  const back = (
    <button
      onClick={() => {
        if (step === "issue" && issueType) setIssueType(null);
        else {
          setAssetType(null);
          setStep("main");
        }
      }}
      className="col-span-2 text-left text-xs font-medium text-kelly-700 hover:underline"
    >
      &larr; Back
    </button>
  );

  // Asset placement: round types lead with Circle (suggested);
  // noCircle types offer Pin and Draw outline only; everything else
  // reads Pin, Draw outline, Circle.
  const placements = noCircle
    ? PLACEMENT_OPTIONS.filter((o) => o.key !== "circle")
    : round
      ? [PLACEMENT_OPTIONS[2], PLACEMENT_OPTIONS[0], PLACEMENT_OPTIONS[1]]
      : PLACEMENT_OPTIONS;

  return (
    <div className="pointer-events-auto fixed inset-0 z-30">
      {/* Backdrop: desktop only; tapping it returns to the map. The
          mobile sheet leaves the top strip of map and the bottom nav
          visible, matching the older sheets. */}
      <div className="hidden bg-black/30 md:absolute md:inset-0 md:block" onClick={onCancel} />
      {/* Phone: a full-height sheet (below a top strip, above the nav).
          Desktop: a centered modal wide enough for 3 columns, so the
          whole set is visible with minimal scrolling. */}
      <div className="absolute inset-x-0 bottom-16 top-12 overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-3 shadow-2xl md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-[42rem] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {step === "easement" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <PickerCard
              onClick={() => onPickDraw({ kind: "line", entityType: "easement", shape: "line" })}
              label="Line"
              hint="Centerline; shows length, width is a note"
            />
            <PickerCard
              onClick={() => onPickDraw({ kind: "boundary", entityType: "easement", shape: "polygon" })}
              label="Area"
              hint="Strip, pool, or tract; shows acres"
            />
            {back}
          </div>
        ) : step === "cemetery" ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <PickerCard
              onClick={() => onPickDraw({ kind: "boundary", entityType: "cemetery" })}
              label="Draw the plot"
              hint="Trace the fence or the edge; shows acres"
            />
            <PickerCard
              onClick={() => onPickDraw({ kind: "pin", entityType: "cemetery" })}
              label="Drop a pin"
              hint="One marker; the crosshair"
            />
            {back}
          </div>
        ) : step === "asset" && assetType ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {placements.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => onPickAsset(assetType, o.key)}
                className={
                  "rounded-lg border px-3 py-2 text-left hover:bg-kelly-50 " +
                  (round && o.key === "circle"
                    ? "border-kelly-500 bg-kelly-50 ring-1 ring-kelly-200"
                    : "border-gray-300")
                }
              >
                <span className="block text-sm font-medium text-gray-900">
                  {o.label}
                  {round && o.key === "circle" ? (
                    <span className="ml-1.5 rounded-full bg-kelly-100 px-1.5 py-0.5 text-[10px] font-medium text-kelly-700">
                      Suggested
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs leading-tight text-gray-500">{o.hint}</span>
              </button>
            ))}
            <div className="md:col-span-3">{back}</div>
          </div>
        ) : step === "issue" ? (
          issueType ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {SHAPE_OPTIONS.map((o) => (
                <PickerCard
                  key={o.key}
                  onClick={() =>
                    onPickDraw({ kind: "issue", entityType: "maintenance_issue", issueType, shape: o.key })
                  }
                  label={o.label}
                  hint={o.hint}
                  className={
                    "hover:bg-amber-50 " +
                    (ISSUE_DEFAULT_KIND[issueType] === o.key ? "border-amber-400 bg-amber-50" : "border-gray-300")
                  }
                />
              ))}
              <div className="col-span-3">{back}</div>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {ISSUE_TYPES.map((t) => (
                <PickerCard
                  key={t}
                  onClick={() => setIssueType(t)}
                  leading={<IssueBang />}
                  label={ISSUE_TYPE_LABELS[t]}
                  hint={ISSUE_TYPE_HINTS[t]}
                  className="border-amber-300 hover:bg-amber-50"
                />
              ))}
              {back}
            </div>
          )
        ) : (
          <>
            <input
              ref={filterRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter picks the first visible card.
                if (e.key === "Enter") {
                  const first = visibleSections[0]?.items[0];
                  if (first) doPick(first.pick);
                }
              }}
              placeholder="Type to filter: barn, fence, wash..."
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
            />
            {visibleSections.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">Nothing matches. Try a shorter word.</p>
            ) : null}
            {visibleSections.map((s) => (
              <div key={s.title} className={s.tone === "amber" ? "mt-4 border-t border-gray-200 pt-3" : "mt-4"}>
                <p
                  className={
                    "mb-1.5 text-xs font-semibold uppercase tracking-wide " +
                    (s.tone === "amber" ? "text-amber-800" : "text-gray-500")
                  }
                >
                  {s.title}
                </p>
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 md:gap-2">
                  {s.items.map((i) => (
                    <PickerCard
                      key={i.key}
                      onClick={() => doPick(i.pick)}
                      leading={
                        i.bang ? <IssueBang /> : i.swatch ? <FillOrLineSwatch color={i.swatch.color} kind={i.swatch.kind} /> : undefined
                      }
                      label={i.label}
                      hint={i.hint}
                      className={
                        i.bang
                          ? "border-amber-300 bg-amber-50/60 hover:bg-amber-50"
                          : "border-gray-300 hover:bg-kelly-50"
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
