import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { originCheck, requestContext } from './common/http-middleware.js'
import { validationPipe } from './common/validation.js'
import { AppConfig } from './config/app-config.service.js'

/** HTTP pipeline shared by main.ts and the e2e tests, so tests exercise exactly what runs in production. */
export function configureApp(app: INestApplication) {
  const config = app.get(AppConfig)
  const server = app.getHttpAdapter().getInstance() as express.Express
  server.disable('x-powered-by')

  app.setGlobalPrefix('api')
  app.use(requestContext())
  app.use(helmet())
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())
  app.use(originCheck(config.frontendOrigin))
  app.enableCors({
    origin: config.frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  })
  app.useGlobalPipes(validationPipe)

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('CampusGuide API')
      .setDescription('NMAMIT student portal backend. Authentication uses an HttpOnly session cookie set by POST /api/auth/login.')
      .setVersion('0.1.0')
      .addCookieAuth('cg_session', { type: 'apiKey', in: 'cookie', name: 'cg_session', description: 'Session cookie (named __Host-cg_session in production).' }, 'session')
      .build())
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' })
  }
  return config
}
