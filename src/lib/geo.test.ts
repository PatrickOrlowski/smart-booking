import { describe, expect, it } from "vitest";
import { boundingBox, haversineKm, KM_PER_DEGREE_LAT } from "./geo";

/** Centra miast (przybliżone współrzędne rynków/centrów). */
const WARSZAWA = { lat: 52.2297, lng: 21.0122 };
const KRAKOW = { lat: 50.0647, lng: 19.945 };
const GDANSK = { lat: 54.352, lng: 18.6466 };
const WROCLAW = { lat: 51.1079, lng: 17.0385 };

/** Połowa obwodu Ziemi dla R = 6371 km (πR). */
const HALF_CIRCUMFERENCE_KM = Math.PI * 6371;

describe("haversineKm", () => {
  it("Warszawa–Kraków ≈ 252 km", () => {
    expect(haversineKm(WARSZAWA, KRAKOW)).toBeCloseTo(252, -1); // ±5 km
  });

  it("Warszawa–Gdańsk ≈ 284 km", () => {
    expect(haversineKm(WARSZAWA, GDANSK)).toBeCloseTo(284, -1);
  });

  it("Kraków–Wrocław ≈ 236 km", () => {
    expect(haversineKm(KRAKOW, WROCLAW)).toBeCloseTo(236, -1);
  });

  it("ten sam punkt = 0", () => {
    expect(haversineKm(WARSZAWA, WARSZAWA)).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });

  it("jest symetryczna", () => {
    expect(haversineKm(WARSZAWA, GDANSK)).toBe(haversineKm(GDANSK, WARSZAWA));
  });

  it("antypody = połowa obwodu Ziemi (bez NaN z błędu zmiennoprzecinkowego)", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(
      HALF_CIRCUMFERENCE_KM,
      1,
    );
    expect(haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })).toBeCloseTo(
      HALF_CIRCUMFERENCE_KM,
      1,
    );
    // Antypoda Warszawy — przypadek, w którym h potrafi przekroczyć 1.
    const antipode = { lat: -WARSZAWA.lat, lng: WARSZAWA.lng - 180 };
    expect(haversineKm(WARSZAWA, antipode)).toBeCloseTo(
      HALF_CIRCUMFERENCE_KM,
      0,
    );
  });

  it("krótkie dystanse: 0,01° szerokości ≈ 1,11 km", () => {
    const a = { lat: 52.22, lng: 21.01 };
    const b = { lat: 52.23, lng: 21.01 };
    expect(haversineKm(a, b)).toBeCloseTo(0.01 * KM_PER_DEGREE_LAT, 3);
  });
});

describe("boundingBox", () => {
  it("szerokość boxa odpowiada promieniowi, długość rośnie z cos(lat)", () => {
    const box = boundingBox(WARSZAWA, 10);
    expect(box.maxLat - box.minLat).toBeCloseTo((2 * 10) / KM_PER_DEGREE_LAT, 6);
    // Na 52°N stopień długości jest krótszy — box po długości musi być szerszy.
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
  });

  it("zawiera każdy punkt w zadanym promieniu (box ⊇ koło)", () => {
    const radius = 25;
    const box = boundingBox(WARSZAWA, radius);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180;
      const point = {
        lat: WARSZAWA.lat + (Math.cos(rad) * radius) / KM_PER_DEGREE_LAT,
        lng:
          WARSZAWA.lng +
          (Math.sin(rad) * radius) /
            (KM_PER_DEGREE_LAT * Math.cos((WARSZAWA.lat * Math.PI) / 180)),
      };
      expect(haversineKm(WARSZAWA, point)).toBeLessThanOrEqual(radius + 0.1);
      expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(point.lat).toBeLessThanOrEqual(box.maxLat);
      expect(point.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(point.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it("przy biegunie przycina szerokość do 90° i nie dzieli przez ~0", () => {
    const box = boundingBox({ lat: 89.99, lng: 0 }, 50);
    expect(box.maxLat).toBe(90);
    expect(Number.isFinite(box.minLng)).toBe(true);
    expect(Number.isFinite(box.maxLng)).toBe(true);
    expect(box.minLng).toBeGreaterThanOrEqual(-180);
    expect(box.maxLng).toBeLessThanOrEqual(180);
  });
});
