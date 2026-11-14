"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

// The last line of defense: a failure in the root layout itself. This
// replaces the whole document, so it brings its own html and body and
// plain inline styles (the app's stylesheet is not loaded here).
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14532d",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: 16,
        }}
      >
        <title>Something went wrong | Turnrow Landowner</title>
        <div
          style={{
            width: "100%",
            maxWidth: 384,
            background: "#ffffff",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#14532d" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "8px 0 20px", fontSize: 14, lineHeight: 1.5, color: "#4b5563" }}>
            The app could not load. Your records are safe. Check your connection
            and try again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              width: "100%",
              border: 0,
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 16,
              fontWeight: 600,
              color: "#ffffff",
              background: "#39b54a",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ margin: "16px 0 0", fontSize: 14 }}>
            <a href="/map" style={{ color: "#14532d" }}>
              Open the map
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
