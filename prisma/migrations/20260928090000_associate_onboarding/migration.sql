-- AlterTable
ALTER TABLE "products" ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "master_product_id" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "associate_id" TEXT,
ADD COLUMN     "invited_by_id" UUID,
ADD COLUMN     "payment_instructions" TEXT,
ADD COLUMN     "whatsapp_number" TEXT,
ADD COLUMN     "yoco_secret_key_encrypted" TEXT,
ADD COLUMN     "yoco_test_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "yoco_webhook_id" TEXT,
ADD COLUMN     "yoco_webhook_secret_encrypted" TEXT;

-- CreateTable
CREATE TABLE "master_products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "category" TEXT,
    "price_cents" INTEGER NOT NULL,
    "weight_grams" INTEGER,
    "length_cm" INTEGER,
    "width_cm" INTEGER,
    "height_cm" INTEGER,
    "shipping_category" "ShippingCategory" NOT NULL DEFAULT 'STANDARD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_by_id" UUID,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_checkouts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "redirect_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_products_sku_key" ON "master_products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "payment_checkouts_order_id_idx" ON "payment_checkouts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_checkouts_provider_external_id_key" ON "payment_checkouts"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_master_product_id_key" ON "products"("tenant_id", "master_product_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_master_product_id_fkey" FOREIGN KEY ("master_product_id") REFERENCES "master_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money invariants (see the init migration for the rationale).
ALTER TABLE "master_products" ADD CONSTRAINT "master_products_price_nonneg" CHECK ("price_cents" >= 0);
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_amount_positive" CHECK ("amount_cents" > 0);
ALTER TABLE "invites" ADD CONSTRAINT "invites_uses_valid" CHECK ("uses" >= 0 AND "max_uses" >= 1 AND "uses" <= "max_uses");
