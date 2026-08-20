import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class EnviarEmailDto {
  /** Um ou mais e-mails de destino, separados por vírgula/ponto-e-vírgula/espaço. */
  @IsString()
  @IsNotEmpty({ message: 'Informe ao menos um e-mail de destino.' })
  @MaxLength(500)
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
