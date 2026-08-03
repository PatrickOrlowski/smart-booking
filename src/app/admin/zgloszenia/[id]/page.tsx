import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { BUSINESS_TYPE_LABELS } from "@/components/panel/format";
import {
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_TONES,
  OPEN_REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  REPORT_TARGET_LABELS,
  USER_ROLE_LABELS,
  adminDateFormatter,
  adminDateTimeFormatter,
} from "@/components/admin/format";
import {
  DataRow,
  PageHeading,
  SectionCard,
  StatusPill,
} from "@/components/admin/ui";
import { AdminReviewCard } from "@/components/admin/review-card";
import { ReportStatusForm } from "@/components/admin/report-status-form";

/**
 * Szczegóły zgłoszenia nadużycia wraz z podglądem zgłoszonego obiektu
 * i decyzją. Przy zgłoszeniu opinii moderator ma „Ukryj opinię" wprost tutaj
 * — bez przeskakiwania do listy opinii i szukania właściwego wiersza.
 */

export default async function AdminReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;

  const report = await prisma.abuseReport.findUnique({
    where: { id },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      reason: true,
      details: true,
      status: true,
      resolutionNote: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
      reporterEmail: true,
      reporter: { select: { id: true, name: true, email: true } },
      resolver: { select: { name: true, email: true } },
    },
  });

  if (!report) notFound();

  const [targetBusiness, targetReview, targetUser] = await Promise.all([
    report.targetType === "BUSINESS"
      ? prisma.business.findUnique({
          where: { id: report.targetId },
          select: {
            id: true,
            name: true,
            slug: true,
            type: true,
            status: true,
            owner: { select: { id: true, name: true, email: true } },
            locations: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: { city: true },
            },
          },
        })
      : null,
    report.targetType === "REVIEW"
      ? prisma.review.findUnique({
          where: { id: report.targetId },
          select: {
            id: true,
            rating: true,
            comment: true,
            reply: true,
            isPublished: true,
            createdAt: true,
            businessId: true,
            author: { select: { name: true, email: true } },
            business: { select: { name: true, slug: true } },
          },
        })
      : null,
    report.targetType === "USER"
      ? prisma.user.findUnique({
          where: { id: report.targetId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            createdAt: true,
          },
        })
      : null,
  ]);

  const openReviewReports =
    report.targetType === "REVIEW"
      ? await prisma.abuseReport.count({
          where: {
            targetType: "REVIEW",
            targetId: report.targetId,
            status: { in: [...OPEN_REPORT_STATUSES] },
          },
        })
      : 0;

  const formatter = adminDateTimeFormatter();
  const dateFormatter = adminDateFormatter();
  const reporterLabel =
    report.reporter?.email ??
    report.reporter?.name ??
    report.reporterEmail ??
    "zgłoszenie anonimowe";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href="/admin/zgloszenia"
        className="mb-3 inline-flex items-center font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        ‹ Wszystkie zgłoszenia
      </Link>

      <PageHeading
        title={report.reason}
        description={`Zgłoszenie dotyczy: ${REPORT_TARGET_LABELS[report.targetType].toLowerCase()} · wpłynęło ${formatter.format(report.createdAt)}`}
      >
        <StatusPill tone={REPORT_STATUS_TONES[report.status]}>
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </PageHeading>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-4">
          <SectionCard title="Treść zgłoszenia">
            <DataRow label="Powód">{report.reason}</DataRow>
            <DataRow label="Szczegóły">
              {report.details ? (
                <span className="whitespace-pre-line">{report.details}</span>
              ) : (
                <span className="text-muted-foreground">
                  zgłaszający nie dodał opisu
                </span>
              )}
            </DataRow>
            <DataRow label="Zgłaszający">
              {report.reporter ? (
                <Link
                  href={`/admin/uzytkownicy/${report.reporter.id}`}
                  className="underline underline-offset-2"
                >
                  {reporterLabel}
                </Link>
              ) : (
                <span className="font-mono text-[12px]">{reporterLabel}</span>
              )}
            </DataRow>
            <DataRow label="Wpłynęło">
              <span className="font-mono text-[12px]">
                {formatter.format(report.createdAt)}
              </span>
            </DataRow>
            {report.resolutionNote ? (
              <DataRow label="Notatka">
                <span className="whitespace-pre-line">
                  {report.resolutionNote}
                </span>
              </DataRow>
            ) : null}
            {report.resolvedAt ? (
              <DataRow label="Rozpatrzone">
                <span className="font-mono text-[12px]">
                  {formatter.format(report.resolvedAt)}
                  {report.resolver
                    ? ` · ${report.resolver.name ?? report.resolver.email ?? "admin"}`
                    : ""}
                </span>
              </DataRow>
            ) : null}
          </SectionCard>

          <SectionCard
            title={`Zgłoszony obiekt — ${REPORT_TARGET_LABELS[report.targetType].toLowerCase()}`}
          >
            {targetBusiness ? (
              <>
                <DataRow label="Firma">
                  <Link
                    href={`/admin/firmy/${targetBusiness.id}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {targetBusiness.name}
                  </Link>
                </DataRow>
                <DataRow label="Status">
                  <StatusPill tone={BUSINESS_STATUS_TONES[targetBusiness.status]}>
                    {BUSINESS_STATUS_LABELS[targetBusiness.status]}
                  </StatusPill>
                </DataRow>
                <DataRow label="Typ i miasto">
                  {BUSINESS_TYPE_LABELS[targetBusiness.type]}
                  {targetBusiness.locations[0]
                    ? ` · ${targetBusiness.locations[0].city}`
                    : ""}
                </DataRow>
                <DataRow label="Właściciel">
                  <Link
                    href={`/admin/uzytkownicy/${targetBusiness.owner.id}`}
                    className="underline underline-offset-2"
                  >
                    {targetBusiness.owner.email ??
                      targetBusiness.owner.name ??
                      "konto właściciela"}
                  </Link>
                </DataRow>
                <DataRow label="Profil publiczny">
                  {targetBusiness.status === "ACTIVE" ? (
                    <Link
                      href={`/b/${targetBusiness.slug}`}
                      className="font-mono text-[12px] underline underline-offset-2"
                    >
                      /b/{targetBusiness.slug} ↗
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      niewidoczna publicznie
                    </span>
                  )}
                </DataRow>
              </>
            ) : null}

            {targetReview ? (
              <AdminReviewCard
                reportId={report.id}
                review={{
                  id: targetReview.id,
                  rating: targetReview.rating,
                  comment: targetReview.comment,
                  reply: targetReview.reply,
                  isPublished: targetReview.isPublished,
                  dateLabel: dateFormatter.format(targetReview.createdAt),
                  authorName: targetReview.author.name ?? "Klient",
                  authorEmail: targetReview.author.email,
                  businessId: targetReview.businessId,
                  businessName: targetReview.business.name,
                  businessSlug: targetReview.business.slug,
                  openReports: openReviewReports,
                }}
              />
            ) : null}

            {targetUser ? (
              <>
                <DataRow label="Konto">
                  <Link
                    href={`/admin/uzytkownicy/${targetUser.id}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {targetUser.name ?? "bez imienia"}
                  </Link>
                </DataRow>
                <DataRow label="E-mail">
                  <span className="font-mono text-[12px]">
                    {targetUser.email ?? "—"}
                  </span>
                </DataRow>
                <DataRow label="Telefon">
                  <span className="font-mono text-[12px]">
                    {targetUser.phone ?? "—"}
                  </span>
                </DataRow>
                <DataRow label="Rola">{USER_ROLE_LABELS[targetUser.role]}</DataRow>
                <DataRow label="Konto od">
                  <span className="font-mono text-[12px]">
                    {dateFormatter.format(targetUser.createdAt)}
                  </span>
                </DataRow>
              </>
            ) : null}

            {!targetBusiness && !targetReview && !targetUser ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
                Zgłoszony obiekt już nie istnieje — został usunięty po wpłynięciu
                zgłoszenia. Identyfikator:{" "}
                <span className="font-mono">{report.targetId}</span>
              </p>
            ) : null}
          </SectionCard>
        </div>

        <ReportStatusForm
          reportId={report.id}
          status={report.status}
          currentNote={report.resolutionNote}
        />
      </div>
    </div>
  );
}
