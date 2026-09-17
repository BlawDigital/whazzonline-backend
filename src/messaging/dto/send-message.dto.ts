import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProductContextDto } from './product-context.dto';

export enum MessageKind {
  IMAGE = 'image',
  TEXT = 'text',
  VOICE = 'voice',
}

export class SendMessageDto extends ProductContextDto {
  @IsEnum(MessageKind)
  kind!: MessageKind;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUri?: string;
}
