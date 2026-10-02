import { IsEnum } from 'class-validator';

export enum ConversationStatusValue {
  OPEN = 'OPEN',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export class UpdateConversationStatusDto {
  @IsEnum(ConversationStatusValue)
  status!: ConversationStatusValue;
}
