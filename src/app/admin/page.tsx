import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { BUSINESS_TYPE_LABELS } from "@/components/panel/format";
import {
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_TONES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  REPORT_TARGET_LABELS,
  adminDateFormatter,
  adminDateTimeFormatter,
  pluralize,
} from "@/components/admin/format";
import {
  PageHeading,
  SectionCard,
  StatCard,
  StatusPill,
} from "@/components/admin/ui";
import type { BusinessStatus } from "@/generated/prisma/enums";

/**
 * Pulpit administratora: liczby platformy, kolejka firm czekających na
 * weryfikację i najświeższe zgłoszenia nadużyć.
 *
 * Wszystko jest liczone na żywo (agregaty w bazie, nie w JS) — panel
 * pokazuje stan „teraz", więc trasa jest dynamiczna z natury (`auth()`
 * czyta ciasteczka).
 */

const DAY_MS = 86_400_000;
const PENDING_LIMIT = 8;
const REPORTS_LIMIT = 5;

export default async function AdminDashboardPage() {
  await requirePlatformAdmin();

  const since30d = new Date(new Date().getTime() - 30 * DAY_MS);

  const [
    statusGroups,
    bookings30d,
    bookingsTotal,
    newUsers30d,
    usersTotal,
    reportGroups,
    pendingBusinesses,
    latestReports,
    hiddenReviews,
  ] = await Promise.all([
    prisma.business.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.booking.count({ where: { createdAt: { gte: since30d } } }),
    prisma.booking.count(),
    prisma.user.count({ where: { createdAt: { gte: since30d } } }),
    prisma.user.count(),
    prisma.abuseReport.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.business.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      take: PENDING_LIMIT,
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        createdAt: true,
        owner: { select: { name: true, email: true } },
        locations: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { city: true },
        },
      },
    }),
    prisma.abuseReport.findMany({
      orderBy: { createdAt: "desc" },
      take: REPORTS_LIMIT,
      select: {
        id: true,
        targetType: true,
        reason: true,
        status: true,
        createdAt: true,
        reporterEmail: true,
        reporter: { select: { name: true, email: true } },
      },
    }),
    prisma.review.count({ where: { isPublished: false } }),
  ]);

  const countByStatus = (status: BusinessStatus) =>
    statusGroups.find((row) => row.status === status)?._count._all ?? 0;
  const businessesTotal = statusGroups.reduce(
    (sum, row) => sum + row._count._all,
    0,
  );
  const openReports =
    reportGroups.find((row) => row.status === "OPEN")?._count._all ?? 0;
  const inReviewReports =
    reportGroups.find((row) => row.status === "IN_REVIEW")?._count._all ?? 0;

  const dateFormatter = adminDateFormatter();
  const dateTimeFormatter = adminDateTimeFormatter();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <PageHeading
        title="Pulpit platformy"
        description="Stan marketplace'u w liczbach, kolejka weryfikacji firm i zgłoszenia czekające na decyzję."
      />

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Firmy aktywne"
          value={countByStatus("ACTIVE")}
          hint={`${businessesTotal} firm w bazie`}
          href="/admin/firmy?status=ACTIVE"
        />
        <StatCard
          label="Czekają na weryfikację"
          value={countByStatus("PENDING_REVIEW")}
          hint={
            countByStatus("SUSPENDED") > 0
              ? `zawieszone: ${countByStatus("SUSPENDED")}`
              : `szkice: ${countByStatus("DRAFT")}`
          }
          href="/admin/firmy?status=PENDING_REVIEW"
          tone={countByStatus("PENDING_REVIEW") > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Rezerwacje / 30 dni"
          value={bookings30d}
          hint={`${bookingsTotal} od początku`}
        />
        <StatCard
          label="Nowi użytkownicy / 30 dni"
          value={newUsers30d}
          hint={`${usersTotal} kont łącznie`}
          href="/admin/uzytkownicy"
        />
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Zgłoszenia otwarte"
          value={openReports}
          hint={`w toku: ${inReviewReports}`}
          href="/admin/zgloszenia?status=OPEN"
          tone={openReports > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Ukryte opinie"
          value={hiddenReviews}
          hint="niewidoczne na profilach"
          href="/admin/opinie?filtr=ukryte"
        />
        <StatCard
          label="Firmy zawieszone"
          value={countByStatus("SUSPENDED")}
          hint="poza marketplace'em"
          href="/admin/firmy?status=SUSPENDED"
          tone={countByStatus("SUSPENDED") > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Szkice firm"
          value={countByStatus("DRAFT")}
          hint="niedokończony onboarding"
          href="/admin/firmy?status=DRAFT"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <SectionCard
          title="Czekają na weryfikację"
          action={
            <Link
              href="/admin/firmy?status=PENDING_REVIEW"
              className="font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              wszystkie ›
            </Link>
          }
        >
          {pendingBusinesses.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
              Kolejka jest pusta — żadna firma nie czeka na decyzję.
            </p>
          ) : (
            <ul>
              {pendingBusinesses.map((business) => (
                <li
                  key={business.id}
                  className="border-t border-border first:border-t-0"
                >
                  <Link
                    href={`/admin/firmy/${business.id}`}
                    className="block px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <span className="text-[14px] font-semibold">
                        {business.name}
                      </span>
                      <StatusPill tone={BUSINESS_STATUS_TONES.PENDING_REVIEW}>
                        {BUSINESS_STATUS_LABELS.PENDING_REVIEW}
                      </StatusPill>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
                      <span>{BUSINESS_TYPE_LABELS[business.type]}</span>
                      {business.locations[0] ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{business.locations[0].city}</span>
                        </>
                      ) : null}
                      <span aria-hidden>·</span>
                      {/* Adres e-mail to jeden długi token — bez łamania
                          rozpychałby wiersz poza kartę na telefonie. */}
                      <span className="min-w-0 break-all">
                        {business.owner.email ?? business.owner.name ?? "—"}
                      </span>
                      <span aria-hidden>·</span>
                      <span>zgłoszona {dateFormatter.format(business.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Najnowsze zgłoszenia"
          action={
            <Link
              href="/admin/zgloszenia"
              className="font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              wszystkie ›
            </Link>
          }
        >
          {latestReports.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
              Brak zgłoszeń nadużyć.
            </p>
          ) : (
            <ul>
              {latestReports.map((report) => {
                const reporter =
                  report.reporter?.email ??
                  report.reporter?.name ??
                  report.reporterEmail ??
                  "zgłoszenie anonimowe";
                return (
                  <li
                    key={report.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <Link
                      href={`/admin/zgloszenia/${report.id}`}
                      className="block px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
                          {REPORT_STATUS_LABELS[report.status]}
                        </StatusPill>
                        <span className="text-[13px] font-semibold">
                          {REPORT_TARGET_LABELS[report.targetType]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug">
                        {report.reason}
                      </p>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {reporter} · {dateTimeFormatter.format(report.createdAt)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <p className="mt-4 font-mono text-[11px] text-muted-foreground">
        {pluralize(businessesTotal, "firma", "firmy", "firm")} ·{" "}
        {pluralize(usersTotal, "konto", "konta", "kont")} · daty w strefie
        Europe/Warsaw
      </p>
    </div>
  );
}
