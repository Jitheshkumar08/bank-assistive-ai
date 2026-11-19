import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Shape of the environment this API requires.
 *
 * Validation runs at boot, before anything connects to a database or
 * opens a port. A missing DATABASE_URL should stop the process with a
 * clear message rather than surface later as an opaque driver error.
 */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL is required. Copy .env.example to .env and fill it in.' })
  DATABASE_URL!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:5173';

  // Signing key for access tokens. A short or shared secret makes every
  // token forgeable, so this is required and length-checked rather than
  // given a convenient default.
  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET is required. Generate one and put it in .env.' })
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters.' })
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRES_IN: string = '1h';

  // Where the Python engine listens. Loopback by default: it is an
  // internal service and must never be reachable from a browser.
  @IsString()
  AI_ENGINE_URL: string = 'http://127.0.0.1:8000';

  // Shared secret sent as X-Internal-Token. Optional so local
  // development stays simple; set it anywhere the port is reachable.
  @IsOptional()
  @IsString()
  AI_ENGINE_TOKEN?: string;

  // Whisper plus an LLM round trip is far slower than an ordinary API
  // call, so the assistant gets its own budget rather than the default.
  @IsNumber()
  @Min(1000)
  AI_ENGINE_TIMEOUT_MS: number = 60_000;

  @IsNumber()
  @Min(1024)
  MAX_AUDIO_BYTES: number = 10 * 1024 * 1024;

  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsOptional()
  @IsEmail({}, { message: 'ADMIN_EMAIL must be a valid email address.' })
  ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'ADMIN_PASSWORD must be at least 8 characters.' })
  ADMIN_PASSWORD?: string;

  // --- Remembered payments ------------------------------------------
  //
  // Kept as strings on purpose. With implicit conversion a declared
  // boolean turns any non-empty string into true, so DEMO_HISTORY_ENABLED
  // of "false" would switch demonstration data ON. These are validated
  // as the two words they may be and read through isEnabled() below.

  @IsIn(['true', 'false'], { message: 'SUGGESTIONS_ENABLED must be "true" or "false".' })
  SUGGESTIONS_ENABLED: string = 'true';

  // Whether SEEDED DEMONSTRATION payment history may be read.
  //
  // FALSE UNLESS AN EXPLICIT DEMONSTRATION ENVIRONMENT TURNS IT ON.
  // Demo rows are not bank records; with this off, no suggestion can be
  // built from them. Unset means false.
  @IsIn(['true', 'false'], { message: 'DEMO_HISTORY_ENABLED must be "true" or "false".' })
  DEMO_HISTORY_ENABLED: string = 'false';

  // Ceiling for an amount a customer may enter on the review screen, in
  // minor units. 1000000 paise = Rs 10,000.
  @IsNumber()
  @Min(1)
  ACTIVITY_MAX_AMOUNT_MINOR: number = 1_000_000;

  // Whether the DEVELOPMENT-ONLY personalisation testing dashboard is
  // served at all.
  //
  // FALSE UNLESS A DEVELOPER TURNS IT ON, and it is only one of four
  // conditions: the dashboard also requires a non-production NODE_ENV,
  // DEMO_HISTORY_ENABLED=true, and an authenticated ADMIN. In
  // production the module is never registered, so its routes do not
  // exist however this is set.
  @IsIn(['true', 'false'], { message: 'DEMO_DASHBOARD_ENABLED must be "true" or "false".' })
  DEMO_DASHBOARD_ENABLED: string = 'false';
}

/** The only reading of a flag: exactly the word "true" enables it. */
export function isEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
}

/** Parses CORS_ORIGINS into the array Nest's CORS option expects. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
