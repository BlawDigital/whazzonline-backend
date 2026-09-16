import { IsNotEmpty, IsString } from 'class-validator';
import { ProductContextDto } from './product-context.dto';

export class StartConversationDto extends ProductContextDto {
  @IsString()
  @IsNotEmpty()
  vendorId!: string;
}
