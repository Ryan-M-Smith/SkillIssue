import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill Issue | Remote Play Control Plane",
  description: "Connect Skill Issue phones and Godot matches through a public relay.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
