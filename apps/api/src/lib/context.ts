import { prisma } from "@nutrition/db";

export async function getPrimaryOrganization() {
  const org = await prisma.organization.findUnique({ where: { slug: "primary" } });
  if (org) return org;
  return prisma.organization.create({
    data: {
      name: "Primary Organization",
      slug: "primary",
      createdBy: "system"
    }
  });
}

export async function getDefaultUser() {
  const org = await getPrimaryOrganization();
  const existing = await prisma.user.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      organizationId: org.id,
      email: "owner@nutrition-autopilot.local",
      fullName: "System Owner",
      createdBy: "system"
    }
  });
}
