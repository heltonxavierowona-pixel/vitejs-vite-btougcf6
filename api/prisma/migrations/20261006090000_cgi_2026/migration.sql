-- Mise en conformité avec le CGI 2026 (TVA).
ALTER TABLE "customers" ADD COLUMN "withholdsVat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN "vatNonDeductible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoice_lines" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoice_payments" ADD COLUMN "vatWithheld" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tax_declarations" ADD COLUMN "vatWithheld" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tax_declarations" ADD COLUMN "vatExcluded" INTEGER NOT NULL DEFAULT 0;

-- Lignes déjà saisies à partir d'un article du catalogue marqué
-- « service » : on reporte l'information.
UPDATE "invoice_lines" l SET "isService" = true
FROM "products" p WHERE l."productId" = p."id" AND p."isService" = true;
