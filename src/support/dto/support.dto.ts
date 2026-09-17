import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class SupportMessageDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  text?: string;
}

export class CreateSupportTicketDto extends SupportMessageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  subject!: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class SupportListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';
}

export class SupportStatusDto {
  @IsIn(['open', 'resolved'])
  status!: 'open' | 'resolved';
}
