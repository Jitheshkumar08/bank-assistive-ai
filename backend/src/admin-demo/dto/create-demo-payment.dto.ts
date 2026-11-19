import { Type } from 'class-transformer';
import {
  IsDivisibleBy,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { NewDemoPayeeDto } from './new-demo-payee.dto';

/** The three outcomes a demonstration payment may have. */
export const DEMO_PAYMENT_STATUSES = ['COMPLETED', 'FAILED', 'PENDING'] as const;

export type DemoPaymentStatusInput = (typeof DEMO_PAYMENT_STATUSES)[number];

/**
 * One demonstration payment, added by hand.
 *
 * There is NO currency field. INR is the only currency this version
 * supports, so a field accepting exactly one value would be noise --
 * and because the global pipe rejects undeclared properties, a request
 * that sends `currency` is refused outright rather than silently
 * ignored. That is the honest signal.
 */
export class CreateDemoPaymentDto {
  /**
   * An existing beneficiary of this same customer.
   *
   * Exactly one of `payeeId` and `newPayee` must be given. That is
   * checked in the service rather than with a new custom validator: one
   * clear 422 is worth more than a bespoke decorator.
   */
  @IsOptional()
  @IsUUID('4', { message: 'That payee is not valid.' })
  payeeId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewDemoPayeeDto)
  newPayee?: NewDemoPayeeDto;

  /**
   * Minor units (paise). Money is never a float.
   *
   * WHOLE RUPEES ONLY, and not merely to match the form.
   * `formatAmount` renders amounts with no decimal places, so every
   * screen in this system -- the welcome card, the review screen, this
   * dashboard -- would show 4999 paise as "₹50" while the stored value
   * stayed 4999. An amount the interface cannot display faithfully has
   * no business being seeded.
   *
   * The ceiling is applied in the service from ACTIVITY_MAX_AMOUNT_MINOR
   * -- the same limit the customer's review screen enforces -- so a row
   * seeded here is always one the customer flow can actually carry
   * through to the end.
   */
  @IsInt({ message: 'The amount must be a whole number of paise.' })
  @Min(100, { message: 'The amount must be at least ₹1.' })
  @IsDivisibleBy(100, {
    message: 'The amount must be a whole number of rupees — paise are not displayed anywhere.',
  })
  amountMinor!: number;

  /** The historical date this payment represents. */
  @IsISO8601(
    { strict: true },
    { message: 'The date must be ISO-8601, for example 2026-11-15T12:00:00.000Z.' },
  )
  occurredAt!: string;

  @IsIn(DEMO_PAYMENT_STATUSES, {
    message: 'Status must be COMPLETED, FAILED or PENDING.',
  })
  status!: DemoPaymentStatusInput;
}
