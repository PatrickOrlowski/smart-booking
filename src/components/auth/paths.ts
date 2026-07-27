import type { UserRole } from "@/generated/prisma/enums";

/**
 * Strona docelowa po zalogowaniu — zależna od roli konta.
 * Właściciel ląduje w panelu firmy, pracownik w swoim grafiku,
 * pozostali na stronie głównej marketplace'u.
 */
export function roleHomePath(role: UserRole): string {
  switch (role) {
    case "BUSINESS_OWNER":
      return "/panel";
    case "STAFF":
      return "/pracownik";
    default:
      return "/";
  }
}
