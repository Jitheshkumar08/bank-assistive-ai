import {
  IsDivisibleBy,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { DEMO_PAYMENT_STATUSES, type DemoPaymentStatusInput } from './create-demo-payment.dto';

/**
 * What may be changed about an existing demonstration payment.
 *
 * Send only what changed. An empty body is refused in the service,
 * because a PATCH that asks for nothing is a mistake rather than a
 * no-op worth accepting quietly.
 *
 * No `newPayee` here: a payee is created when a payment is added, and
 * an edit moves a row between beneficiaries that already exist. No
 * `currency`, for the same reason as on create.
 */
export class UpdateDemoPaymentDto {
  @IsOptional()
  @IsUUID('4', { message: 'That payee is not valid.' })
  payeeId?: string;

  @IsOptional()
  @IsInt({ message: 'The amount must be a whole number of paise.' })
  @Min(100, { message: 'The amount must be at least ₹1.' })
  @IsDivisibleBy(100, {
    message: 'The amount must be a whole number of rupees — paise are not displayed anywhere.',
  })
  amountMinor?: number;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    { message: 'The date must be ISO-8601, for example 2026-11-15T12:00:00.000Z.' },
  )
  occurredAt?: string;

  @IsOptional()
  @IsIn(DEMO_PAYMENT_STATUSES, {
    message: 'Status must be COMPLETED, FAILED or PENDING.',
  })
  status?: DemoPaymentStatusInput;
}
