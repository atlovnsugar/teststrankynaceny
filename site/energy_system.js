/* EUROPEAN ENERGY SYSTEM — v12
 * Evidence-first energy-system maps.
 *
 * Principles:
 *  1) Electricity mix = Eurostat generation, grouped from SIEC fuel labels.
 *  2) Prices = Eurostat / existing official historical datasets.
 *  3) Gas physical flows = ENTSOG transmission-point observations.
 *  4) Pipeline geometry = Global Energy Monitor current route snapshot.
 *  5) Oil origin = Eurostat trade origin; it is NEVER drawn as pipeline throughput.
 */
(() => {
  const EU = [
    ['AT','Austria'],['BE','Belgium'],['BG','Bulgaria'],['HR','Croatia'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['EE','Estonia'],['FI','Finland'],['FR','France'],['DE','Germany'],['GR','Greece'],['HU','Hungary'],['IE','Ireland'],['IT','Italy'],['LV','Latvia'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],['NL','Netherlands'],['PL','Poland'],['PT','Portugal'],['RO','Romania'],['SK','Slovakia'],['SI','Slovenia'],['ES','Spain'],['SE','Sweden']
  ];
  const NAME = new Map(EU), CODES = new Set(EU.map(x => x[0]));
  const state = {
    country: 'CZ', year: null, layer: 'renewable', price: 'electricity',
    flow: 'gas', oilMode: 'infrastructure', oilProduct: 'petrol95', oilPeriod: null,
    system: null, fuel: null, gas: null, supply: null, geometry: null,
    infra: {gas:null, oil:null}, gasPoints: null, selectedPoint: null,
    pointHistory: [], pointLoading: false
  };
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const fmt = (v,d=1) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const pct = v => Number.isFinite(Number(v)) ? `${fmt(Number(v)*100,1)}%` : '—';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const builtVersion = () => window.RUNTIME_CONFIG?.builtAt ? `?v=${encodeURIComponent(window.RUNTIME_CONFIG.builtAt)}` : '';
  const fetchJson = async (url, opts={}) => { const r = await fetch(url + builtVersion(), {cache:'no-store', ...opts}); if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  const flag = (code, name) => {
    const c = String(code||'').toLowerCase();
    return /^[a-z]{2}$/.test(c) ? `<img class="energy-flag" src="https://flagcdn.com/w40/${c}.png" alt="${esc(name||code)} flag"><span>${esc(name||code)}</span>` : `<span>${esc(name||code)}</span>`;
  };
  const groupColor = k => ({renewable:'#70d69a',fossil:'#ff3d55',nuclear:'#9a8cff',other:'#8d98aa'}[k]||'#8d98aa');
  const priceLabel = k => ({electricity:'Electricity · household',gas:'Natural gas · household',petrol95:'Petrol 95',diesel:'Diesel',lpg:'LPG'}[k]||k);
  const priceText = (k,v) => {
    if(!Number.isFinite(Number(v))) return 'NR';
    return k==='electricity'||k==='gas' ? `€${fmt(v,3)}/kWh` : `€${fmt(v,3)}/L`;
  };
  const geoCode = p => { const r=p?.CNTR_CODE??p?.NUTS_ID??p?.id??''; const s=String(r).toUpperCase(); if(CODES.has(s.slice(0,2)))return s.slice(0,2); if(CODES.has(s.slice(-2)))return s.slice(-2); return null; };

  function latestFuel(code,key){ return state.fuel?.history?.[code]?.at(-1)?.[key] ?? null; }
  function latestGas(code){ return state.gas?.history?.[code]?.at(-1)?.value ?? null; }
  function latestElec(code){ return state.system?.prices?.electricity?.[code]?.at(-1)?.value ?? null; }
  function priceValue(code,key){ return key==='electricity'?latestElec(code):key==='gas'?latestGas(code):latestFuel(code,key); }
  function allCountryFeatures(){ return (state.geometry?.features||[]).filter(f=>CODES.has(geoCode(f.properties))); }
  function countryFeatureCollection(){ return {type:'FeatureCollection',features:allCountryFeatures()}; }
  function projectMap(el, features, width, height){ return d3.geoMercator().fitExtent([[12,12],[width-12,height-12]], {type:'FeatureCollection',features}); }
  function showTip(e,html){ const t=$('#systemTooltip'); if(!t)return; t.innerHTML=html; t.style.left=`${Math.min(e.clientX+14,innerWidth-370)}px`; t.style.top=`${Math.min(e.clientY+14,innerHeight-130)}px`; t.hidden=false; }
  function hideTip(){ const t=$('#systemTooltip'); if(t)t.hidden=true; }

  async function load(){
    const [system,fuel,gas,supply,geo] = await Promise.all([
      fetchJson('./data/electricity-system.json'),
      fetchJson('./data/fuel-history.json'),
      fetchJson('./data/gas.json'),
      fetchJson('./data/supply.json').catch(()=>null),
      fetchJson('./data/geo/eu-countries.geojson')
    ]);
    state.system=system; state.fuel=fuel; state.gas=gas; state.supply=supply; state.geometry=geo;
    state.year = state.system?.mix?.[state.country] ? Object.keys(state.system.mix[state.country]).sort().at(-1) : null;
    populateControls();
    setStatus();
    renderAll();
  }

  function setStatus(){
    const el=$('#flowSystemStatus'); if(!el)return;
    const a=state.system?.meta?.history_from||'—', b=state.system?.meta?.history_to||'—';
    el.textContent=`SYSTEM ARCHIVE ${a} → ${b}`;
    el.classList.toggle('ok',!!state.system?.meta);
  }

  function populateControls(){
    const cs=$('#systemCountry'); if(cs){ cs.innerHTML=EU.map(([c,n])=>`<option value="${c}">${n}</option>`).join(''); cs.value=state.country; }
    const years=Object.keys(state.system?.mix?.[state.country]||{}).sort(); const ys=$('#systemYear');
    if(ys){ ys.innerHTML=years.map(y=>`<option>${y}</option>`).join(''); ys.value=years.includes(state.year)?state.year:(years.at(-1)||''); state.year=ys.value||state.year; }
    const ps=$('#systemPrice'); if(ps) ps.value=state.price;
    const op=$('#oilPeriod'); const periods=getOilPeriods(); if(op){ op.innerHTML=periods.map(p=>`<option>${p}</option>`).join(''); state.oilPeriod = periods.includes(state.oilPeriod)?state.oilPeriod:periods.at(-1)||null; op.value=state.oilPeriod||''; }
  }

  function getOilPeriods(){
    const hist=state.supply?.oil?.[state.oilProduct]?.CZ?.history||[];
    return hist.map(x=>x.period).filter(Boolean);
  }

  function renderAll(){
    if(!state.system)return;
    renderElectricityMap(); renderMixChart(); renderPriceMap(); renderFlowMap(); renderCountryDesk();
  }

  function renderElectricityMap(){
    const el=$('#systemMixMap'); if(!el||!window.d3)return; el.innerHTML='';
    const features=allCountryFeatures(), w=el.clientWidth||960, h=520, svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
    const proj=projectMap(el,features,w,h), path=d3.geoPath(proj), vals=Object.fromEntries(features.map(f=>[geoCode(f.properties),state.system.mix?.[geoCode(f.properties)]?.[state.year]?.shares?.[state.layer]]));
    const numbers=Object.values(vals).filter(Number.isFinite), extent=numbers.length?d3.extent(numbers):[0,1];
    const hi=Math.max(extent[1]||0,0.01), scale=d3.scaleSequential().domain([0,hi]).interpolator(t=>d3.interpolateRgb('#12161f',groupColor(state.layer))(t));
    svg.selectAll('path').data(features).join('path').attr('class','system-country').attr('d',path).attr('fill',f=>{const v=vals[geoCode(f.properties)];return Number.isFinite(v)?scale(v):'#171c25';})
      .on('mousemove',(e,f)=>{const c=geoCode(f.properties),m=state.system.mix?.[c]?.[state.year]; showTip(e,`<strong>${esc(NAME.get(c)||c)}</strong><br>${esc(layerLabel(state.layer))}: <b>${pct(m?.shares?.[state.layer])}</b><br>${state.year||'—'} · click for country desk`);})
      .on('mouseleave',hideTip).on('click',(e,f)=>selectCountry(geoCode(f.properties)));
    const note=$('#systemMapNote'); if(note)note.textContent=`${layerLabel(state.layer)} share of annual electricity generation · ${state.year}`;
  }
  function layerLabel(k){return ({renewable:'Renewables',fossil:'Fossil fuels',nuclear:'Nuclear'}[k]||k);}

  function renderMixChart(){
    const el=$('#systemMixChart'); if(!el||!window.d3)return; el.innerHTML='';
    const s=state.system.mix?.[state.country]||{}, years=Object.keys(s).sort(); if(!years.length){el.innerHTML='<div class="energy-empty">No annual generation history for this country.</div>';return;}
    const data=years.map(y=>({year:y,renewable:s[y].shares.renewable||0,nuclear:s[y].shares.nuclear||0,fossil:s[y].shares.fossil||0,other:s[y].shares.other||0}));
    const w=el.clientWidth||900,h=360,m={l:56,r:20,t:20,b:48}; const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);
    const x=d3.scalePoint().domain(years).range([m.l,w-m.r]), y=d3.scaleLinear().domain([0,1]).range([h-m.b,m.t]);
    svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).tickValues(years.filter((_,i)=>i%3===0))).call(g=>g.selectAll('text').attr('fill','#8993a6').attr('font-family','IBM Plex Mono').attr('font-size',9));
    svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(v=>`${Math.round(v*100)}%`)).call(g=>g.selectAll('text').attr('fill','#8993a6').attr('font-family','IBM Plex Mono').attr('font-size',9));
    const stack=d3.stack().keys(['renewable','nuclear','fossil','other'])(data), area=d3.area().x(d=>x(d.data.year)).y0(d=>y(d[0])).y1(d=>y(d[1])).curve(d3.curveMonotoneX);
    svg.append('g').selectAll('path').data(stack).join('path').attr('d',area).attr('fill',d=>groupColor(d.key)).attr('fill-opacity',.72).attr('stroke','#090c11').attr('stroke-width',1);
    const overlay=svg.append('g').selectAll('rect').data(data).join('rect').attr('x',d=>x(d.year)-8).attr('y',m.t).attr('width',16).attr('height',h-m.t-m.b).attr('fill','transparent').on('mousemove',(e,d)=>showTip(e,`<strong>${esc(d.year)}</strong><br>Renewables: <b>${pct(d.renewable)}</b><br>Fossil: <b>${pct(d.fossil)}</b><br>Nuclear: <b>${pct(d.nuclear)}</b>`)).on('mouseleave',hideTip);
    overlay.raise();
  }

  function renderPriceMap(){
    const el=$('#systemPriceMap'); if(!el||!window.d3)return; el.innerHTML='';
    const features=allCountryFeatures(), w=el.clientWidth||960, h=500, svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`), proj=projectMap(el,features,w,h), path=d3.geoPath(proj);
    const vals=features.map(f=>priceValue(geoCode(f.properties),state.price)).filter(Number.isFinite), extent=vals.length?d3.extent(vals):[0,1], domain=extent[0]===extent[1]?[extent[0]-1,extent[1]+1]:extent;
    const scale=d3.scaleSequential().domain(domain).interpolator(t=>d3.interpolateRgb('#141923','#ff3d55')(t));
    svg.selectAll('path').data(features).join('path').attr('class','system-country').attr('d',path).attr('fill',f=>{const v=priceValue(geoCode(f.properties),state.price);return Number.isFinite(v)?scale(v):'#171c25';})
      .on('mousemove',(e,f)=>{const c=geoCode(f.properties);showTip(e,`<strong>${esc(NAME.get(c)||c)}</strong><br>${esc(priceLabel(state.price))}: <b>${priceText(state.price,priceValue(c,state.price))}</b>`);})
      .on('mouseleave',hideTip).on('click',(e,f)=>selectCountry(geoCode(f.properties)));
    const note=$('#systemPriceMapNote'); if(note)note.textContent=`Latest available source observation · ${priceLabel(state.price)}`;
  }

  function selectCountry(code){ if(!CODES.has(code))return; state.country=code; populateControls(); renderMixChart(); renderCountryDesk(); document.querySelector('#systemCountryDesk')?.scrollIntoView({behavior:'smooth',block:'nearest'}); const d=$('#systemCountryDesk'); if(d){d.classList.remove('energy-pulse'); void d.offsetWidth; d.classList.add('energy-pulse');} }

  function renderCountryDesk(){
    const c=state.country, m=state.system.mix?.[c]?.[state.year], desk=$('#systemCountryDesk'); if(!desk)return;
    const shares=m?.shares||{}, sources=m?.sources||{}, keys=Object.keys(sources).sort((a,b)=>(sources[b]||0)-(sources[a]||0)).slice(0,10);
    $('#systemDeskTitle').innerHTML=`${esc(NAME.get(c)||c)} <span class="desk-code">${c}</span>`;
    $('#systemDeskMeta').textContent=`${state.year||'—'} generation · Eurostat monthly net electricity generation aggregated to annual totals`;
    $('#systemDeskCards').innerHTML=[['Renewable',pct(shares.renewable),'renewable'],['Fossil',pct(shares.fossil),'fossil'],['Nuclear',pct(shares.nuclear),'nuclear'],['Generation',`${fmt(m?.total,0)} GWh`,'other']].map(x=>`<div class="energy-card"><span>${x[0]}</span><b class="${x[2]}">${x[1]}</b></div>`).join('');
    $('#systemDeskSources').innerHTML=keys.length?keys.map(k=>`<div class="energy-row"><span>${esc(k)}</span><b>${fmt(sources[k],0)} GWh</b></div>`).join(''):'<div class="energy-empty">No source breakdown available.</div>';
    $('#systemDeskPrices').innerHTML=['electricity','gas','petrol95','diesel','lpg'].map(k=>`<div class="energy-row"><span>${esc(priceLabel(k))}</span><b>${priceText(k,priceValue(c,k))}</b></div>`).join('');
    const origin=state.supply?.oil?.[state.oilProduct]?.[c]?.history?.at(-1);
    $('#systemDeskOrigins').innerHTML=origin?.groupVolumes ? Object.entries(origin.groupVolumes).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([g,v])=>`<div class="energy-row"><span>${esc(g)}</span><b>${fmt(origin.total?v/origin.total*100:0,1)}%</b></div>`).join(''):'<div class="energy-empty">Oil-origin archive not available in current build.</div>';
  }

  function updateFlowControls(){
    const oil=state.flow==='oil'; const infra=state.oilMode==='infrastructure';
    const a=$('#oilModeWrap'),b=$('#oilProductWrap'),c=$('#oilPeriodWrap'); if(a)a.hidden=!oil; if(b)b.hidden=!oil||infra; if(c)c.hidden=!oil||infra;
  }

  function renderFlowMap(){
    const el=$('#systemFlowMap'); if(!el||!window.d3)return; el.innerHTML=''; updateFlowControls();
    if(state.flow==='gas') renderGasFlowMap(el); else renderOilFlowMap(el);
  }

  async function loadInfra(type){
    if(state.infra[type])return state.infra[type];
    const url=`./data/infrastructure/${type}-pipelines.geojson`;
    state.infra[type]=await fetchJson(url).catch(()=>null); return state.infra[type];
  }

  function drawBase(svg,proj,path){
    svg.append('g').selectAll('path').data(allCountryFeatures()).join('path').attr('d',path).attr('fill','#0f141b').attr('stroke','#2a3340').attr('stroke-width',.7);
  }

  async function renderGasFlowMap(el){
    const note=$('#flowRealityNote'); if(note)note.innerHTML='<b>GAS FLOW:</b> route geometry comes from Global Energy Monitor; observed volumes come from ENTSOG transmission-point data. Click a point for the actual monthly physical-flow history. No guessed source→country pipeline lines are drawn.';
    const [infra,points]=await Promise.all([loadInfra('gas'),loadGasPoints()]);
    const features=allCountryFeatures(), w=el.clientWidth||960,h=560,svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),proj=projectMap(el,features,w,h),path=d3.geoPath(proj); drawBase(svg,proj,path);
    const routeCount=drawRoutes(svg,proj,infra,'gas');
    if(!points.length){$('#flowMapMeta').textContent='ENTSOG returned no mappable transmission points.';return;}
    svg.append('g').selectAll('circle').data(points).join('circle').attr('class','flow-point').attr('cx',p=>proj([p.lon,p.lat])[0]).attr('cy',p=>proj([p.lon,p.lat])[1]).attr('r',2.8).attr('fill','#ff3d55').attr('fill-opacity',.75).on('mousemove',(e,p)=>showTip(e,`<strong>${esc(p.pointLabel||p.point||'Interconnection point')}</strong><br>${esc(p.country||p.operatorLabel||'ENTSOG')}<br><span>Click → observed monthly physical flow</span>`)).on('mouseleave',hideTip).on('click',(e,p)=>openPointHistory(p));
    $('#flowMapMeta').textContent=`${points.length} mappable ENTSOG point-directions · ${routeCount} current gas-route features${routeCount?'':' (route package unavailable)'} · flow values are loaded from ENTSOG on point selection`;
  }

  async function loadGasPoints(){
    if(state.gasPoints)return state.gasPoints;
    try{
      const u='https://transparency.entsog.eu/api/v1/operatorpointdirections.json?hasData=1&limit=-1';
      const r=await fetch(u,{cache:'no-store'}); if(!r.ok)throw new Error(`ENTSOG point API HTTP ${r.status}`); const j=await r.json();
      const raw=j.operatorpointdirections||j.items||j.data||[]; state.gasPoints=(Array.isArray(raw)?raw:[]).map(p=>({
        pointDirection:p.pointDirection||p.pointDirectionKey||p.key,
        pointLabel:p.pointLabel||p.point||p.pointKey,
        operatorLabel:p.operatorLabel||p.operator,
        country:p.countryCode||p.country,
        lat:Number(p.lat??p.latitude),lon:Number(p.lon??p.longitude)
      })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lon>=-15&&p.lon<=45&&p.lat>=30&&p.lat<=75);
    }catch(e){state.gasPoints=[]; const n=$('#flowRealityNote');if(n)n.innerHTML+=`<br><span class="flow-warn">Live ENTSOG points unavailable: ${esc(e.message)}</span>`;}
    return state.gasPoints;
  }

  function drawRoutes(svg,proj,geo,type){
    if(!geo?.features?.length)return 0; const path=d3.geoPath(proj), label=type==='gas'?'GGIT route':'GOIT route';
    svg.append('g').selectAll('path').data(geo.features).join('path').attr('class','infra-route').attr('d',path).attr('stroke',type==='gas'?'#70c7ff':'#ffb45e').attr('stroke-width',1.3).attr('stroke-opacity',.65).attr('fill','none')
      .on('mousemove',(e,f)=>{const p=f.properties||{};showTip(e,`<strong>${esc(p.PipelineName||p.pipeline||p.Name||label)}</strong><br>Status: ${esc(p.Status||p.status||'—')}<br>Capacity: ${esc(String(p.CapacityBOEd??p.Capacity??p.capacity??'—'))}`);}).on('mouseleave',hideTip);
    return geo.features.length;
  }

  function renderOilFlowMap(el){
    const note=$('#flowRealityNote'); if(note)note.innerHTML = state.oilMode==='infrastructure' ? '<b>OIL INFRASTRUCTURE:</b> current route geometry comes from Global Energy Monitor. Public EU-wide sources do <u>not</u> provide a defensible pipeline-by-pipeline throughput time series for every route, so the map never fabricates one.' : '<b>OIL TRADE ORIGINS:</b> Eurostat monthly imports by ultimate origin are shown as trade flows. These are not pipeline-throughput measurements.';
    const features=allCountryFeatures(), w=el.clientWidth||960,h=560,svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),proj=projectMap(el,features,w,h),path=d3.geoPath(proj); drawBase(svg,proj,path);
    if(state.oilMode==='infrastructure'){ drawRoutes(svg,proj,state.infra?.oil,'oil'); $('#flowMapMeta').textContent='GOIT / Global Energy Monitor route snapshot · current infrastructure geometry'; return; }
    const period=state.oilPeriod||getOilPeriods().at(-1); const originHubs={'RU':[37,57],'US':[-100,38],'NO':[8,62],'GB':[-3,55],'DZ':[2,28],'LY':[17,28],'AE':[54,25],'SA':[45,24],'QA':[51,25],'AZ':[47,40]}; const groupKey={RU:'Russia',US:'United States',NO:'Norway',GB:'United Kingdom',DZ:'North Africa',LY:'North Africa',AE:'Middle East',SA:'Middle East',QA:'Middle East',AZ:'Azerbaijan / Caspian'};
    const targets=[]; for(const [code,name] of EU){const row=state.supply?.oil?.[state.oilProduct]?.[code]?.history?.find(x=>x.period===period);if(row)targets.push({code,name,row});}
    if(!targets.length){el.innerHTML='<div class="energy-empty">Oil-origin archive is not available. Run the data refresh first.</div>';return;}
    const groups=Object.keys(originHubs), max=d3.max(targets,t=>t.row.total)||1, layer=svg.append('g');
    for(const src of groups){const gname=groupKey[src], hub=originHubs[src], hp=project(hub,proj);for(const t of targets){const amount=t.row.groupVolumes?.[gname]||0;if(!amount)continue;const f=features.find(x=>geoCode(x.properties)===t.code);if(!f)continue;const cp=path.centroid(f),mx=(hp[0]+cp[0])/2,my=(hp[1]+cp[1])/2-28;layer.append('path').attr('d',`M${hp[0]},${hp[1]} Q${mx},${my} ${cp[0]},${cp[1]}`).attr('fill','none').attr('stroke',src==='RU'?'#ff3d55':src==='US'?'#ffd166':'#70c7ff').attr('stroke-opacity',.48).attr('stroke-width',1+4*Math.sqrt(amount/(max||1))).on('mousemove',e=>showTip(e,`<strong>${esc(gname)} → ${esc(t.name)}</strong><br>${fmt(amount,1)} · ${esc(t.row.unit||'kt')} · ${esc(period)}<br><span>Eurostat import trade · ultimate origin</span>`)).on('mouseleave',hideTip);}}
    $('#flowMapMeta').textContent=`${priceLabel(state.oilProduct)} import-origin trade corridors · ${period} · line weight = reported monthly import volume`;
  }
  function project([lon,lat],proj){return proj([lon,lat]);}

  async function openPointHistory(point){
    const m=$('#systemFlowHistory'), title=$('#flowHistoryTitle'), meta=$('#flowHistoryMeta'), chart=$('#flowHistoryChart'); if(!m)return; m.hidden=false; state.pointLoading=true; title.textContent=point.pointLabel||point.point||'ENTSOG point'; meta.textContent='Loading ENTSOG physical-flow history…'; chart.innerHTML='<div class="energy-empty">Loading…</div>';
    const key=point.pointDirection; if(!key){state.pointLoading=false;meta.textContent='This point does not expose a queryable pointDirection key.';chart.innerHTML='<div class="energy-empty">No flow history available for this point.</div>';return;}
    const now=new Date(), from=new Date(Date.UTC(2010,0,1)), to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
    const q=new URLSearchParams({pointDirection:key,from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10),indicator:'Physical Flow',periodType:'month',timeZone:'CET',limit:'-1'});
    try{
      const r=await fetch(`https://transparency.entsog.eu/api/v1/aggregatedData?${q.toString()}`,{cache:'no-store'}); if(!r.ok)throw new Error(`ENTSOG HTTP ${r.status}`); const j=await r.json(); const arr=Array.isArray(j.aggregatedData)?j.aggregatedData:Array.isArray(j.data)?j.data:Array.isArray(j.items)?j.items:[];
      const hist=arr.map(x=>({period:String(x.periodFrom||x.period||x.date||'').slice(0,7),value:Number(x.value),unit:x.unit||'kWh/d'})).filter(x=>x.period&&Number.isFinite(x.value)).sort((a,b)=>a.period.localeCompare(b.period)); state.pointHistory=hist; state.pointLoading=false; meta.textContent=`Physical Flow · monthly · ${hist.length} observations · ${hist.at(-1)?.unit||''}`; drawPointHistory(chart,hist);
    }catch(e){state.pointLoading=false;meta.textContent=`ENTSOG query failed: ${e.message}`;chart.innerHTML='<div class="energy-empty">No history could be retrieved for this point.</div>';}
  }
  function drawPointHistory(el,hist){
    if(!hist.length){el.innerHTML='<div class="energy-empty">No historical observations returned.</div>';return;} const w=el.clientWidth||900,h=340,m={l:60,r:18,t:20,b:46},svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),x=d3.scalePoint().domain(hist.map(d=>d.period)).range([m.l,w-m.r]),y=d3.scaleLinear().domain([0,d3.max(hist,d=>d.value)||1]).nice().range([h-m.b,m.t]);
    svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).tickValues(hist.filter((_,i)=>i%3===0).map(d=>d.period))).call(g=>g.selectAll('text').attr('fill','#8993a6').attr('font-family','IBM Plex Mono').attr('font-size',9));
    svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v=>fmt(v,0))).call(g=>g.selectAll('text').attr('fill','#8993a6').attr('font-family','IBM Plex Mono').attr('font-size',9));
    const line=d3.line().x(d=>x(d.period)).y(d=>y(d.value)).curve(d3.curveMonotoneX); svg.append('path').datum(hist).attr('d',line).attr('fill','none').attr('stroke','#ff3d55').attr('stroke-width',2.3);
    svg.selectAll('circle').data(hist).join('circle').attr('cx',d=>x(d.period)).attr('cy',d=>y(d.value)).attr('r',2.8).attr('fill','#ffd166').on('mousemove',(e,d)=>showTip(e,`<strong>${esc(d.period)}</strong><br>${fmt(d.value,0)} ${esc(d.unit||'')}`)).on('mouseleave',hideTip);
  }

  function events(){
    $('#systemCountry')?.addEventListener('change',e=>selectCountry(e.target.value));
    $('#systemYear')?.addEventListener('change',e=>{state.year=e.target.value;renderElectricityMap();renderMixChart();renderCountryDesk();});
    $$('#systemLayer button').forEach(b=>b.addEventListener('click',()=>{$$('#systemLayer button').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.layer=b.dataset.layer;renderElectricityMap();}));
    $('#systemPrice')?.addEventListener('change',e=>{state.price=e.target.value;renderPriceMap();});
    $('#flowType')?.addEventListener('change',e=>{state.flow=e.target.value;updateFlowControls();renderFlowMap();});
    $('#oilMode')?.addEventListener('change',e=>{state.oilMode=e.target.value;if(state.oilMode==='infrastructure'&&!state.infra.oil)loadInfra('oil').then(renderFlowMap);else renderFlowMap();});
    $('#oilProduct')?.addEventListener('change',e=>{state.oilProduct=e.target.value;populateControls();renderFlowMap();});
    $('#oilPeriod')?.addEventListener('change',e=>{state.oilPeriod=e.target.value;renderFlowMap();});
    $('#systemFlowHistoryClose')?.addEventListener('click',()=>{$('#systemFlowHistory').hidden=true;});
    $('#systemFlowHistory')?.addEventListener('click',e=>{if(e.target.id==='systemFlowHistory')e.currentTarget.hidden=true;});
    window.addEventListener('resize',()=>{if($('#view-system')?.classList.contains('active'))renderAll();});
  }

  let eventsBound=false;
  function bindOnce(){ if(!eventsBound){events();eventsBound=true;} }
  let shellReady=false;
  async function ensureShell(){
    if($('#view-system')){shellReady=true;return true;}
    const tabs=document.querySelector('.tabs');
    const sourcesTab=document.querySelector('.tab[data-view="sources"]');
    const main=document.querySelector('main.shell');
    const sources=document.querySelector('#view-sources');
    if(!tabs||!main)return false;
    // Remove the old schematic Supply & flows UI so there is only one authoritative system view.
    document.querySelector('.tab[data-view="supply"]')?.remove();
    document.querySelector('#view-supply')?.remove();
    const tab=document.createElement('button');
    tab.className='tab';tab.dataset.view='system';tab.textContent='Energy system';
    sourcesTab ? tabs.insertBefore(tab,sourcesTab) : tabs.appendChild(tab);
    const empty=document.createElement('section');
    empty.className='view';empty.id='view-system';
    sources ? main.insertBefore(empty,sources) : main.appendChild(empty);
    try{
      const r=await fetch('./system_section.html'+builtVersion(),{cache:'no-store'});
      if(!r.ok)throw new Error(`system_section.html: HTTP ${r.status}`);
      empty.outerHTML=await r.text();
      const created=$('#view-system');
      tab.addEventListener('click',()=>{
        document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('active',x===tab));
        document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===created));
        window.scrollTo({top:0,behavior:'smooth'});
        setTimeout(()=>start(),0);
      });
      shellReady=true; return true;
    }catch(e){
      empty.innerHTML=`<section class="panel"><div class="eyebrow">ENERGY SYSTEM</div><h2>System module unavailable</h2><p class="small">${esc(e.message)}</p></section>`;
      tab.addEventListener('click',()=>{document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-system'));});
      shellReady=true; return false;
    }
  }
  async function start(){ if(!shellReady) await ensureShell(); if(!$('#view-system'))return; bindOnce(); if(state.system){renderAll();return;} try{await load();}catch(e){console.error(e);const b=$('#flowSystemStatus');if(b){b.textContent='SYSTEM DATA FAILED';b.classList.remove('ok');}} }
  window.renderEnergySystem=()=>start();
  window.addEventListener('DOMContentLoaded',()=>{start().catch(console.error);});
})();
