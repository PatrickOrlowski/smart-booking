"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filtr pracownika w widoku tygodnia — select sterujący searchParamem
 * `pracownik` ("all" = wszyscy, czyli brak parametru w URL).
 */
export function StaffFilter({
  staff,
  value,
  dateParam,
}: {
  staff: { id: string; name: string }[];
  /** Id zasobu pracownika albo "all". */
  value: string;
  dateParam: string;
}) {
  const router = useRouter();

  const handleChange = (next: string) => {
    const params = new URLSearchParams({ widok: "tydzien", data: dateParam });
    if (next !== "all") params.set("pracownik", next);
    router.push(`/panel?${params.toString()}`);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        className="h-11 min-w-44 bg-card text-[12.5px] data-[size=default]:h-11 lg:data-[size=default]:h-8"
        aria-label="Filtruj kalendarz po pracowniku"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Wszyscy pracownicy</SelectItem>
        {staff.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            {member.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
