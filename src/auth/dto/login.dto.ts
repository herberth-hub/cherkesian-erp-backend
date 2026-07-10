import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o usuário.' })
  @MaxLength(100)
  usuario!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha.' })
  @MaxLength(200)
  senha!: string;
}
