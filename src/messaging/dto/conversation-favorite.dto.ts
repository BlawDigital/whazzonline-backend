import { IsBoolean } from 'class-validator';
export class ConversationFavoriteDto {
  @IsBoolean() favorite!: boolean;
}
