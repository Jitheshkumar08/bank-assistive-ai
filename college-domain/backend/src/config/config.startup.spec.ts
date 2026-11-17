import 'reflect-metadata'
import { Test } from '@nestjs/testing'

/**
 * Phase 7A: the REAL configuration module (the one AppModule imports) stops the application from starting in production
 * without College's own engine token. ConfigModule.forRoot reads process.env when config.module.ts is first imported,
 * so the environment is set before the dynamic import and restored afterwards. SYNTHETIC values only.
 */
const PRODUCTION_WITHOUT_TOKEN = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/none',
  FRONTEND_ORIGIN: 'https://campusguide.example',
  AI_ENGINE_COLLEGE_TOKEN: '',
}

describe('production startup (Phase 7A)', () => {
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const [key, value] of Object.entries(PRODUCTION_WITHOUT_TOKEN)) {
      saved[key] = process.env[key]
      process.env[key] = value
    }
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('refuses to start without AI_ENGINE_COLLEGE_TOKEN, naming the variable and never a value', async () => {
    const { AppConfigModule } = await import('./config.module.js')
    const startup = Test.createTestingModule({ imports: [AppConfigModule] }).compile()
    await expect(startup).rejects.toThrow('AI_ENGINE_COLLEGE_TOKEN: is required in production')
    await expect(startup).rejects.not.toThrow(PRODUCTION_WITHOUT_TOKEN.DATABASE_URL)
  })
})
