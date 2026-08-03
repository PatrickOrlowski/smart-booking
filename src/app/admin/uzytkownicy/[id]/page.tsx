import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { STAFF_ROLE_LABELS } from "@/components/panel/format";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_TONES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  REPORT_TARGET_LABELS,
  USER_ROLE_LABELS,
  USER_ROLE_TONES,
  adminDateFormatter,
  adminDateTimeFormatter,
} from "@/components/admin/format";
import {
  DataRow,
  PageHeading,
  SectionCard,
  StatCard,
  StatusPill,
} from "@/components/admin/ui";
import { AuditList, type AdminAuditEntry } from "@/components/admin/audit-list";
import { UserRoleForm } from "@/components/admin/user-role-form";

/**
 * Karta konta: dane, powiązania z firmami, ostatnie rezerwacje, zgłoszenia
 * (złożone i dotyczące konta) oraz zmiana roli.
 *
 * Rezerwacje pokazujemy w strefie platformy — konto klienta bywa rozsiane
 * po lokalach w różnych strefach, więc jedna wspólna oś czasu jest tu
 * czytelniejsza niż mieszanka stref.
 */

const BOOKINGS_LIMIT = 8;
const AUDIT_LIMIT = 20;

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      locale: true,
      emailVerified: true,
      createdAt: true,
      ownedBusinesses: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, slug: true, status: true },
      },
      staffProfiles: {
        select: {
          id: true,
          role: true,
          isActive: true,
          business: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: {
          bookings: true,
          reviews: true,
          favorites: true,
          abuseReports: true,
        },
      },
    },
  });

  if (!user) notFound();

  const [bookings, reportsAbout, reportsBy, auditRows] = await Promise.all([
    prisma.booking.findMany({
      where: { customerUserId: user.id },
      orderBy: { startAt: "desc" },
      take: BOOKINGS_LIMIT,
      select: {
        id: true,
        startAt: true,
        status: true,
        business: { select: { id: true, name: true } },
      },
    }),
    prisma.abuseReport.findMany({
      where: { targetType: "USER", targetId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reason: true, status: true, createdAt: true },
    }),
    prisma.abuseReport.findMany({
      where: { reporterUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        reason: true,
        status: true,
        targetType: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "User", entityId: user.id },
          { actorUserId: user.id },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: AUDIT_LIMIT,
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
    ).map((row) => [row.id, row.name ?? row.email ?? "Użytkownik"]),
  );

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

  const formatter = adminDateTimeFormatter();
  const dateFormatter = adminDateFormatter();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href="/admin/uzytkownicy"
        className="mb-3 inline-flex items-center font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        ‹ Wszyscy użytkownicy
      </Link>

      <PageHeading
        title={user.name ?? "Konto bez imienia"}
        description={user.email ?? "konto bez adresu e-mail"}
      >
        <StatusPill tone={USER_ROLE_TONES[user.role]}>
          {USER_ROLE_LABELS[user.role]}
        </StatusPill>
      </PageHeading>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Rezerwacje" value={user._count.bookings} />
            <StatCard label="Opinie" value={user._count.reviews} />
            <StatCard label="Ulubione" value={user._count.favorites} />
            <StatCard label="Zgłoszenia" value={user._count.abuseReports} />
          </section>

          <SectionCard title="Dane konta">
            <DataRow label="E-mail">
              <span className="font-mono text-[12px]">{user.email ?? "—"}</span>
            </DataRow>
            <DataRow label="Telefon">
              <span className="font-mono text-[12px]">{user.phone ?? "—"}</span>
            </DataRow>
            <DataRow label="Rola">{USER_ROLE_LABELS[user.role]}</DataRow>
            <DataRow label="Język">
              <span className="font-mono text-[12px]">
                {user.locale ?? "wykrywany z przeglądarki"}
              </span>
            </DataRow>
            <DataRow label="E-mail potwierdzony">
              {user.emailVerified ? (
                <span className="font-mono text-[12px]">
                  {formatter.format(user.emailVerified)}
                </span>
              ) : (
                <span className="text-muted-foreground">nie</span>
              )}
            </DataRow>
            <DataRow label="Rejestracja">
              <span className="font-mono text-[12px]">
                {formatter.format(user.createdAt)}
              </span>
            </DataRow>
          </SectionCard>

          {user.ownedBusinesses.length > 0 ? (
            <SectionCard title={`Firmy właściciela (${user.ownedBusinesses.length})`}>
              <ul>
                {user.ownedBusinesses.map((business) => (
                  <li
                    key={business.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <Link
                      href={`/admin/firmy/${business.id}`}
                      className="flex flex-wrap items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                    >
                      <span className="text-[13.5px] font-semibold">
                        {business.name}
                      </span>
                      <StatusPill tone={BUSINESS_STATUS_TONES[business.status]}>
                        {BUSINESS_STATUS_LABELS[business.status]}
                      </StatusPill>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        /{business.slug}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {user.staffProfiles.length > 0 ? (
            <SectionCard title={`Praca w firmach (${user.staffProfiles.length})`}>
              <ul>
                {user.staffProfiles.map((profile) => (
                  <li
                    key={profile.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <Link
                      href={`/admin/firmy/${profile.business.id}`}
                      className="flex flex-wrap items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                    >
                      <span className="text-[13.5px] font-semibold">
                        {profile.business.name}
                      </span>
                      <StatusPill tone="bg-secondary text-secondary-foreground">
                        {STAFF_ROLE_LABELS[profile.role]}
                      </StatusPill>
                      {!profile.isActive ? (
                        <StatusPill tone="bg-muted text-muted-foreground">
                          nieaktywny
                        </StatusPill>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <SectionCard title="Ostatnie rezerwacje">
            {bookings.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
                To konto nie ma rezerwacji.
              </p>
            ) : (
              <ul>
                {bookings.map((booking) => (
                  <li
                    key={booking.id}
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
                  >
                    <Link
                      href={`/admin/firmy/${booking.business.id}`}
                      className="text-[13.5px] font-semibold underline underline-offset-2"
                    >
                      {booking.business.name}
                    </Link>
                    <StatusPill tone={BOOKING_STATUS_TONES[booking.status]}>
                      {BOOKING_STATUS_LABELS[booking.status]}
                    </StatusPill>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {formatter.format(booking.startAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Dziennik zdarzeń konta">
            <AuditList entries={auditEntries} />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <UserRoleForm
            userId={user.id}
            currentRole={user.role}
            isSelf={admin.id === user.id}
            ownedBusinesses={user.ownedBusinesses.length}
          />

          {reportsAbout.length > 0 ? (
            <SectionCard title={`Zgłoszenia na konto (${reportsAbout.length})`}>
              <ul>
                {reportsAbout.map((report) => (
                  <li
                    key={report.id}
                    className="border-t border-border first:border-t-0"
                  >
                    <Link
                      href={`/admin/zgloszenia/${report.id}`}
                      className="block px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                    >
                      <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
                        {REPORT_STATUS_LABELS[report.status]}
                      </StatusPill>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug">
                        {report.reason}
                      </p>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {dateFormatter.format(report.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {reportsBy.length > 0 ? (
            <SectionCard title={`Zgłoszenia od konta (${reportsBy.length})`}>
              <ul>
                {reportsBy.map((report) => (
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
                          {REPORT_TARGET_LABELS[report.targetType]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug">
                        {report.reason}
                      </p>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                        {dateFormatter.format(report.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
