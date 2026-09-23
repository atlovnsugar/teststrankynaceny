const EU = [
  ['AT','Austria'],['BE','Belgium'],['BG','Bulgaria'],['HR','Croatia'],['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['EE','Estonia'],['FI','Finland'],['FR','France'],['DE','Germany'],['GR','Greece'],['HU','Hungary'],['IE','Ireland'],['IT','Italy'],['LV','Latvia'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],['NL','Netherlands'],['PL','Poland'],['PT','Portugal'],['RO','Romania'],['SK','Slovakia'],['SI','Slovenia'],['ES','Spain'],['SE','Sweden']
];
const EU_SET = new Set(EU.map(([c]) => c));
const EU_NAMES = new Map(EU);
const CZ_REGIONS = new Map([
  ['CZ010','Praha'],['CZ020','Středočeský kraj'],['CZ031','Jihočeský kraj'],['CZ032','Plzeňský kraj'],['CZ041','Karlovarský kraj'],['CZ042','Ústecký kraj'],['CZ051','Liberecký kraj'],['CZ052','Královéhradecký kraj'],['CZ053','Pardubický kraj'],['CZ063','Vysočina'],['CZ064','Jihomoravský kraj'],['CZ071','Olomoucký kraj'],['CZ072','Zlínský kraj'],['CZ080','Moravskoslezský kraj']
]);
const GEO_URLS = {countries:'./data/geo/eu-countries.geojson',czRegions:'./data/geo/cz-regions.geojson'};
const RUNTIME = window.RUNTIME_CONFIG || {};

const state = {
  data:null, fuelHistory:null, gas:null, oil:null, fx:null, fxMap:null,
  currency:'EUR', euFuel:'petrol95', czFuel:'petrol95', euCountry:'CZ',
  euWindow:'52', gasCountry:'CZ', gasWindow:'all', brentWindow:'all',
  geoCountries:null, geoRegions:null,
  supply:null,
  supplyCountry:'EU27', supplyCommodity:'oil', supplyProduct:'petrol95', supplyMapMetric:'Russia', supplyTimelineMetric:'share', supplyWindow:'60',
  modal:{kind:null,id:null,metric:'petrol95',window:'all'}
};

const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const fmt = (v,digits=2) => Number.isFinite(v) ? v.toLocaleString('en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
const fuelLabel = k => ({petrol95:'Euro 95 petrol',diesel:'Diesel',lpg:'LPG'})[k] || k;
const fuelUnit = key => key === 'lpg' || key === 'petrol95' || key === 'diesel' ? (state.currency === 'CZK' ? 'Kč/l' : 'EUR/l') : '';
const pct = v => Number.isFinite(v) ? `${fmt(v*100,1)}%` : '—';
const supplyGroupColors = new Map([['Russia','#ff4d5a'],['United States','#ffd166'],['Middle East','#f08c46'],['Norway','#55b8ff'],['EU / intra-EU','#89a5c4'],['North Africa','#c887ff'],['Azerbaijan / Caspian','#f3b7ff'],['United Kingdom','#6ad7a0'],['Other','#7f8794']]);
const sortBy = (arr,key) => [...arr].sort((a,b)=>(a[key]??Infinity)-(b[key]??Infinity));
const flagEmoji = code => { const s=String(code||'').toUpperCase(); if(s==='EU'||s==='EU27') return '🇪🇺'; return s.length===2 ? String.fromCodePoint(...[...s].map(c=>127397+c.charCodeAt(0))) : '◇'; };
const flagImg = (code,label='') => { const s=String(code||'').toLowerCase(); const asset=s==='eu27'||s==='eu'?'eu':s; if(!/^[a-z]{2}$/.test(asset)) return `<span class=\"flag-code\">${String(code||'—')}</span>`; const alt=String(label||code||'').replace(/\"/g,'&quot;'); return `<img class=\"flag-icon\" src=\"https://flagcdn.com/w40/${asset}.png\" alt=\"${alt} flag\" title=\"${alt}\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\" onerror=\"this.style.display='none';this.nextElementSibling.style.display='inline-flex'\"><span class=\"flag-code\" style=\"display:none\">${String(code||'—').toUpperCase()}</span>`; };

async function loadJson(path){const version=RUNTIME.builtAt||'';const joiner=path.includes('?')?'&':'?';const r=await fetch(`${path}${version?joiner+'v='+encodeURIComponent(version):''}`,{cache:'no-store'});if(!r.ok)throw new Error(`${path}: ${r.status}`);return r.json();}
function buildFxLookup(){
  const eur = new Map((state.fx?.eur_czk||[]).map(x=>[x.date,x.value]));
  const usd = new Map((state.fx?.usd_czk||[]).map(x=>[x.date,x.value]));
  state.fxMap = {eur,usd,eurDates:[...(state.fx?.eur_czk||[]).map(x=>x.date).sort()],usdDates:[...(state.fx?.usd_czk||[]).map(x=>x.date).sort()]};
}
function prevRate(map,dates,date){
  if(!map || !dates?.length || !date) return null;
  if(map.has(date)) return map.get(date);
  let lo=0,hi=dates.length-1,ans=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;if(dates[mid]<=date){ans=mid;lo=mid+1;}else hi=mid-1;}
  return ans>=0 ? map.get(dates[ans]) : null;
}
const eurCzk = date => prevRate(state.fxMap?.eur,state.fxMap?.eurDates,date);
const usdCzk = date => prevRate(state.fxMap?.usd,state.fxMap?.usdDates,date);
function fuelValue(v,date,currency=state.currency){if(!Number.isFinite(v))return null;if(currency!=='CZK')return v;const r=eurCzk(date);return Number.isFinite(r)?v*r:null;}
function priceText(v,currency=state.currency,date=null){if(!Number.isFinite(v))return 'NR';const n=fuelValue(v,date,currency);return Number.isFinite(n)?`${currency==='CZK'?fmt(n,2)+' Kč/l':'€'+fmt(n,3)+'/l'}`:'NR';}
function gasPriceText(v,date=null){if(!Number.isFinite(v))return 'NR';if(state.currency==='CZK'){const r=eurCzk(date);return Number.isFinite(r)?`${fmt(v*r,3)} Kč/kWh`:'NR';}return `€${fmt(v,3)}/kWh`;}
function brentText(v,date=null){if(!Number.isFinite(v))return 'NR';if(state.currency==='CZK'){const r=usdCzk(date);return Number.isFinite(r)?`${fmt(v*r,0)} Kč/bbl`:'NR';}return `$${fmt(v,2)}/bbl`;}
function currentFxLabel(date){const r=eurCzk(date);return Number.isFinite(r)?`ECB FX ${fmt(r,3)} Kč/€ · date matched`:'ECB FX unavailable';}
function metric(label,value,meta){return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="meta">${meta||''}</div></div>`;}
function periodToDate(period){const m=String(period||'').match(/^(\d{4})[-_](?:S|H)([12])$/i);if(m)return new Date(Date.UTC(Number(m[1]),Number(m[2])===2?6:0,1));return new Date(period);}
function dateForPoint(d){return d.date ? new Date(`${d.date}T00:00:00Z`) : periodToDate(d.period);}
function windowSlice(arr,windowValue){if(windowValue==='all')return arr;const n=Number(windowValue);return Number.isFinite(n)?arr.slice(-n):arr;}
function flash(el){if(!el)return;el.classList.remove('flash-hit');void el.offsetWidth;el.classList.add('flash-hit');setTimeout(()=>el.classList.remove('flash-hit'),500);}

function archiveStats(){
  const fuelObs = Object.values(state.fuelHistory?.history||{}).reduce((n,s)=>n+(Array.isArray(s)?s.length:0),0);
  const gasObs = Object.values(state.gas?.history||{}).reduce((n,s)=>n+(Array.isArray(s)?s.length:0),0);
  const oilObs = state.oil?.history?.length || 0;
  const fxObs = (state.fx?.eur_czk?.length||0)+(state.fx?.usd_czk?.length||0);
  const fuelCountries = Object.keys(state.fuelHistory?.history||{}).filter(c=>EU_SET.has(c)).length;
  return {fuelObs,gasObs,oilObs,fxObs,fuelCountries};
}
function setStatus(){
  const stats=archiveStats();
  const ready=stats.fuelObs>=20000 && stats.fuelCountries>=20 && stats.gasObs>=200 && stats.oilObs>=1000 && stats.fxObs>=1000;
  const latest=[state.data?.fuel?.as_of,state.data?.czech_regions?.as_of,state.data?.natural_gas?.as_of,state.data?.brent?.as_of].filter(Boolean).sort().at(-1);
  const badge=qs('#freshnessBadge');
  badge.textContent=ready ? `ARCHIVE LIVE · ${latest||'current'}` : 'BOOTSTRAP · OPEN DATA PIPELINE';
  badge.classList.toggle('ok',ready);
  badge.title=ready?'Validated historical archive. Click to open the repository workflow.':'The checked-in seed data is not a validated full archive. Click to open the repository workflow and run the refresh.';
  badge.href=RUNTIME.actionsUrl || '#';badge.classList.toggle('disabled',!RUNTIME.actionsUrl);
  badge.setAttribute('aria-label',badge.title);
}

function renderOverview(){
  const fuel=state.data.fuel,rows=fuel.countries,cz=rows.find(r=>r.code==='CZ');
  const petrol=rows.map(r=>r.petrol95).filter(Number.isFinite);const min=Math.min(...petrol),max=Math.max(...petrol);
  const info=state.fuelHistory?.history?.CZ||[];
  qs('#overviewMetrics').innerHTML=[
    metric('CZ petrol 95',priceText(cz?.petrol95,state.currency,fuel.as_of),`week ${fuel.as_of}`),
    metric('CZ diesel',priceText(cz?.diesel,state.currency,fuel.as_of),`week ${fuel.as_of}`),
    metric('EU petrol spread',state.currency==='CZK'&&Number.isFinite(eurCzk(fuel.as_of))?`${fmt((max-min)*eurCzk(fuel.as_of),2)} Kč/l`:`€${fmt(max-min,2)}/l`,`27-country min → max`),
    metric('CZ archive',info.length?`${info.length.toLocaleString('en-GB')} weekly obs.`:'pending',info[0]?.date?`${info[0].date} → ${info.at(-1)?.date||'—'}`:'EC history')
  ].join('');
  qs('#fuelAsOf').textContent=`as of ${fuel.as_of}`;
  qs('#czAsOf').textContent=`as of ${state.data.czech_regions.as_of}`;
  const top=sortBy(rows,'petrol95').slice(0,8);
  qs('#overviewFuelTable').innerHTML=`<thead><tr><th>Country</th><th class="num">Petrol</th><th class="num">Diesel</th></tr></thead><tbody>${top.map(r=>`<tr><td><button class="entity-link" data-country="${r.code}"><span class="flag">${flagImg(r.code,r.name)}</span>${r.name}</button></td><td class="num">${priceText(r.petrol95,state.currency,fuel.as_of)}</td><td class="num">${priceText(r.diesel,state.currency,fuel.as_of)}</td></tr>`).join('')}</tbody>`;
  qsa('#overviewFuelTable [data-country]').forEach(b=>b.addEventListener('click',()=>{flash(b);openEntityDashboard('country',b.dataset.country)}));
  const regions=state.data.czech_regions.regions;const cheap=sortBy(regions,'petrol95').slice(0,2),expensive=[...regions].sort((a,b)=>(b.petrol95??-Infinity)-(a.petrol95??-Infinity)).slice(0,2);
  qs('#regionHighlights').innerHTML=[...cheap.map(r=>`<div class="region-card"><span class="small">LOWER PETROL SNAPSHOT</span><button class="entity-link" data-region="${r.code}">${r.name}</button><span>${fmt(r.petrol95)} Kč/l</span></div>`),...expensive.map(r=>`<div class="region-card"><span class="small">HIGHER PETROL SNAPSHOT</span><button class="entity-link" data-region="${r.code}">${r.name}</button><span>${fmt(r.petrol95)} Kč/l</span></div>`)].join('');
  qsa('#regionHighlights [data-region]').forEach(b=>b.addEventListener('click',()=>{flash(b);openEntityDashboard('region',b.dataset.region)}));
  drawRegionalBar('#czSparkline',regions,'petrol95',390);
  renderCountryMap('#overviewMap','petrol95',true);
}

function colorScale(values){
  const clean=values.filter(Number.isFinite),ext=d3.extent(clean);let lo=ext[0],hi=ext[1];if(!Number.isFinite(lo)||!Number.isFinite(hi)){lo=0;hi=1;}if(lo===hi){lo-=1;hi+=1;}
  return d3.scaleLinear().domain([lo,(lo+hi)/2,hi]).range(['#23365f','#d44c5e','#ffb45f']).clamp(true);
}
function getGeoCode(p){const raw=p?.NUTS_ID??p?.nuts_id??p?.CNTR_CODE??p?.id??p?.ID??'';return String(raw).slice(0,5).toUpperCase();}
function getCountryCode(p){const raw=p?.CNTR_CODE??p?.NUTS_ID??p?.nuts_id??p?.id??p?.ID??'';const s=String(raw).toUpperCase();if(EU_SET.has(s.slice(0,2)))return s.slice(0,2);if(EU_SET.has(s.slice(-2)))return s.slice(-2);return null;}
async function ensureGeo(type){if(type==='countries'&&state.geoCountries)return state.geoCountries;if(type==='czRegions'&&state.geoRegions)return state.geoRegions;try{const g=await loadJson(GEO_URLS[type]);if(type==='countries')state.geoCountries=g;else state.geoRegions=g;return g;}catch(e){console.warn('Map geometry unavailable',e);return null;}}

function countryTooltip(r,key){return `${flagEmoji(r?.code)} ${r?.name||r?.code||'Unknown'}<br><strong>${priceText(r?.[key],state.currency,state.data.fuel.as_of)}</strong><br><span>${fuelLabel(key)} · ${state.data.fuel.as_of}</span>`;}
function drawCountryFallback(selector,rows,key){
  const el=qs(selector);el.innerHTML='';const w=el.clientWidth||760,h=340,p={l:18,r:18,t:18,b:18},svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),vals=new Map(rows.map(r=>[r.code,r[key]])),scale=colorScale(rows.map(r=>r[key]));
  const cols=5,rowsN=Math.ceil(EU.length/cols),cw=(w-p.l-p.r)/cols,ch=(h-p.t-p.b)/rowsN;
  EU.forEach(([code,name],i)=>{const x=p.l+(i%cols)*cw,y=p.t+Math.floor(i/cols)*ch,r=rows.find(x=>x.code===code);svg.append('rect').attr('class','map-cell').attr('x',x+4).attr('y',y+4).attr('width',cw-8).attr('height',ch-8).attr('fill',Number.isFinite(vals.get(code))?scale(vals.get(code)):'#141b2a').on('click',e=>{flash(e.currentTarget);openEntityDashboard('country',code)});svg.append('text').attr('x',x+cw/2).attr('y',y+ch/2-3).attr('text-anchor','middle').text(code).attr('fill','#fff').attr('font-size',10).attr('font-family','IBM Plex Mono').attr('font-weight',800).style('pointer-events','none');svg.append('text').attr('x',x+cw/2).attr('y',y+ch/2+13).attr('text-anchor','middle').text(Number.isFinite(vals.get(code))?priceText(vals.get(code),state.currency,state.data.fuel.as_of):'NR').attr('fill','#e7edf3').attr('font-size',8).attr('font-family','IBM Plex Mono');});
}

async function renderCountryMap(selector,key,compact=false){
  const el=qs(selector);el.innerHTML='';const geo=await ensureGeo('countries'),rows=state.data.fuel.countries;
  if(!geo){drawCountryFallback(selector,rows,key);return;}
  const features=(geo.features||[]).filter(f=>EU_SET.has(getCountryCode(f.properties))),byCode=new Map(rows.map(r=>[r.code,r])),values=rows.map(r=>r[key]).filter(Number.isFinite),scale=colorScale(values);
  if(!features.length){drawCountryFallback(selector,rows,key);return;}
  const w=el.clientWidth||760,h=compact?340:560,svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),projection=d3.geoMercator().fitExtent([[10,10],[w-10,h-10]],{type:'FeatureCollection',features}),path=d3.geoPath(projection);
  svg.selectAll('path').data(features).join('path').attr('class','map-country').attr('d',path).attr('fill',f=>{const r=byCode.get(getCountryCode(f.properties));return Number.isFinite(r?.[key])?scale(r[key]):'#141b2a';}).on('mousemove',(e,f)=>{const r=byCode.get(getCountryCode(f.properties));showTip(e,countryTooltip(r,key));}).on('mouseleave',hideTip).on('click',(e,f)=>{e.stopPropagation();flash(e.currentTarget);openEntityDashboard('country',getCountryCode(f.properties));});
  svg.selectAll('text').data(features).join('text').attr('class','map-code').attr('x',f=>path.centroid(f)[0]).attr('y',f=>path.centroid(f)[1]+3).attr('text-anchor','middle').text(f=>getCountryCode(f.properties)).attr('font-size',compact?6:7).attr('font-family','IBM Plex Mono').attr('fill','#fff').attr('font-weight',700).style('pointer-events','none');
  if(!compact)setLegend('#euLegend',scale,'LOW','HIGH');
}

async function renderCzMap(){
  const el=qs('#czMap');el.innerHTML='';const geo=await ensureGeo('czRegions'),regions=state.data.czech_regions.regions,key=state.czFuel;
  if(!geo){drawCzBubbles();return;}
  const features=(geo.features||[]).filter(f=>CZ_REGIONS.has(getGeoCode(f.properties))),byCode=new Map(regions.map(r=>[r.code,r])),values=regions.map(r=>r[key]).filter(Number.isFinite),scale=colorScale(values),w=el.clientWidth||760,h=560,svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),projection=d3.geoMercator().fitExtent([[18,16],[w-18,h-16]],{type:'FeatureCollection',features}),path=d3.geoPath(projection);
  svg.selectAll('path').data(features).join('path').attr('class','map-region').attr('d',path).attr('fill',f=>{const r=byCode.get(getGeoCode(f.properties));return Number.isFinite(r?.[key])?scale(r[key]):'#141b2a';}).on('mousemove',(e,f)=>{const r=byCode.get(getGeoCode(f.properties));showTip(e,`${r?.name||getGeoCode(f.properties)}<br><strong>${Number.isFinite(r?.[key])?fmt(r[key])+' Kč/l':'NR'}</strong><br><span>${fuelLabel(key)}</span>`)}).on('mouseleave',hideTip).on('click',(e,f)=>{e.stopPropagation();flash(e.currentTarget);openEntityDashboard('region',getGeoCode(f.properties));});
  svg.selectAll('text').data(features).join('text').attr('class','map-region-label').attr('x',f=>path.centroid(f)[0]).attr('y',f=>path.centroid(f)[1]+2).attr('text-anchor','middle').text(f=>CZ_REGIONS.get(getGeoCode(f.properties))?.replace(/ kraj$/,'')||'').attr('font-size',7.5).attr('font-family','IBM Plex Mono').attr('fill','#fff').attr('font-weight',700).style('pointer-events','none');
  setLegend('#czLegend',scale,'LOW','HIGH');
}
function drawCzBubbles(){
  const el=qs('#czMap');el.innerHTML='';const rs=state.data.czech_regions.regions,w=el.clientWidth||760,h=560,svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),x=d3.scaleLinear().domain([12,19]).range([50,w-50]),y=d3.scaleLinear().domain([48.5,51]).range([h-35,35]),scale=colorScale(rs.map(r=>r[state.czFuel]).filter(Number.isFinite));
  rs.forEach(r=>{const cx=x(r.lon),cy=y(r.lat);svg.append('circle').attr('class','map-bubble').attr('cx',cx).attr('cy',cy).attr('r',19).attr('fill',Number.isFinite(r[state.czFuel])?scale(r[state.czFuel]):'#141b2a').on('click',e=>{flash(e.currentTarget);openEntityDashboard('region',r.code)});svg.append('text').attr('x',cx).attr('y',cy+3).attr('text-anchor','middle').text(r.name.replace(/ kraj$/,'')).attr('fill','#fff').attr('font-size',8).attr('font-family','IBM Plex Mono').style('pointer-events','none');});setLegend('#czLegend',scale,'LOW','HIGH');
}
function setLegend(selector,scale,left,right){const el=qs(selector);if(!el)return;const d=scale.domain(),lo=d[0],hi=d[d.length-1];const vals=Array.from({length:10},(_,i)=>lo+(hi-lo)*(i/9));const stops=Array.from({length:10},(_,i)=>d3.color(scale(vals[i])).formatHex()).join(',');el.innerHTML=`<span>${left}</span><div class="legend-bar" style="background:linear-gradient(90deg,${stops})"></div><span>${right}</span>`;}
function showTip(e,html){const t=qs('#chartTooltip');t.innerHTML=html;t.style.left=`${Math.min(e.clientX+14,window.innerWidth-330)}px`;t.style.top=`${Math.min(e.clientY+14,window.innerHeight-100)}px`;t.hidden=false;}
function hideTip(){qs('#chartTooltip').hidden=true;}

function drawRegionalBar(selector,regions,key,height=360){
  const el=qs(selector);el.innerHTML='';const data=sortBy(regions,key).filter(r=>Number.isFinite(r[key])),w=el.clientWidth||760,h=Math.max(height,data.length*27+52),m={l:182,r:70,t:10,b:26},svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`),x=d3.scaleLinear().domain([0,d3.max(data,d=>d[key])||1]).nice().range([m.l,w-m.r]),y=d3.scaleBand().domain(data.map(d=>d.name)).range([m.t,h-m.b]).padding(.24),scale=colorScale(data.map(d=>d[key]));
  svg.append('g').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(v=>fmt(v,1))).call(g=>g.selectAll('text').attr('fill','#8395a6').attr('font-size',9).attr('font-family','IBM Plex Mono')).call(g=>g.selectAll('path,line').attr('stroke','#3a2b45'));
  svg.selectAll('rect').data(data).join('rect').attr('class','bar-hit').attr('x',m.l).attr('y',d=>y(d.name)).attr('width',d=>x(d[key])-m.l).attr('height',y.bandwidth()).attr('fill',d=>scale(d[key])).attr('opacity',.9).on('mousemove',(e,d)=>showTip(e,`${d.name}<br><strong>${fmt(d[key])} Kč/l</strong>`)).on('mouseleave',hideTip).on('click',(e,d)=>{flash(e.currentTarget);openEntityDashboard('region',d.code)});
  svg.selectAll('.label').data(data).join('text').attr('x',m.l-8).attr('y',d=>y(d.name)+y.bandwidth()/2+4).attr('text-anchor','end').text(d=>d.name.replace(/ kraj$/,'')).attr('fill','#c4ced8').attr('font-size',9).attr('font-family','IBM Plex Mono');
  svg.selectAll('.val').data(data).join('text').attr('x',d=>x(d[key])+8).attr('y',d=>y(d.name)+y.bandwidth()/2+4).text(d=>fmt(d[key])).attr('fill','#eef3f7').attr('font-size',9).attr('font-family','IBM Plex Mono');
}

function renderEuTable(){
  const rows=sortBy(state.data.fuel.countries,state.euFuel),asOf=state.data.fuel.as_of;qs('#euAsOf').textContent=`as of ${asOf}`;
  qs('#euTable').innerHTML=`<thead><tr><th>Country</th><th class="num">${fuelLabel(state.euFuel)}</th><th class="num">Petrol</th><th class="num">Diesel</th><th class="num">LPG</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="entity-link" data-country="${r.code}"><span class="flag">${flagImg(r.code,r.name)}</span>${r.name}</button></td><td class="num strong-col">${priceText(r[state.euFuel],state.currency,asOf)}</td><td class="num">${priceText(r.petrol95,state.currency,asOf)}</td><td class="num">${priceText(r.diesel,state.currency,asOf)}</td><td class="num">${priceText(r.lpg,state.currency,asOf)}</td></tr>`).join('')}</tbody>`;
  qsa('#euTable [data-country]').forEach(b=>b.addEventListener('click',()=>{flash(b);openEntityDashboard('country',b.dataset.country)}));
  const series=state.fuelHistory?.history?.[state.euCountry]||[];const allDates=Object.values(state.fuelHistory?.history||{}).flat().map(x=>x.date).filter(Boolean).sort();const info=series.length;
  qs('#fuelHistoryBadge').textContent=allDates.length&&info>=100?`ARCHIVE ${allDates[0]} → ${allDates.at(-1)}`:'ARCHIVE INCOMPLETE · OPEN DATA PIPELINE';
  qs('#fuelFxNote').textContent=state.currency==='CZK'?currentFxLabel(asOf):'Display: EUR · source-native';
}
async function renderEuMap(){await renderCountryMap('#euMap',state.euFuel,false);}
function renderEuHistory(){
  const series=fuelSeries(state.euCountry,state.euFuel),data=windowSlice(series,state.euWindow),el=qs('#euHistoryChart');el.innerHTML='';
  qs('#euCountrySelect').value=state.euCountry;
  if(!data.length){el.innerHTML='<div class="empty">No validated archive is loaded for this country. Open the data pipeline and run a full refresh.</div>';return;}
  drawInteractiveLineChart(el,data,d=>fuelValue(d.value,d.date,state.currency),fuelAxisLabel(),{dateField:'date',valueKey:'value'});
}
function fuelAxisLabel(){return state.currency==='CZK'?'Kč/l':'EUR/l';}

function renderCzTable(){
  const rows=sortBy(state.data.czech_regions.regions,state.czFuel);qs('#czTableAsOf').textContent=`as of ${state.data.czech_regions.as_of}`;
  qs('#czTable').innerHTML=`<thead><tr><th>Region</th><th class="num">${fuelLabel(state.czFuel)}</th><th class="num">Petrol</th><th class="num">Diesel</th><th class="num">LPG</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="entity-link" data-region="${r.code}"><span class="region-code">${r.code}</span>${r.name}</button></td><td class="num strong-col">${Number.isFinite(r[state.czFuel])?fmt(r[state.czFuel])+' Kč/l':'NR'}</td><td class="num">${Number.isFinite(r.petrol95)?fmt(r.petrol95)+' Kč/l':'NR'}</td><td class="num">${Number.isFinite(r.diesel)?fmt(r.diesel)+' Kč/l':'NR'}</td><td class="num">${Number.isFinite(r.lpg)?fmt(r.lpg)+' Kč/l':'NR'}</td></tr>`).join('')}</tbody>`;
  qsa('#czTable [data-region]').forEach(b=>b.addEventListener('click',()=>{flash(b);openEntityDashboard('region',b.dataset.region)}));
  const count=state.data.czech_regions.history?.length||0;
  qs('#czHistoryBadge').textContent=state.czFuel==='lpg' && rows.every(r=>!Number.isFinite(r.lpg))?'REGIONAL ARCHIVE · LPG NOT REPORTED':(count?`REGIONAL ARCHIVE · ${count} snapshots`:'REGIONAL ARCHIVE · latest only');
  drawRegionalBar('#czBarChart',state.data.czech_regions.regions,state.czFuel,360);renderCzMap();
}

