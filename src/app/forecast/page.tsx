"use client";

import React, { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { readForForecast } from "../../lib/warehouseBridge";

type Season = 'SS'|'FW'|'ALL';
type Wave = { label:string; season:Season; year:number; monthIdx:number; baseVolumeM3:number; shareNewSKU:number };

const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtMonthIdx = (idx:number)=>monthLabels[idx%12];
const ymKey = (y:number,mIdx:number)=>`${y}-${String(mIdx+1).padStart(2,'0')}`;
const round = (x:number,d=1)=>Math.round(x*Math.pow(10,d))/Math.pow(10,d);

function downloadCSV(name:string, rows:any[]) {
  if(!rows?.length) return;
  const header = Object.keys(rows[0]||{});
  const csv = [header.join(',')].concat(rows.map(r=>header.map(h=>r[h]).join(','))).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}

export default function ForecastPage(): JSX.Element {
  const fromCalc = typeof window!=="undefined" ? readForForecast() : null;
  const today = new Date(); const startYear = today.getFullYear(); const startM = today.getMonth();

  // подхватываем стартовые параметры из калькулятора (если уже сохранялись)
  const [cap, setCap] = useState<number>(fromCalc?.capM3Total ?? 422.784);
  const [cells, setCells] = useState<number>(fromCalc?.cellsTotal ?? 1064);
  const [startVol, setStartVol] = useState<number>(fromCalc?.startVolM3 ?? 142.8);
  const [startActive, setStartActive] = useState<number>(fromCalc?.startActiveSkus ?? 850);

  const [horizon, setHorizon] = useState<number>(24);
  const [growth, setGrowth] = useState(0.15);
  const [sell, setSell] = useState(0.08);
  const [coefSS, setCoefSS] = useState(1.10);
  const [coefFW, setCoefFW] = useState(1.05);
  const [avgNew, setAvgNew] = useState(0.50);
  const [avgActive, setAvgActive] = useState(0.35);

  const [waves, setWaves] = useState<Wave[]>([
    { label:'FW26', season:'FW', year:startYear,   monthIdx:8, baseVolumeM3:80, shareNewSKU:0.30 },
    { label:'SS26', season:'SS', year:startYear+1, monthIdx:2, baseVolumeM3:70, shareNewSKU:0.25 },
  ]);
  const addWave=()=>setWaves(w=>w.concat({label:'NEW',season:'ALL',year:startYear,monthIdx:startM,baseVolumeM3:50,shareNewSKU:0.25}));
  const updWave=(i:number,p:Partial<Wave>)=>setWaves(w=>w.map((r,idx)=>idx===i?{...r,...p}:r));
  const delWave=(i:number)=>setWaves(w=>w.filter((_,idx)=>idx!==i));

  const seasonCoef = (mIdx:number)=> (mIdx>=3 && mIdx<=8 ? coefSS : coefFW);

  const months = useMemo(()=>{
    const out:{ym:string;y:number;mIdx:number}[]=[]; let y=startYear, m=startM;
    for(let i=0;i<horizon;i++){ out.push({ym:ymKey(y,m),y,mIdx:m}); m++; if(m>=12){m=0;y++} }
    return out;
  },[horizon,startYear,startM]);

  const arrivalsPlan = useMemo(()=>{
    type V = {vol:number; newShare:number; labels:string[]};
    const map = new Map<string,V>();
    for(const w of waves){
      const key = ymKey(w.year,w.monthIdx);
      const prev = map.get(key) || {vol:0,newShare:0,labels:[]};
      const volNew = prev.vol + w.baseVolumeM3;
      const newShare = volNew>0 ? (prev.newShare*prev.vol + w.shareNewSKU*w.baseVolumeM3)/volNew : w.shareNewSKU;
      map.set(key,{vol:volNew,newShare,labels:[...prev.labels,w.label]});
    }
    return map;
  },[waves]);

  const base = useMemo(()=>{
    const monthlyGrowth = Math.pow(1+growth,1/12)-1;
    let vol = startVol;
    let active = startActive;
    const rows:any[]=[];

    for(let i=0;i<months.length;i++){
      const {ym, mIdx} = months[i];
      const plan = arrivalsPlan.get(ym);

      let arrivals = 0; let newSkus = 0;
      if(plan){
        const growthF = Math.pow(1+monthlyGrowth,i);
        arrivals = plan.vol * growthF;
        const newV = arrivals * plan.newShare;
        newSkus = Math.round(newV / Math.max(0.0001, avgNew));
      }

      const sales = vol * Math.max(0,sell) * Math.max(0.01, seasonCoef(mIdx));
      vol = Math.max(0, vol + arrivals - sales);

      const closures = Math.round(sales / Math.max(0.0001, avgActive));
      active = Math.max(0, active + newSkus - closures);

      const pctM3 = (vol/Math.max(0.0001,cap))*100;
      const pctCells = (active/Math.max(1,cells))*100;

      rows.push({
        ym, month: fmtMonthIdx(mIdx), labels: plan?.labels.join(' + ')||'',
        arrivals: round(arrivals), sales: round(sales), stockEnd: round(vol),
        newSkus, closedSkus: closures, activeSkusEnd: active,
        pctM3: round(pctM3), pctCells: round(pctCells)
      });
    }

    const first80 = rows.find(r=> r.pctM3>=80 || r.pctCells>=80)?.ym||null;
    const first100= rows.find(r=> r.pctM3>=100|| r.pctCells>=100)?.ym||null;

    return {rows, first80, first100};
  }, [months, arrivalsPlan, growth, sell, coefSS, coefFW, avgNew, avgActive, cap, cells, startVol, startActive]);

  const exportCSV = ()=>downloadCSV('forecast.csv',
    base.rows.map((r:any)=>({
      ym:r.ym, labels:r.labels, arrivals_m3:r.arrivals, sales_m3:r.sales, stock_end_m3:r.stockEnd,
      new_sku:r.newSkus, closed_sku:r.closedSkus, active_sku_end:r.activeSkusEnd,
      pct_m3:r.pctM3, pct_cells:r.pctCells
    }))
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Прогноз заполненности — прототип</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="p-4 border rounded-lg space-y-2 bg-white">
          <h2 className="font-medium">Склад и стартовые значения</h2>
          <div className="grid grid-cols-2 gap-2 text-sm items-center">
            <label>Вместимость (м³)</label><input type="number" className="border rounded px-2 py-1" value={cap} onChange={e=>setCap(Number(e.target.value)||0)} />
            <label>Вместимость (ячейки)</label><input type="number" className="border rounded px-2 py-1" value={cells} onChange={e=>setCells(Number(e.target.value)||0)} />
            <label>Стартовый остаток (м³)</label><input type="number" className="border rounded px-2 py-1" value={startVol} onChange={e=>setStartVol(Number(e.target.value)||0)} />
            <label>Активных SKU (ячейки)</label><input type="number" className="border rounded px-2 py-1" value={startActive} onChange={e=>setStartActive(Number(e.target.value)||0)} />
          </div>
        </div>

        <div className="p-4 border rounded-lg space-y-2 bg-white">
          <h2 className="font-medium">Динамика</h2>
          <div className="grid grid-cols-2 gap-2 text-sm items-center">
            <label>Рост YoY</label><input type="number" step={0.01} className="border rounded px-2 py-1" value={growth} onChange={e=>setGrowth(Number(e.target.value)||0)} />
            <label>Sell-through/мес</label><input type="number" step={0.01} className="border rounded px-2 py-1" value={sell} onChange={e=>setSell(Number(e.target.value)||0)} />
            <label>SS коэфф.</label><input type="number" step={0.01} className="border rounded px-2 py-1" value={coefSS} onChange={e=>setCoefSS(Number(e.target.value)||1)} />
            <label>FW коэфф.</label><input type="number" step={0.01} className="border rounded px-2 py-1" value={coefFW} onChange={e=>setCoefFW(Number(e.target.value)||1)} />
          </div>
        </div>
      </div>

      <div className="p-4 border rounded-lg space-y-1 bg-white">
        <div className="flex items-center justify-between"><h2 className="font-medium">Волны поставок</h2><button className="px-3 py-1 border rounded" onClick={addWave}>Добавить волну</button></div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2">Метка</th><th>Сезон</th><th>Год</th><th>Месяц</th><th>Базовый объём (м³)</th><th>Доля новых</th><th></th>
            </tr></thead>
            <tbody>
              {waves.map((w,i)=>(
                <tr key={i} className="border-b">
                  <td className="py-1"><input className="border rounded px-2 py-1 w-24" value={w.label} onChange={e=>updWave(i,{label:e.target.value})}/></td>
                  <td><select className="border rounded px-2 py-1 w-24" value={w.season} onChange={e=>updWave(i,{season:e.target.value as Season})}><option value="SS">SS</option><option value="FW">FW</option><option value="ALL">ALL</option></select></td>
                  <td><input type="number" className="border rounded px-2 py-1 w-24" value={w.year} onChange={e=>updWave(i,{year:Number(e.target.value)||startYear})}/></td>
                  <td><select className="border rounded px-2 py-1 w-24" value={w.monthIdx} onChange={e=>updWave(i,{monthIdx:Number(e.target.value)||0})}>{monthLabels.map((m,idx)=>(<option key={idx} value={idx}>{m}</option>))}</select></td>
                  <td><input type="number" step={0.1} className="border rounded px-2 py-1 w-28" value={w.baseVolumeM3} onChange={e=>updWave(i,{baseVolumeM3:Number(e.target.value)||0})}/></td>
                  <td><input type="number" step={0.01} className="border rounded px-2 py-1 w-24" value={w.shareNewSKU} onChange={e=>updWave(i,{shareNewSKU:Math.max(0,Math.min(1,Number(e.target.value)||0))})}/></td>
                  <td className="text-right"><button className="px-2 py-1 border rounded" onClick={()=>delWave(i)}>Удалить</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 border rounded-lg bg-white">
        <h2 className="font-medium mb-2">Прогноз загрузки (до {horizon} мес.)</h2>
        <div style={{width:'100%',height:320}}>
          <ResponsiveContainer>
            <LineChart data={base.rows} margin={{left:12,right:12,top:12,bottom:12}}>
              <XAxis dataKey="month" interval={0} angle={-30} textAnchor="end" height={60}/>
              <YAxis domain={[0,140]} tickFormatter={v=>`${v}%`} />
              <Tooltip labelFormatter={(l:any,p:any)=> (p&&p[0]&&p[0].payload)? `${p[0].payload.ym} ${p[0].payload.labels||''}`: `${l}`}/>
              <Legend />
              <ReferenceLine y={80} stroke="#999" strokeDasharray="4 4" label="80%"/>
              <ReferenceLine y={100} stroke="#d00" strokeDasharray="4 4" label="100%"/>
              <Line type="monotone" dataKey="pctM3" name="% по м³" stroke="#2563eb" strokeWidth={2} dot={false}/>
              <Line type="monotone" dataKey="pctCells" name="% по ячейкам" stroke="#10b981" strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="text-sm mt-2">
          <b>Первое превышение 80%:</b> {base.first80||"—"} &nbsp;·&nbsp;
          <b>Первое превышение 100%:</b> {base.first100||"—"}
        </div>
        <button className="mt-2 px-3 py-1 border rounded" onClick={exportCSV}>Экспорт CSV</button>
      </div>
    </div>
  );
}
