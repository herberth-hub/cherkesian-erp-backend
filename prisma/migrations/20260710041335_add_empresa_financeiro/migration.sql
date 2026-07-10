/*
  Warnings:

  - Added the required column `empresaId` to the `Comissao` table without a default value. This is not possible if the table is not empty.
  - Added the required column `empresaId` to the `ContaPagar` table without a default value. This is not possible if the table is not empty.
  - Added the required column `empresaId` to the `ContaReceber` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Comissao" ADD COLUMN     "empresaId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ContaPagar" ADD COLUMN     "empresaId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ContaReceber" ADD COLUMN     "empresaId" INTEGER NOT NULL;
