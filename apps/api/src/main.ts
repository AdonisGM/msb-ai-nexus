import './env'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { runMigrations } from './db/migrate'
import { PORT, TRUST_PROXY, WEB_ORIGIN } from './env'

async function bootstrap() {
  await runMigrations()

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  /** Behind nginx in production, nothing in development. */
  if (TRUST_PROXY > 0) app.set('trust proxy', TRUST_PROXY)

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
  app.use(cookieParser())

  /** The web app runs on its own origin in development, so the session cookie
   *  only survives the round trip with credentials explicitly allowed. */
  app.enableCors({ origin: [WEB_ORIGIN], credentials: true })

  /** `whitelist` drops properties no DTO declares, so a client cannot smuggle
   *  an extra field into an update. */
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  app.enableShutdownHooks()
  await app.listen(PORT)
  console.log(`API on http://localhost:${PORT}`)
}

void bootstrap()
