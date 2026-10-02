import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
export class ReadNotificationsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  ids!: string[];
}
export class NotificationSettingsDto {
  @IsOptional() @IsBoolean() orders?: boolean;
  @IsOptional() @IsBoolean() priceSuggestions?: boolean;
  @IsOptional() @IsBoolean() inventoryAlerts?: boolean;
}
