// src/lib/warehouseBridge.ts
"use client";

export type CalcSnapshot = {
  totals: {
    totalCapacity: number;
    totalFact: number;
    fillPctTotal: number;
    totalOverflow: number;
  };
  savedAt: string;   // ISO
  v?: number;        // версия схемы (на будущее)
};

const SNAP_KEY = "ws_calc_snapshot";
const EVT = "ws:calc-saved";

export function writeFromCalculator(snap: CalcSnapshot) {
  if (typeof window === "undefined") return;
  const payload: CalcSnapshot = {
    ...snap,
    v: 1,
    // на всякий — округлим числа чтобы не плодить микросмены
    totals: {
      totalCapacity: +snap.totals.totalCapacity.toFixed(6),
      totalFact: +snap.totals.totalFact.toFixed(6),
      fillPctTotal: +snap.totals.fillPctTotal.toFixed(6),
      totalOverflow: +snap.totals.totalOverflow.toFixed(6),
    },
  };
  localStorage.setItem(SNAP_KEY, JSON.stringify(payload));
  // свой ивент — чтобы можно было услышать в рамках одного окна
  window.dispatchEvent(new CustomEvent(EVT));
}

export function readForForecast(): CalcSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SNAP_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CalcSnapshot;
    if (!parsed?.totals) return null;
    return parsed;
  } catch {
    return null;
  }
}

// подписка на автообновление (внутри страниц)
export function onCalcSaved(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  // refresh и при переключении вкладки назад
  const vis = () => { if (document.visibilityState === "visible") cb(); };
  document.addEventListener("visibilitychange", vis);
  // если кто-то (другая вкладка) написал через storage
  const sto = (e: StorageEvent) => { if (e.key === SNAP_KEY) cb(); };
  window.addEventListener("storage", sto);
  return () => {
    window.removeEventListener(EVT, handler);
    document.removeEventListener("visibilitychange", vis);
    window.removeEventListener("storage", sto);
  };
}
