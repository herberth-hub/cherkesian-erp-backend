import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AuthorizeOffhoursDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o usuário que precisa acessar.' })
  @MaxLength(100)
  usuario!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha do usuário.' })
  @MaxLength(200)
  senha!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe o usuário administrador.' })
  @MaxLength(100)
  adminUsuario!: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha do administrador.' })
  @MaxLength(200)
  adminSenha!: string;
}
