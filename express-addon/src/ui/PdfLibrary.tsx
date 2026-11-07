import React,{useEffect,useState} from 'react';
import type {PdfImport,PdfElement,PdfInsertPage} from '../shared/pdfElements';
import {cardSelectionPages,pdfSelectionPages,pdfReferenceImages} from '../shared/pdfElements';
import type {StudioImage} from '../shared/studio';

interface Props {pdf:PdfImport;selectedCardIds:string[];onCardsChange:(ids:string[])=>void;busy:boolean;connected:boolean;run:(label:string,task:()=>Promise<void>)=>Promise<void>;onInsert:(pages:PdfInsertPage[])=>Promise<void>;onUse:(items:StudioImage[])=>void;onSelectAll:()=>Promise<void>}
export default function PdfLibrary({pdf,selectedCardIds,onCardsChange,busy,connected,run,onInsert,onUse,onSelectAll}:Props){
  const [selected,setSelected]=useState<string[]>(()=>pdf.pages.flatMap(p=>p.elements.map(e=>e.id)));
  const cards=selectedCardIds.filter(id=>pdf.cards.some(c=>c.id===id)),setCards=onCardsChange;
  const [tab,setTab]=useState<'cards'|'elements'>('cards');const [kind,setKind]=useState('all');const [pageNumber,setPageNumber]=useState(0);
  useEffect(()=>{setSelected(pdf.pages.flatMap(p=>p.elements.map(e=>e.id)));setTab(pdf.cards.length?'cards':'elements');setKind('all');setPageNumber(0);},[pdf]);
  const elements=pdf.pages.flatMap(p=>p.elements);
  const shown=elements.filter(e=>(kind==='all'||e.kind===kind)&&(!pageNumber||e.page_number===pageNumber));
  const toggle=(id:string)=>setSelected(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  const setMany=(ids:string[],yes:boolean)=>setSelected(current=>yes?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id)));
  function useCards(){onUse(pdfReferenceImages(pdf,cards));}
  function elementPreview(e:PdfElement){return e.kind==='image'?<img src={e.image_url} alt=""/>:e.kind==='text'?<span className="pdf-text-icon">T</span>:<svg viewBox={`${e.bbox[0]} ${e.bbox[1]} ${e.bbox[2]} ${e.bbox[3]}`}><path d={e.path_data} fill={e.fill??'none'} stroke={e.stroke??'#000'} strokeWidth={e.stroke_width||1}/></svg>;}
  return <section className="surface pdf-library">
    <p className="small-note">Imported from {pdf.filename}</p>
      <div className="pdf-counts"><div><b>{pdf.element_count}</b><span>elements</span></div><div><b>{pdf.counts.vector}</b><span>vectors</span></div><div><b>{pdf.counts.text}</b><span>text layers</span></div><div><b>{pdf.cards.length}</b><span>cards</span></div></div>
      <div className="library-tabs" role="tablist" aria-label="PDF content"><button role="tab" aria-selected={tab==='cards'} onClick={()=>setTab('cards')}>Cards <span>{pdf.cards.length}</span></button><button role="tab" aria-selected={tab==='elements'} onClick={()=>setTab('elements')}>All elements <span>{pdf.element_count}</span></button></div>
      {tab==='cards'?<>
        <div className="selection-toolbar"><span>{cards.length} / {pdf.cards.length} selected</span><button className="text-button" onClick={()=>setCards(pdf.cards.map(c=>c.id))}>Select all cards</button><button className="text-button" onClick={()=>setCards([])}>Clear</button></div>
        <div className="pdf-card-grid">{pdf.cards.map(card=><button key={card.id} className={`pdf-card ${cards.includes(card.id)?'chosen':''}`} aria-pressed={cards.includes(card.id)} aria-label={`Select ${card.kind.replace(/_/g,' ')}: ${card.label}`} onClick={()=>setCards(cards.includes(card.id)?cards.filter(id=>id!==card.id):[...cards,card.id])}><div className="pdf-card-art"><img src={card.preview_url} alt={card.label}/><span className="selection-box">{cards.includes(card.id)?'✓':'+'}</span></div><span className="eyebrow">{card.kind.replace(/_/g,' ')}</span><strong>{card.label}</strong><small>{card.element_ids.length} layers · page {card.page_number}</small></button>)}</div>
        <button className="primary full" disabled={busy||!connected||!cards.length} onClick={()=>void run('Creating editable card pages',()=>onInsert(cardSelectionPages(pdf,cards)))}>Add {cards.length} editable cards on separate pages <span>↗</span></button>
        <button className="secondary full" disabled={busy||!cards.length} onClick={useCards}>Use selected cards in new designs <span>↗</span></button>
      </>:<>
        <div className="selection-toolbar"><span>{selected.length} / {elements.length} selected</span><button className="text-button" onClick={()=>setSelected(elements.map(e=>e.id))}>Select all elements</button><button className="text-button" onClick={()=>setSelected([])}>Clear</button></div>
        <div className="pdf-filters"><select aria-label="PDF element type" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All types</option><option value="vector">Vectors</option><option value="text">Text</option><option value="image">Images</option></select><select aria-label="PDF page" value={pageNumber} onChange={e=>setPageNumber(Number(e.target.value))}><option value={0}>All pages</option>{pdf.pages.map(p=><option key={p.id} value={p.page_number}>Page {p.page_number}</option>)}</select></div>
        <div className="selection-toolbar"><label><input type="checkbox" checked={shown.length>0&&shown.every(e=>selected.includes(e.id))} onChange={e=>setMany(shown.map(e=>e.id),e.target.checked)}/>Select visible ({shown.length})</label></div>
        <div className="pdf-element-list">{shown.map(e=><label key={e.id} className={selected.includes(e.id)?'chosen':''}><input type="checkbox" checked={selected.includes(e.id)} onChange={()=>toggle(e.id)}/><span className="pdf-element-thumb">{elementPreview(e)}</span><span><strong>{e.label}</strong><small>{e.kind==='image'?'Raster image':e.kind==='vector'?'Native vector':'Editable text'} · page {e.page_number}</small></span></label>)}</div>
        <button className="primary full" disabled={busy||!connected||!selected.length} onClick={()=>void run('Creating PDF element pages',()=>onInsert(pdfSelectionPages(pdf,selected)))}>Add {selected.length} selected elements to pages <span>↗</span></button>
      </>}
      <button className="text-button" disabled={busy||!connected} onClick={()=>void run('Selecting page layers',onSelectAll)}>Select all layers on the current Adobe page ↗</button>
      <details><summary>PDF pages & extraction details</summary><div className="pdf-page-grid">{pdf.pages.map(p=><figure key={p.id}><img src={p.preview_url} alt={`PDF page ${p.page_number}`}/><figcaption>Page {p.page_number} · {p.elements.length} elements</figcaption></figure>)}</div>{pdf.warnings.map((w,i)=><p key={i} className="small-note">{w}</p>)}<p className="small-note">Original raster card backings stay raster. Existing text and vector paths remain separate; card groups are detected by layout.</p></details>
  </section>;
}
