-- CreateEnum
CREATE TYPE "ShippingCategory" AS ENUM ('STANDARD', 'FRAGILE', 'PERISHABLE', 'OVERSIZED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PAXI_PICKUP', 'DOOR_COURIER', 'SAME_DAY', 'SELLER_COLLECTION');

-- CreateEnum
CREATE TYPE "ProviderMode" AS ENUM ('INTEGRATED', 'ASSISTED');

-- CreateEnum
CREATE TYPE "ShippingPricingMode" AS ENUM ('EXACT', 'RATE_PLUS_HANDLING');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEB', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'CHECKED_OUT', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FULFILLING', 'SHIPPED', 'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'READY_TO_BOOK', 'READY_FOR_REGISTRATION', 'BOOKED', 'COLLECTED', 'IN_TRANSIT', 'READY_FOR_COLLECTION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentEventSource" AS ENUM ('PROVIDER', 'SELLER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order_prefix" TEXT NOT NULL DEFAULT 'SHS',
    "next_order_no" INTEGER NOT NULL DEFAULT 1001,
    "seller_display_name" TEXT,
    "whatsapp_phone_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight_grams" INTEGER,
    "length_cm" INTEGER,
    "width_cm" INTEGER,
    "height_cm" INTEGER,
    "shipping_category" "ShippingCategory" NOT NULL DEFAULT 'STANDARD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "remember_preferences" BOOLEAN NOT NULL DEFAULT false,
    "preferences_consent_at" TIMESTAMP(3),
    "preferred_method" "DeliveryMethod",
    "last_pickup_location_id" UUID,
    "last_address_id" UUID,
    "web_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "recipient_name" TEXT,
    "phone" TEXT,
    "street" TEXT NOT NULL,
    "complex" TEXT,
    "suburb" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "postcode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_providers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supports_pickup_points" BOOLEAN NOT NULL DEFAULT false,
    "supports_door_delivery" BOOLEAN NOT NULL DEFAULT false,
    "supports_same_day" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_delivery_providers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "methods" "DeliveryMethod"[],
    "mode" "ProviderMode" NOT NULL DEFAULT 'ASSISTED',
    "credentials_encrypted" TEXT,
    "pricing_mode" "ShippingPricingMode" NOT NULL DEFAULT 'EXACT',
    "handling_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "markup_bps" INTEGER NOT NULL DEFAULT 0,
    "free_shipping_threshold_cents" INTEGER,
    "dispatch_street" TEXT,
    "dispatch_suburb" TEXT,
    "dispatch_city" TEXT,
    "dispatch_province" TEXT,
    "dispatch_postcode" TEXT,
    "dispatch_latitude" DOUBLE PRECISION,
    "dispatch_longitude" DOUBLE PRECISION,
    "dispatch_contact_name" TEXT,
    "dispatch_contact_phone" TEXT,
    "default_parcel_length_cm" INTEGER NOT NULL DEFAULT 30,
    "default_parcel_width_cm" INTEGER NOT NULL DEFAULT 20,
    "default_parcel_height_cm" INTEGER NOT NULL DEFAULT 15,
    "default_parcel_weight_grams" INTEGER NOT NULL DEFAULT 1000,
    "handling_time_days" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_delivery_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_locations" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "suburb" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postcode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "kind" TEXT NOT NULL DEFAULT 'PICKUP_POINT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "service_code" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "provider_rate_cents" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "eta_min_days" INTEGER,
    "eta_max_days" INTEGER,
    "eta_label" TEXT,
    "delivery_location_id" UUID,
    "destination" JSONB NOT NULL,
    "provider_data" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID,
    "channel" "Channel" NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "delivery_method" "DeliveryMethod",
    "delivery_provider_id" UUID,
    "delivery_service_code" TEXT,
    "delivery_location_id" UUID,
    "delivery_address_id" UUID,
    "delivery_quote_id" UUID,
    "shipping_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "cart_id" UUID,
    "channel" "Channel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "subtotal_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "delivery_method" "DeliveryMethod" NOT NULL,
    "delivery_provider_id" UUID NOT NULL,
    "delivery_service_code" TEXT NOT NULL,
    "delivery_location_id" UUID,
    "delivery_destination" JSONB NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "mode" "ProviderMode" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "service_code" TEXT NOT NULL,
    "tracking_number" TEXT,
    "tracking_url" TEXT,
    "provider_shipment_ref" TEXT,
    "label_url" TEXT,
    "expected_delivery_at" TIMESTAMP(3),
    "parcel_length_cm" INTEGER NOT NULL,
    "parcel_width_cm" INTEGER NOT NULL,
    "parcel_height_cm" INTEGER NOT NULL,
    "parcel_weight_grams" INTEGER NOT NULL,
    "destination" JSONB NOT NULL,
    "provider_data" JSONB NOT NULL DEFAULT '{}',
    "booked_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_tracked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source" "ShipmentEventSource" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "to_phone" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "template_params" JSONB NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "cart_id" UUID,
    "context" JSONB NOT NULL DEFAULT '{}',
    "last_inbound_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_whatsapp_phone_id_key" ON "tenants"("whatsapp_phone_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "products_tenant_id_active_idx" ON "products"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "customers_web_token_hash_key" ON "customers"("web_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_providers_code_key" ON "delivery_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_delivery_providers_tenant_id_provider_id_key" ON "tenant_delivery_providers"("tenant_id", "provider_id");

-- CreateIndex
CREATE INDEX "delivery_locations_provider_id_active_idx" ON "delivery_locations"("provider_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_locations_provider_id_external_id_key" ON "delivery_locations"("provider_id", "external_id");

-- CreateIndex
CREATE INDEX "delivery_quotes_cart_id_idx" ON "delivery_quotes"("cart_id");

-- CreateIndex
CREATE INDEX "carts_tenant_id_status_idx" ON "carts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_id_key" ON "cart_items"("cart_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_cart_id_key" ON "orders"("cart_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_idx" ON "orders"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_number_key" ON "orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "shipments_tenant_id_status_idx" ON "shipments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_occurred_at_idx" ON "shipment_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_shipment_id_dedupe_key_key" ON "shipment_events"("shipment_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_tenant_id_dedupe_key_key" ON "outbound_messages"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_phone_key" ON "conversations"("tenant_id", "phone");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_last_pickup_location_id_fkey" FOREIGN KEY ("last_pickup_location_id") REFERENCES "delivery_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_delivery_providers" ADD CONSTRAINT "tenant_delivery_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_delivery_providers" ADD CONSTRAINT "tenant_delivery_providers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "delivery_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_locations" ADD CONSTRAINT "delivery_locations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "delivery_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "delivery_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_delivery_provider_id_fkey" FOREIGN KEY ("delivery_provider_id") REFERENCES "delivery_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "delivery_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_provider_id_fkey" FOREIGN KEY ("delivery_provider_id") REFERENCES "delivery_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "delivery_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "delivery_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Money and quantity invariants ────────────────────────────────────
-- The service layer validates these too; the database is the backstop
-- that makes a negative or inconsistent delivery total impossible to
-- store, whatever code path wrote it.
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonneg" CHECK ("price_cents" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_dims_positive" CHECK (
  ("weight_grams" IS NULL OR "weight_grams" > 0) AND
  ("length_cm" IS NULL OR "length_cm" > 0) AND
  ("width_cm" IS NULL OR "width_cm" > 0) AND
  ("height_cm" IS NULL OR "height_cm" > 0));
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "carts" ADD CONSTRAINT "carts_shipping_nonneg" CHECK ("shipping_cents" IS NULL OR "shipping_cents" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_consistent" CHECK (
  "subtotal_cents" >= 0 AND "shipping_cents" >= 0 AND "total_cents" = "subtotal_cents" + "shipping_cents");
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_amounts_nonneg" CHECK (
  "provider_rate_cents" >= 0 AND "price_cents" >= 0);
ALTER TABLE "tenant_delivery_providers" ADD CONSTRAINT "tdp_pricing_nonneg" CHECK (
  "handling_fee_cents" >= 0 AND "markup_bps" >= 0 AND
  ("free_shipping_threshold_cents" IS NULL OR "free_shipping_threshold_cents" >= 0) AND
  "default_parcel_length_cm" > 0 AND "default_parcel_width_cm" > 0 AND
  "default_parcel_height_cm" > 0 AND "default_parcel_weight_grams" > 0 AND
  "handling_time_days" >= 0);
