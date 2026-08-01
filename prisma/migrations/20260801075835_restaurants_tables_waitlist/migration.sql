-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('ROUND', 'SQUARE', 'RECTANGLE');

-- CreateEnum
CREATE TYPE "RestaurantArea" AS ENUM ('INDOOR', 'OUTDOOR', 'BAR', 'PRIVATE');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONVERTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('STANDARD', 'TABLE_RESERVATION');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "default_turn_time_min" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "max_party_size_online" INTEGER,
ADD COLUMN     "table_buffer_min" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "area" "RestaurantArea",
ADD COLUMN     "combinable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pos_x" INTEGER,
ADD COLUMN     "pos_y" INTEGER,
ADD COLUMN     "room_id" TEXT,
ADD COLUMN     "shape" "TableShape",
ADD COLUMN     "span_x" INTEGER,
ADD COLUMN     "span_y" INTEGER,
ADD COLUMN     "table_number" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "kind" "ServiceKind" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "grid_width" INTEGER NOT NULL DEFAULT 20,
    "grid_height" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_combinations" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity_min" INTEGER NOT NULL,
    "capacity_max" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "table_combinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_combination_members" (
    "id" TEXT NOT NULL,
    "combination_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,

    CONSTRAINT "table_combination_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_time_rules" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "party_size_min" INTEGER NOT NULL,
    "party_size_max" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,

    CONSTRAINT "turn_time_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacing_rules" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "weekday" INTEGER,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "interval_min" INTEGER NOT NULL DEFAULT 15,
    "max_covers" INTEGER,
    "max_bookings" INTEGER,

    CONSTRAINT "pacing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "flex_min" INTEGER NOT NULL DEFAULT 60,
    "party_size" INTEGER NOT NULL,
    "customer_user_id" TEXT,
    "customer_id" TEXT,
    "guest_name" TEXT,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "note" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notified_at" TIMESTAMPTZ(3),
    "hold_until" TIMESTAMPTZ(3),
    "booking_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_location_id_idx" ON "rooms"("location_id");

-- CreateIndex
CREATE INDEX "table_combinations_location_id_idx" ON "table_combinations"("location_id");

-- CreateIndex
CREATE INDEX "table_combination_members_resource_id_idx" ON "table_combination_members"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "table_combination_members_combination_id_resource_id_key" ON "table_combination_members"("combination_id", "resource_id");

-- CreateIndex
CREATE INDEX "turn_time_rules_location_id_party_size_min_idx" ON "turn_time_rules"("location_id", "party_size_min");

-- CreateIndex
CREATE INDEX "pacing_rules_location_id_weekday_idx" ON "pacing_rules"("location_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_booking_id_key" ON "waitlist_entries"("booking_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_location_id_status_requested_at_idx" ON "waitlist_entries"("location_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "waitlist_entries_business_id_status_idx" ON "waitlist_entries"("business_id", "status");

-- CreateIndex
CREATE INDEX "resources_room_id_idx" ON "resources"("room_id");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combinations" ADD CONSTRAINT "table_combinations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combination_members" ADD CONSTRAINT "table_combination_members_combination_id_fkey" FOREIGN KEY ("combination_id") REFERENCES "table_combinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combination_members" ADD CONSTRAINT "table_combination_members_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_time_rules" ADD CONSTRAINT "turn_time_rules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacing_rules" ADD CONSTRAINT "pacing_rules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
