import React,{useEffect,useMemo,useState} from 'react';
import type { DesignSpec,DocumentState } from '../shared/contracts';
import type { TextStyle } from '../shared/textLayout';
import { inspectImportedDesign } from '../shared/importedDesign';
import { specToSvg } from '../shared/svgPreview';
import { analyzePost,extractCopy,generateDesigns,iterateVersions,sourceImages,FORMATS,type BrandProfile,type PostCopy,type StudioFormat,type StudioImage,type StudioVersion } from '../shared/studio';
import { backendBase,fetchDemoDesign,importFromUrl,importPinterestPdf,parseBrandGuidelines,analyzeStyleReferences,type WebImage } from './api';
import { blobDataUrl,prepareWebImages } from './conceptAssets';
import { prepareVersionImages,readImageFiles } from './studioAssets';
import type { WebImageInput,WebImageInsertResult } from '../shared/webImages';
import PdfLibrary from './PdfLibrary';
import type {PdfImport,PdfInsertPage,PdfInsertResult,VectorStyle} from '../shared/pdfElements';
import {pdfReferenceImages} from '../shared/pdfElements';

type Section='import'|'load'|'brand'|'analyze'|'iterations'|'new';
interface SandboxApi {
  importCurrentDesign():Promise<{state:DocumentState;spec:DesignSpec}>;
  capturePreviewAssets():Promise<{assets:Array<{id:string;blob:Blob}>;missing:string[]}>;
  createConceptPage(spec:DesignSpec,title:string,images:Record<string,Blob>,styles:Record<string,TextStyle>,nativeSources?:Record<string,string>,vectors?:Record<string,VectorStyle>):Promise<DocumentState>;
  insertImageNodes(items:WebImageInput[]):Promise<WebImageInsertResult>;
  insertPdfPages(pages:PdfInsertPage[],blobs:Record<string,Blob>):Promise<PdfInsertResult>;
  selectAllPageElements():Promise<number>;
}
const NAV:Array<{id:Section;title:string;subtitle:string;icon:string}>=[
  {id:'import',title:'Import elements',subtitle:'Pinterest & images',icon:'import'},
  {id:'load',title:'Load elements',subtitle:'Your selected page',icon:'layers'},
  {id:'brand',title:'Brand guidelines',subtitle:'Make it your brand',icon:'brand'},
  {id:'analyze',title:'Analyze versions',subtitle:'Scores & insights',icon:'chart'},
  {id:'iterations',title:'Iterations',subtitle:'Refine your favourite',icon:'iterate'},
  {id:'new',title:'New design',subtitle:'From your inspiration',icon:'spark'},
];
const ICONS:Record<string,React.ReactNode>={
  import:<><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 16v4h16v-4"/></>,
  layers:<><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  brand:<><path d="M4 20 10 4h4l6 16M7 14h10"/></>,
  chart:<><path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/></>,
  iterate:<><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,
  spark:<><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,check:<path d="m5 12 4 4L19 6"/>,plus:<path d="M12 4v16M4 12h16"/>,
};
function Icon({name,size=20}:{name:string;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]??ICONS.spark}</svg>;}
const emptyCopy:PostCopy={brand:'',headline:'',body:'',cta:''};
function errorText(e:unknown){return e instanceof Error?e.message:String(e);}

