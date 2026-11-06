import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { AppConfig } from '../config/app-config.service.js'
import { PrismaClient } from '../generated/prisma/client.js'

/** Single Prisma client (Prisma 7 + node-postgres driver adapter) shared by all modules. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.env.DATABASE_URL }) })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
