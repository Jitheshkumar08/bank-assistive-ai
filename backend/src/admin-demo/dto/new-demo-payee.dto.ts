import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** Trims, and turns a blank optional field into nothing at all. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A demonstration beneficiary, entered by hand.
 *
 * Always created with DEMO_SEEDED trust by the service -- there is no
 * field here that could ask for anything else, so no request can
 * manufacture a payee that looks bank verified.
 */
export class NewDemoPayeeDto {
  /**
   * The name a card shows and the assistant SPEAKS.
   *
   * Letters only, deliberately. The welcome screen's spoken line must
   * contain no digits -- amounts are shown, never read aloud -- and a
   * payee called "Rahul 2" would put one there through data rather than
   * code. The pattern covers Kannada and Devanagari as well as Latin,
   * since a name is spoken in the customer's own language.
   */
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'A payee name must be between 1 and 40 characters.' })
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u, {
    message: 'A payee name must be letters only — no digits or symbols.',
  })
  displayName!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 80, { message: 'A full name must be between 1 and 80 characters.' })
  fullName?: string;

  /**
   * The last four digits, and nothing more.
   *
   * There is deliberately no column for a full account number anywhere
   * in this system, so this is the most that can be stored even if a
   * caller sent more.
   */
  @Transform(trim)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'Enter the last four digits of the account only.' })
  accountLast4!: string;
}
