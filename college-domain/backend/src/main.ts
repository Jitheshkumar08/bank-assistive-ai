import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './configure-app.js'

async function bootstrap() {
  // Body parsing is configured in configureApp (with a size limit), so Nest's default parser is disabled.
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.enableShutdownHooks()
  const config = configureApp(app)
  await app.listen(config.env.PORT)
  const logger = new Logger('Bootstrap')
  logger.log(`CampusGuide API listening on http://localhost:${config.env.PORT}/api (${config.env.NODE_ENV})`)
  if (config.swaggerEnabled) logger.log(`Swagger UI: http://localhost:${config.env.PORT}/api/docs`)
}

void bootstrap()
