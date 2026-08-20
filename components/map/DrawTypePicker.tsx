"use client";

import { useState } from "react";
import { EASEMENT_CATEGORY_COLORS } from "@/lib/easements";
import { KELLY, PASTURE_TAN, PINE, WETLAND_BLUE } from "./drawColors";

// What is being drawn, chosen BEFORE the first point goes down. The
// session's type is fixed from here: the draw tool (polygon or line),
// the draft color, and the save form's inline fields all follow it.
export type DrawType =
  | { kind: "boundary"; entityType: "property" | "parcel" | "field" | "pasture" | "wetland" | "timber_stand" }
  | { kind: "boundary"; entityType: "easement"; shape: "polygon" }
  | { kind: "line"; entityType: "easement"; shape: "line" }
  | { kind: "line"; entityType: "road" | "underground_pipe" | "fence" };

interface Choice {
  key: string;
  label: string;
  hint: string;
  color: string;
  swatch: "fill" | "line";
  pick: DrawType | "easement";
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
  { key: "pasture", label: "Pasture", hint: "Grazing ground", color: PASTURE_TAN, swatch: "fill",
    pick: { kind: "boundary", entityType: "pasture" } },
  { key: "wetland", label: "Wetland", hint: "Open marsh, sloughs", color: WETLAND_BLUE, swatch: "fill",
    pick: { kind: "boundary", entityType: "wetland" } },
  { key: "road", label: "Road", hint: "Gravel, dirt, turnrow", color: "#ffffff", swatch: "line",
    pick: { kind: "line", entityType: "road" } },
  { key: "easement", label: "Easement", hint: "Line or area", color: EASEMENT_CATEGORY_COLORS.utility, swatch: "line",
    pick: "easement" },
  { key: "fence", label: "Fence", hint: "Your fence line", color: "#bae6fd", swatch: "line",
    pick: { kind: "line", entityType: "fence" } },
  { key: "underground_pipe", label: "Underground pipe", hint: "Your irrigation pipe", color: "#bae6fd", swatch: "line",
    pick: { kind: "line", entityType: "underground_pipe" } },
];

export default function DrawTypePicker({
  onPick,
  onCancel,
}: {
  onPick: (type: DrawType) => void;
  onCancel: () => void;
}) {
  const [easementStep, setEasementStep] = useState(false);

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:left-3 md:top-3 md:bottom-auto md:w-80 md:rounded-xl md:border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {easementStep ? "Easement shape" : "What are you drawing?"}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {easementStep
              ? "A line for a centerline (powerline, pipe, access lane) or an area for the recorded strip, flowage pool, or conservation tract."
              : "Pick first; the drawing tool and save form follow. The type stays fixed for this session."}
          </p>
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

      {easementStep ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => onPick({ kind: "line", entityType: "easement", shape: "line" })}
            className="rounded-xl border border-gray-300 px-3 py-3 text-left hover:bg-kelly-50"
          >
            <span className="block text-sm font-semibold text-gray-900">Line</span>
            <span className="block text-xs text-gray-500">Centerline; shows length, width is a note</span>
          </button>
          <button
            onClick={() => onPick({ kind: "boundary", entityType: "easement", shape: "polygon" })}
            className="rounded-xl border border-gray-300 px-3 py-3 text-left hover:bg-kelly-50"
          >
            <span className="block text-sm font-semibold text-gray-900">Area</span>
            <span className="block text-xs text-gray-500">Strip, pool, or tract; shows acres</span>
          </button>
          <button
            onClick={() => setEasementStep(false)}
            className="col-span-2 text-left text-xs font-medium text-kelly-700 hover:underline"
          >
            &larr; Back
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              onClick={() => (c.pick === "easement" ? setEasementStep(true) : onPick(c.pick))}
              className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3 py-2.5 text-left hover:bg-kelly-50"
            >
              <span
                className={
                  "shrink-0 rounded-[3px] border " +
                  (c.swatch === "fill" ? "h-5 w-5" : "h-1.5 w-5")
                }
                style={{
                  background: c.swatch === "fill" ? c.color + "66" : c.color,
                  borderColor: c.color === "#ffffff" ? PINE : c.color,
                }}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                <span className="block text-[11px] leading-tight text-gray-500">{c.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
