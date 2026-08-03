import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiBusiness } from "@/app/api/public/v1/common";

/**
 * GET /api/public/v1/staff — aktywni pracownicy (zasoby typu STAFF)
 * firmy właściciela klucza, z usługami, które wykonują.
 */
export async function GET(request: Request) {
  const auth = await requireApiBusiness(request);
  if (!auth.ok) return auth.response;
  const { business } = auth.ctx;

  const staff = await prisma.resource.findMany({
    where: {
      type: "STAFF",
      isActive: true,
      location: { businessId: business.id },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      locationId: true,
      staffProfile: { select: { title: true } },
      services: {
        where: { service: { isActive: true, kind: "STANDARD" } },
        select: { serviceId: true },
      },
    },
  });

  return NextResponse.json({
    staff: staff.map((member) => ({
      id: member.id,
      name: member.name,
      title: member.staffProfile?.title ?? null,
      description: member.description,
      locationId: member.locationId,
      serviceIds: member.services.map((entry) => entry.serviceId),
    })),
  });
}
