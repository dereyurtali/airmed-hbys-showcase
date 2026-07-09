import { IsEmail, IsString, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
