import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the real application the way main.ts does.
 *
 * The pipe and filter are applied here too, because most of what these
 * tests assert -- rejected unknown fields, one error shape -- is
 * produced by them rather than by the controllers.
 */
export interface TestAppOptions {
  /** Replaces a provider, e.g. swapping the Python engine for a stub. */
  overrides?: Array<{ token: unknown; value: unknown }>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  for (const { token, value } of options.overrides ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/**
 * Each test file uses its own email addresses.
 *
 * Login is rate-limited on (address + email), so tests that reused one
 * address would throttle each other and fail for the wrong reason.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.local`;
}

export const STRONG_PASSWORD = 'E2ePassw0rd!';
