"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Papa from "papaparse";
import {
  Calculator as CalcIcon,
  TrendingUp,
  Database,
  Upload,
  Download,
  PackageSearch,
  AlertCircle,
  PlusCircle,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Legend, Tooltip as ReTooltip,
  ReferenceLine, ResponsiveContainer
} from "recharts";
import { writeFromCalculator, readForForecast, onCalcSaved } from "@/lib/warehouseBridge";

/* ========= типы ========= */
type Role = "pick" | "overstock" | "attic";
interface RefRow { sku: string; pcs_per_mc?: number; pcs_cbm?: number; mc_cbm?: number; category: string }
interface InvRow { sku: string; qty_pcs: number }
interface AddrCellRow { role: Role; cellId: string; cellVolume_m3: number; category: string }
interface CapByCategory { category: string; capacity_cbm: number }
interface CapByCategoryRole { category: string; role: Role; capacity_cbm: number }
interface CatSummary { category: string; volume_cbm: number; capacity_cbm: number; fill_pct: number | null; overflow_cbm: number }
interface RoleSummary { role: Role | "overflow"; allocated_cbm: number; pct_of_total_capacity: number }

/* ========= утилиты ========= */
const fmt = (n: number, d = 3) => (isFinite(n) ? n.toFixed(d) : "—");
const fmt0 = (n: number) => (isFinite(n) ? Math.round(n).toString() : "—");
const fmtPct = (n: number) => (isFinite(n) ? n.toFixed(2) + "%" : "—");

async function fetchJSON<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}
function downloadCSV(filename: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const toNum = (v: any, def = 0) => {
  if (v == null || v === "") return def;
  const n = Number(String(v).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : def;
};
const pretty = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : "—");

const MONTHS_RU = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
const monthName = (i: number) => MONTHS_RU[((i % 12)+12)%12];
const ymKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2,"0")}`;

/* ========= маленькие UI-компоненты ========= */
function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-xs cursor-help">?</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
    </Tooltip>
  );
}
function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(120, value || 0));
  const color =
    v >= 100 ? "bg-rose-500" :
    v >= 80  ? "bg-amber-500" :
               "bg-emerald-500";
  return (
    <div className="w-full h-2 rounded bg-muted/60 overflow-hidden">
      <div className={`h-2 ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ========= страница с табами (оба смонтированы всегда) ========= */
