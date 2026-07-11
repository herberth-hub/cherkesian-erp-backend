import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class EnviarEmailDto {
  @IsEmail({}, { message: 'Informe um e-mail de destino válido.' })
  para!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  assunto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mensagem?: string;
}
