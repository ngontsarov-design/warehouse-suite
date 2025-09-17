"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Calculator as CalcIcon,
  TrendingUp,
  Download,
  PackageSearch,
  Bug,
  FolderCog,
  HelpCircle,
  Database,
  Cog,
  Info,
  PlusCircle,
  Trash2,
} from "lucide-react";

import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer,
  ReferenceLine, Legend, CartesianGrid
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";

/* ============================== типы ============================== */
type Role = "pick" | "overstock" | "attic";
type Tab = "calc" | "forecast" | "settings";
type Notice = { text: string; kind: "success" | "error" };

interface CellRow { cellId: string; zone?: string; cellVolume_m3: number }
interface MetaRow { cellId: string; role: Role; allowedCategories?: string; priority?: number }

interface RefRow {
  sku: string;
  name?: string;
  category?: string;
  pcs_per_mc?: number;
  pcs_volume_cbm?: number;
  mc_volume_cbm?: number;
  mc_len_cm?: number;
  mc_w_cm?: number;
  mc_d_cm?: number;
}

interface SkuRow {
  sku: string;
  name?: string;
  qty: number;
  category: string;
  pcsPerMc: number;
  pcsCbm?: number;
  mcCbm?: number;
}

/* ============================== хелперы ============================== */
const clamp = (x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const pretty = (x:number)=> (Math.round((x||0)*10)/10).toLocaleString("ru-RU");
const toNum = (v:any, def=0) => {
  if (v==null || v==="") return def;
  const s = String(v).replace(/\s+/g,"").replace(",",".");
  const n = Number(s);
  return Number.isFinite(n)? n : def;
};

function downloadCSV(name:string, rows:any[]){
  if(!rows.length) return;
  const header = Object.keys(rows[0]);
  const esc = (v:any)=> {
    const s=String(v??"");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const csv = [header.join(",")]
    .concat(rows.map(r=>header.map(h=>esc(r[h])).join(",")))
    .join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(text:string){
  const raw=(text??"").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  if(!raw.trim()) return [];
  const first = raw.split("\n",1)[0];
  const delims=[",",";","\t"];
  const score=(d:string)=>{let c=0,iq=false;
    for(let i=0;i<first.length;i++){
      const ch=first[i];
      if(ch==='"'){ if(iq && first[i+1]==='"'){i++;continue} iq=!iq; }
      else if(!iq && ch===d) c++;
    } return c;
  };
  const delim = delims.reduce((b,d)=> score(d)>score(b)?d:b, ",");
  const split=(line:string)=>{const out:string[]=[]; let cur="",iq=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){ if(iq && line[i+1]==='"'){cur+='"'; i++; continue} iq=!iq; }
      else if(!iq && ch===delim){ out.push(cur); cur=""; }
      else cur+=ch;
    } out.push(cur); return out;
  };
  const lines = raw.split("\n");
  const headers = split(lines[0]).map(s=>s.trim());
  const rows:Record<string,string>[]=[];
  for(let li=1; li<lines.length; li++){
    const l=lines[li]; if(!l.trim()) continue;
    const cells=split(l);
    const r:Record<string,string>={};
    for(let i=0;i<headers.length;i++) r[headers[i]] = (cells[i]??"").trim();
    rows.push(r);
  }
  return rows;
}

function signalDataUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ws-data-updated"));
  }
}

/* ============================== storage ============================== */
const store = {
  set(k:string,v:any){ if(typeof window==="undefined") return; localStorage.setItem(k, JSON.stringify({v,t:Date.now()})); },
  get<T=any>(k:string, def:T){ try{
    const raw = typeof window!=="undefined" ? localStorage.getItem(k) : null;
    if(!raw) return def; const o=JSON.parse(raw); return (o?.v ?? def) as T;
  }catch{return def;} },
  clear(k:string){ if(typeof window==="undefined") return; localStorage.removeItem(k); }
};
const K = {
  REF:"ws_ref_v1",
  CELLS:"ws_cells_v1",
  META:"ws_meta_v1",
  MAP:"ws_map_v1",
  INV:"ws_inventory_v1",
  FORECAST_BRIDGE: "forecast_bridge_v3"
};

/* ============================== категории ============================== */
type CanonCat =
 | "Ботинки" | "Сапоги" | "Вейдерсы" | "Кроссовки" | "Куртки" | "Комбинезоны"
 | "Брюки" | "Костюмы" | "Термоодежда" | "Жилеты" | "Футболки и рубашки"
 | "Перчатки" | "Головные уборы" | "Аксессуары" | "Рюкзаки" | "Сумки и чехлы"
 | "Носки" | "Худи" | "Торговое оборудование" | "Каталоги" | "Uncategorized";

const catMap: Array<[CanonCat, RegExp[]]> = [
  ["Ботинки",      [/ботин/i, /boot/i, /tactic/i, /track/i]],
  ["Сапоги",       [/сапог/i, /welling/i]],
  ["Вейдерсы",     [/вейдер/i, /заброд/i, /wader/i]],
  ["Кроссовки",    [/кросс|sneak|shoe/i]],
  ["Куртки",       [/куртк|jacket/i]],
  ["Комбинезоны",  [/комбинез|overall/i]],
  ["Брюки",        [/брюки|pants|штаны/i]],
  ["Костюмы",      [/костюм|suit/i]],
  ["Термоодежда",  [/термо|thermal|флис|fleece/i]],
  ["Жилеты",        [/жилет|vest/i]],
  ["Футболки и рубашки", [/футболк|t-shirt|рубашк|shirt|поло/i]],
  ["Перчатки",     [/перчат|glove|варежки|mitten/i]],
  ["Головные уборы",[/шапк|beanie|hat|кепк|cap|балаклав|balaclava/i]],
  ["Рюкзаки",      [/рюкзак|backpack/i]],
  ["Сумки и чехлы", [/сумк|bag|гермомешок|чехол|case/i]],
  ["Носки",        [/носки|sock/i]],
  ["Аксессуары",   [/аксесс|access|ремень|belt|подтяж|suspender/i]],
  ["Худи", [/худи|hoodie|hoody|hooded|hood/i]],
    ["Футболки и рубашки", [/футболк|t-?shirt|рубашк|shirt|поло|лонгслив|long\s*sleeve|longsleeve|ls\s*tee/i]],
  ["Худи", [/худи|hoodie|hoody|hooded|hood\b/i]],
  ["Торговое оборудование", [
    /shelf|display|rack|flag|mesh/i,
    /стеллаж|полк|сетк|флаг|стойк|стенд|баннер|плакат|холдер|держател|рамк|кронштейн/i
  ]],
  ["Каталоги", [/каталог|каталоги|catalogue|catalog|brochure|leaflet|буклет/i]],

];

