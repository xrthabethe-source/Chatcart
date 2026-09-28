-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "whatsapp_access_token_encrypted" TEXT,
ADD COLUMN     "whatsapp_business_account_id" TEXT,
ADD COLUMN     "whatsapp_coexistence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_connected_at" TIMESTAMP(3),
ADD COLUMN     "whatsapp_display_number" TEXT;

