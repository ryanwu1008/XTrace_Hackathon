import type { Metadata } from "next";
import "./globals.css";
import "./vsee.css";
import "./underwriting-memo.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://vsee-vc-intelligence.dream86625.chatgpt.site"),
  title: "VSee — VC Decision Intelligence",
  description: "XTrace connects live market shifts to the beliefs behind past investment decisions.",
  openGraph: {
    title: "VSee — VC Decision Intelligence",
    description: "The market changed. XTrace revises the belief.",
    images: [{ url: "/og-flat20.png", width: 1536, height: 1024, alt: "VSee XTrace connects an old investment belief to new market evidence." }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VSee — VC Decision Intelligence",
    description: "The market changed. XTrace revises the belief.",
    images: ["/og-flat20.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
