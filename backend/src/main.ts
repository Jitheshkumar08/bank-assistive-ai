import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { parseCorsOrigins } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Rate limiting keys on req.ip. Behind one reverse proxy that value
  // is only correct with this set -- and setting it higher than the
  // real number of proxies would let a client spoof X-Forwarded-For.
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api');

  // whitelist strips properties the DTO does not declare, and
  // forbidNonWhitelisted rejects them outright, so a client cannot
  // smuggle unexpected fields into a request body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = parseCorsOrigins(config.get<string>('CORS_ORIGINS', ''));

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (origins.includes(origin) || origins.includes('*')) {
        return callback(null, true);
      }

      // Automatically permit local network connections (e.g. mobile testing on Wi-Fi)
      const isLocalNetwork = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(
        origin,
      );
      if (isLocalNetwork) {
        return callback(null, true);
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/api`);
  logger.log(`CORS origins: ${origins.join(', ') || '(none)'}`);
}

void bootstrap();
