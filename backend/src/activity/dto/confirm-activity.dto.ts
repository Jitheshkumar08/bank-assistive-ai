import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * What the customer may change on the review screen.
 *
 * Only the amount and the payee, and the payee only to one of their
 * own. The ceiling is applied in the service, from configuration, so a
 * deployment can lower it without a code change.
 */
export class ConfirmActivityDto {
  @IsOptional()
  @IsInt({ message: 'The amount must be a whole number of paise.' })
  @Min(1, { message: 'The amount must be more than zero.' })
  amountMinor?: number;

  @IsOptional()
  @IsUUID('4', { message: 'That payee is not valid.' })
  payeeId?: string;
}
