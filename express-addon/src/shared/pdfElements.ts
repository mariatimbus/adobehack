import type { BBox, DesignNode } from './contracts';
import type { TextStyle } from './textLayout';
import type { StudioImage } from './studio';

export interface VectorStyle { path:string; box:BBox; stroke?:string|null; strokeWidth?:number; opacity?:number; evenOdd?:boolean }
export interface PdfElement {
  id:string;page_number:number;kind:'text'|'vector'|'image';bbox:BBox;order:number;label:string;
  text?:string;font_size?:number;font_name?:string;bold?:boolean;color?:string;
  path_data?:string;fill?:string|null;stroke?:string|null;stroke_width?:number;opacity?:number;even_odd?:boolean;
  image_url?:string;image_width?:number;image_height?:number;raster?:boolean;
}
export interface PdfPage {id:string;page_number:number;width:number;height:number;preview_url:string;elements:PdfElement[];counts:Record<string,number>}
export interface PdfCard {id:string;page_number:number;kind:string;label:string;bbox:BBox;element_ids:string[];preview_url:string}
export interface PdfImport {filename:string;source_id:string;pages:PdfPage[];cards:PdfCard[];counts:Record<string,number>;element_count:number;warnings:string[];provenance:string}
export interface PdfComponent {id:string;label:string;bounds:BBox;elements:PdfElement[];previewUrl:string}
export interface PdfInsertPage {title:string;width:number;height:number;elements:PdfElement[]}
export interface PdfInsertResult {pageCount:number;elementCount:number;selectedCount:number;warnings:string[]}
export function pdfSelectionPages(pdf:PdfImport,ids:string[]):PdfInsertPage[] {
  const chosen=new Set(ids);
  return pdf.pages.map(page=>({title:`${pdf.filename} · ${page.page_number}`,width:page.width,height:page.height,elements:page.elements.filter(e=>chosen.has(e.id))})).filter(p=>p.elements.length);
}
export function cardComponent(pdf:PdfImport,card:PdfCard):PdfComponent {
  const members=new Set(card.element_ids);
  return {id:card.id,label:card.label,bounds:card.bbox,elements:pdf.pages.find(p=>p.page_number===card.page_number)!.elements.filter(e=>members.has(e.id)),previewUrl:card.preview_url};
}
/** Imports are immediately usable by New design. Keep original PDF objects
 * as components; preview images are only thumbnails, never their replacement. */
export function pdfReferenceImages(pdf:PdfImport,cardIds?:string[]):StudioImage[]{
  if(pdf.cards.length||cardIds!==undefined){
    const chosen=cardIds===undefined?undefined:new Set(cardIds);
    return pdf.cards.filter(c=>!chosen||chosen.has(c.id)).map(c=>({id:c.id,name:c.label,width:c.bbox[2],height:c.bbox[3],url:c.preview_url,component:cardComponent(pdf,c)}));
  }
  return pdf.pages.filter(p=>p.elements.length).map(p=>({id:`pdf-page-${p.id}`,name:`${pdf.filename} · page ${p.page_number}`,width:p.width,height:p.height,url:p.preview_url,
    component:{id:`pdf-page-${p.id}`,label:`Page ${p.page_number}`,bounds:[0,0,p.width,p.height],elements:p.elements,previewUrl:p.preview_url}}));
}
export function cardSelectionPages(pdf:PdfImport,ids:string[]):PdfInsertPage[] {
  const chosen=new Set(ids);
  return pdf.cards.filter(c=>chosen.has(c.id)).map(card=>{
    const component=cardComponent(pdf,card);const [x,y,w,h]=component.bounds;const scale=Math.min(3,900/Math.max(w,h));
    const {nodes,styles,assets,vectors}=expandComponent(component,[24,24,w*scale,h*scale],card.id);
    // Preserve extraction contracts while moving each card to its own page.
    const elements=nodes.map((node,index):PdfElement=>{
      const source=component.elements[index]; const vector=vectors[node.id];
      return {...source,id:node.id,bbox:node.bbox,font_size:node.font_size??undefined,image_url:assets[node.id],
        ...(vector?{path_data:mapPath(vector.path,vector.box,node.bbox),stroke_width:(vector.strokeWidth??0)*scale}:{}),
        text:node.text??undefined,color:node.color??undefined};
    });
    return {title:card.label,width:Math.max(100,w*scale+48),height:Math.max(100,h*scale+48),elements};
  });
}
/** Extraction uses M/L/C/Z absolute paths only, so every coordinate pair can
 * be transformed safely without altering arc flags or relative commands. */
export function mapPath(path:string,from:BBox,to:BBox):string {
  let axis=0;return path.replace(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g,token=>{
    const i=axis++%2;return ((Number(token)-from[i])*to[i+2]/from[i+2]+to[i]).toFixed(4);
  });
}
export function expandComponent(component:PdfComponent,box:BBox,prefix:string):{nodes:DesignNode[];styles:Record<string,TextStyle>;assets:Record<string,string>;vectors:Record<string,VectorStyle>} {
  const scale=Math.min(box[2]/component.bounds[2],box[3]/component.bounds[3]);
  const dx=box[0]+(box[2]-component.bounds[2]*scale)/2,dy=box[1]+(box[3]-component.bounds[3]*scale)/2;
  const nodes:DesignNode[]=[],styles:Record<string,TextStyle>={},assets:Record<string,string>={},vectors:Record<string,VectorStyle>={};
  component.elements.forEach((e,i)=>{
    const id=`${prefix}-${i}`;const bbox:BBox=[dx+(e.bbox[0]-component.bounds[0])*scale,dy+(e.bbox[1]-component.bounds[1])*scale,e.bbox[2]*scale,e.bbox[3]*scale];
    const node:DesignNode={id,bbox,type:e.kind==='vector'?'rectangle':e.kind,role:'decoration'};
    if(e.kind==='text'){node.text=e.text;node.font_size=(e.font_size??12)*scale;node.color=e.color;styles[id]={family:'Arial, Helvetica, sans-serif',weight:e.bold?700:400,lineHeight:1.1};}
    if(e.kind==='image'){node.asset_id=id;if(e.image_url)assets[id]=e.image_url;}
    if(e.kind==='vector'){node.fill=e.fill;vectors[id]={path:e.path_data!,box:e.bbox,stroke:e.stroke,strokeWidth:e.stroke_width,opacity:e.opacity,evenOdd:e.even_odd};}
    nodes.push(node);
  });return {nodes,styles,assets,vectors};
}
