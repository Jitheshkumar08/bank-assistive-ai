import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Everything optional: a form sends only what it changed.
 *
 * The code is absent on purpose. It is printed on every QR sticker
 * already stuck to a counter, so changing it would silently break them;
 * a branch that needs a different code gets a new branch and the old one
 * deactivated.
 */
export class UpdateBranchDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 80, { message: 'Branch name must be between 2 and 80 characters.' })
  name?: string;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
