// src/lib/warehouseBridge.ts
// Мост через localStorage для обмена данными между Калькулятором и Прогнозом.

type Roles = { pick: number; overstock: number; attic: number };

const KEY = "warehouseSuite.forecastSeed.v1";

export function saveForForecast(
  capacity: { totalCapacityByRole: Roles; cells: number | Roles },
  start: { pick: number; overstock: number; attic: number; activeSkus: number; cellsByRole?: Roles }
) {
  if (typeof window === "undefined") return;
  const payload = { capacity, start, ts: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

export function loadForForecast() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const { capacity, start } = JSON.parse(raw) as {
      capacity: { totalCapacityByRole: Roles; cells: number | Roles };
      start: { pick: number; overstock: number; attic: number; activeSkus: number; cellsByRole?: Roles };
    };

    const capM3 =
      (capacity?.totalCapacityByRole?.pick || 0) +
      (capacity?.totalCapacityByRole?.overstock || 0) +
      (capacity?.totalCapacityByRole?.attic || 0);

    const capCells =
      typeof capacity?.cells === "number"
        ? capacity.cells
        : ((capacity?.cells as Roles)?.pick || 0) +
          ((capacity?.cells as Roles)?.overstock || 0) +
          ((capacity?.cells as Roles)?.attic || 0);

    const startM3 = (start?.pick || 0) + (start?.overstock || 0) + (start?.attic || 0);
    const activeSkus = start?.activeSkus ?? 0;

    return {
      capacityM3: capM3,
      capacityCells: capCells,
      startStockM3: startM3,
      startActiveSkus: activeSkus,
      raw: { capacity, start },
    };
  } catch {
    return null;
  }
}
