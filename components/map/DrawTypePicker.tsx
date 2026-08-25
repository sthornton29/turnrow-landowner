"use client";

import { useRef, useState, type ReactNode } from "react";
import { EASEMENT_CATEGORY_COLORS } from "@/lib/easements";
import {
  ISSUE_DEFAULT_KIND,
  ISSUE_TYPES,
  ISSUE_TYPE_HINTS,
  ISSUE_TYPE_LABELS,
  type IssueGeometryKind,
  type IssueType,
} from "@/lib/maintenance";
import { CEMETERY_VIOLET, ISSUE_AMBER, KELLY, PASTURE_TAN, PINE, WETLAND_BLUE } from "./drawColors";

// What is being drawn, chosen BEFORE the first point goes down. The
// session's type is fixed from here: the draw tool (polygon, line, or
// the crosshair pin), the draft color, and the save form's inline
// fields all follow it.
export type DrawType =
  | { kind: "boundary"; entityType: "property" | "parcel" | "field" | "pasture" | "wetland" | "timber_stand" | "cemetery" }
  | { kind: "boundary"; entityType: "easement"; shape: "polygon" }
  | { kind: "line"; entityType: "easement"; shape: "line" }
  | { kind: "line"; entityType: "road" | "underground_pipe" | "fence" }
  // A cemetery marker: the crosshair, then the save form.
  | { kind: "pin"; entityType: "cemetery" }
  // Maintenance issues: their own layer; pin, line, or area per issue.
  | { kind: "issue"; entityType: "maintenance_issue"; issueType: IssueType; shape: IssueGeometryKind };

interface Choice {
  key: string;
  label: string;
  hint: string;
  color: string;
  swatch: "fill" | "line";
  pick: DrawType | "easement" | "cemetery";
}

const CHOICES: Choice[] = [
  { key: "property", label: "Property boundary", hint: "The outer line", color: "#ffffff", swatch: "fill",
    pick: { kind: "boundary", entityType: "property" } },
  { key: "parcel", label: "Parcel", hint: "Tax parcel", color: "#e5e7eb", swatch: "fill",
    pick: { kind: "boundary", entityType: "parcel" } },
  { key: "field", label: "Ag field", hint: "Cropland", color: KELLY, swatch: "fill",
    pick: { kind: "boundary", entityType: "field" } },
  { key: "timber_stand", label: "Timber stand", hint: "Pine, hardwood, mixed", color: "#0f766e", swatch: "fill",
    pick: { kind: "boundary", entityType: "timber_stand" } },
  { key: "pasture", label: "Pasture/Grassland", hint: "Grazing ground, hay, grassland", color: PASTURE_TAN, swatch: "fill",
    pick: { kind: "boundary", entityType: "pasture" } },
  { key: "wetland", label: "Wetland", hint: "Open marsh, sloughs", color: WETLAND_BLUE, swatch: "fill",
    pick: { kind: "boundary", entityType: "wetland" } },
  { key: "cemetery", label: "Cemetery", hint: "Family or church plot; draw the plot or drop a pin", color: CEMETERY_VIOLET, swatch: "fill",
    pick: "cemetery" },
  { key: "road", label: "Road", hint: "Gravel, dirt, turnrow", color: "#ffffff", swatch: "line",
    pick: { kind: "line", entityType: "road" } },
  { key: "easement", label: "Easement", hint: "Line or area", color: EASEMENT_CATEGORY_COLORS.utility, swatch: "line",
    pick: "easement" },
  { key: "fence", label: "Fence", hint: "Your fence line", color: "#bae6fd", swatch: "line",
    pick: { kind: "line", entityType: "fence" } },
  { key: "underground_pipe", label: "Underground pipe", hint: "Your irrigation pipe", color: "#bae6fd", swatch: "line",
    pick: { kind: "line", entityType: "underground_pipe" } },
];

const SHAPE_OPTIONS: Array<{ key: IssueGeometryKind; label: string; hint: string }> = [
  { key: "point", label: "Pin", hint: "One spot, the crosshair" },
  { key: "line", label: "Line", hint: "Along a terrace or a ditch" },
  { key: "area", label: "Area", hint: "Trace the washed or damaged ground" },
];

// Add a zero-width break opportunity after each "/" so a label like
// "Pasture/Grassland" wraps between its words instead of escaping the
// card (browsers do not break lines at a slash on their own). The label
// text itself is unchanged.
function breakableLabel(label: string): string {
  return label.replaceAll("/", "/​");
}

