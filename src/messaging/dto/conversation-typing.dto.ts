import { IsBoolean } from 'class-validator';

export class ConversationTypingDto {
  @IsBoolean()
  typing!: boolean;
}