function normalizeCategory(raw?: string, nameHint?: string): CanonCat {
  const s = String(raw ?? "").trim().toLowerCase();
  const aliases: Record<string, CanonCat> = {
     "ботинки":"Ботинки", "сапоги":"Сапоги", "вейдерсы":"Вейдерсы", "кроссовки":"Кроссовки",
  "куртки":"Куртки", "комбинезоны":"Комбинезоны", "брюки":"Брюки", "костюмы":"Костюмы",
  "термоодежда":"Термоодежда", "перчатки":"Перчатки", "головные уборы":"Головные уборы",
  "аксессуары":"Аксессуары", "рюкзаки":"Рюкзаки", "носки":"Носки",
  "худи":"Худи", "кофта":"Худи"
  };
  if (aliases[s]) return aliases[s];
  for (const [canon, regs] of catMap) { if (regs.some(rx => rx.test(s))) return canon; }
  if (nameHint) for (const [canon, regs] of catMap) { if (regs.some(rx => rx.test(nameHint))) return canon; }
  return "Uncategorized";
}

/* ============================== тултип ============================== */
function InfoTip({children}:{children:React.ReactNode}){
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground cursor-help">
          <HelpCircle className="w-4 h-4"/>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/* ============================== санитайзер объёмов ============================== */
function resolveVolumes(ref?: RefRow){
  const pcsPerMc = Math.max(1, Number(ref?.pcs_per_mc || 1));
  let pcsCbm = ref?.pcs_volume_cbm != null ? toNum(ref?.pcs_volume_cbm, undefined as any) : undefined;
  let mcCbm  = ref?.mc_volume_cbm  != null ? toNum(ref?.mc_volume_cbm,  undefined as any) : undefined;
  const L = toNum(ref?.mc_len_cm,0), W = toNum(ref?.mc_w_cm,0), D = toNum(ref?.mc_d_cm,0);
  const byDims = (L>0 && W>0 && D>0) ? (L/100)*(W/100)*(D/100) : undefined;
  let mc = mcCbm ?? byDims ?? (pcsCbm && pcsPerMc>0 ? pcsCbm * pcsPerMc : undefined);
  return { pcsPerMc, pcsCbm, mcCbm: mc };
}

/* ============================== ErrorBoundary ============================== */
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:any}>{
  constructor(p:any){ super(p); this.state={error:null}; }
  static getDerivedStateFromError(error:any){ return {error}; }
  componentDidCatch(error:any,info:any){ console.error("UI crash:",error,info); }
  render(){ if(this.state.error){ return (
    <div className="p-4 border border-red-300 rounded bg-red-50 text-sm text-red-700">
      <div className="flex items-center gap-2 mb-2"><Bug className="w-4 h-4"/> Ошибка интерфейса</div>
      <pre className="whitespace-pre-wrap">{String(this.state.error?.message||this.state.error)}</pre>
    </div>
  ); } return this.props.children as any; }
}

