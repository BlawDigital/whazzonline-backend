import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ProductContextDto } from './product-context.dto';

export class StartConversationDto extends ProductContextDto {
  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  clientThreadId?: string;

  @IsOptional()
  @IsBoolean()
  newThread?: boolean;
}
