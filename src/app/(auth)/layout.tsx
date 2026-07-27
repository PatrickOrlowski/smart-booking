import Link from "next/link";

/**
 * Ekrany auth: wycentrowana kolumna max-w-md na kremowym tle, bez top-bara.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="font-display text-xl font-extrabold tracking-tight"
        >
          Planner
        </Link>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
