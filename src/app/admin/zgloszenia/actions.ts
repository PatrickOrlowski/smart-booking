"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requirePlatformAdminAction } from "@/lib/admin-auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/authz";
import type { ActionResult } from "@/components/admin/action-result";
import {
  REPORT_STATUS_LABELS,
  REPORT_TRANSITIONS,
} from "@/components/admin/format";

/**
 * Obsługa zgłoszeń nadużyć.
 *
 * Przejścia statusu są zamknięte listą (`REPORT_TRANSITIONS`): zgłoszenie
 * idzie OPEN → IN_REVIEW → RESOLVED/REJECTED, a decyzję da się cofnąć
 * wyłącznie do „w toku". Dzięki temu `resolvedAt`/`resolvedByUserId` zawsze
 * odpowiadają ostatniej decyzji, a nie przypadkowej kolejności kliknięć.
 */

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

const schema = z.object({
  reportId: z.string().min(1),
  status: z.enum(["IN_REVIEW", "RESOLVED", "REJECTED"]),
  note: z.string().trim().max(1000, "Notatka może mieć maksymalnie 1000 znaków"),
});

export async function updateReportStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane zgłoszenia",
    };
  }
  const data = parsed.data;

  // Zamknięcie sprawy bez uzasadnienia to zgłoszenie, do którego nikt
  // po latach nie wróci — notatka jest wymagana przy decyzji ostatecznej.
  const isFinal = data.status === "RESOLVED" || data.status === "REJECTED";
  if (isFinal && data.note.length < 3) {
    return { ok: false, error: "Dopisz notatkę z uzasadnieniem decyzji" };
  }

  try {
    const admin = await requirePlatformAdminAction();

    const report = await prisma.abuseReport.findUnique({
      where: { id: data.reportId },
      select: {
        id: true,
        status: true,
        targetType: true,
        targetId: true,
        resolutionNote: true,
      },
    });
    if (!report) return { ok: false, error: "Nie znaleziono zgłoszenia" };

    if (!REPORT_TRANSITIONS[report.status].includes(data.status)) {
      return {
        ok: false,
        error: `Ze statusu „${REPORT_STATUS_LABELS[report.status]}" nie można przejść do „${REPORT_STATUS_LABELS[data.status]}"`,
      };
    }

    await prisma.abuseReport.update({
      where: { id: report.id },
      data: {
        status: data.status,
        resolutionNote: data.note || report.resolutionNote,
        // Wznowienie sprawy kasuje ślad poprzedniej decyzji — inaczej widok
        // twierdziłby, że sprawa jest w toku i rozstrzygnięta jednocześnie.
        resolvedByUserId: isFinal ? admin.id : null,
        resolvedAt: isFinal ? new Date() : null,
      },
    });

    // Zgłoszenie firmy albo jej opinii trafia też do dziennika tej firmy —
    // właściciel ma prawo wiedzieć, że coś się wokół niego działo.
    const businessId =
      report.targetType === "BUSINESS"
        ? report.targetId
        : report.targetType === "REVIEW"
          ? ((
              await prisma.review.findUnique({
                where: { id: report.targetId },
                select: { businessId: true },
              })
            )?.businessId ?? null)
          : null;

    await logAudit({
      businessId,
      actorUserId: admin.id,
      action: "REPORT_STATUS_CHANGED",
      entityType: "AbuseReport",
      entityId: report.id,
      metadata: {
        from: report.status,
        to: data.status,
        targetType: report.targetType,
        // Notatka moderatora jest WEWNĘTRZNA: wpis z businessId czyta
        // właściciel zgłoszonej firmy w /panel/aktywnosc, a uzasadnienie
        // decyzji bywa w stanie zidentyfikować zgłaszającego. Pełna treść
        // żyje w AbuseReport.resolutionNote — tu tylko, gdy wpis nie jest
        // przypięty do żadnej firmy.
        ...(data.note && businessId === null ? { note: data.note } : {}),
      },
    });
  } catch (error) {
    return failure(error, "Nie udało się zapisać decyzji");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/zgloszenia");
  revalidatePath(`/admin/zgloszenia/${data.reportId}`);
  revalidatePath("/admin/opinie");
  return { ok: true };
}
