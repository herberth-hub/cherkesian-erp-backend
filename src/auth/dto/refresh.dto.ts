import { IsJWT, IsNotEmpty } from 'class-validator';

export class RefreshDto {
  @IsJWT({ message: 'refreshToken inválido.' })
  @IsNotEmpty()
  refreshToken!: string;
}
