import { IsISO8601, IsOptional } from 'class-validator';

/**
 * The date to evaluate against.
 *
 * This is the whole of the simulated-date mechanism. The detectors
 * already take `now` as an argument, so there is no clock to replace,
 * nothing global to set, and no way for a value here to reach a
 * customer's visit -- the customer path calls `new Date()` and accepts
 * no parameter at all.
 *
 * Absent means the real present.
 */
export class SimulatedDateQueryDto {
  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'at must be an ISO-8601 date-time, for example 2027-02-28T12:00:00.000Z.' },
  )
  at?: string;
}