/* ============================== главная страница ============================== */
export default function Page(): JSX.Element {
  const [tab, setTab] = useState<Tab>("calc");
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const showNotice = (text: string, kind: Notice["kind"], duration = 3000) => {
    setNotice({ text, kind });
    setTimeout(() => setNotice(null), duration);
  };

  useEffect(() => {
    setHydrated(true);
    const hasMap = store.get(K.MAP, null as any);
    if (!hasMap || typeof hasMap !== "object" || Object.keys(hasMap).length === 0) {
      fetch("/reference_categories.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: any) => {
          if (!data) return;
          const map: Record<string, string> = {};
          if (Array.isArray(data)) {
            data.forEach((r: any) => {
              const sku = String(r?.sku || "").trim();
              const cat = normalizeCategory(String(r?.category || ""));
              if (sku && cat) map[sku] = cat;
            });
          } else {
            Object.entries(data).forEach(([k, v]) => {
              const sku = String(k).trim();
              const cat = normalizeCategory(String(v || ""));
              if (sku && cat) map[sku] = cat;
            });
          }
          if (Object.keys(map).length) store.set(K.MAP, map);
        })
        .catch(() => {});
    }
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-semibold">Finntrail Warehouse Suite</div>
              <div className="text-xs text-muted-foreground">Калькулятор вместимости и прогноз</div>
            </div>
            <div className="flex gap-2">
              <Button variant={tab==="calc"?"default":"secondary"} onClick={()=>setTab("calc")}>
                <CalcIcon className="w-4 h-4 mr-2"/>Калькулятор
              </Button>
              <Button variant={tab==="forecast"?"default":"secondary"} onClick={()=>setTab("forecast")}>
                <TrendingUp className="w-4 h-4 mr-2"/>Прогноз
              </Button>
              <Button variant={tab==="settings"?"default":"secondary"} onClick={()=>setTab("settings")}>
                <FolderCog className="w-4 h-4 mr-2"/>Настройки
              </Button>
            </div>
          </div>

          {tab === "calc" && (hydrated ? <CalculatorTab hydrated showNotice={showNotice} /> : <Card><CardHeader><CardTitle>Загрузка...</CardTitle></CardHeader></Card>)}
          {tab === "forecast" && <ForecastTab showNotice={showNotice} />}
          {tab === "settings" && <SettingsTab showNotice={showNotice} />}

          {notice && (
            <div className={"fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2 rounded-xl shadow-lg " + (notice.kind === "success" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>
              {notice.text}
            </div>
          )}
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}


/* ============================== КАЛЬКУЛЯТОР ============================== */
function CalculatorTab({ hydrated, showNotice }: { hydrated?: boolean, showNotice: (text: string, kind: Notice['kind']) => void }): JSX.Element {
  // стабильные стейты
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [meta, setMeta] = useState<MetaRow[] | null>(null);
  const [referenceRows, setReferenceRows] = useState<RefRow[]>([]);
  const [inventoryRows, setInventoryRows] = useState<any[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  const [bufferPick, setBufferPick] = useState<string>("30");
  const [kCoef, setKCoef] = useState<string>("1.0");

  // читаем из localStorage
  useEffect(() => {
    if (!hydrated) return;
    setReferenceRows(store.get(K.REF, []));
    setCells(store.get(K.CELLS, null));
    setMeta(store.get(K.META, null));
    setCategoryMap(store.get(K.MAP, {}));
    setInventoryRows(store.get(K.INV, []));
  }, [hydrated]);

  // слушаем обновление из Настроек (после загрузки карты/справочника)
  useEffect(() => {
    const onUpd = () => {
      setReferenceRows(store.get(K.REF, []));
      setCells(store.get(K.CELLS, null));
      setMeta(store.get(K.META, null));
      setCategoryMap(store.get(K.MAP, {}));
    };
    window.addEventListener("ws-data-updated", onUpd);
    return () => window.removeEventListener("ws-data-updated", onUpd);
  }, []);

  // сохраняем инвентарь
  useEffect(() => {
    if (!hydrated) return;
    if (inventoryRows) store.set(K.INV, inventoryRows);
  }, [inventoryRows, hydrated]);

  if (!hydrated) return <div />;

  // === Оригинальная, полнофункциональная логика загрузки остатков ===
  const onInventory: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;

    const nrm = (s:string) => String(s||"").replace(/\u00A0/g," ").replace(/\s+/g," ").trim().toLowerCase();
    const toNumSafe = (v:any, def=0) => {
      if (v==null || v==="") return def;
      const n = Number(String(v).replace(/\s+/g,"").replace(",",".")); return Number.isFinite(n) ? n : def;
    };

    const skuKeys = ["sku","код","артикул","код товара","код товара (sku)","код (sku)","product code","item code","item","product","ид товара","vendor code"];
    const qtyKeys = ["available","в наличии","доступно","доступное","остаток","количество","кол-во","qty","stock","on hand","free","остаток, шт","остаток шт","qty available"];
    const nameKeys = ["name","наименование","название","product name","item name"];
    const catKeys  = ["category","категория","группа","раздел"];

    try {
      let rows: Record<string, any>[] = [];

      if (f.name.toLowerCase().endsWith(".xlsx") || /sheet|excel/i.test(f.type)) {
        const data = new Uint8Array(await f.arrayBuffer());
        const XLSX: any = await import("xlsx");
        const wb = XLSX.read(data, { type: "array" });

        const pickSheetName = () => {
          for (const sn of wb.SheetNames) {
            const ws = wb.Sheets[sn];
            const rowsTest = XLSX.utils.sheet_to_json(ws, { defval: "" });
            if (!rowsTest || rowsTest.length === 0) continue;
            const headers = Object.keys(rowsTest[0] ?? {}).map(nrm);
            if (headers.some(h => skuKeys.includes(h)) || headers.some(h => qtyKeys.includes(h))) return sn;
          }
          return wb.SheetNames[0];
        };
        const ws = wb.Sheets[pickSheetName()];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      } else {
        const text = await f.text(); rows = parseCSV(text);
      }

      if (!rows.length) { showNotice("Файл остатков пуст или не распознан.", "error"); return; }

      const headers = Object.keys(rows[0] ?? {});
      const findKey = (keys: string[]) => {
        let k = headers.find(h => keys.includes(nrm(h))); if (k) return k;
        k = headers.find(h => keys.some(kk => nrm(h) === kk || nrm(h).includes(kk)));
        return k || null;
      };

      const skuCol = findKey(skuKeys);
      const qtyCol = findKey(qtyKeys);
      const nameCol = findKey(nameKeys);
      const catCol  = findKey(catKeys);

      if (!skuCol || !qtyCol) { showNotice("Не найдены колонки SKU и/или Количество.", "error"); return; }

      const items = rows.map(r => {
        const sku = String(r[skuCol] ?? "").trim();
        const qty = toNumSafe(r[qtyCol], 0);
        const name = nameCol ? String(r[nameCol] ?? "").trim() : "";
        const invCat = catCol ? String(r[catCol] ?? "").trim() : "";
        return { sku, qty, name, invCat };
      }).filter(r => r.sku);

      if (!items.length) { showNotice("В файле не нашлось строк с SKU.", "error"); return; }

      const mergedMap = new Map<string, {sku:string; qty:number; name?:string; invCat?:string}>();
      for (const it of items) {
        const prev = mergedMap.get(it.sku);
        if (prev) {
          prev.qty += Number(it.qty) || 0;
          if (!prev.name && it.name) prev.name = it.name;
          if (!prev.invCat && it.invCat) prev.invCat = it.invCat;
        } else {
          mergedMap.set(it.sku, { ...it });
        }
      }
      const merged = Array.from(mergedMap.values());

      setInventoryRows(merged as any);
      store.set(K.INV, merged);
      showNotice(`Остатки загружены: ${merged.length.toLocaleString("ru-RU")} SKU.`, "success");
    } catch (err) {
      console.error("Ошибка загрузки остатков:", err);
      showNotice("Не удалось прочитать файл остатков.", "error");
    }
  };

  // ёмкости из карты
  const derived = useMemo(() => {
    if (!cells || !meta) return { caps: { pick: 0, overstock: 0, attic: 0 }, counts: { pick: 0, overstock: 0, attic: 0 } };
    const volById = new Map<string,number>(); cells.forEach(c=> volById.set(c.cellId, Number(c.cellVolume_m3)||0));
    const caps = { pick:0, overstock:0, attic:0 } as Record<Role,number>;
    const counts = { pick:0, overstock:0, attic:0 } as Record<Role,number>;
    meta.forEach(m=>{ const v=volById.get(m.cellId)||0; if(m.role && caps[m.role]!=null) { caps[m.role]+=v; counts[m.role]+=1;} });
    return { caps, counts };
  }, [cells, meta]);

  const countsToShow = useMemo(() => derived.counts, [derived]);
  const capTotal = useMemo(() => (derived.caps.pick + derived.caps.overstock + derived.caps.attic), [derived]);
  
  // индекс справочника
  const refIndex = useMemo(() => {
    const m = new Map<string, RefRow>();
    (referenceRows || []).forEach((r) => {
      const key = String(r?.sku ?? "").trim();
      if (key) m.set(key, r);
    });
    return m;
  }, [referenceRows]);

  // inventory → список SKU
  const skuList: SkuRow[] = useMemo(() => {
    return (inventoryRows || []).map((r: any) => {
      const ref = refIndex.get(String(r.sku));
      const { pcsPerMc, pcsCbm, mcCbm } = resolveVolumes(ref);
      const cat = normalizeCategory(categoryMap[r.sku] || r.invCat || ref?.category, r.name);
      return {
        sku: r.sku, name: r.name, qty: toNum(r.qty), category: cat,
        pcsPerMc: Math.max(1, pcsPerMc || 1), pcsCbm, mcCbm,
      };
    }).filter(r => r.qty > 0);
  }, [inventoryRows, refIndex, categoryMap]);

  // Оригинальная, детальная логика расчётов
  const result = useMemo(() => {
    if (!skuList.length) return null;

    const k = clamp(Number(kCoef) || 1, 0, 1);
    let totalVol = 0;

    const bySku = skuList.map(s => {
      const pcsPer = Math.max(1, s.pcsPerMc || 1);
      const mc = (s.mcCbm ?? 0) || (s.pcsCbm ? s.pcsCbm * pcsPer : 0);
      const pcs = (s.pcsCbm ?? 0) || (mc ? mc / pcsPer : 0);
      const fullBoxes = Math.floor(s.qty / pcsPer);
      const rem = s.qty - fullBoxes * pcsPer;
      const vol = fullBoxes * mc + rem * pcs * k;
      totalVol += vol;
      return { ...s, fullBoxes, rem, volBoxes: vol };
    });

    const byCategory = Array.from(bySku.reduce((acc, r) => {
        const key = r.category || "Uncategorized";
        const entry = acc.get(key) || { cat: key, vol: 0, qty: 0 };
        entry.vol += r.volBoxes;
        entry.qty += r.qty;
        acc.set(key, entry);
        return acc;
    }, new Map<string, { cat: string; vol: number; qty: number }>()).values()).sort((a, b) => b.vol - a.vol);

    const caps = derived.caps;
    const bufPct = clamp(Number(bufferPick) || 0, 0, 100) / 100;
    const capPickEff = caps.pick * (1 - bufPct);

    let rest = totalVol;
    const placePick = Math.min(rest, capPickEff); rest -= placePick;
    const placeOver = Math.min(rest, caps.overstock); rest -= placeOver;
    const placeAttic = Math.min(rest, caps.attic); rest -= placeAttic;
    const overflow = Math.max(0, rest);

    return { bySku, byCategory, totals: { totalVol, placePick, placeOver, placeAttic, overflow } };
  }, [skuList, kCoef, bufferPick, derived.caps]);

  // экспорт
  const exportBySku = () => {
    if (!result) return;
    downloadCSV("by_sku.csv", result.bySku.map(r => ({ sku: r.sku, name: r.name, category: r.category, qty: r.qty, full_boxes: r.fullBoxes, rem_pcs: r.rem, volume_m3: +r.volBoxes.toFixed(3) })));
  };
  const exportByCategory = () => {
    if (!result) return;
    downloadCSV("by_category.csv", result.byCategory.map(c => ({ category: c.cat, volume_m3: +c.vol.toFixed(3), qty: c.qty })));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Файлы и параметры</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <FileStatus hydrated={!!hydrated} label="Карта" ok={!!(cells && cells.length)} sub={`${cells?.length||0} яч.`}/>
            <FileStatus hydrated={!!hydrated} label="Meta" ok={!!(meta && meta.length)} sub={`${meta?.length||0} стр.`}/>
            <FileStatus hydrated={!!hydrated} label="Остатки" ok={inventoryRows.length>0} sub={`${inventoryRows.length} строк`}/>
            <FileStatus hydrated={!!hydrated} label="Справочник" ok={referenceRows.length>0} sub={`${referenceRows.length} стр.`}/>
          </div>
          <div className="space-y-2">
            <label className="text-sm flex items-center gap-2"><PackageSearch className="w-4 h-4"/> Текущий остаток (XLSX/CSV)</label>
            <Input type="file" accept=".xlsx,.csv" onChange={onInventory}/>
          </div>
          <Button
            onClick={() => {
              if(!result){ showNotice("Загрузите данные для расчёта.", "error"); return; }
              localStorage.setItem(K.FORECAST_BRIDGE, JSON.stringify({
                caps: derived.caps, counts: derived.counts,
                start:{ pick: result.totals.placePick, overstock: result.totals.placeOver, attic: result.totals.placeAttic }
              }));
              showNotice("Данные сохранены для прогноза!", "success");
            }}
          >Сохранить для прогноза</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Параметры склада</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground"><Database className="w-4 h-4"/>Ёмкости по ролям (из карты):</div>
          <div className="grid grid-cols-2 gap-1">
            <span>Подбор</span><span className="text-right">{pretty(derived.caps.pick)} м³</span>
            <span>Запас</span><span className="text-right">{pretty(derived.caps.overstock)} м³</span>
            <span>Чердак</span><span className="text-right">{pretty(derived.caps.attic)} м³</span>
            <span className="font-medium mt-1">Всего по карте</span>
            <span className="text-right font-medium mt-1">{pretty(capTotal)} м³</span>
          </div>
          <div className="pt-2 flex items-center gap-2 text-muted-foreground"><Cog className="w-4 h-4"/>Кол-во ячеек по ролям:</div>
          <div className="grid grid-cols-2 gap-1">
            <span>Подбор</span><span className="text-right">{countsToShow.pick.toLocaleString("ru-RU")} яч.</span>
            <span>Запас</span><span className="text-right">{countsToShow.overstock.toLocaleString("ru-RU")} яч.</span>
            <span>Чердак</span><span className="text-right">{countsToShow.attic.toLocaleString("ru-RU")} яч.</span>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader><CardTitle>Итоги по объёму</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between"><span>Всего объём (м³)</span><b>{pretty(result.totals.totalVol)}</b></div>
              <div className="flex justify-between">
                <span>Занято от общей ёмкости</span>
                <b>{capTotal > 0 ? `${(result.totals.totalVol / capTotal * 100).toFixed(1)}%` : "—"}</b>
              </div>
              <div className="flex justify-between"><span>Размещение в PICK</span><b>{pretty(result.totals.placePick)} м³</b></div>
              <div className="flex justify-between"><span>Размещение в OVERSTOCK</span><b>{pretty(result.totals.placeOver)} м³</b></div>
              <div className="flex justify-between"><span>Размещение в ATTIC</span><b>{pretty(result.totals.placeAttic)} м³</b></div>
              <div className="flex justify-between"><span>Переполнение</span><b className={result.totals.overflow > 0 ? "text-red-600" : ""}>{pretty(result.totals.overflow)} м³</b></div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="secondary" onClick={exportBySku}>Экспорт по SKU</Button>
                <Button size="sm" variant="secondary" onClick={exportByCategory}>Экспорт по категориям</Button>
              </div>
            </div>
            <div>
              <div className="font-medium mb-2">Топ категорий по объёму</div>
              <TopCats bySku={result.bySku} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============================== TopCats ============================== */
function TopCats({ bySku }: { bySku: any[] }) {
  const list = useMemo(() => {
    const agg = new Map<string, number>();
    bySku.forEach(r => {
      const key = r.category || "Uncategorized";
      agg.set(key, (agg.get(key) || 0) + (r.volBoxes || 0));
    });
    return Array.from(agg.entries())
      .map(([cat, vol]) => ({ cat, vol }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 10);
  }, [bySku]);

  if (!list.length) return <div className="text-xs text-muted-foreground">Нет данных</div>;

  return (
    <div className="space-y-1 text-sm">
      {list.map(({ cat, vol }) => (
        <div key={cat} className="flex justify-between">
          <span>{cat}</span>
          <span>{pretty(vol)} м³</span>
        </div>
      ))}
    </div>
  );
}

// Вспомогательный компонент FileStatus, если он был удален
function FileStatus({label,sub,ok,hydrated}:{label:string;sub?:string;ok:boolean;hydrated:boolean}){
  const base="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border";
  if (!hydrated) return <span className={`${base} border-gray-200 text-gray-500`}>{label}: —</span>;
  if (ok) return <span className={`${base} border-emerald-200 text-emerald-700 bg-emerald-50`}>{label}{sub ? <span>{` • ${sub}`}</span> : null}</span>;
  return <span className={`${base} border-gray-200 text-gray-500`}>{label}: не загружен</span>;
}
function ForecastTab({ showNotice }: { showNotice: (text: string, kind: Notice['kind']) => void }): JSX.Element {
  // --- Стейты для файлов калибровки ---
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [movesFile, setMovesFile] = useState<File | null>(null);
  const [volumeFile, setVolumeFile] = useState<File | null>(null);
  
  // --- Стейты параметров ---
  const [capacityM3, setCapacityM3] = useState(422.784);
  const [capacityCells, setCapacityCells] = useState(1064);
  const [startStockM3, setStartStockM3] = useState(127.6);
  const [horizon, setHorizon] = useState(24);
  const [protectMonths, setProtectMonths] = useState(3);
  const [growthYoY, setGrowthYoY] = useState(0.15);
  const [sellThru, setSellThru] = useState(0.08);
  const [coefSS, setCoefSS] = useState(1.10);
  const [coefFW, setCoefFW] = useState(0.95);
  const [avgNewSkuM3, setAvgNewSkuM3] = useState(0.065);
  const [cellTurnoverEfficiency, setCellTurnoverEfficiency] = useState(0.05);
  const [hist, setHist] = useState({ sellThru: 0.08, coefSS: 1.10, coefFW: 1.0, shareNew: 0.25, growthYoY: 0.0 });
  const [useCalib, setUseCalib] = useState(true);
  const [smoothing, setSmoothing] = useState(0.7);
  const today = new Date(); const baseYear = today.getFullYear(); const baseMonth = today.getMonth();
  const [waves, setWaves] = useState([
    { label: "FW25", season: "FW", year: 2025, monthIdx: 8, base: 80, shareNew: 0.30 },
    { label: "SS26", season: "SS", year: 2026, monthIdx: 2, base: 70, shareNew: 0.25 },
  ]);

  const handleCalibration = async () => {
    if (!salesFile || !movesFile || !volumeFile) {
      showNotice("Пожалуйста, выберите все три файла для калибровки.", "error");
      return;
    }
    try {
      const salesData = parseCSV(await salesFile.text());
      const movesData = parseCSV(await movesFile.text());
      let volumeData: Record<string, any>[] = [];
      if (volumeFile.name.toLowerCase().endsWith(".xlsx")) {
          const data = new Uint8Array(await volumeFile.arrayBuffer());
          const XLSX: any = await import("xlsx");
          const wb = XLSX.read(data, { type: "array" });
          volumeData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      } else {
          volumeData = parseCSV(await volumeFile.text());
      }
      const volumeMap = new Map<string, number>();
      volumeData.forEach(r => {
        const sku = r["SKU"];
        const volume = toNum(r["PCS Volume, CBM"]);
        if (sku && volume > 0) volumeMap.set(sku, volume);
      });
      const totalOpeningVolume = movesData.reduce((sum, r) => sum + (toNum(r["На открытие"]) * (volumeMap.get(r["Код"]) || 0)), 0);
      const monthlySalesVolume = new Map<string, number>();
      salesData.forEach(r => {
        const dateString = r["Дата"];
        if (!dateString || typeof dateString !== 'string') return;
        const dateParts = dateString.split('.');
        if (dateParts.length !== 3) return;
        const date = new Date(Number(dateParts[2]), Number(dateParts[1]) - 1, Number(dateParts[0]));
        const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlySalesVolume.set(ym, (monthlySalesVolume.get(ym) || 0) + (toNum(r["Кол-во"]) * (volumeMap.get(r["Код"]) || 0)));
      });
      const salesMonthsVolumes = Array.from(monthlySalesVolume.values());
      if (salesMonthsVolumes.length === 0) {
          showNotice("В файле продаж не найдено данных для расчета объемов.", "error");
          return;
      }
      const averageMonthlySalesVolume = salesMonthsVolumes.reduce((a,b) => a+b, 0) / salesMonthsVolumes.length;
      const calculatedSellThru = totalOpeningVolume > 0 ? averageMonthlySalesVolume / totalOpeningVolume : 0.08;
      let ssSalesVol: number[] = [], fwSalesVol: number[] = [];
      for (const [ym, vol] of monthlySalesVolume.entries()) {
        const month = parseInt(ym.split('-')[1], 10);
        (month >= 4 && month <= 9 ? ssSalesVol : fwSalesVol).push(vol);
      }
      const avgSsSalesVol = ssSalesVol.length > 0 ? ssSalesVol.reduce((a,b)=>a+b,0) / ssSalesVol.length : averageMonthlySalesVolume;
      const avgFwSalesVol = fwSalesVol.length > 0 ? fwSalesVol.reduce((a,b)=>a+b,0) / fwSalesVol.length : averageMonthlySalesVolume;
      const calculatedCoefSS = averageMonthlySalesVolume > 0 ? avgSsSalesVol / averageMonthlySalesVolume : 1;
      const calculatedCoefFW = averageMonthlySalesVolume > 0 ? avgFwSalesVol / averageMonthlySalesVolume : 1;
      const newSkuArrivals = movesData.filter(r => toNum(r["На открытие"]) === 0 && toNum(r["Приход"]) > 0).reduce((sum, r) => sum + toNum(r["Приход"]), 0);
      const totalArrivals = movesData.reduce((sum, r) => sum + toNum(r["Приход"]), 0);
      const calculatedShareNew = totalArrivals > 0 ? newSkuArrivals / totalArrivals : 0.25;
      setHist({ sellThru: calculatedSellThru, coefSS: calculatedCoefSS, coefFW: calculatedCoefFW, shareNew: calculatedShareNew, growthYoY: 0.0 });
      showNotice("Калибровка по объему успешно завершена!", "success");
    } catch (error) {
      console.error("Ошибка при калибровке:", error);
      showNotice("Произошла ошибка при обработке файлов.", "error");
    }
  };
  
  const addWave = () => setWaves(w => [...w, { label: "NEW", season: "FW", year: baseYear, monthIdx: baseMonth, base: 50, shareNew: 0.25 }]);
  const updWave = (i: number, p: Partial<any>) => setWaves(w => w.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const delWave = (i: number) => setWaves(w => w.filter((_, idx) => idx !== i));
  const months = useMemo(() => {
    const out: { ym: string; y: number; m: number; label: string }[] = []; let y = baseYear, m = baseMonth;
    for (let i = 0; i < horizon; i++) { out.push({ ym: ymKey(y, m), y, m, label: monthName(m) }); m++; if (m >= 12) { m = 0; y++; } }
    return out;
  }, [horizon, baseYear, baseMonth]);

  const sim = useMemo(() => {
    try {
      const alpha = useCalib ? clamp(smoothing, 0, 1) : 0;
      const sellThruEff = (1 - alpha) * sellThru + alpha * hist.sellThru;
      const coefSSEff = (1 - alpha) * coefSS + alpha * hist.coefSS;
      const coefFWEff = (1 - alpha) * coefFW + alpha * hist.coefFW;
      const growthYoYEff = (1 - alpha) * growthYoY + alpha * hist.growthYoY;
      const rows: any[] = [];
      const monthlyGrowth = Math.pow(1 + growthYoYEff, 1 / 12) - 1;
      let stockM3 = startStockM3;
      let activeSkusCount;
      if (startStockM3 >= capacityM3) { activeSkusCount = capacityCells; } 
      else { activeSkusCount = capacityCells * (startStockM3 / capacityM3); }
      activeSkusCount = Math.round(activeSkusCount);
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
        const closedSkus = Math.max(0, skusToClear - protectedNow);
        activeSkusCount = Math.max(0, activeSkusCount - closedSkus);
        protectedQueue.push(newSkus);
        stockM3 = Math.max(0, stockBeforeSales - salesM3);
        const pctM3 = (stockM3 / Math.max(0.0001, capacityM3)) * 100;
        const pctCells = (activeSkusCount / Math.max(0.0001, capacityCells)) * 100;
        if (!first80 && (pctM3 >= 80 || pctCells >= 80)) first80 = ym;
        if (!first100 && (pctM3 >= 100 || pctCells >= 100)) first100 = ym;
        rows.push({ ym, label: monthName(m), arrivals: arrivalsM3, sales: salesM3, stock: stockM3, newSkus, active: Math.round(activeSkusCount), pctM3, pctCells, waveLabel: w.map(x => x.label).join(" + ") });
      }
      return { rows, first80, first100 };
    } catch (error) {
        console.error("Simulation failed:", error);
        return { rows: [], first80: "Error", first100: "Error" };
    }
  }, [
    months, waves, protectMonths, cellTurnoverEfficiency,
    growthYoY, sellThru, coefSS, coefFW, avgNewSkuM3, capacityM3, capacityCells, startStockM3,
    useCalib, smoothing, hist
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
              <Label htmlFor="sales-file" className="flex items-center gap-1">Продажи <InfoTip>Обязательные колонки: 'Дата', 'Код' (SKU), 'Кол-во'.</InfoTip></Label>
              <Input id="sales-file" type="file" accept=".csv" onChange={(e) => setSalesFile(e.target.files?.[0] || null)} />
              <Label htmlFor="moves-file" className="flex items-center gap-1">Движения <InfoTip>Обязательные колонки: 'Код' (SKU), 'На открытие', 'Приход'.</InfoTip></Label>
              <Input id="moves-file" type="file" accept=".csv" onChange={(e) => setMovesFile(e.target.files?.[0] || null)} />
              <Label htmlFor="volume-file" className="flex items-center gap-1">Справочник объемов <InfoTip>Обязательные колонки: 'SKU', 'PCS Volume, CBM'. Поддерживает XLSX и CSV.</InfoTip></Label>
              <Input id="volume-file" type="file" accept=".csv,.xlsx" onChange={(e) => setVolumeFile(e.target.files?.[0] || null)} />
            </div>
            <div className="pt-2"><Button onClick={handleCalibration}>Рассчитать калибровку по объему</Button></div>
            <div className="flex justify-between items-center pt-2">
              <div className="flex items-center gap-2">
                <Switch id="use-calib-switch" checked={useCalib} onCheckedChange={setUseCalib} />
                <Label htmlFor="use-calib-switch" className="flex items-center gap-1 cursor-pointer">Использовать калибровку<InfoTip>Смешиваем ручные параметры с оценками из CSV...</InfoTip></Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="smoothing-input" className="text-muted-foreground text-xs">Вес (α)</Label>
                <div className="relative w-24"><Input id="smoothing-input" className="h-9 w-full text-right pr-7" type="number" value={smoothing * 100} onChange={e => setSmoothing(clamp(toNum(e.target.value, 0) / 100, 0, 1))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span></div>
              </div>
            </div>
             <div className="text-xs text-muted-foreground p-2 bg-muted rounded-md">
                <b>Оценки из истории:</b> 
                sell-thru ≈ {(hist.sellThru * 100).toFixed(1)}%, 
                SS ≈ {hist.coefSS.toFixed(2)}, 
                FW ≈ {hist.coefFW.toFixed(2)}, 
                новые SKU ≈ {(hist.shareNew * 100).toFixed(0)}%
              </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Волны поставок</CardTitle><Button size="sm" onClick={addWave}><PlusCircle className="w-4 h-4 mr-2" />Добавить волну</Button></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-2 font-normal pr-3">Метка</th><th className="py-2 font-normal px-3">Сезон</th><th className="py-2 font-normal px-3">Год</th><th className="py-2 font-normal px-3">Месяц</th><th className="py-2 font-normal px-3 text-right">Объём, м³</th><th className="py-2 font-normal pl-3 text-right">Новые SKU, %</th><th className="py-2 font-normal w-12"></th></tr></thead>
            <tbody>
              {waves.map((w, i) => (
                <tr key={i} className="border-t">
                  <td className="py-2 pr-3"><Input className="h-9 w-28" value={w.label} onChange={e => updWave(i, { label: e.target.value })} /></td>
                  <td className="p-3"><select className="border rounded px-2 h-9 w-full" value={w.season} onChange={e => updWave(i, { season: e.target.value as any })}><option value="FW">FW</option><option value="SS">SS</option></select></td>
                  <td className="p-3"><Input className="h-9 w-24" type="number" value={w.year} onChange={e => updWave(i, { year: toNum(e.target.value, baseYear) })} /></td>
                  <td className="p-3"><select className="border rounded px-2 h-9 w-full" value={w.monthIdx} onChange={e => updWave(i, { monthIdx: toNum(e.target.value, 0) })}>{MONTHS_RU.map((m, idx) => (<option key={idx} value={idx}>{m}</option>))}</select></td>
                  <td className="p-3 text-right"><Input className="h-9 w-28 text-right" type="number" step={1} value={w.base} onChange={e => updWave(i, { base: toNum(e.target.value, 0) })} /></td>
                  <td className="p-3 text-right">
                    <div className="relative">
                      {/* ИСПРАВЛЕНО: Добавлено округление для отображения и ввода */}
                      <Input 
                        className="h-9 w-28 text-right pr-7" 
                        type="number" 
                        step={1} 
                        min={0} 
                        max={100} 
                        value={Math.round(w.shareNew * 100)} 
                        onChange={e => updWave(i, { shareNew: clamp(Math.round(toNum(e.target.value, 0)) / 100, 0, 1) })} 
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </td>
                  <td className="text-right pl-3"><Button size="icon" variant="ghost" onClick={() => delWave(i)}><Trash2 className="w-4 h-4 text-muted-foreground" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Параметры прогноза</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          <div className="space-y-4">
            <div className="font-medium text-sm">Ключевые параметры</div>
            <SliderInput label="Рост год к году" tip="Годовой рост входящих поставок..." value={growthYoY} setValue={setGrowthYoY} min={-0.5} max={1} step={0.01} isPercentage />
            <SliderInput label="Базовая уходимость / мес" tip="Доля текущего запаса, продающаяся каждый месяц..." value={sellThru} setValue={setSellThru} min={0.01} max={0.4} step={0.01} isPercentage />
            <SliderInput label="Эффективность освобождения ячеек" tip="Какая доля проданного объема приводит к освобождению ячеек." value={cellTurnoverEfficiency} setValue={setCellTurnoverEfficiency} min={0} max={1} step={0.01} isPercentage />
          </div>
          <div className="space-y-4">
            <div className="font-medium text-sm">Дополнительные настройки</div>
            <SliderInput label="Защита новых от закрытий (мес)" tip="Сколько месяцев новые SKU не попадают под закрытие." value={protectMonths} setValue={setProtectMonths} min={0} max={12} step={1}/>
            <div className="grid grid-cols-[1fr,auto] items-center gap-x-4 gap-y-2 pt-2">
              <label className="text-sm">Коэфф. продаж SS (апр–сен)</label><Input className="h-9 w-24 text-right" type="number" step={0.01} value={coefSS} onChange={e => setCoefSS(toNum(e.target.value, 1))} />
              <label className="text-sm">Коэфф. продаж FW (окт–мар)</label><Input className="h-9 w-24 text-right" type="number" step={0.01} value={coefFW} onChange={e => setCoefFW(toNum(e.target.value, 1))} />
              <label className="text-sm">Средний объём НОВОГО SKU (м³)</label><Input className="h-9 w-24 text-right" type="number" step={0.001} min={0.001} value={avgNewSkuM3} onChange={e => setAvgNewSkuM3(Math.max(0.001, toNum(e.target.value, 0.01)))} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Прогноз загрузки (до {horizon} мес.)</CardTitle></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={sim.rows} margin={{ left: 8, right: 8, top: 12, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} />
                <YAxis tickFormatter={(v) => `${v}%`} domain={[0, (dataMax: number) => Math.max(120, dataMax)]} />
                <ReTooltip formatter={(v: any) => `${v.toFixed(1)}%`} labelFormatter={(l: any, p: any) => (p && p[0] && p[0].payload) ? p[0].payload.ym : l} />
                <Legend />
                <ReferenceLine y={80} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: "80%", position: "insideTopRight" }} />
                <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "100%", position: "insideTopRight" }} />
                <Line type="monotone" dataKey="pctM3" name="% по м³" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="pctCells" name="% по ячейкам" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-sm mt-4">Прогноз: первое превышение 80% в <b>{sim.first80 || "—"}</b>, превышение 100% в <b>{sim.first100 || "—"}</b></div>
          <details className="mt-4"><summary className="cursor-pointer text-sm text-muted-foreground">Показать таблицу помесячно</summary>
            <div className="mt-3 overflow-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead><tr className="text-left border-b"><th className="py-1">Месяц</th><th>Метки</th><th>Поступило (м³)</th><th>Продажи (м³)</th><th>Остаток на конец (м³)</th><th>Новые SKU</th><th>Активных SKU</th><th>% по м³</th><th>% по ячейкам</th></tr></thead>
                <tbody>{sim.rows.map((r: any) => (<tr key={r.ym} className="border-b"><td className="py-1">{r.ym}</td><td>{r.waveLabel}</td><td>{r.arrivals.toFixed(1)}</td><td>{r.sales.toFixed(1)}</td><td>{r.stock.toFixed(1)}</td><td>{r.newSkus}</td><td>{r.active.toFixed(0)}</td><td>{r.pctM3.toFixed(1)}%</td><td>{r.pctCells.toFixed(1)}%</td></tr>))}</tbody>
              </table>
            </div>
          </details>
          <div className="mt-4"><Button variant="secondary" onClick={() => downloadCSV('forecast.csv', sim.rows)}><Download className="w-4 h-4 mr-2" />Экспорт CSV</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================== ПРОГНОЗ ============================== */
const MONTHS_RU = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const monthName = (i: number) => MONTHS_RU[((i % 12) + 12) % 12];
const ymKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;

// FIX: Полностью исправленный компонент SliderInput
// Вспомогательный компонент для слайдера с полем ввода
// Вспомогательный компонент для слайдера с полем ввода
function SliderInput({ label, tip, value, setValue, min, max, step, isPercentage = false }: {
  label: string;
  tip: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  isPercentage?: boolean;
}) {
  const displayMultiplier = isPercentage ? 100 : 1;
  const displayValue = Math.round((value * displayMultiplier) * 1000) / 1000;
  const displayStep = isPercentage ? 1 : step;

  const handleUiChange = (uiValue: number) => {
    const realValue = uiValue / displayMultiplier;
    // Используем clamp с оригинальными min/max в долях единицы
    setValue(clamp(realValue, min, max));
  };

  return (
    <div>
      <label className="flex items-center gap-1 text-sm mb-1">
        {label}
        <InfoTip>{tip}</InfoTip>
      </label>
      <div className="flex items-center gap-3">
        <Slider
          value={[displayValue]}
          onValueChange={(v) => handleUiChange(v[0])}
          min={min * displayMultiplier}
          max={max * displayMultiplier}
          step={displayStep}
        />
        <div className="relative w-24">
          <Input
            className="w-full h-9 text-right pr-7"
            type="number"
            step={displayStep}
            value={displayValue}
            onChange={e => handleUiChange(Number(e.target.value))}
          />
          {isPercentage && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
        </div>
      </div>
    </div>
  );
}



/* ============================== НАСТРОЙКИ ============================== */
function SettingsTab({ showNotice }: { showNotice: (text: string, kind: Notice['kind']) => void }): JSX.Element {
  const [cleared, setCleared] = useState<string>("");

  const clearKey = (key:string) => {
    store.clear(key);
    setCleared(key);
    setTimeout(()=>setCleared(""), 1500);
    signalDataUpdated();
  };

// === ЗАГРУЗКА КАРТЫ (A: старый формат с CELL ID; B: новая матрица объёмов с Role) ===
const onCellMap: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
  const f = e.target.files?.[0]; if (!f) return;

  const toNumSafe = (v:any, def=0) => {
    if (v==null || v==="") return def;
    const n = Number(String(v).replace(/\s+/g,"").replace(",","."));
    return Number.isFinite(n) ? n : def;
  };
  const nrm = (s:any) => String(s ?? "").replace(/\u00A0/g," ").trim().toLowerCase();

  // ---- A) старый формат: CELL ID* + each/total
  const tryOldFormat = async (): Promise<null | {cells: CellRow[]; meta: MetaRow[]}> => {
    try {
      let rows: Record<string, any>[] = [];
      if (f.name.toLowerCase().endsWith(".xlsx") || /sheet|excel/i.test(f.type)) {
        const data = new Uint8Array(await f.arrayBuffer());
        const XLSX:any = await import("xlsx");
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      } else {
        rows = parseCSV(await f.text());
      }
      if (!rows.length) return null;

      const headers = Object.keys(rows[0] ?? {});
      const idCols   = headers.filter(h => nrm(h).startsWith("cell id"));
      const eachCol  = headers.find(h => nrm(h) === "each cell volume in this row") || null;
      const totalCol = headers.find(h => nrm(h) === "total row volume") || null;
      const roleCol  = headers.find(h => nrm(h) === "role" || nrm(h) === "зона") || null;
      if (!idCols.length || (!eachCol && !totalCol)) return null;

      const idRx = /^l\d+(?:\.\d+)+$/i;
      const mapRole = (v:any): Role => {
        const s = nrm(v);
        if (/^pick$|подбор/.test(s))   return "pick";
        if (/^attic$|чердак/.test(s))  return "attic";
        return "overstock";
      };

      const cells: CellRow[] = [];
      const meta:  MetaRow[] = [];
      for (const r of rows) {
        const ids = idCols.map(c => String(r[c] ?? "").trim()).filter(v => v && idRx.test(v));
        if (!ids.length) continue;

        let volEach = 0;
        if (eachCol) volEach = toNumSafe(r[eachCol], 0);
        if (!volEach && totalCol) {
          const tot = toNumSafe(r[totalCol], 0);
          if (tot > 0) volEach = tot / ids.length;
        }
        if (volEach <= 0) continue;

        const role = mapRole(roleCol ? r[roleCol] : "");
        for (const id of ids) {
          cells.push({ cellId: id, cellVolume_m3: volEach });
          meta.push({ cellId: id, role });
        }
      }
      if (!cells.length) return null;
      return { cells, meta };
    } catch { return null; }
  };

  // ---- B) новая матрица: первый столбец = Role, где каждая числовая ячейка — объём м³
  const tryMatrixFormat = async (): Promise<null | {cells: CellRow[]; meta: MetaRow[]}> => {
    if (!(f.name.toLowerCase().endsWith(".xlsx") || /sheet|excel/i.test(f.type))) return null;
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const XLSX:any = await import("xlsx");
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid:any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

      const mapRoleWord = (v:any): Role => {
        const s = nrm(v);
        if (/^(pick|подбор)/.test(s))      return "pick";
        if (/^(attic|чердак)/.test(s))     return "attic";
        if (/^(overstock|запас)/.test(s))  return "overstock";
        return "overstock";
      };

      let rack = "R0";
      const roleToken = /^(pick|overstock|attic|подбор|запас|чердак)$/i;

      const cells: CellRow[] = [];
      const meta:  MetaRow[] = [];

      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];

        // строка-заголовок стеллажа: "Rack N"
        const rackCell = row.find(v => typeof v === "string" && /rack\s*\d+/i.test(v));
        if (rackCell) {
          const m = String(rackCell).match(/rack\s*(\d+)/i);
          rack = m ? `R${m[1]}` : rack;
          continue;
        }

        // роль сидит в первом столбце
        const roleRaw = row[0];
        if (!roleRaw || !roleToken.test(String(roleRaw))) {
          // пустая/разделительная строка — пропустим
          const hasNumbers = row.some((v,i)=> i>0 && (typeof v === "number" ? v>0 : Number.isFinite(toNumSafe(v, NaN))));
          if (!hasNumbers) continue;
        }
        const role = mapRoleWord(roleRaw);

        // объёмы начинаются со второго столбца
        for (let c = 1; c < row.length; c++) {
          const v = row[c];
          const num = typeof v === "number" ? v : toNumSafe(v, NaN);
          if (!(Number.isFinite(num) && num > 0 && num < 10)) continue;

          // стабильный, читаемый ID (привязываем к rack/строке/колонке)
          const cellId = `${rack}.${r+1}.${c+1}`;
          cells.push({ cellId, cellVolume_m3: num });
          meta.push({ cellId, role });
        }
      }

      if (!cells.length) return null;
      return { cells, meta };
    } catch { return null; }
  };

  try {
    let parsed = await tryOldFormat();
    if (!parsed) parsed = await tryMatrixFormat();
    if (!parsed) {
      showNotice("Не удалось распознать карту. Нужен XLSX с матрицей или файл CELL ID + volume.", "error");
      return;
    }

    store.set(K.CELLS, parsed.cells);
    store.set(K.META,  parsed.meta);
    signalDataUpdated();

    const totalM3 = parsed.cells.reduce((s,c)=> s + (Number(c.cellVolume_m3)||0), 0);
    showNotice(`Карта загружена: ${parsed.cells.length} ячеек • ${totalM3.toFixed(1)} м³`, "success");
  } catch (err) {
    console.error("Ошибка загрузки карты:", err);
    showNotice("Ошибка чтения файла карты", "error");
  }
};

  // === onReference (как в твоём baseline) ===
  const onReference: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const toNumSafe = (v:any, def=0)=>{ if(v==null||v==="")return def; const n=Number(String(v).replace(/\s+/g,"").replace(",",".")); return Number.isFinite(n)?n:def; };
    try{
      let rows: Record<string, any>[] = [];
      if (f.name.toLowerCase().endsWith(".xlsx") || /sheet|excel/i.test(f.type)) {
        const data = new Uint8Array(await f.arrayBuffer());
        const XLSX:any = await import("xlsx");
        const wb = XLSX.read(data, {type:"array"});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws,{defval:""});
      } else { const text = await f.text(); rows = parseCSV(text); }
      if (!rows.length) { showNotice("Файл справочника пуст", "error"); return; }

      const normalized = rows.map(r => ({
        sku: String(r["SKU"] || r["sku"] || "").trim(),
        pcs_per_mc: toNumSafe(r["PCS. Per MC"] || r["pcs_per_mc"], 1),
        pcs_volume_cbm: toNumSafe(r["PCS Volume, CBM"] || r["pcs_volume_cbm"], 0),
        mc_volume_cbm:  toNumSafe(r["MC Volume, CBM"] || r["mc_volume_cbm"], 0),
        mc_len_cm: toNumSafe(r["MC length, cm"] || r["mc_len_cm"], 0),
        mc_w_cm:   toNumSafe(r["MC width, cm"]  || r["mc_w_cm"], 0),
        mc_d_cm:   toNumSafe(r["MC depth, cm"]  || r["mc_d_cm"], 0),
      })).filter(r => r.sku);

      if (!normalized.length) { showNotice("Не найдено SKU в справочнике", "error"); return; }

      store.set(K.REF, normalized);
      signalDataUpdated();
      showNotice(`Справочник загружен: ${normalized.length.toLocaleString("ru-RU")} SKU`, "success");
    }catch(err){ console.error("Ошибка загрузки справочника:", err); showNotice("Ошибка чтения файла справочника", "error"); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Данные склада</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm">Карта склада (XLSX/CSV)</label>
              <div className="flex gap-2">
                <Input type="file" accept=".xlsx,.csv" onChange={onCellMap}/>
                <Button variant="secondary" onClick={()=>{ clearKey(K.CELLS); clearKey(K.META); }}>Очистить карту</Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm">Справочник упаковок (XLSX/CSV)</label>
              <div className="flex gap-2">
                <Input type="file" accept=".xlsx,.csv" onChange={onReference}/>
                <Button variant="secondary" onClick={()=> clearKey(K.REF)}>Очистить справочник</Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <span>Маппинг категорий</span>
            <div className="text-right"><Button size="sm" variant="secondary" onClick={()=>clearKey(K.MAP)}>Очистить</Button></div>
            <span>Текущий остаток</span>
            <div className="text-right"><Button size="sm" variant="secondary" onClick={()=>clearKey(K.INV)}>Очистить</Button></div>
          </div>

          {cleared && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-block">
              Очищено: {cleared}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            После загрузки/очистки калькулятор подхватит данные автоматически.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}