function drawInteractiveLineChart(el,data,transform,label,opts={}){
  el.innerHTML='';
  const prepared=data.map(d=>{const dt=opts.dateField==='date'?dateForPoint(d):periodToDate(d.period);const value=transform(d);return {...d,_date:dt,_value:value};}).filter(d=>d._date instanceof Date&&!Number.isNaN(d._date.valueOf())&&Number.isFinite(d._value)).sort((a,b)=>a._date-b._date);
  if(!prepared.length){el.innerHTML='<div class="empty">No observations available in this display currency.</div>';return;}
  const w=Math.max(el.clientWidth||900,620),h=390,m={l:64,r:26,t:30,b:52},svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`).attr('class','interactive-chart');let xDomain=d3.extent(prepared,d=>d._date);if(+xDomain[0]===+xDomain[1])xDomain=[new Date(+xDomain[0]-86400000),new Date(+xDomain[1]+86400000)];
  const x=d3.scaleTime().domain(xDomain).range([m.l,w-m.r]),y=d3.scaleLinear().domain(d3.extent(prepared,d=>d._value)).nice().range([h-m.b,m.t]);
  svg.append('g').attr('class','grid-x').attr('transform',`translate(0,${h-m.b})`).call(d3.axisBottom(x).ticks(7).tickFormat(d3.timeFormat('%b %Y'))).call(g=>g.selectAll('text').attr('fill','#8793a5').attr('font-size',9).attr('font-family','IBM Plex Mono')).call(g=>g.selectAll('path,line').attr('stroke','#342b42'));
  svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v=>fmt(v,2))).call(g=>g.selectAll('text').attr('fill','#8793a5').attr('font-size',9).attr('font-family','IBM Plex Mono')).call(g=>g.selectAll('path,line').attr('stroke','#342b42'));
  const line=d3.line().x(d=>x(d._date)).y(d=>y(d._value)).curve(d3.curveMonotoneX);svg.append('path').datum(prepared).attr('class','history-line').attr('d',line);
  const focus=svg.append('g').style('display','none');focus.append('line').attr('class','crosshair').attr('y1',m.t).attr('y2',h-m.b);focus.append('circle').attr('class','focus-dot').attr('r',4.5);
  const bisect=d3.bisector(d=>d._date).left;const overlay=svg.append('rect').attr('x',m.l).attr('y',m.t).attr('width',w-m.l-m.r).attr('height',h-m.t-m.b).attr('fill','transparent').style('cursor','crosshair');
  overlay.on('pointerenter',()=>focus.style('display',null)).on('pointermove',(event)=>{const [px]=d3.pointer(event);const dt=x.invert(px),i=Math.max(0,Math.min(prepared.length-1,bisect(prepared,dt)));const d=prepared[i];const cx=x(d._date),cy=y(d._value);focus.attr('transform',`translate(${cx},0)`);focus.select('.crosshair').attr('y2',h-m.b);focus.select('.focus-dot').attr('cy',cy);showTip(event,`${d3.timeFormat('%d %b %Y')(d._date)}<br><strong>${fmt(d._value,3)} ${label}</strong>`);}).on('pointerleave',()=>{focus.style('display','none');hideTip();});
  svg.append('text').attr('x',w-m.r).attr('y',18).attr('text-anchor','end').attr('fill','#8c98ab').attr('font-size',9).attr('font-family','IBM Plex Mono').text(`${label} · ${prepared.length.toLocaleString('en-GB')} obs. · HOVER TO INSPECT`);
}

function renderGas(){
  const hist=state.gas?.history||{},entries=Object.entries(hist).map(([code,series])=>({code,series,last:series?.at(-1)?.value})).filter(d=>Number.isFinite(d.last)),names=new Map(EU);names.set('EU27','EU-27');
  qs('#gasCountrySelect').innerHTML=entries.sort((a,b)=>(names.get(a.code)||a.code).localeCompare(names.get(b.code)||b.code)).map(d=>`<option value="${d.code}">${flagEmoji(d.code==='EU27'?'EU':d.code)} ${names.get(d.code)||d.code}</option>`).join('');
  if(!entries.some(d=>d.code===state.gasCountry))state.gasCountry=entries.some(d=>d.code==='CZ')?'CZ':entries[0]?.code||'CZ';qs('#gasCountrySelect').value=state.gasCountry;
  const series=hist[state.gasCountry]||[],latest=series.at(-1)?.value,previous=series.at(-2)?.value,period=series.at(-1)?.period,fxDate=period?periodToDate(period).toISOString().slice(0,10):null;
  qs('#gasMetrics').innerHTML=[metric('Latest',gasPriceText(latest,fxDate),state.gas?.band||''),metric('Semester change',Number.isFinite(latest)&&Number.isFinite(previous)?`${fmt((latest/previous-1)*100,1)}%`:'—','versus previous semester'),metric('Tax basis','All taxes','Eurostat I_TAX'),metric('History',state.gas?.history_from||'—',`latest ${state.gas?.as_of||'—'}`)].join('');
  qs('#gasAsOf').textContent=period||'';qs('#gasHistoryBadge').textContent=state.gas?.history_from?`ARCHIVE ${state.gas.history_from} → ${state.gas.as_of}`:'ARCHIVE NOT LOADED';qs('#gasFxNote').textContent=state.currency==='CZK'?'EUR/CZK conversion anchored to period date':'Display: EUR · source-native';qs('#gasUnitNote').textContent=state.currency==='CZK'?'Kč/kWh · ECB date-matched':'EUR/kWh · source-native';
  const data=windowSlice(series,state.gasWindow);qs('#gasChart').innerHTML='';if(data.length)drawInteractiveLineChart(qs('#gasChart'),data,d=>{const dt=periodToDate(d.period).toISOString().slice(0,10);return state.currency==='CZK'?(Number.isFinite(eurCzk(dt))?d.value*eurCzk(dt):NaN):d.value;},state.currency==='CZK'?'Kč/kWh':'EUR/kWh',{dateField:'period'});else qs('#gasChart').innerHTML='<div class="empty">No gas history available.</div>';
  const table=entries.sort((a,b)=>b.last-a.last);qs('#gasTable').innerHTML=`<thead><tr><th>Country</th><th class="num">${state.currency==='CZK'?'Kč/kWh':'EUR/kWh'}</th><th>Latest</th></tr></thead><tbody>${table.map(d=>`<tr><td><button class="entity-link" data-country="${d.code}"><span class="flag">${flagImg(d.code==='EU27'?'EU':d.code,names.get(d.code)||d.code)}</span>${names.get(d.code)||d.code}</button></td><td class="num">${gasPriceText(d.last,periodToDate(d.series.at(-1)?.period).toISOString().slice(0,10))}</td><td>${d.series.at(-1)?.period||'—'}</td></tr>`).join('')}</tbody>`;qsa('#gasTable [data-country]').forEach(b=>b.addEventListener('click',()=>{if(EU_SET.has(b.dataset.country)){flash(b);openEntityDashboard('country',b.dataset.country);}}));
}

function renderBrent(){
  const h=state.oil?.history||[],last=h.at(-1)?.value,prev=h.at(-2)?.value,delta=Number.isFinite(last)&&Number.isFinite(prev)?last-prev:null;
  qs('#brentMetrics').innerHTML=[metric('Latest',brentText(last,h.at(-1)?.date),state.oil?.as_of||''),metric('1-day move',delta!=null?(state.currency==='CZK'&&Number.isFinite(usdCzk(h.at(-1)?.date))?`${delta*usdCzk(h.at(-1)?.date)>=0?'+':''}${fmt(delta*usdCzk(h.at(-1)?.date),0)} Kč`:`${delta>=0?'+':''}$${fmt(delta,2)}`):'—',state.currency==='CZK'?'observation-date FX':'USD/barrel'),metric('Series','DCOILBRENTEU','EIA via FRED'),metric('History',state.oil?.history_from||'—',`latest ${state.oil?.as_of||'—'}`)].join('');
  qs('#brentHistoryBadge').textContent=state.oil?.history_from?`ARCHIVE ${state.oil.history_from} → ${state.oil.as_of}`:'ARCHIVE NOT LOADED';qs('#brentFxNote').textContent=state.currency==='CZK'?'USD/CZK from ECB reference-rate history':'Display: USD · source-native';qs('#brentUnitNote').textContent=state.currency==='CZK'?'Kč/bbl · ECB date-matched':'USD/barrel';
  const data=windowSlice(h,state.brentWindow);qs('#brentChart').innerHTML='';if(data.length)drawInteractiveLineChart(qs('#brentChart'),data,d=>state.currency==='CZK'?(Number.isFinite(usdCzk(d.date))?d.value*usdCzk(d.date):NaN):d.value,state.currency==='CZK'?'Kč/bbl':'USD/bbl',{dateField:'date'});
}

function entityName(kind,id){if(kind==='country')return EU_NAMES.get(id)||id;return CZ_REGIONS.get(id)||id;}
function entityCurrent(kind,id){if(kind==='country')return state.data?.fuel?.countries?.find(x=>x.code===id)||{};return state.data?.czech_regions?.regions?.find(x=>x.code===id)||{};}
function fuelSeries(id,key){
  return (state.fuelHistory?.history?.[id]||[])
    .map(r=>({date:r.date,value:Number(r[key])}))
    .filter(r=>r.date&&Number.isFinite(r.value));
}
function entitySeries(kind,id,key){
  if(kind==='country')return fuelSeries(id,key);
  return (state.data?.czech_regions?.history||[]).map(snapshot=>{const row=(snapshot.regions||[]).find(r=>r.code===id);return row&&Number.isFinite(row[key])?{date:snapshot.as_of,value:row[key]}:null;}).filter(Boolean);
}
function openEntityDashboard(kind,id){
  if(!id)return;
  state.modal.kind=kind;state.modal.id=id;state.modal.metric=Number.isFinite(entityCurrent(kind,id).petrol95)?'petrol95':(Number.isFinite(entityCurrent(kind,id).diesel)?'diesel':'lpg');state.modal.window='all';renderEntityModal();qs('#entityModal').hidden=false;document.body.classList.add('modal-open');
}
function closeEntityDashboard(){qs('#entityModal').hidden=true;document.body.classList.remove('modal-open');hideTip();}
function renderEntityModal(){
  const {kind,id}=state.modal,name=entityName(kind,id),cur=entityCurrent(kind,id),keys=['petrol95','diesel','lpg'];
  qs('#entityModalKicker').textContent=kind==='country'?'COUNTRY DASHBOARD // NATIONAL FUEL':'REGIONAL DASHBOARD // CZECHIA NUTS 3';
  qs('#entityModalTitle').textContent=name;qs('#entityModalMeta').innerHTML=kind==='country'?`${flagImg(id,name)} <span>${id} · European Commission weekly series</span>`:`<span>${id} · Czech regional secondary feed</span>`;
  qs('#entityModalMetrics').innerHTML=keys.map(k=>metric(fuelLabel(k),kind==='country'?priceText(cur[k],state.currency,state.data.fuel.as_of):(Number.isFinite(cur[k])?fmt(cur[k])+' Kč/l':'NR'),kind==='country'?fuelUnit(k):'source-native Kč/l')).join('');
  const availableKeys = keys.filter(k => kind==='country' ? state.fuelHistory?.history?.[id]?.some(r=>Number.isFinite(r[k])) : state.data?.czech_regions?.regions?.some(r=>r.code===id && Number.isFinite(r[k])));
  if(!availableKeys.length) availableKeys.push(state.modal.metric);
  if(!availableKeys.includes(state.modal.metric)) state.modal.metric=availableKeys[0];
  qs('#entityMetricSelect').innerHTML=availableKeys.map(k=>`<option value="${k}" ${state.modal.metric===k?'selected':''}>${fuelLabel(k)}</option>`).join('');qs('#entityWindowSelect').value=state.modal.window;
  const series=entitySeries(kind,id,state.modal.metric),data=windowSlice(series,state.modal.window),chart=qs('#entityChart');chart.innerHTML='';
  qs('#entityArchiveBadge').textContent=series.length?`${series.length.toLocaleString('en-GB')} observations`:'NO VALIDATED OBSERVATIONS';
  qs('#entitySourceNote').textContent=kind==='country'?'Primary weekly national price series · click/hover the chart to inspect dates and values.':'Regional feed · historical values are dated snapshots. LPG is shown only where a genuine regional observation exists; current zero placeholders are treated as not reported.';
  if(data.length){
    drawInteractiveLineChart(chart,data,d=>kind==='country'?fuelValue(d.value,d.date,state.currency):d.value,kind==='country'?fuelAxisLabel():'Kč/l',{dateField:'date'});
    qs('#entityRecentTable').innerHTML=`<thead><tr><th>Date</th><th class="num">${fuelLabel(state.modal.metric)}</th></tr></thead><tbody>${data.slice(-18).reverse().map(d=>`<tr><td>${d.date||'—'}</td><td class="num">${kind==='country'?priceText(d.value,state.currency,d.date):fmt(d.value)+' Kč/l'}</td></tr>`).join('')}</tbody>`;
  }else{
    chart.innerHTML='<div class="empty">No observations are published for this fuel in this entity.</div>';qs('#entityRecentTable').innerHTML='<tbody><tr><td>NO DATA REPORTED</td><td class="num">NR</td></tr></tbody>';
  }
}


function supplyGroupColor(group){return supplyGroupColors.get(group)||'#7f8794';}
function supplyProductsForCommodity(c){return c==='oil'?[['petrol95','Motor gasoline / petrol 95'],['diesel','Gas/diesel oil'],['lpg','LPG']]:[['all',c==='gas_lng'?'LNG':'Gaseous natural gas']];}
function supplyKeyForCommodity(c){return c.startsWith('gas_')?'gas': 'oil';}
function supplySeries(country,commodity,product){
  if(!state.supply)return [];
  let source;
  if(commodity==='gas_pipeline') source=state.supply.gas?.pipeline||{};
  else if(commodity==='gas_lng') source=state.supply.gas?.lng||{};
  else source=state.supply.oil?.[product]||{};
  let series;
  if(country==='EU27'){
    const allCodes=EU.map(([code])=>code);
    const byPeriod=new Map();
    for(const code of allCodes){
      const src=source?.[code]?.history||[];
      for(const row of src){
        if(!byPeriod.has(row.period))byPeriod.set(row.period,{period:row.period,total:0,groupVolumes:{},partnerVolumes:{}});
        const out=byPeriod.get(row.period);out.total+=Number(row.total)||0;
        for(const [g,v] of Object.entries(row.groupVolumes||{}))out.groupVolumes[g]=(out.groupVolumes[g]||0)+(Number(v)||0);
        for(const p of row.partners||[])out.partnerVolumes[p.code]=(out.partnerVolumes[p.code]||0)+(Number(p.value)||0);
      }
    }
    series=[...byPeriod.values()].sort((a,b)=>a.period.localeCompare(b.period));
    return series.map(r=>({...r,groupShares:Object.fromEntries(Object.entries(r.groupVolumes).map(([g,v])=>[g,r.total?v/r.total:0])),partners:Object.entries(r.partnerVolumes).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([code,value])=>({code,value,share:r.total?value/r.total:0}))}));
  }
  series=source?.[country]?.history||[];
  return series;
}
function supplyLatest(series){return series.at(-1)||null;}
function supplyName(code){if(code==='EU27')return 'EU-27';return EU_NAMES.get(code)||code;}
function supplyFormatVolume(v,commodity){if(!Number.isFinite(v))return 'NR';return commodity.startsWith('gas_')?`${fmt(v,0)} TJ`:`${fmt(v,1)} kt`}
function renderSupplyMetrics(series,commodity,product){
  const latest=supplyLatest(series),groups=latest?.groupShares||{};
  const label=commodity.startsWith('gas_')?(commodity==='gas_lng'?'LNG':'Gaseous natural gas'):(fuelLabel(product));
  qs('#supplyMetrics').innerHTML=[
    metric('Latest month',latest?.period||'—',label),
    metric('Total imported',latest?supplyFormatVolume(latest.total,commodity):'—','reported import volume'),
    metric('Russia',pct(groups['Russia']), 'share of imports · ultimate origin'),
    metric('United States',pct(groups['United States']), 'share of imports · ultimate origin'),
    metric('Middle East',pct(groups['Middle East']), 'share of imports · defined group'),
    metric('Norway',pct(groups['Norway']), 'share of imports · ultimate origin')
  ].join('');
}
function renderSupplyPartners(series,commodity){
  const latest=supplyLatest(series),tbl=qs('#supplyPartnerTable');
  if(!latest){tbl.innerHTML='<tbody><tr><td>NO SUPPLY OBSERVATIONS</td></tr></tbody>';return;}
  const rows=(latest.partners||[]).filter(p=>p.value>0).slice(0,14);
  tbl.innerHTML=`<thead><tr><th>Origin</th><th class="num">Volume</th><th class="num">Share</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${flagImg(p.code,p.code)} <span>${p.code}</span></td><td class="num">${supplyFormatVolume(p.value,commodity)}</td><td class="num">${pct(p.share)}</td></tr>`).join('')}</tbody>`;
}
function renderSupplyMap(series,metric){
  const el=qs('#supplyMap');if(!el)return;el.innerHTML='';const geo=state.geoCountries||null;
  if(!geo){el.innerHTML='<div class="empty">Country geometry unavailable.</div>';return;}
  const latest=supplyLatest(series);const features=(geo.features||[]).filter(f=>EU_SET.has(getCountryCode(f.properties)));const w=el.clientWidth||900,h=540;
  const svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${w} ${h}`);const projection=d3.geoMercator().fitExtent([[18,18],[w-18,h-18]],{type:'FeatureCollection',features});const path=d3.geoPath(projection);
  const vals=[];for(const f of features){const code=getCountryCode(f.properties);const s=supplySeries(code,state.supply._uiCommodity||'oil',state.supply._uiProduct||'petrol95').at(-1);const v=s?.groupShares?.[metric];if(Number.isFinite(v))vals.push(v);}
  const scale=d3.scaleLinear().domain([0,d3.max(vals)||1]).range(['#161c2b','#ff314b']).clamp(true);
  const byCode=new Map();for(const [code] of EU)byCode.set(code,supplySeries(code,state.supply._uiCommodity||'oil',state.supply._uiProduct||'petrol95').at(-1));
  svg.selectAll('path.map-country').data(features).join('path').attr('class','map-country').attr('d',path).attr('fill',f=>{const c=getCountryCode(f.properties),v=byCode.get(c)?.groupShares?.[metric];return Number.isFinite(v)?scale(v):'#141b2a';}).on('mousemove',(e,f)=>{const c=getCountryCode(f.properties),r=byCode.get(c),v=r?.groupShares?.[metric];showTip(e,`${flagEmoji(c)} ${supplyName(c)}<br><strong>${pct(v)}</strong><br><span>${metric} · ${r?.period||'—'}</span>`);}).on('mouseleave',hideTip).on('click',(e,f)=>{const c=getCountryCode(f.properties);flash(e.currentTarget);openEntityDashboard('country',c);});
  // Schematic source-flow arcs: source hubs to countries, using the latest imported volume for the selected group.
  const hubs={'Russia':[37,57],'United States':[-11,51],'Middle East':[43,29],'Norway':[8,62],'EU / intra-EU':[10,50],'North Africa':[13,31],'Azerbaijan / Caspian':[49,40],'United Kingdom':[-3,55]};
  if(latest && hubs[metric]){
    const hub=projection(hubs[metric]);if(hub){const sourceVals=[];for(const f of features){const c=getCountryCode(f.properties),p=supplySeries(c,state.supply._uiCommodity||'oil',state.supply._uiProduct||'petrol95').at(-1);const v=p?.groupVolumes?.[metric];if(Number.isFinite(v)&&v>0)sourceVals.push({c,v,f});}const top=sourceVals.sort((a,b)=>b.v-a.v).slice(0,14);const max=d3.max(top,d=>d.v)||1;svg.append('g').attr('class','supply-flows').selectAll('path').data(top).join('path').attr('d',d=>{const c=path.centroid(d.f);const mx=(hub[0]+c[0])/2;const my=(hub[1]+c[1])/2-45;return `M${hub[0]},${hub[1]} Q${mx},${my} ${c[0]},${c[1]}`;}).attr('fill','none').attr('stroke',supplyGroupColor(metric)).attr('stroke-width',d=>1.2+5*Math.sqrt(d.v/max)).attr('stroke-opacity',0.38).attr('class','supply-flow-line');svg.append('circle').attr('cx',hub[0]).attr('cy',hub[1]).attr('r',7).attr('fill',supplyGroupColor(metric)).attr('class','supply-hub');svg.append('text').attr('x',hub[0]+10).attr('y',hub[1]-8).attr('fill',supplyGroupColor(metric)).attr('font-family','IBM Plex Mono').attr('font-size',10).attr('font-weight',700).text(metric.toUpperCase());}}
  setSupplyLegend(scale);
}
function setSupplyLegend(scale){const el=qs('.supply-map-legend');if(!el)return;el.querySelector('.supply-gradient').style.background='linear-gradient(90deg,#161c2b,#ff314b)';}
function drawSupplyTimeline(series,metric,commodity){
  const el=qs('#supplyTimeline');el.innerHTML='';if(!series.length){el.innerHTML='<div class="empty">No supply history is available for this selection. Run the full data refresh.</div>';return;}
  const data=windowSlice(series,state.supplyWindow),groups=['Russia','United States','Middle East','Norway','North Africa','Azerbaijan / Caspian','United Kingdom','EU / intra-EU','Other'];
  const width=el.clientWidth||960,height=420,m={t:24,r:24,b:42,l:58},svg=d3.select(el).append('svg').attr('viewBox',`0 0 ${width} ${height}`),x=d3.scaleTime().range([m.l,width-m.r]),y=d3.scaleLinear().range([height-m.b,m.t]);
  const prepared=data.map(r=>{const o={period:r.period};for(const g of groups)o[g]=metric==='share'?(r.groupShares?.[g]||0):(r.groupVolumes?.[g]||0);return o;});
  const keys=groups.filter(g=>prepared.some(r=>r[g]>0));const stack=d3.stack().keys(keys)(prepared);const maxY=metric==='share'?1:d3.max(stack,arr=>d3.max(arr,d=>d[1]))||1;x.domain(d3.extent(prepared,d=>periodToDate(d.period)));y.domain([0,maxY]);
  if(metric==='share'){svg.append('g').attr('transform',`translate(0,${height-m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%Y-%m')));}else{svg.append('g').attr('transform',`translate(0,${height-m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%Y-%m')));}
  const area=d3.area().x(d=>x(periodToDate(d.data.period))).y0(d=>y(d[0])).y1(d=>y(d[1])).curve(d3.curveMonotoneX);
  svg.append('g').selectAll('path').data(stack).join('path').attr('d',area).attr('fill',d=>supplyGroupColor(d.key)).attr('fill-opacity',0.72).attr('stroke','#0b111a').attr('stroke-width',0.6);
  svg.append('g').attr('transform',`translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v=>metric==='share'?`${Math.round(v*100)}%`:supplyFormatVolume(v,commodity))).call(g=>g.selectAll('text').attr('fill','#8793a5').attr('font-size',9).attr('font-family','IBM Plex Mono')).call(g=>g.selectAll('path,line').attr('stroke','#342b42'));
  let focus=svg.append('g').style('display','none');focus.append('line').attr('class','crosshair').attr('y1',m.t).attr('y2',height-m.b);focus.append('circle').attr('r',4).attr('class','focus-dot');const bisect=d3.bisector(d=>periodToDate(d.period)).left;const overlay=svg.append('rect').attr('x',m.l).attr('y',m.t).attr('width',width-m.l-m.r).attr('height',height-m.t-m.b).attr('fill','transparent').style('cursor','crosshair');overlay.on('pointerenter',()=>focus.style('display',null)).on('pointermove',(event)=>{const [px]=d3.pointer(event);const dt=x.invert(px);const i=Math.max(0,Math.min(prepared.length-1,bisect(prepared,dt)));const r=prepared[i];const cx=x(periodToDate(r.period));const total=metric==='share'?1:(r.total||0);focus.attr('transform',`translate(${cx},0)`).select('.focus-dot').attr('cy',y(metric==='share'?Math.min(1,total):Math.min(maxY,total)));const lines=keys.map(g=>`${g}: <strong>${metric==='share'?pct(r[g]):supplyFormatVolume(r[g],commodity)}</strong>`).join('<br>');showTip(event,`${r.period}<br>${lines}`);}).on('pointerleave',()=>{focus.style('display','none');hideTip();});
  const legend=keys.slice(0,8).map(g=>`<span class="supply-legend-item"><i style="background:${supplyGroupColor(g)}"></i>${g}</span>`).join('');el.insertAdjacentHTML('beforeend',`<div class="supply-inline-legend">${legend}</div>`);
}
function renderRefinerySignal(country){
  const el=qs('#refineryPanel');if(!el)return;let src=state.supply?.refinery?.[country];let oilProd=state.supply?state.supply.oil?.petrol95?.[country]?.history?.slice(-12):[];let diesel=state.supply?state.supply.oil?.diesel?.[country]?.history?.slice(-12):[];if(country==='EU27'){src={};for(const key of ['petrol95','diesel']){const byP=new Map();for(const code of EU.map(([c])=>c)){for(const r of (state.supply?.refinery?.[code]?.[key]||[])){byP.set(r.period,(byP.get(r.period)||0)+Number(r.value||0));}}src[key]=[...byP.entries()].map(([period,value])=>({period,value})).sort((a,b)=>a.period.localeCompare(b.period));}for(const key of ['petrol95','diesel']){const byP=new Map();const table=key==='petrol95'?state.supply.oil?.petrol95:state.supply.oil?.diesel;for(const code of EU.map(([c])=>c)){for(const r of (table?.[code]?.history||[])){byP.set(r.period,(byP.get(r.period)||0)+Number(r.total||0));}}if(key==='petrol95')oilProd=[...byP.entries()].map(([period,total])=>({period,total})).sort((a,b)=>a.period.localeCompare(b.period)).slice(-12);else diesel=[...byP.entries()].map(([period,total])=>({period,total})).sort((a,b)=>a.period.localeCompare(b.period)).slice(-12);}}
  if(!src || (!src.petrol95?.length&&!src.diesel?.length)){el.innerHTML='<div class="empty">Refinery-output series was not available for this country. Imported product volumes remain available above.</div>';return;}
  const cards=[];for(const [key,label] of [['petrol95','Petrol 95'],['diesel','Diesel']]){const importSeries=(key==='petrol95'?oilProd:diesel)||[];const imp=importSeries.reduce((n,r)=>n+(r.total||0),0);const ref=(src[key]||[]).slice(-12).reduce((n,r)=>n+(r.value||0),0);const signal=(imp+ref)?ref/(imp+ref):null;cards.push(`<div class="refinery-card"><div class="eyebrow">${label} · LAST 12 MONTHS</div><div class="refinery-number">${fmt(ref,0)} <span>kt refinery output</span></div><div class="refinery-sub">${fmt(imp,0)} kt imported product · output/(output+imports): <strong>${pct(signal)}</strong></div><div class="refinery-bar"><i style="width:${Math.max(0,Math.min(100,(signal||0)*100))}%"></i></div></div>`)}
  qs('#refineryPanel').innerHTML=cards.join('');qs('#refineryPeriod').textContent=state.supply?.meta?.supply_from?`archive ${state.supply.meta.supply_from} → ${state.supply.meta.supply_to}`:'';
}
function renderSupply(){
  if(!state.supply){qs('#supplyHistoryBadge').textContent='SUPPLY ARCHIVE NOT LOADED';qs('#supplyTimeline').innerHTML='<div class="empty">Run the full energy-data refresh to build the supply archive.</div>';return;}
  const c=state.supplyCountry,commodity=state.supplyCommodity,product=state.supplyProduct;state.supply._uiCommodity=commodity;state.supply._uiProduct=product;
  const series=supplySeries(c,commodity,product);renderSupplyMetrics(series,commodity,product);renderSupplyPartners(series,commodity);renderSupplyMap(series,state.supplyMapMetric);drawSupplyTimeline(series,state.supplyTimelineMetric,commodity);renderRefinerySignal(c);
  qs('#supplyLatestPeriod').textContent=supplyLatest(series)?.period||'NO DATA';qs('#supplyHistoryBadge').textContent=series.length?`ARCHIVE ${series[0].period} → ${series.at(-1).period}`:'NO OBSERVATIONS';qs('#supplyMethodNote').textContent=commodity.startsWith('gas_')?'Eurostat nrg_ti_gasm · monthly partner-origin imports':'Eurostat nrg_ti_oilm · monthly product imports · ultimate origin';
  qs('#supplyTimelineTitle').textContent=state.supplyTimelineMetric==='share'?'Origin share over time':'Imported volume over time';
}

function renderSources(){
  const f=state.data?.fuel,cz=state.data?.czech_regions,g=state.gas,o=state.oil,fx=state.fx;
  const cards=[
    ['European Commission','Weekly Oil Bulletin','Weekly national consumer prices for petroleum products. Current values are published weekly; the application keeps the validated historical archive.','https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en',f?.as_of,`Primary · history from ${f?.history_from||'—'}`],
    ['Archive transport','EC bulletin mirror','Validated flattened archive mirror used only when the Commission workbook layout cannot be parsed safely; the mirror states the underlying source is the EC Weekly Oil Bulletin.','https://huggingface.co/datasets/FionnHughes/eu-weekly-oil-bulletin',f?.observation_count,`Fallback archive · ${f?.archive_mirror_url?'enabled':'not used'}`],
    ['Eurostat','nrg_pc_202','Household natural-gas price statistics, D2, EUR/kWh, I_TAX (all taxes and levies included).','https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_202',g?.as_of,`Primary · history from ${g?.history_from||'—'}`],
    ['U.S. EIA / FRED','DCOILBRENTEU','Europe Brent Spot Price FOB, daily, USD/barrel.','https://fred.stlouisfed.org/series/DCOILBRENTEU',o?.as_of,`Primary series / distributor · history from ${o?.history_from||'—'}`],
    ['ECB','Reference exchange rates','Daily EUR/CZK and USD/CZK history used for date-matched Czech-koruna display.','https://data.ecb.europa.eu/data/datasets/EXR',fx?.as_of,`FX series · history from ${fx?.history_from||'—'}`],
    ['Czech regional feed','Czech regions','Secondary regional averages; current source reports LPG as a zero field, so the app treats it as not reported instead of inventing prices.','https://cenaphm.cz/data.json',cz?.as_of,`Secondary · ${cz?.history?.length||0} snapshots retained`],
    ['European Commission GISCO','NUTS 2024 geometry','Map boundaries; the EU map is clipped to the European geographic theatre so overseas territories do not shrink the continental view.','https://gisco-services.ec.europa.eu/distribution/v1/nuts-2024.html','NUTS 2024','Map geometry']
  ];
  qs('#sourceCards').innerHTML=cards.map(c=>`<div class="source-card"><div class="eyebrow">${c[5]}</div><h3>${c[0]} · ${c[1]}</h3><p>${c[2]}</p><a href="${c[3]}" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a><div class="small">Reference: ${c[4]||'—'}</div></div>`).join('');
  const pipeline=qs('#pipelineButton');if(pipeline){pipeline.href=RUNTIME.actionsUrl||'#';pipeline.classList.toggle('disabled',!RUNTIME.actionsUrl);}
}

function renderActive(){
  const active=qs('.tab.active')?.dataset.view;
  if(active==='overview')renderOverview();
  if(active==='eu-fuel'){renderEuTable();renderEuMap();renderEuHistory();}
  if(active==='czechia')renderCzTable();
  if(active==='gas')renderGas();
  if(active==='brent')renderBrent();
  if(active==='supply')renderSupply();
  if(active==='sources')renderSources();
}
function setCurrency(currency){state.currency=currency;qs('#currencyEur').classList.toggle('active',currency==='EUR');qs('#currencyCzk').classList.toggle('active',currency==='CZK');renderActive();if(!qs('#entityModal').hidden)renderEntityModal();}
function switchView(view){qsa('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));qsa('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));renderActive();window.scrollTo({top:0,behavior:'smooth'});}
function initControls(){
  qsa('.tab').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
  qsa('[data-go]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.go)));
  qs('#themeToggle').addEventListener('click',()=>{document.documentElement.classList.toggle('light');localStorage.setItem('theme',document.documentElement.classList.contains('light')?'light':'dark');});
  if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light');
  qs('#currencyEur').addEventListener('click',()=>setCurrency('EUR'));qs('#currencyCzk').addEventListener('click',()=>setCurrency('CZK'));
  qs('#euFuelSelect').addEventListener('change',e=>{state.euFuel=e.target.value;renderActive();});qs('#euHistoryWindow').addEventListener('change',e=>{state.euWindow=e.target.value;renderEuHistory();});qs('#euCountrySelect').addEventListener('change',e=>{state.euCountry=e.target.value;renderEuHistory();});
  qs('#czFuelSelect').addEventListener('change',e=>{state.czFuel=e.target.value;renderCzTable();});
  qs('#gasCountrySelect').addEventListener('change',e=>{state.gasCountry=e.target.value;renderGas();});qs('#gasHistoryWindow').addEventListener('change',e=>{state.gasWindow=e.target.value;renderGas();});
  qs('#brentHistoryWindow').addEventListener('change',e=>{state.brentWindow=e.target.value;renderBrent();});
  qs('#supplyCountrySelect').addEventListener('change',e=>{state.supplyCountry=e.target.value;renderSupply();});
  qs('#supplyCommoditySelect').addEventListener('change',e=>{state.supplyCommodity=e.target.value;const opts=supplyProductsForCommodity(e.target.value);qs('#supplyProductSelect').innerHTML=opts.map(([v,n])=>`<option value=\"${v}\">${n}</option>`).join('');state.supplyProduct=opts[0]?.[0]||'all';renderSupply();});
  qs('#supplyProductSelect').addEventListener('change',e=>{state.supplyProduct=e.target.value;renderSupply();});
  qs('#supplyMapMetric').addEventListener('change',e=>{state.supplyMapMetric=e.target.value;renderSupply();});
  qs('#supplyTimelineMetric').addEventListener('change',e=>{state.supplyTimelineMetric=e.target.value;renderSupply();});
  qs('#supplyWindow').addEventListener('change',e=>{state.supplyWindow=e.target.value;renderSupply();});
  qs('#entityMetricSelect').addEventListener('change',e=>{state.modal.metric=e.target.value;renderEntityModal();});qs('#entityWindowSelect').addEventListener('change',e=>{state.modal.window=e.target.value;renderEntityModal();});
  qs('#entityModalClose').addEventListener('click',closeEntityDashboard);qs('#entityModal').addEventListener('click',e=>{if(e.target.id==='entityModal')closeEntityDashboard();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!qs('#entityModal').hidden)closeEntityDashboard();});
}

