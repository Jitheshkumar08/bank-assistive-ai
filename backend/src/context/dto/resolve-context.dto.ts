import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * The scanned QR payload, after the client has mapped it.
 *
 * A branch QR carries one value:
 *
 *   { "branch_id": "BR001" }
 *
 * That value is a branch *code*, not a database id, so it is named
 * accordingly here -- calling it "id" alongside the real uuid primary
 * keys would be misleading.
 *
 * The QR code establishes context and nothing else. It carries no
 * workflow instructions, no assistant behaviour, and no business rules.
 */
export class ResolveContextDto {
  @IsString()
  @IsNotEmpty({ message: 'branchCode is required.' })
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'branchCode may contain only letters, digits, hyphens and underscores.',
  })
  branchCode!: string;
}
