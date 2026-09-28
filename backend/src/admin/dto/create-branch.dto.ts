import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/** Trims, and turns a blank optional field into nothing at all. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBranchDto {
  /**
   * The code printed under the QR and carried inside it.
   *
   * The pattern matches the scanner's own (`lib/qr.ts`): a code that
   * cannot be scanned must not be issuable in the first place. Stored
   * uppercase, because that is how it is printed.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,32}$/, {
    message: 'Branch code must be 2-32 characters: letters, digits, hyphen or underscore.',
  })
  code!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'Branch name must be between 2 and 80 characters.' })
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(0, 80)
  city?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(0, 160)
  address?: string;
}
