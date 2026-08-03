import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { BUSINESS_TYPE_LABELS } from "@/components/panel/format";
import {
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_TONES,
  PLATFORM_TIMEZONE,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  USER_ROLE_LABELS,
  adminDateTimeFormatter,
  pluralize,
} from "@/components/admin/format";
import {
  DataRow,
  PageHeading,
  SectionCard,
  StatCard,
  StatusPill,
} from "@/components/admin/ui";
import { AuditList, type AdminAuditEntry } from "@/components/admin/audit-list";
import { BusinessActions } from "@/components/admin/business-actions";

/**
 * Karta firmy w panelu admina: komplet danych, właściciel, lokalizacje,
 * statystyki, historia decyzji z AuditLog i przyciski decyzji platformy.
 *
 * Czas prezentowany jest w strefie pierwszej lokalizacji firmy — admin
 * czytający „ostatnia rezerwacja 19:00" ma widzieć godzinę, którą widzi
 * właściciel, a nie własną.
 */

const AUDIT_LIMIT = 30;
const DAY_MS = 86_400_000;

export default async function AdminBusinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;

  const business = await prisma.business.findUnique({
    where: { id },
    include: {
      owner: {
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
      locations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          phone: true,
          timezone: true,
          isActive: true,
        },
      },
      subscription: { select: { plan: true, status: true } },
      _count: {
        select: {
          bookings: true,
          reviews: true,
          services: true,
          staff: true,
          locations: true,
          customers: true,
        },
      },
    },
  });

  if (!business) notFound();

  const since30d = new Date(new Date().getTime() - 30 * DAY_MS);

  const [bookings30d, ratingAggregate, hiddenReviews, auditRows, verifier, reports] =
    await Promise.all([
      prisma.booking.count({
        where: { businessId: business.id, createdAt: { gte: since30d } },
      }),
      prisma.review.aggregate({
        where: { businessId: business.id, isPublished: true },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      prisma.review.count({
        where: { businessId: business.id, isPublished: false },
      }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { businessId: business.id },
            { entityType: "Business", entityId: business.id },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: AUDIT_LIMIT,
      }),
      business.verifiedByUserId
        ? prisma.user.findUnique({
            where: { id: business.verifiedByUserId },
            select: { name: true, email: true },
          })
        : null,
      prisma.abuseReport.findMany({
        where: { targetType: "BUSINESS", targetId: business.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, reason: true, status: true, createdAt: true },
      }),
    ]);

  const actorIds = [
    ...new Set(
      auditRows
        .map((row) => row.actorUserId)
        .filter((value): value is string => value !== null),
    ),
  ];
  const actors = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    ).map((user) => [user.id, user.name ?? user.email ?? "Użytkownik"]),
  );

  const timeZone = business.locations[0]?.timezone ?? PLATFORM_TIMEZONE;
  const formatter = adminDateTimeFormatter(timeZone);

  const auditEntries: AdminAuditEntry[] = auditRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actorLabel: row.actorUserId
      ? (actors.get(row.actorUserId) ?? "Użytkownik")
      : "system",
  }));

  const average = ratingAggregate._avg.rating ?? 0;
  const publicUrl = `/b/${business.slug}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Link
        href="/admin/firmy"
        className="mb-3 inline-flex items-center font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        ‹ Wszystkie firmy
      </Link>

      <PageHeading
        title={business.name}
        description={`${BUSINESS_TYPE_LABELS[business.type]} · /${business.slug}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={BUSINESS_STATUS_TONES[business.status]}>
            {BUSINESS_STATUS_LABELS[business.status]}
          </StatusPill>
          {business.status === "ACTIVE" ? (
            <Link
              href={publicUrl}
              className="font-mono text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              profil publiczny ↗
            </Link>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">
              niewidoczna publicznie
            </span>
          )}
        </div>
      </PageHeading>

      {business.rejectionReason ? (
        <div className="mb-4 rounded-2xl border-[1.5px] border-warning bg-warning-soft px-4 py-3 sm:px-5">
          <span className="meta-label text-warning-strong">
            Powód ostatniej decyzji platformy
          </span>
          <p className="mt-1 text-[13px] leading-relaxed text-warning-strong">
            {business.rejectionReason}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Rezerwacje"
              value={business._count.bookings}
              hint={`${bookings30d} w 30 dni`}
            />
            <StatCard
              label="Ocena"
              value={
                ratingAggregate._count._all > 0
                  ? average.toLocaleString("pl-PL", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })
                  : "—"
              }
              hint={`${ratingAggregate._count._all} opinii${
                hiddenReviews > 0 ? ` · ${hiddenReviews} ukrytych` : ""
              }`}
              href={`/admin/opinie?firma=${business.id}`}
            />
            <StatCard
              label="Zespół"
              value={business._count.staff}
              hint={pluralize(
                business._count.services,
                "usługa",
                "usługi",
                "usług",
              )}
            />
            <StatCard
              label="Klienci"
              value={business._count.customers}
              hint={pluralize(
                business._count.locations,
                "lokalizacja",
                "lokalizacje",
                "lokalizacji",
              )}
            />
          </section>

          <SectionCard title="Dane firmy">
            <DataRow label="Nazwa">{business.name}</DataRow>
            <DataRow label="Slug">
              <span className="font-mono text-[12px]">/{business.slug}</span>
            </DataRow>
            <DataRow label="Typ">{BUSINESS_TYPE_LABELS[business.type]}</DataRow>
            <DataRow label="Status">
              {BUSINESS_STATUS_LABELS[business.status]}
            </DataRow>
            <DataRow label="Opis">
              {business.description ?? (
                <span className="text-muted-foreground">brak opisu</span>
              )}
            </DataRow>
            <DataRow label="Język i waluta">
              <span className="font-mono text-[12px]">
                {business.defaultLocale} · {business.currency}
              </span>
            </DataRow>
            <DataRow label="Limit nieobecności">
              <span className="font-mono text-[12px]">
                {business.noShowLimit}
              </span>
            </DataRow>
            <DataRow label="Plan">
              {business.subscription
                ? `${business.subscription.plan} · ${business.subscription.status}`
                : "brak subskrypcji"}
            </DataRow>
            <DataRow label="Dodana">
              <span className="font-mono text-[12px]">
                {formatter.format(business.createdAt)}
              </span>
            </DataRow>
            <DataRow label="Zweryfikowana">
              {business.verifiedAt ? (
                <span className="font-mono text-[12px]">
                  {formatter.format(business.verifiedAt)}
                  {verifier
                    ? ` · ${verifier.name ?? verifier.email ?? "admin"}`
                    : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">nigdy</span>
              )}
            </DataRow>
          </SectionCard>

          <SectionCard
            title={`Lokalizacje (${business.locations.length})`}
          >
            {business.locations.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
                Firma nie ma jeszcze żadnej lokalizacji.
              </p>
            ) : (
              <ul>
                {business.locations.map((location) => (
                  <li
                    key={location.id}
                    className="border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-semibold">
                        {location.name}
                      </span>
                      {!location.isActive ? (
                        <StatusPill tone="bg-muted text-muted-foreground">
                          nieaktywna
                        </StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {location.addressLine1}
                      {location.addressLine2 ? `, ${location.addressLine2}` : ""},{" "}
                      {location.postalCode} {location.city}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {location.phone ?? "brak telefonu"} · {location.timezone}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Historia decyzji i operacji">
            <AuditList entries={auditEntries} timeZone={timeZone} />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <BusinessActions
            businessId={business.id}
            businessName={business.name}
            status={business.status}
          />

          <SectionCard title="Właściciel">
            <DataRow label="Osoba">
              <Link
                href={`/admin/uzytkownicy/${business.owner.id}`}
                className="font-semibold underline underline-offset-2"
              >
                {business.owner.name ?? "bez imienia"}
              </Link>
            </DataRow>
            <DataRow label="E-mail">
              <span className="font-mono text-[12px]">
                {business.owner.email ?? "—"}
              </span>
            </DataRow>
            <DataRow label="Telefon">
              <span className="font-mono text-[12px]">
                {business.owner.phone ?? "—"}
              </span>
            </DataRow>
            <DataRow label="Rola konta">
              {USER_ROLE_LABELS[business.owner.role]}
            </DataRow>
          </SectionCard>

          <SectionCard title={`Zgłoszenia na firmę (${reports.length})`}>
            {reports.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
                Brak zgłoszeń nadużyć dotyczących tej firmy.
              </p>
            ) : (
              <ul>
                {reports.map((report) => (
                  <li
                    key={report.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <Link
                      href={`/admin/zgloszenia/${report.id}`}
                      className="block px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
                          {REPORT_STATUS_LABELS[report.status]}
                        </StatusPill>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {formatter.format(report.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug">
                        {report.reason}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
