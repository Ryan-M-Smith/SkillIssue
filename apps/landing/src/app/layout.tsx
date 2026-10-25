import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill Issue - 2v2 Noir Shooter",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
  description: "Connect Skill Issue phones and Godot matches through a public relay.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
