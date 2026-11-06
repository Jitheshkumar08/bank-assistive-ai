// Seeds institution CONTEXT metadata only (public facts about NMAMIT and its approved QR placement).
// It never creates students, admission records, ranks, branches or statuses — those come only from official imports.
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

try {
  await prisma.institution.upsert({
    where: { id: 'nmamit' },
    create: { id: 'nmamit', name: 'NMAM Institute of Technology', shortName: 'NMAMIT', parentName: 'Nitte (Deemed to be University)' },
    update: {},
  })
  await prisma.institutionQrCode.upsert({
    where: { institutionId_areaSlug: { institutionId: 'nmamit', areaSlug: 'admissions-desk' } },
    create: { institutionId: 'nmamit', areaSlug: 'admissions-desk', label: 'Admission desk' },
    update: {},
  })
  process.stdout.write('Seeded NMAMIT institution context (no student or admission data).\n')
} finally {
  await prisma.$disconnect()
}
