const EU = [
  ['AT','Austria'],['BE','Belgium'],['BG','Bulgaria'],['HR','Croatia'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['EE','Estonia'],['FI','Finland'],['FR','France'],['DE','Germany'],['GR','Greece'],['HU','Hungary'],['IE','Ireland'],['IT','Italy'],['LV','Latvia'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],['NL','Netherlands'],['PL','Poland'],['PT','Portugal'],['RO','Romania'],['SK','Slovakia'],['SI','Slovenia'],['ES','Spain'],['SE','Sweden']
];
const EU_SET = new Set(EU.map(d => d[0]));
const CZ_REGIONS = new Map([
  ['CZ010','Praha'],['CZ020','Středočeský kraj'],['CZ031','Jihočeský kraj'],['CZ032','Plzeňský kraj'],['CZ041','Karlovarský kraj'],['CZ042','Ústecký kraj'],['CZ051','Liberecký kraj'],['CZ052','Královéhradecký kraj'],['CZ053','Pardubický kraj'],['CZ063','Vysočina'],['CZ064','Jihomoravský kraj'],['CZ071','Olomoucký kraj'],['CZ072','Zlínský kraj'],['CZ080','Moravskoslezský kraj']
]);
const ISO2_FROM_NAME = new Map(EU.map(([c,n]) => [n,c]));
const GEO_URLS = {
  countries: './data/geo/eu-countries.geojson',
  czRegions: './data/geo/cz-regions.geojson'
};

let state = {
  data: null,
  fuelHistory: null,
  gas: null,
  oil: null,
  currency: 'EUR',
  euFuel: 'petrol95',
  czFuel: 'petrol95',
  euCountry: 'CZ',
  euWindow: '52',
  gasCountry: 'CZ',
  geoCountries: null,
  geoRegions: null
};

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const fmt = (v, digits=2) => Number.isFinite(v) ? v.toLocaleString('en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
const asNum = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const getFuel = (row,key) => asNum(row?.[key]);
const fuelLabel = key => ({petrol95:'Euro 95 petrol', diesel:'Diesel', lpg:'LPG'})[key] || key;
const priceText = (v, currency='EUR') => v == null ? '—' : (currency === 'CZK' ? `${fmtCzk(v)} Kč/l` : `€${fmt(v,2)}/l`);
const sortBy = (arr, key) => [...arr].sort((a,b) => (a[key] ?? Infinity) - (b[key] ?? Infinity));

async function loadJson(path){
  const r = await fetch(path, {cache:'no-store'});
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function setStatus(){
  const dates = [state.data?.fuel?.as_of, state.data?.czech_regions?.as_of, state.data?.natural_gas?.as_of, state.data?.brent?.as_of].filter(Boolean);
  const latest = dates.length ? dates.sort().at(-1) : null;
  const badge = qs('#freshnessBadge');
  badge.textContent = latest ? `Latest source: ${latest}` : 'Data pending';
  badge.classList.toggle('ok', !!latest);
}

function metric(label,value,meta){return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="meta">${meta || ''}</div></div>`;}

function renderOverview(){
  const fuel = state.data.fuel;
  const rows = fuel.countries;
  const petrol = rows.map(r=>r.petrol95).filter(Number.isFinite);
  const diesel = rows.map(r=>r.diesel).filter(Number.isFinite);
  const cz = rows.find(r=>r.code==='CZ');
  const min = Math.min(...petrol), max = Math.max(...petrol);
  qs('#overviewMetrics').innerHTML = [
    metric('CZ petrol 95',priceText(cz?.petrol95,'EUR'),`week ${fuel.as_of}`),
    metric('CZ diesel',priceText(cz?.diesel,'EUR'),`week ${fuel.as_of}`),
    metric('EU petrol spread',`€${fmt(max-min,2)}/l`,`27-country min → max`),
    metric('CZ LPG',cz?.lpg != null ? priceText(cz.lpg,'EUR') : '—', cz?.lpg != null ? `week ${fuel.as_of}` : 'included after next EC refresh')
  ].join('');
  qs('#fuelAsOf').textContent = `as of ${fuel.as_of}`;
  qs('#czAsOf').textContent = `as of ${state.data.czech_regions.as_of}`;
  const top = sortBy(rows,'petrol95').slice(0,6);
  qs('#overviewFuelTable').innerHTML = `<thead><tr><th>Country</th><th class="num">Petrol</th><th class="num">Diesel</th></tr></thead><tbody>${top.map(r=>`<tr><td>${r.name}</td><td class="num">${priceText(r.petrol95)}</td><td class="num">${priceText(r.diesel)}</td></tr>`).join('')}</tbody>`;
  const regions = state.data.czech_regions.regions;
  const cheapestP = sortBy(regions,'petrol95').slice(0,2), expensiveP = [...regions].sort((a,b)=>b.petrol95-a.petrol95).slice(0,2);
  qs('#regionHighlights').innerHTML = [...cheapestP.map(r=>`<div class="region-card"><span class="small">Lower petrol snapshot</span><strong>${r.name}</strong><span>${fmt(r.petrol95)} Kč/l</span></div>`),...expensiveP.map(r=>`<div class="region-card"><span class="small">Higher petrol snapshot</span><strong>${r.name}</strong><span>${fmt(r.petrol95)} Kč/l</span></div>`)].join('');
  drawSimpleSparkline('#czSparkline', regions.map(r=>({x:r.name,y:r.petrol95})));
  drawCountryFallback('#overviewMap',rows,'petrol95');
}

function drawSimpleSparkline(selector,data){
  const el=qs(selector); el.innerHTML='';
  const w=el.clientWidth||500,h=160,m={t:20,r:12,b:30,l:42};
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const x=d3.scalePoint().domain(data.map(d=>d.x)).range([m.l,w-m.r]);
  const y=d3.scaleLinear().domain(d3.extent(data,d=>d.y)).nice().range([h-m.b,m.t]);
  svg.append('path').datum(data).attr('fill','none').attr('stroke','#61d5b7').attr('stroke-width',2.4).attr('d',d3.line().x(d=>x(d.x)).y(d=>y(d.y)));
  svg.selectAll('circle').data(data).join('circle').attr('cx',d=>x(d.x)).attr('cy',d=>y(d.y)).attr('r',3.5).attr('fill','#61d5b7');
  svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).tickValues(data.filter((_,i)=>i%3===0).map(d=>d.x)).tickFormat(s=>s.replace(' kraj',''))).selectAll('text').attr('transform','rotate(-35)').attr('text-anchor','end').attr('font-size',8).attr('fill','#97a5b7');
  svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d=>`${fmt(d,1)}`)).selectAll('text').attr('font-size',9).attr('fill','#97a5b7');
  svg.selectAll('.domain,.tick line').attr('stroke','#33445b');
}

function colorScale(values){
  const ext=d3.extent(values.filter(Number.isFinite));
  return d3.scaleSequential(d3.interpolateYlGnBu).domain(ext[1] === ext[0] ? [ext[0]-1,ext[1]+1] : ext);
}

function getGeoCode(p){
  const raw = p?.NUTS_ID ?? p?.nuts_id ?? p?.CNTR_CODE ?? p?.id ?? p?.ID ?? '';
  return String(raw).slice(0,5);
}
function getCountryCode(p){
  const raw = p?.CNTR_CODE ?? p?.NUTS_ID ?? p?.nuts_id ?? p?.id ?? p?.ID ?? '';
  const s=String(raw);
  if(EU_SET.has(s.slice(0,2))) return s.slice(0,2);
  if(EU_SET.has(s.slice(-2))) return s.slice(-2);
  const name=String(p?.NAME_ENGL ?? p?.na_en ?? p?.name ?? p?.NAME_LATN ?? '');
  return ISO2_FROM_NAME.get(name) || null;
}

async function ensureGeo(type){
  if(type==='countries' && state.geoCountries) return state.geoCountries;
  if(type==='czRegions' && state.geoRegions) return state.geoRegions;
  try{
    const g=await fetch(GEO_URLS[type]).then(r=>r.ok?r.json():Promise.reject(new Error(r.statusText)));
    if(type==='countries') state.geoCountries=g; else state.geoRegions=g;
    return g;
  }catch(e){
    console.warn('Map geometry unavailable',e);
    return null;
  }
}

function drawCountryFallback(selector,rows,key){
  const el=qs(selector); el.innerHTML='';
  const w=el.clientWidth||760,h=340,p={l:30,r:30,t:20,b:20};
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const cols=5, rowsN=Math.ceil(EU.length/cols);
  const cellW=(w-p.l-p.r)/cols, cellH=(h-p.t-p.b)/rowsN;
  const vals=new Map(state.data.fuel.countries.map(r=>[r.code,r[key]]));
  const scale=colorScale(state.data.fuel.countries.map(r=>r[key]));
  EU.forEach(([code,name],i)=>{
    const x=p.l+(i%cols)*cellW,y=p.t+Math.floor(i/cols)*cellH;
    svg.append('rect').attr('x',x+4).attr('y',y+4).attr('width',cellW-8).attr('height',cellH-8).attr('rx',10).attr('fill',scale(vals.get(code))).attr('opacity',.92);
    svg.append('text').attr('x',x+cellW/2).attr('y',y+cellH/2-1).attr('text-anchor','middle').text(code).attr('fill','#fff').attr('font-size',11).attr('font-weight',800);
    svg.append('text').attr('x',x+cellW/2).attr('y',y+cellH/2+15).attr('text-anchor','middle').text(priceText(vals.get(code),state.currency)).attr('fill','#fff').attr('font-size',9);
  });
}

async function renderEuMap(){
  const el=qs('#euMap'); el.innerHTML='';
  const geo=await ensureGeo('countries');
  const rows=state.data.fuel.countries;
  const key=state.euFuel;
  if(!geo){drawCountryFallback('#euMap',rows,key);return;}
  const features=(geo.features||[]).filter(f=>EU_SET.has(getCountryCode(f.properties)));
  const w=el.clientWidth||760,h=560;
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const values=rows.map(r=>r[key]).filter(Number.isFinite); const scale=colorScale(values); const byCode=new Map(rows.map(r=>[r.code,r]));
  const projection=d3.geoMercator().fitExtent([[12,12],[w-12,h-12]],{type:'FeatureCollection',features});
  const path=d3.geoPath(projection);
  svg.selectAll('path').data(features).join('path').attr('d',path).attr('fill',f=>{const r=byCode.get(getCountryCode(f.properties));return scale(r?.[key] ?? values[0]);}).attr('stroke','rgba(255,255,255,.7)').attr('stroke-width',1).on('mousemove',(e,f)=>showTip(e,`${byCode.get(getCountryCode(f.properties))?.name || getCountryCode(f.properties)}<br><strong>${priceText(byCode.get(getCountryCode(f.properties))?.[key],state.currency)}</strong>`)).on('mouseleave',hideTip);
  svg.selectAll('text').data(features).join('text').attr('x',f=>path.centroid(f)[0]).attr('y',f=>path.centroid(f)[1]+3).attr('text-anchor','middle').text(f=>getCountryCode(f.properties)).attr('font-size',7.5).attr('fill','#fff').attr('font-weight',800).style('pointer-events','none');
  setLegend('#euLegend',scale,'Low','High');
}

async function renderCzMap(){
  const el=qs('#czMap'); el.innerHTML='';
  const geo=await ensureGeo('czRegions');
  const regions=state.data.czech_regions.regions;
  const key=state.czFuel;
  if(!geo){ drawCzBubbles(); return; }
  const features=(geo.features||[]).filter(f=>CZ_REGIONS.has(getGeoCode(f.properties)));
  const byCode=new Map(regions.map(r=>[r.code,r]));
  const values=regions.map(r=>r[key]).filter(Number.isFinite); const scale=colorScale(values);
  const w=el.clientWidth||760,h=560;
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const projection=d3.geoMercator().fitExtent([[25,20],[w-25,h-20]],{type:'FeatureCollection',features});
  const path=d3.geoPath(projection);
  svg.selectAll('path').data(features).join('path').attr('d',path).attr('fill',f=>scale(byCode.get(getGeoCode(f.properties))?.[key] ?? values[0])).attr('stroke','rgba(255,255,255,.8)').attr('stroke-width',1.2).on('mousemove',(e,f)=>{const r=byCode.get(getGeoCode(f.properties));showTip(e,`${r?.name || getGeoCode(f.properties)}<br><strong>${fmt(r?.[key])} Kč/l</strong>`)}).on('mouseleave',hideTip);
  svg.selectAll('text').data(features).join('text').attr('x',f=>path.centroid(f)[0]).attr('y',f=>path.centroid(f)[1]+2).attr('text-anchor','middle').text(f=>getGeoCode(f.properties).replace('CZ','')).attr('font-size',7).attr('fill','#fff').attr('font-weight',800).style('pointer-events','none');
  setLegend('#czLegend',scale,'Lower','Higher');
}

function drawCzBubbles(){
  const el=qs('#czMap'); el.innerHTML='';
  const rs=state.data.czech_regions.regions; const w=el.clientWidth||760,h=560;
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const x=d3.scaleLinear().domain([12,19]).range([50,w-50]); const y=d3.scaleLinear().domain([48.5,51]).range([h-35,35]); const scale=colorScale(rs.map(r=>r[state.czFuel]).filter(Number.isFinite));
  svg.append('rect').attr('x',30).attr('y',20).attr('width',w-60).attr('height',h-55).attr('rx',28).attr('fill','rgba(122,169,255,.05)').attr('stroke','#2a3a52');
  rs.forEach(r=>{
    svg.append('circle').attr('cx',x(r.lon)).attr('cy',y(r.lat)).attr('r',18).attr('fill',scale(r[state.czFuel])).attr('stroke','#fff').attr('stroke-opacity',.55);
    svg.append('text').attr('x',x(r.lon)).attr('y',y(r.lat)+3).attr('text-anchor','middle').text(r.code.slice(2)).attr('fill','#fff').attr('font-size',9).attr('font-weight',800);
  });
  setLegend('#czLegend',scale,'Lower','Higher');
}

function setLegend(selector,scale,left,right){
  const el=qs(selector); const range=Array.from({length:8},(_,i)=>scale.domain()[0]+(scale.domain()[1]-scale.domain()[0])*(i/7));
  const stops=range.map(v=>d3.color(scale(v)).formatHex()).join(',');
  el.innerHTML=`<span>${left}</span><div class="legend-bar" style="background:linear-gradient(90deg,${stops})"></div><span>${right}</span>`;
}

function showTip(e,html){
  let t=qs('#chartTooltip'); if(!t){t=document.createElement('div');t.id='chartTooltip';t.className='chart-tooltip';document.body.appendChild(t);} t.innerHTML=html;t.style.left=`${e.clientX+12}px`;t.style.top=`${e.clientY+12}px`;t.hidden=false;
}
function hideTip(){const t=qs('#chartTooltip');if(t)t.hidden=true;}

function renderEuTable(){
  const rows=sortBy(state.data.fuel.countries,state.euFuel);
  qs('#euAsOf').textContent=`as of ${state.data.fuel.as_of}`;
  qs('#euTable').innerHTML=`<thead><tr><th>Country</th><th class="num">${fuelLabel(state.euFuel)}</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="linklike" data-country="${r.code}">${r.name}</button></td><td class="num">${priceText(r[state.euFuel],'EUR')}</td></tr>`).join('')}</tbody>`;
  qsa('[data-country]').forEach(b=>b.addEventListener('click',()=>{state.euCountry=b.dataset.country;qs('#euCountrySelect').value=state.euCountry;renderEuHistory();}));
}

function renderEuHistory(){
  const h=state.fuelHistory?.history?.[state.euCountry]||[];
  const key=state.euFuel;
  const all=h.filter(r=>Number.isFinite(r[key]));
  let data=all;
  if(state.euWindow!=='all') data=all.slice(-Number(state.euWindow));
  const el=qs('#euHistoryChart'); el.innerHTML='';
  if(!data.length){el.innerHTML='<div class="empty">Historical data will appear after the first successful EC workbook refresh.</div>';return;}
  drawLineChart(el,data.map(r=>({date:r.date,value:r[key]})),v=>v,'EUR/l');
}

function renderCzTable(){
  const rows=sortBy(state.data.czech_regions.regions,state.czFuel);
  qs('#czTableAsOf').textContent=`as of ${state.data.czech_regions.as_of}`;
  qs('#czTable').innerHTML=`<thead><tr><th>Region</th><th class="num">${fuelLabel(state.czFuel)}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.name}</td><td class="num">${Number.isFinite(r[state.czFuel])?fmt(r[state.czFuel])+' Kč/l':'—'}</td></tr>`).join('')}</tbody>`;
  renderCzBar(); renderCzMap();
}
function renderCzBar(){
  const el=qs('#czBarChart');el.innerHTML=''; const data=sortBy(state.data.czech_regions.regions,state.czFuel);
  if(!data.length)return;
  const w=el.clientWidth||900,h=Math.max(330,data.length*27+55); const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const m={l:185,r:65,t:15,b:20}; const x=d3.scaleLinear().domain([0,d3.max(data,d=>d[state.czFuel])]).nice().range([m.l,w-m.r]); const y=d3.scaleBand().domain(data.map(d=>d.name)).range([m.t,h-m.b]).padding(.23);
  svg.selectAll('rect').data(data).join('rect').attr('x',m.l).attr('y',d=>y(d.name)).attr('width',d=>x(d[state.czFuel])-m.l).attr('height',y.bandwidth()).attr('rx',6).attr('fill','url(#barGradient)');
  const defs=svg.append('defs'),g=defs.append('linearGradient').attr('id','barGradient');g.append('stop').attr('offset','0%').attr('stop-color','#61d5b7');g.append('stop').attr('offset','100%').attr('stop-color','#7aa9ff');
  svg.selectAll('.label').data(data).join('text').attr('x',m.l-8).attr('y',d=>y(d.name)+y.bandwidth()/2+4).attr('text-anchor','end').text(d=>d.name).attr('fill','#a4b1c1').attr('font-size',10);
  svg.selectAll('.val').data(data).join('text').attr('x',d=>x(d[state.czFuel])+8).attr('y',d=>y(d.name)+y.bandwidth()/2+4).text(d=>`${fmt(d[state.czFuel])}`).attr('fill','#e9eff8').attr('font-size',10).attr('font-family','JetBrains Mono, monospace');
}

function periodToDate(period){
  const m=String(period||'').match(/^(\d{4})[-_](?:S|H)([12])$/i);
  if(m) return new Date(Date.UTC(Number(m[1]), Number(m[2])===2 ? 6 : 0, 1));
  return new Date(period);
}
function drawLineChart(el,data,transform,label){
  const w=el.clientWidth||900,h=380,m={l:55,r:18,t:20,b:46}; const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
  const dateOf=d=>d.date ? new Date(`${d.date}T00:00:00Z`) : periodToDate(d.period);
  const x=d3.scaleTime().domain(d3.extent(data,dateOf)).range([m.l,w-m.r]);
  const vals=data.map(d=>transform(d.value)); const y=d3.scaleLinear().domain(d3.extent(vals)).nice().range([h-m.b,m.t]);
  svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %Y'))).call(g=>g.selectAll('text').attr('fill','#97a5b7').attr('font-size',9)).call(g=>g.selectAll('path,line').attr('stroke','#33445b'));
  svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v=>fmt(v,2))).call(g=>g.selectAll('text').attr('fill','#97a5b7').attr('font-size',9)).call(g=>g.selectAll('path,line').attr('stroke','#33445b'));
  svg.append('path').datum(data).attr('fill','none').attr('stroke','#61d5b7').attr('stroke-width',2.4).attr('d',d3.line().x(d=>x(dateOf(d))).y(d=>y(transform(d.value))));
  svg.append('text').attr('x',w-m.r).attr('y',18).attr('text-anchor','end').attr('fill','#97a5b7').attr('font-size',10).text(label);
}

function renderGas(){
  const hist=state.gas?.history || {}; const entries=Object.entries(hist).map(([code,series])=>({code,series,last:series?.at(-1)?.value})).filter(d=>Number.isFinite(d.last));
  const names=new Map(EU.map(([c,n])=>[c,n])); names.set('EU27','EU-27');
  qs('#gasCountrySelect').innerHTML=entries.sort((a,b)=>(names.get(a.code)||a.code).localeCompare(names.get(b.code)||b.code)).map(d=>`<option value="${d.code}">${names.get(d.code)||d.code}</option>`).join('');
  if(!entries.some(d=>d.code===state.gasCountry)) state.gasCountry=entries[0]?.code||'CZ';
  qs('#gasCountrySelect').value=state.gasCountry;
  const series=hist[state.gasCountry]||[];
  const latest=series.at(-1)?.value; const previous=series.at(-2)?.value;
  qs('#gasMetrics').innerHTML=[metric('Latest',Number.isFinite(latest)?`${fmt(latest*100,2)} c€/kWh`:'—',state.gas?.band||''),metric('Year-on-year',Number.isFinite(latest)&&Number.isFinite(previous)?`${fmt((latest/previous-1)*100,1)}%`:'—',previous?'previous semester':'not enough history'),metric('Tax basis','All taxes','Eurostat I_TAX'),metric('Cadence','Half-yearly','official consumer statistic')].join('');
  qs('#gasAsOf').textContent=series.at(-1)?.period || '';
  qs('#gasChart').innerHTML='';
  if(series.length) drawLineChart(qs('#gasChart'),series.map(x=>({period:x.period,value:x.value})),v=>v*100,'c€/kWh'); else qs('#gasChart').innerHTML='<div class="empty">No gas history available.</div>';
  const table=entries.sort((a,b)=>b.last-a.last);
  qs('#gasTable').innerHTML=`<thead><tr><th>Country</th><th class="num">EUR/kWh</th><th class="num">c€/kWh</th><th>Latest</th></tr></thead><tbody>${table.map(d=>`<tr><td>${names.get(d.code)||d.code}</td><td class="num">${fmt(d.last,4)}</td><td class="num">${fmt(d.last*100,2)}</td><td>${d.series.at(-1)?.period||'—'}</td></tr>`).join('')}</tbody>`;
}

function renderBrent(){
  const h=state.oil?.history||[]; const last=h.at(-1)?.value; const prev=h.at(-2)?.value; const delta=Number.isFinite(last)&&Number.isFinite(prev)?(last-prev):null;
  qs('#brentMetrics').innerHTML=[metric('Latest',Number.isFinite(last)?`$${fmt(last,2)}`:'—',state.oil?.as_of||''),metric('1-day move',delta!=null?`${delta>=0?'+':''}${fmt(delta,2)}`:'—','USD/barrel'),metric('Series','DCOILBRENTEU','EIA via FRED'),metric('Cadence','Daily','business days')].join('');
  qs('#brentChart').innerHTML=''; if(h.length) drawLineChart(qs('#brentChart'),h.map(x=>({date:x.date,value:x.value})),v=>v,'USD/barrel');
}

function renderSources(){
  const f=state.data?.fuel; const cz=state.data?.czech_regions; const g=state.gas; const o=state.oil;
  const cards=[
    ['European Commission','Weekly Oil Bulletin','Weekly national consumer prices for petroleum products; use for petrol, diesel and LPG.','https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en',f?.as_of,'Primary'],
    ['Eurostat','nrg_pc_202','Household natural gas price statistics. This app selects D2, EUR/kWh and I_TAX (all taxes included).','https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_202',g?.as_of,'Primary'],
    ['U.S. EIA / FRED','DCOILBRENTEU','Europe Brent Spot Price FOB, daily, USD/barrel.','https://fred.stlouisfed.org/series/DCOILBRENTEU',o?.as_of,'Primary series / official distributor'],
    ['Czech regional feed','Czech regions','Regional Czech averages from a secondary public feed; snapshots are date-labelled and retained when the feed is unavailable.','https://cenaphm.cz/data.json',cz?.as_of,'Secondary'],
    ['European Commission GISCO','NUTS 2024 geometry','Map boundaries used for EU countries and Czech NUTS-3 regions.','https://gisco-services.ec.europa.eu/distribution/v1/nuts-2024.html','NUTS 2024','Map geometry']
  ];
  qs('#sourceCards').innerHTML=cards.map(c=>`<div class="source-card"><div class="eyebrow">${c[5]}</div><h3>${c[0]} · ${c[1]}</h3><p>${c[2]}</p><a href="${c[3]}" target="_blank" rel="noopener noreferrer">Open source ↗</a><div class="small">Reference: ${c[4]||'—'}</div></div>`).join('');
}

function initControls(){
  qsa('.tab').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
  qsa('[data-go]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.go)));
  qs('#themeToggle').addEventListener('click',()=>{document.documentElement.classList.toggle('light');localStorage.setItem('theme',document.documentElement.classList.contains('light')?'light':'dark');});
  if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light');
  qs('#euFuelSelect').addEventListener('change',e=>{state.euFuel=e.target.value;renderEuTable();renderEuMap();renderEuHistory();});
    qs('#euHistoryWindow').addEventListener('change',e=>{state.euWindow=e.target.value;renderEuHistory();});
  qs('#euCountrySelect').addEventListener('change',e=>{state.euCountry=e.target.value;renderEuHistory();});
  qs('#czFuelSelect').addEventListener('change',e=>{state.czFuel=e.target.value;renderCzTable();});
  qs('#gasCountrySelect').addEventListener('change',e=>{state.gasCountry=e.target.value;renderGas();});
}
function switchView(view){
  qsa('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  qsa('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
  if(view==='eu-fuel') { renderEuTable();renderEuMap();renderEuHistory(); }
  if(view==='czechia') renderCzTable();
  if(view==='gas') renderGas();
  if(view==='brent') renderBrent();
  if(view==='sources') renderSources();
  window.scrollTo({top:0,behavior:'smooth'});
}

async function boot(){
  initControls();
  const [data,fuelHistory,gas,oil]=await Promise.all([
    loadJson('./data/current.json'),loadJson('./data/fuel-history.json'),loadJson('./data/gas.json'),loadJson('./data/oil.json')
  ]);
  state.data=data;state.fuelHistory=fuelHistory;state.gas=gas;state.oil=oil;
  setStatus();renderOverview();renderSources();
  qs('#euCountrySelect').innerHTML=EU.map(([c,n])=>`<option value="${c}">${n}</option>`).join('');
  qs('#euCountrySelect').value='CZ';
}

boot().catch(err=>{
  console.error(err);
  const b=qs('#freshnessBadge');b.textContent='Data load failed';b.classList.remove('ok');
  document.querySelector('main').insertAdjacentHTML('afterbegin',`<div class="panel" style="margin-bottom:16px;border-color:#8d4d55"><strong>Data files could not be loaded.</strong><div style="color:var(--muted);margin-top:4px">The site still builds, but its JSON assets are missing or inaccessible. Run the repository's data refresh workflow or check that the <code>data/</code> folder was published.</div></div>`);
});
