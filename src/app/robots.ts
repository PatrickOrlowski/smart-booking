import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Roboty: publiczny marketplace tak, panele i API nie. */
export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/panel", "/pracownik", "/konto", "/wizyta", "/api"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
