-- Twarda gwarancja braku podwójnych rezerwacji.
--
-- Walidacja w kodzie aplikacji nie wystarcza: dwa równoległe żądania mogą
-- sprawdzić dostępność tego samego slotu, zanim którekolwiek zapisze rezerwację.
-- Ograniczenie wykluczające (exclusion constraint) rozstrzyga wyścig w bazie —
-- drugi INSERT kończy się błędem 23P01 (exclusion_violation).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Blokowany zakres jest domknięty od lewej i otwarty od prawej: [start, end).
-- Dzięki temu wizyta 10:00–10:30 i 10:30–11:00 nie kolidują ze sobą.
-- Warunek WHERE opiera się na kolumnie is_blocking, bo exclusion constraint
-- nie może sięgnąć po status z tabeli bookings — status przenosi trigger poniżej.
ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("blocked_start_at", "blocked_end_at", '[)') WITH &&
  ) WHERE ("is_blocking");

-- Anulowanie rezerwacji zwalnia slot; NO_SHOW nie — ten czas fizycznie minął
-- i ma pozostać widoczny w historii grafiku.
CREATE OR REPLACE FUNCTION sync_booking_items_blocking()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "booking_items"
     SET "is_blocking" = NEW."status" NOT IN (
           'CANCELLED_BY_CUSTOMER',
           'CANCELLED_BY_BUSINESS'
         )
   WHERE "booking_id" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_sync_blocking"
AFTER UPDATE OF "status" ON "bookings"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION sync_booking_items_blocking();