export default function Page() {
  const [activeTab, setActiveTab] = useState<"calc" | "forecast">("calc");

  return (
    <TooltipProvider>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalcIcon className="w-6 h-6" />
            <h1 className="text-2xl font-semibold">Warehouse Suite</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={activeTab === "calc" ? "default" : "outline"} onClick={() => setActiveTab("calc")}>
              <CalcIcon className="w-4 h-4 mr-2" />
              Калькулятор
            </Button>
            <Button variant={activeTab === "forecast" ? "default" : "outline"} onClick={() => setActiveTab("forecast")}>
              <TrendingUp className="w-4 h-4 mr-2" />
              Прогноз
            </Button>
          </div>
        </div>

        <div className={activeTab === "calc" ? "block" : "hidden"}>
          <CalculatorTab />
        </div>
        <div className={activeTab === "forecast" ? "block" : "hidden"}>
          <ForecastTab />
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ========= КАЛЬКУЛЯТОР ========= */
function CalculatorTab() {
  // дефолтные JSON из /public
  const [ref, setRef] = useState<RefRow[] | null>(null);
  const [capCat, setCapCat] = useState<CapByCategory[] | null>(null);
  const [capCatRole, setCapCatRole] = useState<CapByCategoryRole[] | null>(null);
  const [addrCells, setAddrCells] = useState<AddrCellRow[] | null>(null);

  // инвентарь
  const [invRows, setInvRows] = useState<InvRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // диагностика
  const [missingVolume, setMissingVolume] = useState<number>(0);
  const [missingCategory, setMissingCategory] = useState<number>(0);

  // UI-фильтры/сортировка
  const [catQuery, setCatQuery] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [hideUncat, setHideUncat] = useState(true);
  const [catSort, setCatSort] = useState<{ key: keyof CatSummary; dir: 1 | -1 }>({ key: "overflow_cbm", dir: -1 });
// ↓↓↓ вставить сразу после useState для catSort ↓↓↓
const SORT_LABELS: Record<keyof CatSummary | 'category', string> = {
  category: "Категория",
  volume_cbm: "Факт, м³",
  capacity_cbm: "Вместимость, м³",
  fill_pct: "% заполн.",
  overflow_cbm: "Переполн., м³",
};

const SORT_ORDER: (keyof CatSummary | 'category')[] = [
  "overflow_cbm",
  "fill_pct",
  "volume_cbm",
  "capacity_cbm",
  "category",
];

  // DnD + paste
  const dropRef = useRef<HTMLDivElement | null>(null);

  // загрузка дефолтных JSON
  useEffect(() => {
    (async () => {
      try {
        const [refMin, cap1, cap2, addrCellsMap] = await Promise.all([
          fetchJSON<RefRow[]>("/reference_min.json"),
          fetchJSON<CapByCategory[]>("/capacity_by_category.json"),
          fetchJSON<CapByCategoryRole[]>("/capacity_by_category_role.json"),
          fetchJSON<AddrCellRow[]>("/addr_cells_map.json"),
        ]);
        setRef(refMin);
        setCapCat(cap1);
        setCapCatRole(cap2);
        setAddrCells(addrCellsMap);
      } catch (e) {
        console.error(e);
        alert("Не удалось загрузить дефолтные JSON из /public. Проверь файлы.");
      }
    })();
  }, []);

  // сводим Level-3 → укрупнённые категории карты
  const normalizeCategory = React.useCallback((raw: string | null | undefined) => {
    const s0 = String(raw ?? "").trim();
    if (!s0) return "Uncategorized";
    const s = s0.toLowerCase();

    if (/(термоноск)/i.test(s)) return "Носки";
    if (/(джог+ер|джогер)/i.test(s)) return "Брюки";
    if (/(вейдерс)/i.test(s)) return "Вейдерсы";
    if (/(ботин|сапог|полусапог|кроссовк|забродн.*обув|обувь)/i.test(s)) return "Обувь";
    if (/(термокуртк|куртк|жилетк|плащ)/i.test(s)) return "Куртки";
    if (/(кофт|худ[иы])/i.test(s)) return "Кофты";
    if (/(комбез|комбинез)/i.test(s)) return "Костюмы";
    if (/(брюк|термобрюк)/i.test(s)) return "Брюки";
    if (/(лонгслив|джерс|футболк|рубаш)/i.test(s)) return "Футболки и рубашки";
    if (/(шапк|балаклав|баф|маск|кепк)/i.test(s)) return "Головные уборы";
    if (/(перчат|вареж)/i.test(s)) return "Перчатки";
    if (/(сумк|чехл|рюкзак|пояс|оборудован)/i.test(s)) return "Сумки и чехлы";
    if (/(термобель)/i.test(s)) return "Термоодежда";
    return s0[0].toUpperCase() + s0.slice(1);
  }, []);

  // агрегации
  const results = useMemo(() => {
    if (!ref || !capCat || !capCatRole || !addrCells || !invRows) return null;

    const refMap = new Map<string, RefRow>();
    ref.forEach(r => refMap.set(r.sku, r));

    const skuRows = invRows.map(ir => {
      const r = refMap.get(ir.sku);
      const pcs_cbm = r?.pcs_cbm ?? 0;
      const categoryRaw = r?.category ?? "Uncategorized";
      const category = normalizeCategory(categoryRaw);
      const volume_cbm = (ir.qty_pcs || 0) * (pcs_cbm || 0);
      return { sku: ir.sku, qty_pcs: ir.qty_pcs || 0, pcs_cbm, volume_cbm, category };
    });

    setMissingVolume(skuRows.filter(x => !x.pcs_cbm || x.pcs_cbm <= 0).length);
    setMissingCategory(skuRows.filter(x => !x.category || x.category === "Uncategorized").length);

    const volByCat = new Map<string, number>();
    for (const row of skuRows) volByCat.set(row.category, (volByCat.get(row.category) || 0) + row.volume_cbm);

    const capByCat = new Map<string, number>();
    for (const c of capCat) {
      const tgt = normalizeCategory(c.category);
      capByCat.set(tgt, (capByCat.get(tgt) || 0) + (c.capacity_cbm || 0));
    }
    const capRoleKey = (c: string, role: Role) => `${c}__${role}`;
    const capByCatAndRole = new Map<string, number>();
    for (const c of capCatRole) {
      const tgt = normalizeCategory(c.category);
      const key = capRoleKey(tgt, c.role);
      capByCatAndRole.set(key, (capByCatAndRole.get(key) || 0) + (c.capacity_cbm || 0));
    }

    const catSummaries: CatSummary[] = [];
    const categories = new Set<string>([...volByCat.keys(), ...capByCat.keys()]);
    for (const cat of categories) {
      const vol = volByCat.get(cat) || 0;
      const cap = capByCat.get(cat) || 0;
      if (vol <= 1e-9 && cap <= 1e-9) continue;
      const fill = cap > 0 ? (vol / cap) * 100 : null;
      const overflow = Math.max(0, vol - cap);
      catSummaries.push({ category: cat, volume_cbm: vol, capacity_cbm: cap, fill_pct: fill, overflow_cbm: overflow });
    }

    // сортировка (по выбранному столбцу)
    catSummaries.sort((a, b) => {
  const { key: k, dir } = catSort;

  if (k === "category") {
    const cmp = String(a.category).localeCompare(String(b.category), "ru");
    return dir * (cmp === 0 ? 0 : (cmp > 0 ? 1 : -1));
  } else {
    const av = Number((a as any)[k] ?? 0);
    const bv = Number((b as any)[k] ?? 0);
    if (av === bv) {
      // тай-брейк по «Факт, м³» по убыванию
      return (b.volume_cbm - a.volume_cbm);
    }
    return dir * (av > bv ? 1 : -1);
  }
});

    // распределение по ролям
    const roleOrder: Role[] = ["pick", "overstock", "attic"];
    const alloc: { category: string; role: Role | "overflow"; allocated_cbm: number }[] = [];
    for (const cat of categories) {
      let remaining = volByCat.get(cat) || 0;
      for (const role of roleOrder) {
        const cap = capByCatAndRole.get(capRoleKey(cat, role)) || 0;
        const take = Math.min(remaining, cap);
        if (take > 0) { alloc.push({ category: cat, role, allocated_cbm: take }); remaining -= take; }
        if (remaining <= 1e-9) break;
      }
      if (remaining > 1e-9) alloc.push({ category: cat, role: "overflow", allocated_cbm: remaining });
    }

    const totalCapacity = addrCells.reduce((s, c) => s + (c.cellVolume_m3 || 0), 0);
    const totalFact = skuRows.reduce((s, r) => s + r.volume_cbm, 0);
    const byRole = new Map<string, number>();
    for (const a of alloc) byRole.set(a.role, (byRole.get(a.role) || 0) + a.allocated_cbm);
    const roleSummaries: RoleSummary[] = Array.from(byRole.entries()).map(([role, v]) => ({
      role: role as Role | "overflow",
      allocated_cbm: v,
      pct_of_total_capacity: totalCapacity > 0 ? (v / totalCapacity) * 100 : 0,
    }));

    return {
      totals: {
        totalCapacity,
        totalFact,
        fillPctTotal: totalCapacity > 0 ? (totalFact / totalCapacity) * 100 : 0,
        totalOverflow: Math.max(0, totalFact - totalCapacity),
      },
      catSummaries,
      roleSummaries,
      skuRows,
    };
  }, [ref, capCat, capCatRole, addrCells, invRows, normalizeCategory, catSort]);

  /* ---------- кэш остатков ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("calc_inv_rows_v1");
      if (raw) {
        const parsed = JSON.parse(raw) as InvRow[];
        if (Array.isArray(parsed) && parsed.length) {
          setInvRows(parsed);
          const fname = localStorage.getItem("calc_inv_filename_v1");
          if (fname) setFileName(fname);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (invRows && invRows.length) {
        localStorage.setItem("calc_inv_rows_v1", JSON.stringify(invRows));
        if (fileName) localStorage.setItem("calc_inv_filename_v1", fileName);
      } else {
        localStorage.removeItem("calc_inv_rows_v1");
        localStorage.removeItem("calc_inv_filename_v1");
      }
    } catch {}
  }, [invRows, fileName]);

  // автосейв снапшота (в т.ч. после восстановления из кэша)
  useEffect(() => {
    if (!results) return;
    writeFromCalculator({
      totals: {
        totalCapacity: results.totals.totalCapacity,
        totalFact: results.totals.totalFact,
        fillPctTotal: results.totals.fillPctTotal,
        totalOverflow: results.totals.totalOverflow,
      },
      savedAt: new Date().toISOString(),
    });
  }, [results?.totals.totalCapacity, results?.totals.totalFact, results?.totals.fillPctTotal, results?.totals.totalOverflow]);

  /* ---------- CSV: file, DnD, paste ---------- */
  const handleParsedRows = (rows: any[]) => {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const norm = (s: string) => s.trim().toLowerCase();
    const skuCol = cols.find(c => ["sku","код товара (sku)","код товара","артикул"].includes(norm(c))) || cols[0];
    const qtyCol = cols.find(c => ["доступно","qty","кол-во","количество","остаток","остаток, шт","available"].includes(norm(c))) || cols[1];

    const parsed = rows.map((r) => {
      const sku = String(r[skuCol] ?? "").trim();
      const qty = Number(String(r[qtyCol] ?? "0").replace(",", "."));
      return { sku, qty: isFinite(qty) ? Math.max(0, qty) : 0 };
    }).filter(r => r.sku);

    const map = new Map<string, number>();
    for (const r of parsed) map.set(r.sku, (map.get(r.sku) || 0) + r.qty);
    const inv: InvRow[] = Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty_pcs: qty }));
    setInvRows(inv);
  };

  const onCSV = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse(file, {
      header: true, skipEmptyLines: true, encoding: "utf-8",
      complete: (res) => handleParsedRows(res.data as any[]),
      error: (err) => { console.error(err); alert("Ошибка чтения CSV. Проверь формат и кодировку UTF-8."); }
    });
  }, []);

  // drag&drop
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const stop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const enter = (e: DragEvent) => { stop(e); el.classList.add("ring-2","ring-primary"); };
    const leave = (e: DragEvent) => { stop(e); el.classList.remove("ring-2","ring-primary"); };
    const over  = (e: DragEvent) => stop(e);
    const drop  = (e: DragEvent) => {
      stop(e); el.classList.remove("ring-2","ring-primary");
      const f = e.dataTransfer?.files?.[0];
      if (f) onCSV(f);
    };
    el.addEventListener("dragenter", enter); el.addEventListener("dragleave", leave);
    el.addEventListener("dragover", over);   el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter); el.removeEventListener("dragleave", leave);
      el.removeEventListener("dragover", over);   el.removeEventListener("drop", drop);
    };
  }, [onCSV]);

  // paste CSV from clipboard
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const text = e.clipboardData.getData("text/plain");
      if (!text || !text.includes(",")) return; // простая эвристика
      try {
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        if (parsed?.data && Array.isArray(parsed.data) && parsed.data.length) {
          setFileName("Вставлено из буфера");
          handleParsedRows(parsed.data as any[]);
        }
      } catch {}
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  }, []);

  /* ---------- экспорт ---------- */
  const exportCat  = () => results && downloadCSV("category_vs_capacity.csv", results.catSummaries);
  const exportRole = () => results && downloadCSV("allocated_by_role.csv", results.roleSummaries);
  const exportSku  = () => results && downloadCSV("sku_volumes.csv", results.skuRows);

  /* ---------- отфильтрованные категории ---------- */
  const visibleCats = useMemo(() => {
    if (!results) return [];
    return results.catSummaries.filter(r => {
      if (hideZero && (r.volume_cbm <= 1e-9) && (r.capacity_cbm <= 1e-9)) return false;
      if (hideUncat && r.category.toLowerCase() === "uncategorized") return false;
      if (catQuery && !r.category.toLowerCase().includes(catQuery.toLowerCase())) return false;
      return true;
    });
  }, [results, hideZero, hideUncat, catQuery]);

  /* ---------- UI ---------- */
  return (
    <div className="space-y-6">
      {/* Загрузка CSV */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Загрузка остатков (CSV)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onCSV(f); }} className="max-w-sm" />
            {fileName && <div className="text-sm text-muted-foreground">Файл: {fileName}</div>}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">
                  <Database className="w-4 h-4 mr-2" />
                  Схема CSV
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm">
                Обязательные колонки: <b>Код товара (SKU)</b>, <b>Доступно</b>. Можно перетянуть CSV сюда или вставить из буфера (Ctrl+V).
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" onClick={() => { setInvRows(null); setFileName(null); }}>
              Очистить кэш остатков
            </Button>
          </div>

          <div ref={dropRef} className="border-2 border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
            Перетащи сюда CSV с остатками или нажми, чтобы выбрать файл. Также можно просто <b>вставить</b> CSV из буфера.
          </div>
        </CardContent>
      </Card>

      {/* KPI — липкая панель */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 sticky top-4 z-10">
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Вместимость</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold flex items-center gap-2">
              {addrCells ? fmt(addrCells.reduce((s, c) => s + (c.cellVolume_m3 || 0), 0), 3) : "—"} <span className="text-sm">м³</span>
            </div>
            <div className="text-xs text-muted-foreground">Сумма объёмов ячеек из карты</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Фактический объём</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {results ? fmt(results.totals.totalFact, 3) : "—"} <span className="text-sm">м³</span>
            </div>
            <div className="text-xs text-muted-foreground">Остатки × объём/шт</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Заполняемость</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{results ? fmtPct(results.totals.fillPctTotal) : "—"}</div>
            <div className="text-xs text-muted-foreground">% от общей вместимости</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Переполнение</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {results ? fmt(results.totals.totalOverflow, 3) : "—"} <span className="text-sm">м³</span>
            </div>
            <div className="text-xs text-muted-foreground">Если факт &gt; вместимости</div>
          </CardContent>
        </Card>
      </div>

      {/* Диагностика + спойлер со SKU без объёма */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Диагностика данных
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm">
          <div className="flex gap-6 flex-wrap">
            <div>SKU без объёма (pcs_cbm ≤ 0): <b>{fmt0(missingVolume)}</b></div>
            <div>SKU без категории: <b>{fmt0(missingCategory)}</b></div>
            <div>Загружено позиций по остаткам: <b>{fmt0(invRows?.length || 0)}</b></div>
          </div>

          {results && results.skuRows.some(r => !r.pcs_cbm || r.pcs_cbm <= 0) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground text-sm">Показать список SKU без объёма</summary>
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Остаток, шт</TableHead>
                      <TableHead>Категория</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.skuRows
                      .filter(r => !r.pcs_cbm || r.pcs_cbm <= 0)
                      .slice(0, 300)
                      .map(r => (
                        <TableRow key={r.sku}>
                          <TableCell className="font-medium">{r.sku}</TableCell>
                          <TableCell className="text-right">{fmt0(r.qty_pcs)}</TableCell>
                          <TableCell>{r.category}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Фильтры категорий */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Input
            placeholder="Поиск по категории…"
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            className="w-[240px]"
          />
        </div>
        <label className="text-sm flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Скрывать нулевые строки
        </label>
        <label className="text-sm flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hideUncat} onChange={(e) => setHideUncat(e.target.checked)} />
          Скрывать Uncategorized
        </label>
        <Button
  size="sm"
  variant="outline"
  onClick={() => {
    const idx = SORT_ORDER.indexOf(catSort.key);
    const nextKey = SORT_ORDER[(idx + 1) % SORT_ORDER.length];
    const defaultDir: 1 | -1 = nextKey === "category" ? 1 : -1; // текст по возр., числа по убыв.
    setCatSort({ key: nextKey, dir: defaultDir });
  }}
  className="ml-auto"
  title="Сменить поле сортировки"
>
  <ArrowUpDown className="w-4 h-4 mr-2" />
  Сортировка: {SORT_LABELS[catSort.key]} {catSort.dir === -1 ? "↓" : "↑"}
</Button>
</div>

      {/* Категории — факт vs вместимость (с прогрессом) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="w-5 h-5" />
            Категории — факт vs вместимость
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground">
                 <th
  className="py-2 cursor-pointer"
  onClick={() => setCatSort({ key: "category", dir: 1 })}
>
  Категория
</th>
<th
  className="py-2 text-right cursor-pointer"
  onClick={() => setCatSort({ key: "volume_cbm", dir: -1 })}
>
  Факт, м³
</th>
<th
  className="py-2 text-right cursor-pointer"
  onClick={() => setCatSort({ key: "capacity_cbm", dir: -1 })}
>
  Вместимость, м³
</th>
<th
  className="py-2 text-right cursor-pointer"
  onClick={() => setCatSort({ key: "fill_pct", dir: -1 })}
>
  % заполн.
</th>
<th
  className="py-2 text-right cursor-pointer"
  onClick={() => setCatSort({ key: "overflow_cbm", dir: -1 })}
>
  Переполн., м³
</th> 
                </tr>
              </thead>
              <tbody>
                {visibleCats.map((r) => (
                  <tr key={r.category} className="border-t align-top">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span>{r.category}</span>
                        {r.overflow_cbm > 0 && (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-rose-50 text-rose-600 border border-rose-200">
                            OVERFLOW
                          </span>
                        )}
                      </div>
                      <div className="mt-2 w-56"><ProgressBar value={r.fill_pct ?? 0} /></div>
                    </td>
                    <td className="py-2 text-right">{fmt(r.volume_cbm)}</td>
                    <td className="py-2 text-right">{fmt(r.capacity_cbm)}</td>
                    <td className="py-2 text-right">{r.fill_pct == null ? "—" : fmtPct(r.fill_pct)}</td>
                    <td className={`py-2 text-right ${r.overflow_cbm > 0 ? "text-rose-600 font-semibold" : ""}`}>
                      {fmt(r.overflow_cbm)}
                    </td>
                  </tr>
                ))}
                {!results && (
                  <tr><td colSpan={5} className="text-center text-muted-foreground py-4">Загрузите CSV остатков</td></tr>
                )}
                {results && visibleCats.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted-foreground py-4">Нет строк по текущим фильтрам</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={exportCat}><Download className="w-4 h-4 mr-2" />Экспорт (категории)</Button>
          </div>
        </CardContent>
      </Card>

      {/* По ролям */}
      <Card>
        <CardHeader><CardTitle>Распределение по ролям</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Роль</th>
                  <th className="py-2 text-right">Объём, м³</th>
                  <th className="py-2 text-right">% от общей вмест.</th>
                </tr>
              </thead>
              <tbody>
                {results?.roleSummaries.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2">{String(r.role)}</td>
                    <td className="py-2 text-right">{fmt(r.allocated_cbm)}</td>
                    <td className="py-2 text-right">{fmtPct(r.pct_of_total_capacity)}</td>
                  </tr>
                ))}
                {!results && (
                  <tr><td colSpan={3} className="text-center text-muted-foreground py-4">Загрузите CSV остатков</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={exportRole}><Download className="w-4 h-4 mr-2" />Экспорт (по ролям)</Button>
          </div>
        </CardContent>
      </Card>

      {/* Топ SKU (под спойлером) */}
      <Card>
  <CardHeader>
    <CardTitle>Топ SKU по объёму</CardTitle>
  </CardHeader>
  <CardContent>
    <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">
        Показать топ SKU (до 100 позиций)
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">SKU</th>
              <th className="py-2 text-right">Остаток, шт</th>
              <th className="py-2 text-right">Объём/шт, м³</th>
              {/* больше правый padding у числовой колонки */}
              <th className="py-2 text-right pr-8">Объём итого, м³</th>
              {/* левый отступ + тонкий разделитель у «Категория» */}
              <th className="py-2 pl-6 border-l border-muted/40">Категория</th>
            </tr>
          </thead>
          <tbody>
            {results?.skuRows
              ?.slice()
              .sort((a, b) => b.volume_cbm - a.volume_cbm)
              .slice(0, 100)
              .map((r) => (
                <tr key={r.sku} className="border-t">
                  <td className="py-2">{r.sku}</td>
                  <td className="py-2 text-right">{fmt0(r.qty_pcs)}</td>
                  <td className="py-2 text-right">{fmt(r.pcs_cbm || 0)}</td>
                  {/* такой же увеличенный отступ, как в шапке */}
                  <td className="py-2 text-right pr-8">{fmt(r.volume_cbm)}</td>
                  {/* отступ слева + вертикальный разделитель; не переносим короткие названия */}
                  <td className="py-2 pl-6 border-l border-muted/40 whitespace-nowrap">
                    {r.category}
                  </td>
                </tr>
              ))}

            {!results && (
              <tr>
                <td colSpan={5} className="text-center text-muted-foreground py-4">
                  Загрузите CSV остатков
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={exportSku}>
          <Download className="w-4 h-4 mr-2" />
          Экспорт (SKU)
        </Button>
      </div>
    </details>
  </CardContent>
</Card>
</div>
);
} 

/* ========= ПРОГНОЗ (как в рабочей вкладке) ========= */
function ForecastTab() {
  // 1) Стабильные дефолты для SSR — без чтения снапшота
  const [capacityM3, setCapacityM3]       = useState<number>(422.784);
  const [capacityCells, setCapacityCells] = useState<number>(1064);
  const [startStockM3, setStartStockM3]   = useState<number>(127.6);

  // 2) После монтирования подтянем снапшот и подписку на обновления из калькулятора
  useEffect(() => {
    try {
      const snap = readForForecast();
      if (snap?.totals) {
        setStartStockM3(prev => snap.totals.totalFact ?? prev);
        setCapacityM3(prev => snap.totals.totalCapacity ?? prev);
      }
    } catch {}
  }, []);
  useEffect(() => {
    const off = onCalcSaved((payload: any) => {
      if (!payload?.totals) return;
      setStartStockM3(prev => payload.totals.totalFact ?? prev);
      setCapacityM3(prev => payload.totals.totalCapacity ?? prev);
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  // 3) Прочие параметры прогноза
  const [horizon, setHorizon] = useState(24);
  const [protectMonths, setProtectMonths] = useState(3);
  const [growthYoY, setGrowthYoY] = useState(0.15);
  const [sellThru, setSellThru] = useState(0.08);
  const [coefSS, setCoefSS] = useState(1.10);
  const [coefFW, setCoefFW] = useState(0.95);
  const [avgNewSkuM3, setAvgNewSkuM3] = useState(0.065);
  const [cellTurnoverEfficiency, setCellTurnoverEfficiency] = useState(0.05);

  const [hist, setHist] = useState({
    sellThru: 0.08, coefSS: 1.10, coefFW: 1.0, shareNew: 0.25, growthYoY: 0.0
  });
  const [useCalib, setUseCalib] = useState(true);
  const [smoothing, setSmoothing] = useState(0.7);

  // 4) Гидрационно-безопасные базовый год/месяц:
  // SSR рендерим 1970/0, на клиенте обновляем фактическим временем.
  const [baseYear,  setBaseYear]  = useState(1970);
  const [baseMonth, setBaseMonth] = useState(0);
  useEffect(() => {
    const now = new Date();
    setBaseYear(now.getFullYear());
    setBaseMonth(now.getMonth());
  }, []);

  // 5) Волны: безопасные дефолты, затем корректируем год после инициализации baseYear
  const [waves, setWaves] = useState([
    { label: "FW25", season: "FW" as const, year: 1970,     monthIdx: 8, base: 80, shareNew: 0.30 },
    { label: "SS26", season: "SS" as const, year: 1970 + 1, monthIdx: 2, base: 70, shareNew: 0.25 },
  ]);
  useEffect(() => {
    setWaves(ws => ws.map((w, i) => ({ ...w, year: i === 0 ? baseYear : baseYear + 1 })));
  }, [baseYear]);

  // CRUD по волнам
  const addWave = () =>
    setWaves(w => [...w, { label: "NEW", season: "FW", year: baseYear, monthIdx: baseMonth, base: 50, shareNew: 0.25 }]);
  const updWave = (i: number, p: Partial<typeof waves[number]>) =>
    setWaves(w => w.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const delWave = (i: number) =>
    setWaves(w => w.filter((_, idx) => idx !== i));

  // 6) Файлы для калибровки + обработчик (CSV/XLSX)
  const [salesFile, setSalesFile]   = useState<File | null>(null);
  const [movesFile, setMovesFile]   = useState<File | null>(null);
  const [volumeFile, setVolumeFile] = useState<File | null>(null);

  const parseCSV = (text: string) =>
    Papa.parse(text, { header: true, skipEmptyLines: true }).data as any[];

  const handleCalibration = React.useCallback(async () => {
    if (!salesFile || !movesFile || !volumeFile) {
      alert("Пожалуйста, выбери все три файла (Продажи, Движения, Справочник объёмов).");
      return;
    }
    try {
      const salesData = parseCSV(await salesFile.text());
      const movesData = parseCSV(await movesFile.text());

      // справочник объёмов
      let volumeRows: Record<string, any>[] = [];
      if (volumeFile.name.toLowerCase().endsWith(".xlsx")) {
        const data = new Uint8Array(await volumeFile.arrayBuffer());
        const XLSX: any = await import("xlsx");
        const wb = XLSX.read(data, { type: "array" });
        volumeRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      } else {
        volumeRows = parseCSV(await volumeFile.text());
      }

      const volumeMap = new Map<string, number>();
      volumeRows.forEach(r => {
        const sku =
          r["SKU"] || r["Код"] || r["Код товара"] || r["Код товара (SKU)"] || r["Артикул"];
        const vol =
          toNum(r["PCS Volume, CBM"]) ||
          toNum(r["PCS CBM"]) ||
          toNum(r["PCS_CBM"]) ||
          toNum(r["PCS CBM, м3"]);
        if (sku && vol > 0) volumeMap.set(String(sku).trim(), vol);
      });

      const totalOpeningVolume = movesData.reduce(
        (sum, r) => sum + (toNum(r["На открытие"]) * (volumeMap.get(String(r["Код"]).trim()) || 0)),
        0
      );

      const monthlySalesVolume = new Map<string, number>();
      salesData.forEach(r => {
        const ds = r["Дата"];
        if (!ds || typeof ds !== "string") return;
        const [dd, mm, yyyy] = ds.split(".");
        if (!yyyy) return;
        const ym = `${Number(yyyy)}-${String(Number(mm)).padStart(2, "0")}`;
        const sku = String(r["Код"]).trim();
        const vol = toNum(r["Кол-во"]) * (volumeMap.get(sku) || 0);
        monthlySalesVolume.set(ym, (monthlySalesVolume.get(ym) || 0) + vol);
      });

      const monthsVals = Array.from(monthlySalesVolume.values());
      if (!monthsVals.length) {
        alert("В файле продаж не найдено данных для объёмов.");
        return;
      }
      const avgMonthlySalesVol = monthsVals.reduce((a,b)=>a+b,0) / monthsVals.length;
      const calculatedSellThru =
        totalOpeningVolume > 0 ? avgMonthlySalesVol / totalOpeningVolume : 0.08;

      const ss: number[] = [], fw: number[] = [];
      for (const [ym, vol] of monthlySalesVolume.entries()) {
        const m = parseInt(ym.split("-")[1], 10); // 1..12
        (m >= 4 && m <= 9 ? ss : fw).push(vol);
      }
      const avgSs = ss.length ? ss.reduce((a,b)=>a+b,0)/ss.length : avgMonthlySalesVol;
      const avgFw = fw.length ? fw.reduce((a,b)=>a+b,0)/fw.length : avgMonthlySalesVol;

      const calculatedCoefSS = avgMonthlySalesVol > 0 ? (avgSs / avgMonthlySalesVol) : 1;
      const calculatedCoefFW = avgMonthlySalesVol > 0 ? (avgFw / avgMonthlySalesVol) : 1;

      const newSkuArrivals = movesData
        .filter(r => toNum(r["На открытие"]) === 0 && toNum(r["Приход"]) > 0)
        .reduce((s, r) => s + toNum(r["Приход"]), 0);
      const totalArrivals = movesData.reduce((s, r) => s + toNum(r["Приход"]), 0);
      const calculatedShareNew = totalArrivals > 0 ? newSkuArrivals / totalArrivals : 0.25;

      setHist({
        sellThru: calculatedSellThru,
        coefSS: calculatedCoefSS,
        coefFW: calculatedCoefFW,
        shareNew: calculatedShareNew,
        growthYoY: 0.0
      });
      alert("Калибровка по объёму завершена.");
    } catch (e) {
      console.error(e);
      alert("Ошибка калибровки. Проверь форматы файлов.");
    }
  }, [salesFile, movesFile, volumeFile]);

  // 7) Месячная шкала
  const months = useMemo(() => {
    const out: { ym: string; y: number; m: number; label: string }[] = [];
    let y = baseYear, m = baseMonth;
    for (let i = 0; i < horizon; i++) {
      out.push({ ym: ymKey(y, m), y, m, label: monthName(m) });
      m++; if (m >= 12) { m = 0; y++; }
    }
    return out;
  }, [horizon, baseYear, baseMonth]);

  // 8) Симуляция
  const sim = useMemo(() => {
    try {
      const alpha        = useCalib ? clamp(smoothing, 0, 1) : 0;
      const sellThruEff  = (1 - alpha) * sellThru + alpha * hist.sellThru;
      const coefSSEff    = (1 - alpha) * coefSS   + alpha * hist.coefSS;
      const coefFWEff    = (1 - alpha) * coefFW   + alpha * hist.coefFW;
      const growthYoYEff = (1 - alpha) * growthYoY + alpha * hist.growthYoY;

      const rows: any[] = [];
      const monthlyGrowth = Math.pow(1 + growthYoYEff, 1 / 12) - 1;

      let stockM3 = startStockM3;
      let activeSkusCount =
        startStockM3 >= capacityM3
          ? capacityCells
          : Math.round(capacityCells * (startStockM3 / Math.max(0.0001, capacityM3)));

      const prot = Math.max(0, Math.floor(protectMonths));
      const protectedQueue: number[] = Array(prot).fill(0);

      let first80: string | null = null, first100: string | null = null;

      for (let i = 0; i < months.length; i++) {
        const { ym, y, m } = months[i];
        const w = waves.filter(w => w.year === y && w.monthIdx === m);
        const growth = Math.pow(1 + monthlyGrowth, i);

        const arrivalsM3 = w.reduce((a, b) => a + b.base * growth, 0);
        const seasonK = (m >= 3 && m <= 8) ? coefSSEff : coefFWEff;

        const stockBeforeSales = stockM3 + arrivalsM3;
        const salesM3 = stockBeforeSales * sellThruEff * seasonK;

        const newShare = w.length ? w.reduce((a, b) => a + b.shareNew, 0) / w.length : hist.shareNew;
        const newSkus = Math.round(arrivalsM3 * newShare / Math.max(0.0001, avgNewSkuM3));
        activeSkusCount += newSkus;

        const percentOfStockSold = stockBeforeSales > 0 ? salesM3 / stockBeforeSales : 0;
        const skusToClear = activeSkusCount * percentOfStockSold * cellTurnoverEfficiency;

        const protectedNow = protectedQueue.shift() || 0;
        const closedSkus = Math.max(0, Math.round(skusToClear - protectedNow));
        activeSkusCount = Math.max(0, activeSkusCount - closedSkus);
        protectedQueue.push(newSkus);

        stockM3 = Math.max(0, stockBeforeSales - salesM3);

        const pctM3    = (stockM3 / Math.max(0.0001, capacityM3)) * 100;
        const pctCells = (activeSkusCount / Math.max(0.0001, capacityCells)) * 100;

        if (!first80  && (pctM3 >= 80  || pctCells >= 80 )) first80  = ym;
        if (!first100 && (pctM3 >= 100 || pctCells >= 100)) first100 = ym;

        rows.push({
          ym, label: monthName(m),
          arrivals: arrivalsM3, sales: salesM3, stock: stockM3,
          newSkus, active: activeSkusCount,
          pctM3, pctCells,
          waveLabel: w.map(x => x.label).join(" + "),
        });
      }
      return { rows, first80, first100 };
    } catch (error) {
      console.error("Simulation failed:", error);
      return { rows: [], first80: "Error", first100: "Error" };
    }
  }, [
    months, waves, protectMonths, cellTurnoverEfficiency,
    growthYoY, sellThru, coefSS, coefFW, avgNewSkuM3,
    capacityM3, capacityCells, startStockM3, useCalib, smoothing, hist
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Исходные данные и калибровка</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Вместимость (м³)</span><span className="font-medium">{capacityM3.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Вместимость (ячейки)</span><span className="font-medium">{capacityCells}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Стартовый остаток (м³)</span><span className="font-medium">{pretty(startStockM3)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Горизонт (мес.)</span><Input className="h-9 w-24 text-right" type="number" min={6} max={36} value={horizon} onChange={e => setHorizon(toNum(e.target.value, 24))} /></div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-2">
              <Label htmlFor="sales-file" className="flex items-center gap-1">Продажи <InfoTip>Колонки: 'Дата', 'Код'(SKU), 'Кол-во'.</InfoTip></Label>
              <Input id="sales-file" type="file" accept=".csv" onChange={(e) => setSalesFile(e.target.files?.[0] || null)} />
              <Label htmlFor="moves-file" className="flex items-center gap-1">Движения <InfoTip>'Код'(SKU), 'На открытие', 'Приход'.</InfoTip></Label>
              <Input id="moves-file" type="file" accept=".csv" onChange={(e) => setMovesFile(e.target.files?.[0] || null)} />
              <Label htmlFor="volume-file" className="flex items-center gap-1">Справочник объёмов <InfoTip>'SKU', 'PCS Volume, CBM'. XLSX/CSV.</InfoTip></Label>
              <Input id="volume-file" type="file" accept=".csv,.xlsx" onChange={(e) => setVolumeFile(e.target.files?.[0] || null)} />
            </div>
            <div className="pt-2"><Button onClick={handleCalibration}>Рассчитать калибровку по объёму</Button></div>
            <div className="flex justify-between items-center pt-2">
              <div className="flex items-center gap-2">
                <Switch id="use-calib-switch" checked={useCalib} onCheckedChange={setUseCalib} />
                <Label htmlFor="use-calib-switch" className="flex items-center gap-1 cursor-pointer">Использовать калибровку<InfoTip>Смешиваем ручные параметры с оценками из CSV по весу α.</InfoTip></Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="smoothing-input" className="text-muted-foreground text-xs">Вес (α)</Label>
                <div className="relative w-24">
                  <Input id="smoothing-input" className="h-9 w-full text-right pr-7" type="number" value={Math.round(smoothing*100)} onChange={e => setSmoothing(clamp(toNum(e.target.value, 0)/100, 0, 1))} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground p-2 bg-muted rounded-md">
              <b>Оценки из истории:</b> sell-thru ≈ {(hist.sellThru * 100).toFixed(1)}%, SS ≈ {hist.coefSS.toFixed(2)}, FW ≈ {hist.coefFW.toFixed(2)}, новые SKU ≈ {(hist.shareNew * 100).toFixed(0)}%
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Волны поставок</CardTitle>
          <Button size="sm" onClick={addWave}><PlusCircle className="w-4 h-4 mr-2" />Добавить волну</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 font-normal pr-3">Метка</th>
                <th className="py-2 font-normal px-3">Сезон</th>
                <th className="py-2 font-normal px-3">Год</th>
                <th className="py-2 font-normal px-3">Месяц</th>
                <th className="py-2 font-normal px-3 text-right">Объём, м³</th>
                <th className="py-2 font-normal pl-3 text-right">Новые SKU, %</th>
                <th className="py-2 font-normal w-12"></th>
              </tr>
            </thead>
            <tbody>
                {waves.map((w, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-3">
                      <Input
                        className="h-9 w-28"
                        value={w.label}
                        onChange={e => updWave(i, { label: e.target.value })}
                      />
                    </td>
                    <td className="p-3">
                      <select
                        className="border rounded px-2 h-9 w-full"
                        value={w.season}
                        onChange={e => updWave(i, { season: e.target.value as any })}
                      >
                        <option value="FW">FW</option>
                        <option value="SS">SS</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <Input
                        className="h-9 w-24"
                        type="number"
                        value={w.year}
                        onChange={e => updWave(i, { year: toNum(e.target.value, w.year) })}
                      />
                    </td>
                    <td className="p-3">
                      <select
                        className="border rounded px-2 h-9 w-full"
                        value={w.monthIdx}
                        onChange={e => updWave(i, { monthIdx: toNum(e.target.value, w.monthIdx) })}
                      >
                        {MONTHS_RU.map((m, idx) => (
                          <option key={idx} value={idx}>{m}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-right">
                      <Input
                        className="h-9 w-28 text-right"
                        type="number"
                        step={1}
                        value={w.base}
                        onChange={e => updWave(i, { base: toNum(e.target.value, 0) })}
                      />
                    </td>
                    <td className="p-3 text-right">
                      <div className="relative">
                        <Input
                          className="h-9 w-28 text-right pr-7"
                          type="number"
                          step={1}
                          min={0}
                          max={100}
                          value={Math.round(w.shareNew * 100)}
                          onChange={e => {
                            const pct = clamp(Math.round(toNum(e.target.value, 0)), 0, 100);
                            updWave(i, { shareNew: pct / 100 });
                          }}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                      </div>
                    </td>
                    <td className="text-right pl-3">
                      <Button size="icon" variant="ghost" onClick={() => delWave(i)}>
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Параметры прогноза */}
      <Card>
        <CardHeader><CardTitle>Параметры прогноза</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          <div className="space-y-4">
            <div className="text-sm font-medium">Ключевые параметры</div>

            <div className="space-y-2">
              <Label>Рост год к году <InfoTip>Годовой рост входящих поставок, конвертируется в ежемесячный темп.</InfoTip></Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[Math.round(growthYoY * 100)]}
                  onValueChange={v => setGrowthYoY(clamp((v[0] ?? 0) / 100, -0.5, 1))}
                  min={-50} max={100} step={1}
                />
                <div className="relative w-24">
                  <Input
                    className="h-9 w-full text-right pr-7"
                    type="number"
                    value={Math.round(growthYoY * 100)}
                    onChange={e => setGrowthYoY(clamp(toNum(e.target.value, 0) / 100, -0.5, 1))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Базовая уходимость / мес <InfoTip>Доля текущего запаса, продающаяся в месяц (до сезонных коэфф.).</InfoTip></Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[Math.round(sellThru * 100)]}
                  onValueChange={v => setSellThru(clamp((v[0] ?? 0) / 100, 0.01, 0.4))}
                  min={1} max={40} step={1}
                />
                <div className="relative w-24">
                  <Input
                    className="h-9 w-full text-right pr-7"
                    type="number"
                    value={Math.round(sellThru * 100)}
                    onChange={e => setSellThru(clamp(toNum(e.target.value, 8) / 100, 0.01, 0.4))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Эффективность освобождения ячеек <InfoTip>Какая доля проданного объёма приводит к закрытию ячеек.</InfoTip></Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[Math.round(cellTurnoverEfficiency * 100)]}
                  onValueChange={v => setCellTurnoverEfficiency(clamp((v[0] ?? 0) / 100, 0, 1))}
                  min={0} max={100} step={1}
                />
                <div className="relative w-24">
                  <Input
                    className="h-9 w-full text-right pr-7"
                    type="number"
                    value={Math.round(cellTurnoverEfficiency * 100)}
                    onChange={e => setCellTurnoverEfficiency(clamp(toNum(e.target.value, 5) / 100, 0, 1))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-sm font-medium">Дополнительные настройки</div>

            <div className="grid grid-cols-[1fr,auto] items-center gap-x-4 gap-y-2">
              <label className="text-sm">Защита новых от закрытий (мес)</label>
              <Input
                className="h-9 w-24 text-right"
                type="number"
                step={1}
                min={0}
                max={12}
                value={protectMonths}
                onChange={e => setProtectMonths(clamp(toNum(e.target.value, 3), 0, 12))}
              />

              <label className="text-sm">Коэфф. продаж SS (апр–сен)</label>
              <Input
                className="h-9 w-24 text-right"
                type="number"
                step={0.01}
                value={coefSS}
                onChange={e => setCoefSS(toNum(e.target.value, 1))}
              />

              <label className="text-sm">Коэфф. продаж FW (окт–мар)</label>
              <Input
                className="h-9 w-24 text-right"
                type="number"
                step={0.01}
                value={coefFW}
                onChange={e => setCoefFW(toNum(e.target.value, 1))}
              />

              <label className="text-sm">Средний объём НОВОГО SKU (м³)</label>
              <Input
                className="h-9 w-24 text-right"
                type="number"
                step={0.001}
                min={0.001}
                value={avgNewSkuM3}
                onChange={e => setAvgNewSkuM3(Math.max(0.001, toNum(e.target.value, 0.065)))}
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              <div className="flex items-center gap-2">
                <Switch id="use-calib-switch" checked={useCalib} onCheckedChange={setUseCalib} />
                <Label htmlFor="use-calib-switch" className="flex items-center gap-1 cursor-pointer">
                  Использовать калибровку
                  <InfoTip>Смешиваем ручные параметры с оценками из CSV по весу α.</InfoTip>
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="smoothing-input" className="text-muted-foreground text-xs">Вес (α)</Label>
                <div className="relative w-24">
                  <Input
                    id="smoothing-input"
                    className="h-9 w-full text-right pr-7"
                    type="number"
                    value={Math.round(smoothing * 100)}
                    onChange={e => setSmoothing(clamp(toNum(e.target.value, 70) / 100, 0, 1))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground p-2 bg-muted rounded-md">
              <b>Оценки из истории:</b>{" "}
              sell-thru ≈ {(hist.sellThru * 100).toFixed(1)}%, SS ≈ {hist.coefSS.toFixed(2)}, FW ≈ {hist.coefFW.toFixed(2)}, новые SKU ≈ {(hist.shareNew * 100).toFixed(0)}%
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Прогноз: график + таблица + экспорт */}
      <Card>
        <CardHeader><CardTitle>Прогноз загрузки (до {horizon} мес.)</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={sim.rows} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[0, (dataMax: number) => Math.max(120, dataMax)]} />
                <ReTooltip
                  formatter={(v: any) => `${Number(v).toFixed(1)}%`}
                  labelFormatter={(l: any, p: any) => (p && p[0] && p[0].payload) ? p[0].payload.ym : l}
                />
                <Legend />
                <ReferenceLine y={80} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: "80%", position: "insideTopRight" }} />
                <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "100%", position: "insideTopRight" }} />
                <Line type="monotone" dataKey="pctM3" name="% по м³" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="pctCells" name="% по ячейкам" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="text-sm mt-4">
            Прогноз: первое превышение 80% в <b>{sim.first80 || "—"}</b>, превышение 100% в <b>{sim.first100 || "—"}</b>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">Показать таблицу помесячно</summary>
            <div className="mt-3 overflow-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1">Месяц</th>
                    <th>Метки</th>
                    <th>Поступило (м³)</th>
                    <th>Продажи (м³)</th>
                    <th>Остаток на конец (м³)</th>
                    <th>Новые SKU</th>
                    <th>Активных SKU</th>
                    <th>% по м³</th>
                    <th>% по ячейкам</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.rows.map((r: any) => (
                    <tr key={r.ym} className="border-b">
                      <td className="py-1">{r.ym}</td>
                      <td>{r.waveLabel}</td>
                      <td>{r.arrivals.toFixed(1)}</td>
                      <td>{r.sales.toFixed(1)}</td>
                      <td>{r.stock.toFixed(1)}</td>
                      <td>{r.newSkus}</td>
                      <td>{Math.round(r.active)}</td>
                      <td>{r.pctM3.toFixed(1)}%</td>
                      <td>{r.pctCells.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="mt-4">
            <Button variant="secondary" onClick={() => downloadCSV("forecast.csv", sim.rows)}>
              <Download className="w-4 h-4 mr-2" />
              Экспорт CSV
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