// One picker card. The title wraps to a second line when it needs to
// (grid rows equalize height, content pinned to the top); the hint
// clamps to ONE line with an ellipsis, with the full text on hover
// (title tooltip) or touch long-press (the bubble). A long-press never
// also picks the card.
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
        "relative flex select-none items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left " +
        className
      }
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold leading-snug text-gray-900">
          {breakableLabel(label)}
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

function FillOrLineSwatch({ color, swatch }: { color: string; swatch: "fill" | "line" }) {
  return (
    <span
      className={
        // Rows align to the top so wrapped titles read cleanly; the thin
        // line swatch nudges down to sit centered on the first line.
        "shrink-0 rounded-[3px] border " + (swatch === "fill" ? "h-5 w-5" : "mt-1.5 h-1.5 w-5")
      }
      style={{
        background: swatch === "fill" ? color + "66" : color,
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

export default function DrawTypePicker({
  onPick,
  onCancel,
}: {
  onPick: (type: DrawType) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"main" | "easement" | "cemetery" | "issue">("main");
  const [issueType, setIssueType] = useState<IssueType | null>(null);

  const heading =
    step === "easement"
      ? "Easement shape"
      : step === "cemetery"
        ? "Cemetery shape"
        : step === "issue"
          ? issueType
            ? `${ISSUE_TYPE_LABELS[issueType]}: pin, line, or area?`
            : "What needs attention?"
          : "What are you drawing?";
  const sub =
    step === "easement"
      ? "A line for a centerline (powerline, pipe, access lane) or an area for the recorded strip, flowage pool, or conservation tract."
      : step === "cemetery"
        ? "Trace the plot when you know its edges, or drop a pin on a single marker."
        : step === "issue"
          ? issueType
            ? ISSUE_TYPE_HINTS[issueType]
            : "Problems that need fixing. They show in warning colors on their own layer, not as land."
          : "Pick first; the drawing tool and save form follow. The type stays fixed for this session.";

  const back = (
    <button
      onClick={() => {
        if (step === "issue" && issueType) setIssueType(null);
        else setStep("main");
      }}
      className="col-span-2 text-left text-xs font-medium text-kelly-700 hover:underline"
    >
      &larr; Back
    </button>
  );

  return (
    // Phone: bottom sheet capped at 75% of the viewport, scrolling
    // inside. Desktop: floating panel with its own height cap so a short
    // window scrolls the list instead of clipping the bottom cards.
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:left-3 md:top-3 md:bottom-auto md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-xl md:border">
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
            onClick={() => onPick({ kind: "line", entityType: "easement", shape: "line" })}
            label="Line"
            hint="Centerline; shows length, width is a note"
          />
          <PickerCard
            onClick={() => onPick({ kind: "boundary", entityType: "easement", shape: "polygon" })}
            label="Area"
            hint="Strip, pool, or tract; shows acres"
          />
          {back}
        </div>
      ) : step === "cemetery" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <PickerCard
            onClick={() => onPick({ kind: "boundary", entityType: "cemetery" })}
            label="Draw the plot"
            hint="Trace the fence or the edge; shows acres"
          />
          <PickerCard
            onClick={() => onPick({ kind: "pin", entityType: "cemetery" })}
            label="Drop a pin"
            hint="One marker; the crosshair"
          />
          {back}
        </div>
      ) : step === "issue" ? (
        issueType ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SHAPE_OPTIONS.map((o) => (
              <PickerCard
                key={o.key}
                onClick={() => onPick({ kind: "issue", entityType: "maintenance_issue", issueType, shape: o.key })}
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
          <div className="mt-3 grid grid-cols-2 gap-2">
            {CHOICES.map((c) => (
              <PickerCard
                key={c.key}
                onClick={() =>
                  c.pick === "easement"
                    ? setStep("easement")
                    : c.pick === "cemetery"
                      ? setStep("cemetery")
                      : onPick(c.pick)
                }
                leading={<FillOrLineSwatch color={c.color} swatch={c.swatch} />}
                label={c.label}
                hint={c.hint}
              />
            ))}
          </div>
          <div className="mt-3 border-t border-gray-200 pt-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">Needs attention</p>
            <PickerCard
              onClick={() => setStep("issue")}
              leading={<IssueBang />}
              label="Maintenance issue"
              hint="Wash, sinkhole, broken terrace, road washout, other"
              className="w-full border-amber-300 bg-amber-50/60 hover:bg-amber-50"
            />
          </div>
        </>
      )}
    </div>
  );
}