export default function App(){
  const params=useMemo(()=>new URLSearchParams(window.location.search),[]);const harness=params.get('harness')==='1';
  const [section,setSection]=useState<Section>('load');const [sandbox,setSandbox]=useState<SandboxApi|null>(null);
  const [connection,setConnection]=useState(harness?'Preview workspace':'Connecting to Adobe…');
  const [busy,setBusy]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [creationErrors,setCreationErrors]=useState<Record<string,string>>({});
  const [versions,setVersions]=useState<StudioVersion[]>([]);const [selectedId,setSelectedId]=useState('');const [sourceId,setSourceId]=useState('');
  const [brand,setBrand]=useState<BrandProfile>();const [brandFile,setBrandFile]=useState('');
  const [webUrl,setWebUrl]=useState('');const [removeBg,setRemoveBg]=useState(false);const [webImages,setWebImages]=useState<WebImage[]>([]);
  const [pinterestPdf,setPinterestPdf]=useState<PdfImport>();
  const isPinterestLink=(()=>{try{return /(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/i.test(new URL(webUrl.trim()).hostname);}catch{return false;}})();
  const [referenceImages,setReferenceImages]=useState<StudioImage[]>([]);const [chosenImages,setChosenImages]=useState<string[]>([]);const [referenceColors,setReferenceColors]=useState<string[]>([]);
  const [referenceNote,setReferenceNote]=useState('');const [referenceErrors,setReferenceErrors]=useState<string[]>([]);
  const [copy,setCopy]=useState<PostCopy>(emptyCopy);const [format,setFormat]=useState<StudioFormat>('portrait');
  const [request,setRequest]=useState('');const [replacement,setReplacement]=useState('');const [analyzed,setAnalyzed]=useState(false);
  const [galleryIds,setGalleryIds]=useState<string[]>([]);const [brandImage,setBrandImage]=useState<StudioImage>();
  const [secondaryImages,setSecondaryImages]=useState(false);
  const selected=versions.find(v=>v.id===selectedId);const source=versions.find(v=>v.id===sourceId);
  const count=source?.spec.nodes.length??0;const activeNav=NAV.find(n=>n.id===section)!;

  useEffect(()=>{let cancelled=false;
    if(harness){setConnection('Preview workspace · SVG export');return;}
    (async()=>{try{
      let sdk=window.__creativednaSdk??window.addOnUISdk;
      if(!sdk)sdk=await new Promise<AddOnUISdkGlobal>((resolve,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('Adobe connection timed out. Reopen the add-on inside Adobe Express.'));},12000);
        const ready=(e:Event)=>{cleanup();resolve((e as CustomEvent).detail);};const failed=()=>{cleanup();reject(new Error('Could not load the Adobe SDK.'));};
        const cleanup=()=>{clearTimeout(timer);window.removeEventListener('creativedna-sdk',ready);window.removeEventListener('creativedna-sdk-error',failed);};
        window.addEventListener('creativedna-sdk',ready);window.addEventListener('creativedna-sdk-error',failed);
      });
      await sdk.ready;const proxy=await sdk.instance.runtime.apiProxy<SandboxApi>('documentSandbox');
      if(!cancelled){setSandbox(()=>proxy);setConnection('Connected to Adobe Express');}
    }catch(e){if(!cancelled){setConnection('Adobe unavailable');setError(errorText(e));}}})();return()=>{cancelled=true;};
  },[harness]);
  useEffect(()=>{if(params.get('showcase')==='1')void loadDemo();},[]);

  async function work(label:string,action:()=>Promise<void>){if(busy)return;setBusy(label);setError('');setNotice('');try{await action();}catch(e){setError(errorText(e));}finally{setBusy('');}}
  function navigate(next:Section){setSection(next);setError('');setNotice('');}
  function append(items:StudioVersion[]){setVersions(v=>[...v,...items]);setSelectedId(items[0].id);setGalleryIds(items.map(v=>v.id));setAnalyzed(false);}
  async function loadDemo(){await work('Loading sample',async()=>{
    const {spec}=await fetchDemoDesign('alphaz');const inferred=inspectImportedDesign(spec).spec;
    const assets:Record<string,string>={};inferred.nodes.filter(n=>n.type==='image').forEach(n=>assets[n.asset_id??n.id]='./alphaz-hero.png');
    const v:StudioVersion={id:`sample-${Date.now()}`,title:'AI Expo · sample',spec:inferred,styles:{},assets,nativeSources:{},origin:'loaded',changes:['Sample campaign · not your current Adobe page']};
    setVersions(prev=>[...prev,v]);setSelectedId(v.id);setSourceId(v.id);setCopy(extractCopy(v.spec));setSection('load');
  });}
  async function loadSelected(){if(!sandbox)return;await work('Reading every layer',async()=>{
    const imported=await sandbox.importCurrentDesign();if(!imported.spec.nodes.length)throw new Error('The selected page is empty. Select a page with your post, then load it again.');
    const inferred=inspectImportedDesign(imported.spec).spec;const nativeSources:Record<string,string>={};
    imported.state.bindings.filter(b=>b.type==='image').forEach(b=>nativeSources[b.node_id]=b.adobe_node_id);
    let assets:Record<string,string>={};
    try{const capture=await sandbox.capturePreviewAssets();for(const a of capture.assets)assets[a.id]=await blobDataUrl(a.blob);}catch{/* Native image copies do not depend on preview availability. */}
    const v:StudioVersion={id:`loaded-${Date.now()}`,title:`Loaded page · ${versions.filter(v=>v.origin==='loaded').length+1}`,spec:inferred,styles:{},assets,nativeSources,origin:'loaded',changes:[`${inferred.nodes.length} layers loaded, including grouped elements`]};
    setVersions(prev=>[...prev,v]);setSelectedId(v.id);setSourceId(v.id);setCopy(extractCopy(v.spec));setAnalyzed(false);
    setNotice(`Loaded ${inferred.nodes.length} elements. Your page is ready to redesign.`);
  });}
  async function fetchWeb(){await work(isPinterestLink?'Importing Pinterest elements':'Fetching your inspiration',async()=>{
    if(isPinterestLink){
      // This flow deliberately uses the supplied Pinterest PDF as its source.
      // Keep that provenance visible instead of implying a live board scrape.
      const pdf=await importPinterestPdf(),refs=pdfReferenceImages(pdf);
      if(!refs.length)throw new Error('No editable elements were found in the Pinterest PDF.');
      setPinterestPdf(pdf);setWebImages([]);setReferenceImages(refs);setChosenImages(refs.map(i=>i.id));setReferenceColors([]);setReferenceErrors([]);
      setReferenceNote(`${refs.length} editable ${pdf.cards.length?'cards':'page components'} from ${pdf.filename}. Ready for New design.`);
      setNotice(`${pdf.element_count} elements imported from ${pdf.filename}. ${refs.length} editable references are selected and ready in New design.`);return;
    }
    const res=await importFromUrl(webUrl.trim(),removeBg);setPinterestPdf(undefined);setWebImages(res.images);
    const refs=res.images.map(image=>({id:`web-${image.id}`,name:image.id,url:`data:${image.content_type};base64,${image.data_b64}`,width:image.width,height:image.height}));
    setReferenceImages(refs);setChosenImages(refs.map(i=>i.id));setReferenceColors([]);
    setReferenceErrors(res.errors.map(e=>e.error));setReferenceNote(`${refs.length} images fetched${res.errors.length?` · ${res.errors.length} could not be fetched`:''}.`);
    if(!refs.length)throw new Error('No usable images were found. Try a public Pinterest board or upload its images.');
    try{
      const prepared=await prepareWebImages(res.images.slice(0,6));
      const analysis=await analyzeStyleReferences(prepared.map((item,i)=>new File([item.blob],`reference-${i}.png`,{type:item.blob.type})));
      setReferenceColors([...new Set(analysis.analyses.flatMap(a=>a.dominant_colors.slice(0,2).map(c=>c.hex)))]);
      setReferenceNote(`${refs.length} images fetched · inspiration palette measured${res.errors.length?` · ${res.errors.length} unavailable`:''}.`);
    }catch{setReferenceNote(`${refs.length} images fetched. Palette analysis unavailable; choose brand guidelines for colors.`);}
  });}
  async function insertReferences(){if(!sandbox||!referenceImages.length)return;await work('Adding reference pages',async()=>{
    // Browser-prepared PNG/JPEG Blobs cross the bridge; no atob in Adobe.
    const items=webImages.length?await prepareWebImages(webImages):await Promise.all(referenceImages.map(async image=>{
      const bitmap=await createImageBitmap(await(await fetch(image.url!)).blob());
      try{const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0);
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image conversion failed.')),'image/png'));
        return {name:image.name,blob,width:image.width,height:image.height};}finally{bitmap.close();}
    }));
    const result=await sandbox.insertImageNodes(items);setNotice(`${result.insertedCount} images added to ${result.pageCount} separate reference pages.`);
  });}
  async function insertPdf(pages:PdfInsertPage[]){
    if(!sandbox)throw new Error('Open the add-on inside Adobe Express to add native elements.');
    const blobs:Record<string,Blob>={};
    for(const e of pages.flatMap(p=>p.elements).filter(e=>e.kind==='image')){
      if(!e.image_url)throw new Error(`Image ${e.label} is unavailable.`);
      const res=await fetch(e.image_url);if(!res.ok)throw new Error('Could not prepare a PDF image.');
      const bitmap=await createImageBitmap(await res.blob());
      try{
        // PDF image transforms can differ from the embedded bitmap ratio.
        // Bake that transform into the image, keeping the extracted box exact.
        // A minimum short side avoids >1% rounding errors on tiny PDF icons.
        const [,,width,height]=e.bbox;
        const scale=Math.min(4096/Math.max(width,height),Math.max(1,128/Math.min(width,height)));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('PDF image preparation is unavailable.');
        ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        blobs[e.id]=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare a PDF image.')),'image/png'));
      }finally{bitmap.close();}
    }
    const result=await sandbox.insertPdfPages(pages,blobs);
    setNotice(`${result.elementCount} native elements added across ${result.pageCount} pages. ${result.selectedCount} layers selected on the last page. Text uses available Arial fallbacks.`);
  }
  function usePdfCards(items:StudioImage[]){
    setReferenceImages(pinterestPdf?pdfReferenceImages(pinterestPdf):items);setChosenImages(items.map(i=>i.id));setWebImages([]);setReferenceColors([]);
    setReferenceNote(`${items.length} PDF cards ready as editable components.`);setSection('new');setNotice('Selected cards will keep their separate text, vector and image layers.');
  }
  async function uploadReferences(files:File[]){await work('Reading reference images',async()=>{
    const images=await readImageFiles(files);setPinterestPdf(undefined);setReferenceImages(images);setWebImages([]);setChosenImages(images.map(i=>i.id));setReferenceErrors([]);
    setReferenceNote(`${images.length} reference images ready.`);setReferenceColors([]);
    try{const res=await analyzeStyleReferences(files);setReferenceColors([...new Set(res.analyses.flatMap(a=>a.dominant_colors.slice(0,2).map(c=>c.hex)))]);setReferenceNote(`${images.length} references · palette measured from your images.`);}catch{setReferenceNote(`${images.length} references ready. Palette analysis unavailable; brand palette will be used.`);}
  });}
  async function loadGuide(text:string,name:string){await work('Reading brand guidelines',async()=>{
    const guide=await parseBrandGuidelines(text,name);setBrand(guide);setBrandFile(name);setNotice(`${guide.name} guidelines loaded. Review the extracted rules below.`);
  });}
  async function useSample(name:string){try{const res=await fetch(`./brand-guidelines/${name}.md`);if(!res.ok)throw new Error('Sample guidelines could not be loaded.');await loadGuide(await res.text(),`${name.toUpperCase()}_Brand_Guidelines.md`);}catch(e){setError(errorText(e));}}
  function generate(origin:'brand'|'new'){
    setError('');setNotice('');try{
      if(origin==='brand'&&!brand)throw new Error('Load a Markdown brand guide first.');
      if(origin==='brand'&&!source)throw new Error('Load the selected page first so its copy and images can be reused.');
      if(origin==='new'&&!chosenImages.length)throw new Error('Import a Pinterest board or upload reference images first.');
      const inputCopy=origin==='brand'?{...extractCopy(source!.spec),brand:brand!.wordmark||brand!.name}:copy;
      const sourcePhotos=source?sourceImages(source):[];
      const images=origin==='brand'?[...(brandImage?[brandImage]:sourcePhotos.slice(0,1)),...(secondaryImages?sourcePhotos.slice(1):[])]:referenceImages.filter(i=>chosenImages.includes(i.id));
      const items=generateDesigns({copy:inputCopy,images,brand,format,referenceColors,origin});append(items);setNotice('Three editable directions are ready. Choose one to create a new Adobe page.');
    }catch(e){setError(errorText(e));}
  }
  async function createPage(version:StudioVersion){if(busy)return;setCreationErrors(all=>({...all,[version.id]:''}));await work(`Creating ${version.title}`,async()=>{try{
    if(harness){
      const embedded={...version.assets};
      for(const [id,url] of Object.entries(embedded))if(!url.startsWith('data:')){const res=await fetch(url);if(!res.ok)throw new Error('Could not embed the design image.');embedded[id]=await blobDataUrl(await res.blob());}
      const svg=specToSvg(version.spec,{width:version.spec.canvas.width,styles:version.styles,assets:embedded,vectors:version.vectors});
      const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download=`CreativeDNA-${version.id}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('SVG downloaded. Open CreativeDNA inside Adobe Express to create native editable pages.');return;
    }
    if(!sandbox)throw new Error('Connect to Adobe Express before creating an editable page.');
    const images=await prepareVersionImages(version);const state=await sandbox.createConceptPage(version.spec,version.title,images,version.styles,version.nativeSources,version.vectors);
    if(state.node_count!==version.spec.nodes.length)throw new Error('Page creation was incomplete. Review the new page in Adobe.');
    setVersions(all=>all.map(v=>v.id===version.id?{...v,pageCreated:true}:v));
    setNotice(`${version.title} created with ${state.node_count} native editable layers.${state.unsupported_properties.length?` ${state.unsupported_properties.join(' ')}`:''}`);
  }catch(e){setCreationErrors(all=>({...all,[version.id]:errorText(e)}));throw e;}});}
  function createIteration(){if(!selected)return;setError('');try{const next=iterateVersions(selected,request,replacement,brand??selected.brand);append(next);setNotice('Three redesigned iterations are ready. Each uses the selected brand and keeps the original version.');}catch(e){setError(errorText(e));}}
  const analyses=useMemo(()=>versions.map(v=>({version:v,analysis:analyzePost(v,brand)})),[versions,brand]);
  const galleryOrigin=section==='new'?'new':section==='brand'?'brand':undefined;
  const gallery=galleryOrigin?versions.filter(v=>v.origin===galleryOrigin).slice(-3):versions.filter(v=>galleryIds.includes(v.id)&&v.origin!=='loaded');
  const originalCounts=['text','image','rectangle'].map(type=>source?.spec.nodes.filter(n=>n.type===type).length??0);

  function versionCard(v:StudioVersion,compact=false){const score=analyzePost(v,brand);const missing=v.spec.nodes.filter(n=>n.type==='image'&&!v.assets[n.asset_id??n.id]&&!v.assets[n.id]).length;
    return <article key={v.id} className={`version-card ${selectedId===v.id?'is-selected':''} ${compact?'compact':''}`}>
      <div className="version-top"><span className="eyebrow">{v.origin==='iteration'?'ITERATION':v.origin==='loaded'?'ORIGINAL':'DESIGN DIRECTION'}</span><span className="score-pill">{score.overall}<small>/100</small></span></div>
      <button className="art-button" onClick={()=>setSelectedId(v.id)} aria-label={`Select ${v.title}`} aria-pressed={selectedId===v.id}>
        <div className="version-art" dangerouslySetInnerHTML={{__html:specToSvg(v.spec,{width:420,assets:v.assets,styles:v.styles,vectors:v.vectors})}}/>
      </button>
      <div className="version-info">{v.origin==='iteration'&&<div className="iteration-context"><span>FROM {versions.find(parent=>parent.id===v.parentId)?.title??'PREVIOUS VERSION'}</span>{v.brand&&<b>{v.brand.name}</b>}</div>}<div className="title-row"><h3>{v.title}</h3>{selectedId===v.id&&<span className="selected-mark"><Icon name="check" size={15}/></span>}</div>
        <p>{v.spec.canvas.width} × {v.spec.canvas.height} <span>·</span> {v.spec.nodes.length} layers</p>
        {!!missing&&<p className="small-note">{missing} original image previews unavailable. Native images are preserved when you create the page.</p>}
        <button className="primary full" disabled={!!busy||(!harness&&!sandbox)} onClick={()=>void createPage(v)}><Icon name={v.pageCreated?'check':'plus'} size={16}/>{busy.includes(v.title)?'Creating page…':harness?'Download SVG':v.pageCreated?'Create another copy':'Create editable page'}</button>
        {creationErrors[v.id]&&<p className="message error" role="alert">{creationErrors[v.id]}</p>}
        {v.pageCreated&&<p className="small-note" role="status">Editable page created in Adobe Express.</p>}
        {v.origin==='iteration'&&<ul className="change-list">{v.changes.slice(0,3).map((change,i)=><li key={i}>{change}</li>)}</ul>}<div className="card-actions"><button className="text-button" onClick={()=>{setSelectedId(v.id);setSection('analyze');setAnalyzed(true);}}>Analyze version</button><button className="text-button" onClick={()=>{setSelectedId(v.id);setSection('iterations');}}>Make an iteration <span>↗</span></button></div>
      </div>
    </article>;
  }
  function copyFields(){return <div className="field-stack"><label>Brand / project<input value={copy.brand} onChange={e=>setCopy({...copy,brand:e.target.value})} placeholder={brand?.name??'Your brand'}/></label><label>Headline<input value={copy.headline} onChange={e=>setCopy({...copy,headline:e.target.value})} placeholder="One idea worth stopping for."/></label><label>Supporting copy<textarea value={copy.body} onChange={e=>setCopy({...copy,body:e.target.value})} placeholder="The details your audience should know." rows={3}/></label><label>Call to action<input value={copy.cta} onChange={e=>setCopy({...copy,cta:e.target.value})} placeholder="Explore the collection"/></label></div>;}
  function formatPicker(){return <label className="select-label">Post format<select value={format} onChange={e=>setFormat(e.target.value as StudioFormat)}>{Object.entries(FORMATS).map(([id,size])=><option key={id} value={id}>{id==='portrait'?'Portrait · 4:5':id==='square'?'Square · 1:1':'Stories · 9:16'} — {size.width} × {size.height}</option>)}</select></label>;}

  return <div className="studio">
    <nav className="studio-nav" aria-label="Studio sections">{NAV.map((item,i)=><button key={item.id} className={section===item.id?'active':''} onClick={()=>navigate(item.id)} aria-current={section===item.id?'page':undefined}><Icon name={item.icon} size={18}/><span>{item.title}</span><small>0{i+1}</small></button>)}</nav>
    <main>
      <div className="section-heading"><div className="eyebrow">0{NAV.indexOf(activeNav)+1} / THE CREATIVE PROCESS</div><h1>{activeNav.title}<span>.</span></h1><p>{({import:'Collect the pieces. Find your next direction.',load:'Start with the post you already made.',brand:'Same story. Unmistakably your brand.',analyze:'Know what works. See what to improve.',iterations:'Good design gets better with every version.',new:'Turn your inspiration into something new.'})[section]}</p></div>
      <div className="project-strip"><span><i className={source?'status-dot ready':'status-dot'}/>{source?`${count} elements loaded`:'No page loaded'}</span><span>{brand?.name??'No brand selected'}</span><span>{referenceImages.length} references</span></div>
      {harness&&<div className="info-note">Preview workspace · Download SVGs here. Native editable pages are created inside Adobe Express.</div>}
      {error&&<div className="message error" role="alert"><strong>Let’s fix this</strong><p>{error}</p><button className="dismiss" aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
      {notice&&<div className="message success" role="status"><Icon name="check" size={17}/><p>{notice}</p></div>}
      {busy&&<div className="working" role="status"><span className="spinner"/>{busy}…</div>}

      {section==='import'&&<>
        <div className="feature-note"><Icon name="import"/><div><strong>A moodboard, without the busywork.</strong><p>Optional. Bring in Pinterest references, then add them to separate pages or use them in a new design.</p></div><span className="tag">OPTIONAL</span></div>
        <section className="surface"><label className="field-label" htmlFor="board-url">Pinterest board or public image URL</label><form className="input-action" onSubmit={e=>{e.preventDefault();void fetchWeb();}}><input id="board-url" type="url" placeholder="https://pinterest.com/your-board/" value={webUrl} onChange={e=>setWebUrl(e.target.value)}/><button type="submit" className="primary" aria-label="Import elements from link" disabled={!!busy||!webUrl.trim()}><Icon name="arrow" size={17}/><span>Import elements</span></button></form>
          {!isPinterestLink&&<label className="checkbox"><input type="checkbox" checked={removeBg} onChange={e=>setRemoveBg(e.target.checked)}/>Remove backgrounds <span>local U²-Net</span></label>}
          <div className="or-divider"><span>or add your own</span></div><label className="upload-zone"><Icon name="plus"/><strong>Upload reference images</strong><span>PNG, JPG, WebP · select multiple files</span><input type="file" multiple accept="image/*" disabled={!!busy} onChange={e=>{if(e.target.files)void uploadReferences(Array.from(e.target.files));e.target.value='';}}/></label>
        </section>
        {pinterestPdf&&<PdfLibrary pdf={pinterestPdf} selectedCardIds={chosenImages} onCardsChange={setChosenImages} busy={!!busy} connected={!!sandbox} run={work} onInsert={insertPdf} onUse={usePdfCards} onSelectAll={async()=>{const n=await sandbox!.selectAllPageElements();setNotice(`${n} layers selected on the current page.`);}}/>}
        {!!referenceImages.length&&!pinterestPdf&&<section className="surface"><div className="section-title"><h2>Your inspiration library</h2><span className="count-pill">{referenceImages.length}</span></div><p className="muted">{referenceNote}</p><div className="reference-grid">{referenceImages.map(image=><figure key={image.id}><img src={image.url} alt={image.name}/><figcaption>{image.width} × {image.height}</figcaption></figure>)}</div>
          <button className="primary full" disabled={!!busy||!sandbox} onClick={()=>void insertReferences()}><Icon name="layers" size={17}/>Add {referenceImages.length} on separate pages</button><button className="secondary full" onClick={()=>navigate('new')}>Create a design from these <Icon name="arrow" size={16}/></button>
          {!!referenceErrors.length&&<details><summary>{referenceErrors.length} images couldn’t be fetched</summary>{referenceErrors.map((msg,i)=><p className="small-note" key={i}>{msg}</p>)}</details>}
        </section>}
      </>}

      {section==='load'&&<>
        <section className="load-feature"><div className="page-illustration" aria-hidden="true"><div className="paper back"/><div className="paper front"><span/><b>Make<br/>room for<br/><em>better.</em></b><i/><small>YOUR NEXT CHAPTER ↗</small></div><div className="floating-layer"><Icon name="layers" size={17}/>Every layer. Ready.</div></div><div><span className="eyebrow">YOUR CANVAS, CONNECTED</span><h2>One page.<br/>Every possibility.</h2><p>Select your post in Adobe Express. We’ll read its text, photos, shapes and grouped layers.</p><button className="primary full" disabled={!!busy||!sandbox} onClick={()=>void loadSelected()}><Icon name="layers" size={17}/>{source?'Reload selected page':'Load selected page'}<Icon name="arrow" size={17}/></button></div></section>
        {source&&<section className="surface"><div className="section-title"><h2>Your loaded elements</h2><span className="tag">READY</span></div><div className="stat-grid">{['Text layers','Images','Shapes'].map((label,i)=><div key={label}><strong>{originalCounts[i]}</strong><span>{label}</span></div>)}</div><details><summary>Inspect all {count} elements</summary><div className="element-list">{source.spec.nodes.map(n=><div key={n.id}><span className="element-kind">{n.type==='text'?'T':n.type==='image'?'▧':'□'}</span><div><strong>{n.role.replace(/_/g,' ')}</strong><p>{n.text??`${Math.round(n.bbox[2])} × ${Math.round(n.bbox[3])}`}</p></div></div>)}</div></details><div className="next-actions"><button className="primary full" onClick={()=>navigate('brand')}>Apply brand guidelines <Icon name="arrow" size={17}/></button><button className="text-button" onClick={()=>{setSection('analyze');setAnalyzed(true);}}>Analyze this post first ↗</button></div></section>}
        <div className="sample-line"><span>Just exploring?</span><button className="text-button" disabled={!!busy} onClick={()=>void loadDemo()}>Load the AI Expo sample ↗</button></div>
      </>}

      {section==='brand'&&<>
        <section className="surface"><label className="upload-zone brand-upload"><Icon name="brand"/><strong>Drop your brand into the process.</strong><span>Choose a .md or .txt brand guidelines file</span><input type="file" accept=".md,.txt,text/markdown,text/plain" disabled={!!busy} onChange={e=>{const f=e.target.files?.[0];if(f)void f.text().then(text=>loadGuide(text,f.name)).catch(e=>setError(errorText(e)));e.target.value='';}}/></label><div className="sample-label">Or try your supplied guidelines</div><div className="brand-presets">{['aurelia','pulse','wildform'].map(name=><button key={name} className={`brand-preset ${name} ${brand?.name.toLowerCase()===name?'chosen':''}`} onClick={()=>void useSample(name)} disabled={!!busy}>{name==='pulse'?'pulse':name.toUpperCase()}<span>{name==='aurelia'?'Quiet confidence':name==='pulse'?'Bold clarity':'Outside is yours'}</span></button>)}</div></section>
        {brand&&<section className="surface brand-profile"><div className="section-title"><div><span className="eyebrow">BRAND DNA</span><h2>{brand.name}</h2></div><span className="file-chip">MD</span></div><p className="muted filename">{brandFile}</p><div className="palette-strip">{brand.palette.map(hex=><div key={hex}><span style={{background:hex}}/><code>{hex}</code></div>)}</div><div className="type-pair"><div><span>HEADLINE</span><strong>{brand.typography.headline?.family??'Not specified'}</strong><small>Fallback: {brand.typography.headline?.fallback??'Arial'}</small></div><div><span>BODY</span><strong>{brand.typography.body?.family??'Not specified'}</strong><small>Fallback: {brand.typography.body?.fallback??'Arial'}</small></div></div><p className="brand-tone">{brand.tone}</p><details><summary>Review visual & copy rules</summary><ul className="rule-list">{[...brand.visual_rules,...brand.copy_rules].map((r,i)=><li key={i}>{r}</li>)}</ul><p className="small-note">Rules extracted locally. Fonts use the guideline’s available system fallback. Review imagery and claims before publishing.</p></details>{brand.warnings.length>0&&<p className="small-note">{brand.warnings.join(' · ')}</p>}</section>}
        <section className="surface"><div className="section-title"><h2>Reimagine your loaded post</h2><Icon name="spark"/></div><p className="muted">Reuse its copy, photos and logos. Rebuild the composition with your brand’s colors and typography.</p>{!source&&<button className="secondary full" onClick={()=>navigate('load')}>Load a page first <Icon name="arrow" size={16}/></button>}{formatPicker()}{source&&sourceImages(source).length>1&&<label className="checkbox secondary-image-choice"><input type="checkbox" checked={secondaryImages} onChange={e=>setSecondaryImages(e.target.checked)}/>Include all {sourceImages(source).length-1} secondary images and overlays</label>}<label className="inline-upload">Replace the main photo (optional)<input type="file" accept="image/*" disabled={!!busy} onChange={e=>{const f=e.target.files?.[0];if(f)void readImageFiles([f]).then(images=>setBrandImage(images[0])).catch(e=>setError(errorText(e)));e.target.value='';}}/></label>{brandImage&&<div className="replacement-preview"><img src={brandImage.url} alt={brandImage.name}/><span>{brandImage.name}</span><button className="text-button" onClick={()=>setBrandImage(undefined)}>Remove</button></div>}<button className="primary full" disabled={!!busy||!brand||!source} onClick={()=>generate('brand')}><Icon name="spark" size={17}/>Generate 3 brand directions</button></section>
        {gallery.length>0&&<div className="version-gallery">{gallery.map(v=>versionCard(v))}</div>}
      </>}

      {section==='analyze'&&<>
        <div className="feature-note"><Icon name="chart"/><div><strong>Design quality, with the reasons attached.</strong><p>Scores use a transparent 0–100 rubric. Attention potential is a design proxy; actual retention requires audience analytics.</p></div></div>
        {!versions.length?<div className="empty-state"><Icon name="layers" size={34}/><h2>Give us a post to look at.</h2><p>Load your selected page or generate a design first.</p><button className="primary" onClick={()=>navigate('load')}>Load elements <Icon name="arrow" size={17}/></button></div>:<>
          <button className="primary full" disabled={!!busy} onClick={()=>setAnalyzed(true)}>Analyze all {versions.length} versions <Icon name="chart" size={17}/></button>
          {analyzed&&<><div className="analysis-table"><div className="analysis-table-head"><span>VERSION</span><span>DESIGN SCORE</span></div>{analyses.map(({version:v,analysis:a})=><button key={v.id} className={selectedId===v.id?'selected':''} onClick={()=>setSelectedId(v.id)}><span><strong>{v.title}</strong><small>{v.origin==='loaded'?'Loaded page':v.origin==='iteration'?'Iteration':'Design direction'}</small></span><b>{a.overall}<small>/100</small></b></button>)}</div>
          {selected&&(()=>{const a=analyzePost(selected,brand);return <><section className="surface"><div className="section-title"><div><span className="eyebrow">VERSION BREAKDOWN</span><h2>{selected.title}</h2></div><span className="large-score">{a.overall}<small>/100</small></span></div>{a.metrics.map(m=><div className="metric" key={m.id}><div><strong>{m.label}</strong><span>{m.score??'—'}{m.score!==null&&<small>/100</small>}</span></div><div className="meter"><span style={{width:`${m.score??0}%`}}/></div><p>{m.evidence}</p></div>)}<div className="retention-row"><span>Measured retention</span><strong>No audience data</strong></div></section><section className="surface"><h2>What to improve</h2>{a.issues.length?<ul className="insights">{a.issues.map((issue,i)=><li key={i}><span>↗</span>{issue}</li>)}</ul>:<p className="muted">No issues found in the implemented layout checks. Review photography, tone and claims separately.</p>}<h2 className="space-top">What’s working</h2><ul className="insights strengths">{a.strengths.map((s,i)=><li key={i}><Icon name="check" size={15}/>{s}</li>)}</ul><p className="method-note">{a.provenance}</p><button className="primary full" onClick={()=>navigate('iterations')}>Improve this version <Icon name="arrow" size={17}/></button></section></>;})()}</>}
        </>}
      </>}

      {section==='iterations'&&<>
        {!versions.length?<div className="empty-state"><Icon name="iterate" size={34}/><h2>Every iteration needs a starting point.</h2><p>Load a post or create a design direction first.</p><button className="primary" onClick={()=>navigate('load')}>Load elements</button></div>:<>
          <section className="surface"><label className="select-label">Start from<select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>{versions.map(v=><option key={v.id} value={v.id}>{v.title}</option>)}</select></label><label className="field-label" htmlFor="iteration-request">What would you like to change?</label><textarea id="iteration-request" rows={4} value={request} onChange={e=>setRequest(e.target.value)} placeholder="Make the headline bigger and give the supporting copy more space…"/><div className="prompt-chips">{['More editorial','Photo-led design','Bold statement','More whitespace','Stronger CTA','Adapt to Stories'].map(prompt=><button key={prompt} onClick={()=>setRequest(prompt)}>{prompt}<span>+</span></button>)}</div><label className="select-label">New headline (optional)<input value={replacement} onChange={e=>setReplacement(e.target.value)} placeholder="Keep the current headline"/></label><button className="primary full" disabled={!!busy||(!request.trim()&&!replacement.trim())} onClick={createIteration}><Icon name="iterate" size={17}/>Create 3 refined iterations</button><p className="small-note">Each iteration rebuilds the layout with the active brand, original copy and image layers. Unsupported requests show an explanation.</p></section>
          <div className="section-title gallery-heading"><div><span className="eyebrow">RECOMPOSED / STILL YOURS</span><h2>Your latest directions</h2></div><span className="count-pill">{gallery.length}</span></div><div className="version-gallery">{(gallery.length?gallery:selected?[selected]:[]).map(v=>versionCard(v))}</div><details className="surface"><summary>Version history · {versions.length} versions</summary><div className="version-history">{[...versions].reverse().map(v=><button key={v.id} onClick={()=>{setSelectedId(v.id);setGalleryIds([v.id]);}}><strong>{v.title}</strong><span>{v.origin} · {v.spec.nodes.length} layers</span></button>)}</div></details>
        </>}
      </>}

      {section==='new'&&<>
        <section className="surface"><div className="section-title"><h2>Choose your visual ingredients</h2><button className="text-button" onClick={()=>navigate('import')}>Add references ↗</button></div><p className="muted">Selected images and PDF cards keep their layers. References guide the palette when no brand is selected.</p>{referenceImages.length?<><div className="selection-toolbar"><span>{chosenImages.length} / {referenceImages.length} selected</span><button className="text-button" onClick={()=>setChosenImages(referenceImages.map(i=>i.id))}>Select all</button><button className="text-button" onClick={()=>setChosenImages([])}>Clear</button></div><div className="reference-picker">{referenceImages.map(image=><button key={image.id} className={chosenImages.includes(image.id)?'chosen':''} aria-pressed={chosenImages.includes(image.id)} onClick={()=>setChosenImages(ids=>ids.includes(image.id)?ids.filter(id=>id!==image.id):[...ids,image.id])}><img src={image.url} alt={image.name}/><span>{chosenImages.includes(image.id)?<Icon name="check" size={14}/>:<Icon name="plus" size={14}/>}</span>{image.component&&<small className="component-label">{image.component.elements.length} layers</small>}</button>)}</div></>:<div className="small-empty"><Icon name="import"/><p>Bring a Pinterest board or upload inspiration images.</p><button className="secondary" onClick={()=>navigate('import')}>Import elements</button></div>}</section>
        <section className="surface"><div className="section-title"><h2>Give it a story</h2><Icon name="brand"/></div>{brand&&<div className="brand-context"><i style={{background:brand.palette[0]}}/>{brand.name}<button className="text-button" onClick={()=>setCopy({brand:brand.wordmark||brand.name,headline:brand.sample_copy.headline??'',body:brand.sample_copy.body??'',cta:brand.sample_copy.cta??''})}>Use sample copy</button></div>}{copyFields()}{formatPicker()}<button className="primary full" disabled={!!busy||!chosenImages.length||!copy.headline.trim()} onClick={()=>generate('new')}><Icon name="spark" size={17}/>Create 3 new designs</button></section>
        {gallery.length>0&&<div className="version-gallery">{gallery.map(v=>versionCard(v))}</div>}
      </>}
    </main>
    <footer className="studio-footer"><span className="footer-spark">✳</span><span>Made to be made yours.</span><details><summary>Studio details</summary><p>{connection}<br/>Design generation & scores: local heuristics.<br/>Brand parsing: deterministic extraction.<br/>Backend: {backendBase()}</p></details></footer>
  </div>;
}
