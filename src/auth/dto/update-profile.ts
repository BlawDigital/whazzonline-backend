import { IsArray, IsOptional, IsString, IsInt, Min, Max } from "class-validator";

export class UpdateProfileDto {
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(4)
    buyerOnboardingStep?: number;
    @IsOptional()
    @IsString()
    firstName?: string;

    @IsOptional()
    @IsString()
    lastName?: string;

    @IsOptional()
    @IsString()
    dateOfBirth?: string;

    @IsOptional()
    @IsString()
    state?: string;

    @IsOptional()
    @IsString()
    city?: string;

    @IsOptional()
    @IsArray()
    @IsString({each: true})
    interests?: string[];
}
