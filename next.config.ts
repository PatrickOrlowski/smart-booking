import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next trzyma blokadę jednej instancji dev/build per distDir. Zmienna
  // NEXT_DIST_DIR pozwala uruchomić równolegle kilka buildów/serwerów
  // (np. agenci weryfikujący różne obszary) bez konfliktu na .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
