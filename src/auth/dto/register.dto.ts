import { IsNotEmpty, IsString } from "class-validator";

export class RegisterDto{
    @IsString()
    @IsNotEmpty()
    phone!: string;



    @IsString()
    @IsNotEmpty()
    fullName!: string;
    
    @IsString()
    @IsNotEmpty()
    accountType!: string;
}