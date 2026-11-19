import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Turnrow Landowner",
    template: "%s | Turnrow Landowner",
  },
  description:
    "See and keep track of your farmland, timberland, and ranchland.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Landowner",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#39b54a",
  width: "device-width",
  initialScale: 1,
  // Map drawing works best without accidental pinch-zoom of the page itself;
  // content is sized responsively so page zoom is not needed.
  maximumScale: 1,
  userScalable: false,
  // Draw edge to edge on iPhones so the bottom tab bar runs to the bottom
  // of the screen; the bar pads itself by the home-indicator strip
  // (env(safe-area-inset-bottom), which is 0 without this setting).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
