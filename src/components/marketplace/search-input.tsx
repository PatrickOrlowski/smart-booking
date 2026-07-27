"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Pole wyszukiwarki — filtruje po nazwie firmy i mieście przez parametr
 * ?q= w URL (debounce 300 ms), więc wyniki liczy serwer, a back button
 * wraca do poprzedniego zapytania.
 */
export function SearchInput({ className }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  const apply = (next: string) => {
    setValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.trim()) params.set("q", next.trim());
      else params.delete("q");
      router.replace(params.size ? `/?${params.toString()}` : "/", {
        scroll: false,
      });
    }, 300);
  };

  return (
    <label
      className={cn(
        "mb-3 flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-border-strong bg-card px-[15px] py-[13px]",
        className,
      )}
    >
      <span className="font-mono text-[13px] text-muted-foreground">⌕</span>
      <input
        type="search"
        value={value}
        onChange={(event) => apply(event.target.value)}
        placeholder="Barber, fryzjer, miasto…"
        className="w-full bg-transparent text-sm outline-none placeholder:text-[#8f8b81]"
        aria-label="Szukaj firmy lub miasta"
      />
    </label>
  );
}