async function boot(){
  initControls();
  const results=await Promise.all([loadJson('./data/current.json'),loadJson('./data/fuel-history.json'),loadJson('./data/gas.json'),loadJson('./data/oil.json'),loadJson('./data/fx.json'),loadJson('./data/supply.json').catch(()=>null)]);
  const [data,fuelHistory,gas,oil,fx,supply]=results;state.data=data;state.fuelHistory=fuelHistory;state.gas=gas;state.oil=oil;state.fx=fx;state.supply=supply;buildFxLookup();setStatus();
  qs('#euCountrySelect').innerHTML=EU.map(([c,n])=>`<option value="${c}">${flagEmoji(c)} ${n}</option>`).join('');qs('#euCountrySelect').value='CZ';
  qs('#supplyCountrySelect').innerHTML=['EU27',...EU.map(([c])=>c)].map(c=>`<option value="${c}">${flagImg(c,c==='EU27'?'EU-27':EU_NAMES.get(c)||c)} ${supplyName(c)}</option>`).join('');qs('#supplyCountrySelect').value=state.supplyCountry;
  const supplyOpts=supplyProductsForCommodity(state.supplyCommodity);qs('#supplyProductSelect').innerHTML=supplyOpts.map(([v,n])=>`<option value="${v}">${n}</option>`).join('');qs('#supplyProductSelect').value=state.supplyProduct;
  renderOverview();renderSources();
}
boot().catch(err=>{console.error(err);const b=qs('#freshnessBadge');b.textContent='DATA LOAD FAILED · OPEN PIPELINE';b.classList.remove('ok');b.href=RUNTIME.actionsUrl||'#';document.querySelector('main').insertAdjacentHTML('afterbegin',`<div class="panel" style="margin-bottom:14px;border-color:#8e304a"><strong>Validated data assets could not be loaded.</strong><div style="color:var(--muted);margin-top:4px">Run the repository's full data-refresh workflow. The repository now fails validation rather than silently leaving the dashboard on bootstrap data.</div></div>`);});
