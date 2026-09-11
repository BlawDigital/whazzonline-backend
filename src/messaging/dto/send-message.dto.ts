import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum MessageKind {
  IMAGE = 'image',
  TEXT = 'text',
  VOICE = 'voice',
}

export class SendMessageDto {
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
