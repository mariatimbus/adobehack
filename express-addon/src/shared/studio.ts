import type { BBox, DesignNode, DesignSpec } from './contracts';
import { wrapText, type TextStyle } from './textLayout';
import type {PdfComponent,VectorStyle} from './pdfElements';
import {generateBrandLayouts} from './brandLayouts';

export interface BrandProfile {
  name: string; wordmark?: string; tagline: string; palette: string[];
  colors: Array<{role:string; name:string; hex:string; usage:string}>;
  typography: Record<string,{family:string; fallback:string}>;
  sample_copy: Record<string,string>; visual_rules:string[]; copy_rules:string[]; tone:string;
  forbidden_phrases:string[]; min_font_size:Record<string,number>; locked_roles:string[];
  notes:string[]; warnings:string[]; provenance:string;
}
export interface StudioImage { id:string; url?:string; nativeId?:string; width:number; height:number; name:string; component?:PdfComponent }
export interface PostCopy { brand:string; headline:string; body:string; cta:string }
export interface StudioVersion {
  id:string; title:string; spec:DesignSpec; styles:Record<string,TextStyle>;
  assets:Record<string,string>; nativeSources:Record<string,string>;
  origin:'loaded'|'brand'|'new'|'iteration'; parentId?:string;
  brand?:BrandProfile; changes:string[]; request?:string; pageCreated?:boolean;
  vectors?:Record<string,VectorStyle>;
  ingredients?:StudioImage[];
  campaignCopy?:PostCopy;
}
export const FORMATS = { portrait:{width:1080,height:1350}, square:{width:1080,height:1080}, story:{width:1080,height:1920} };
export type StudioFormat = keyof typeof FORMATS;
export function luminance(hex:string):number {
  const rgb = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
export function contrast(a:string,b:string):number { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
export function extractCopy(spec:DesignSpec):PostCopy {
  const texts=spec.nodes.filter(n=>n.type==='text'&&n.text?.trim()&&n.role!=='decoration');
  const head=texts.find(n=>n.role==='headline')??[...texts].sort((a,b)=>(b.font_size??0)-(a.font_size??0))[0];
  const brand=texts.find(n=>n.role==='brand'); const cta=texts.find(n=>n.role==='cta_text');
  return {brand:brand?.text??'',headline:head?.text??'',body:texts.filter(n=>n!==head&&n!==brand&&n!==cta).map(n=>n.text).join('\n\n'),cta:cta?.text??''};
}
export function sourceImages(version:StudioVersion):StudioImage[] {
  return version.spec.nodes.filter(n=>n.type==='image').sort((a,b)=>Number(b.role==='product')-Number(a.role==='product')||b.bbox[2]*b.bbox[3]-a.bbox[2]*a.bbox[3]).map(n=>({id:n.id,url:version.assets[n.asset_id??n.id]??version.assets[n.id],nativeId:version.nativeSources[n.id],width:n.bbox[2],height:n.bbox[3],name:n.asset_id??n.id}));
}
function cssFont(family:string):string {
  if(/cormorant|georgia/i.test(family)) return 'Georgia, serif';
  if(/archivo|arial black/i.test(family)) return 'Arial Black, Arial, sans-serif';
  return 'Arial, Helvetica, sans-serif';
}
export interface GenerateInput {copy:PostCopy; images:StudioImage[]; brand?:BrandProfile; format:StudioFormat; referenceColors?:string[]; origin:'brand'|'new'; refinement?:{headlineScale?:number; whitespace?:boolean; strongCta?:boolean}}
/** Brand-specific compositions share the same native spec as their previews. */
export {generateBrandLayouts as generateDesigns} from './brandLayouts';

export interface Metric {id:string;label:string;score:number|null;evidence:string;}
export interface PostAnalysis {overall:number;metrics:Metric[];issues:string[];strengths:string[];provenance:string;}
const clamp=(n:number)=>Math.round(Math.max(0,Math.min(100,n)));
const overlap=(a:BBox,b:BBox)=>Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
export function analyzePost(version:StudioVersion, brand=version.brand):PostAnalysis {
  const {spec}=version; const texts=spec.nodes.filter(n=>n.type==='text'&&n.text?.trim());
  const headline=texts.find(n=>n.role==='headline'); const cta=texts.find(n=>n.role==='cta_text');
  const body=texts.filter(n=>n.role==='subhead'); const issues:string[]=[]; const strengths:string[]=[];
  let badContrast=0,unknownContrast=0,overflow=0,collisions=0;
  const outside=spec.nodes.filter(n=>n.bbox[0]<-1||n.bbox[1]<-1||n.bbox[0]+n.bbox[2]>spec.canvas.width+1||n.bbox[1]+n.bbox[3]>spec.canvas.height+1);
  for(const n of texts){
    if(wrapText(n.text!,n.font_size??24,n.bbox[2],version.styles[n.id]).length*(n.font_size??24)*(version.styles[n.id]?.lineHeight??1.15)>n.bbox[3]+2)overflow++;
    const under=spec.nodes.slice(0,spec.nodes.indexOf(n)).filter(a=>a.type!=='text'&&overlap(a.bbox,n.bbox)>0).pop();
    if(under?.type==='rectangle'&&under.fill&&n.color&&overlap(under.bbox,n.bbox)>=n.bbox[2]*n.bbox[3]*.98){if(contrast(n.color,under.fill)<((n.font_size??24)*360/spec.canvas.width>=24?3:4.5))badContrast++;}
    else unknownContrast++;
  }
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++)if(overlap(texts[i].bbox,texts[j].bbox)>4)collisions++;
  const mobileSmall=texts.filter(n=>(n.font_size??0)*360/spec.canvas.width<10&&n.role!=='decoration').length;
  const headWords=headline?.text?.trim().split(/\s+/).length??0;
  const ratio=(headline?.font_size??0)/Math.max(1,...body.map(n=>n.font_size??24));
  const hierarchy=clamp((headline?55:0)+Math.min(35,Math.max(0,ratio-1)*22)-(collisions*12)+(ratio>=1.7?10:0));
  const readable=clamp(100-mobileSmall*12-badContrast*17-overflow*15-outside.length*8);
  const attention=clamp((headline?55:0)+(headWords>0&&headWords<=12?25:headWords<=20?10:0)+(spec.nodes.some(n=>n.type==='image')?10:0)+(hierarchy>=75?10:0)-collisions*8);
  const action=cta?clamp(65+(spec.nodes.some(n=>n.role==='cta_background')?20:0)+(cta.text!.split(/\s+/).length<=7?15:0)-outside.filter(n=>n.id===cta.id).length*60):0;
  const colorNodes=spec.nodes.filter(n=>n.fill||n.color);
  const paletteMatches=brand?colorNodes.filter(n=>brand.palette.includes((n.fill??n.color??'').toLowerCase())).length:0;
  const copy=texts.map(n=>n.text).join(' ').toLowerCase();
  const forbidden=brand?.forbidden_phrases.filter(p=>copy.includes(p.toLowerCase()))??[];
  const brandScore=brand?clamp((colorNodes.length?paletteMatches/colorNodes.length:0)*80+(Object.values(version.styles).every(s=>[cssFont(brand.typography.headline?.family??'Arial'),cssFont(brand.typography.body?.family??'Arial')].includes(s.family??''))?20:0)-forbidden.length*40):null;
  if(outside.length)issues.push(`${outside.length} elements extend beyond the canvas.`);
  if(collisions)issues.push(`${collisions} text boxes overlap; check reading order.`);
  if(mobileSmall)issues.push(`${mobileSmall} text layers are smaller than 10px at a 360px feed width.`);
  if(overflow)issues.push(`${overflow} text boxes may overflow (browser font estimate).`);
  if(badContrast)issues.push(`${badContrast} text layers have low contrast on a solid background.`);
  if(unknownContrast)issues.push(`${unknownContrast} text contrast checks need visual review (image or unknown background).`);
  if(!cta)issues.push('No clear call to action was detected.');
  if(headWords>12)issues.push('Shorten the headline to make the first read faster.');
  if(forbidden.length)issues.push(`Forbidden copy: ${forbidden.join(', ')}.`);
  if(hierarchy>=75)strengths.push('Headline has a clear size advantage over supporting copy.');
  if(action>=85)strengths.push('A short CTA is grouped with a dedicated action area.');
  if(!outside.length)strengths.push('All measured elements fit inside the canvas.');
  const metrics:Metric[]=[{id:'attention',label:'Attention potential',score:attention,evidence:`${headWords} headline words; size and image presence checked.`},
    {id:'readability',label:'Readability',score:readable,evidence:`${mobileSmall} small layers · ${badContrast} low-contrast · ${overflow} possible overflow.`},
    {id:'hierarchy',label:'Visual hierarchy',score:hierarchy,evidence:`Headline/body size ratio ${ratio.toFixed(1)}× · ${collisions} text overlaps.`},
    {id:'cta',label:'CTA clarity',score:action,evidence:cta?'Action length, grouping and canvas position.':'No CTA detected.'},
    {id:'brand',label:'Brand alignment',score:brandScore,evidence:brand?`Palette, declared fallback fonts and exact forbidden phrases checked for ${brand.name}. Imagery, tone and claims need human review.`:'Load brand guidelines to measure this.'}];
  const measured=metrics.filter(m=>m.score!==null);return {overall:clamp(measured.reduce((sum,m)=>sum+m.score!,0)/measured.length),metrics,issues,strengths,provenance:'Local design heuristics · 0–100 rubric scores, not measured retention or engagement predictions'};
}

export function iterateVersions(parent:StudioVersion,request:string,newHeadline?:string,activeBrand=parent.brand):StudioVersion[]{
  const low=request.toLowerCase(),changes:string[]=[];
  const copy={...(parent.campaignCopy??extractCopy(parent.spec))};
  if(activeBrand&&activeBrand.name!==parent.brand?.name){copy.brand=activeBrand.wordmark||activeBrand.name;changes.push(`Applied ${activeBrand.name} brand identity`);}
  const replacement=newHeadline?.trim()||request.match(/(?:headline|titlu)\s*(?:to|cu|:|=)\s*[“"]([^”"]+)[”"]/i)?.[1];
  if(replacement){copy.headline=replacement;changes.push('New headline');}
  const bigger=/bigger|larger|mai mare|m[aă]re[sș]te/.test(low)&&/headline|titlu/.test(low);
  const whitespace=/space|spacing|whitespace|spa[tț]iu|aerisit/.test(low);
  const cta=/cta|call.to.action|buton/.test(low);
  const visual=/editorial|photo|foto|bold|statement|redesign|reimagine|design|mai bine|premium|brand/.test(low);
  const format:StudioFormat=/story|stories|9:16/.test(low)?'story':/square|p[aă]trat|1:1/.test(low)?'square':parent.spec.canvas.height/parent.spec.canvas.width>1.5?'story':parent.spec.canvas.height===parent.spec.canvas.width?'square':'portrait';
  if(bigger)changes.push('Stronger headline hierarchy');if(whitespace)changes.push('More whitespace and a calmer copy rhythm');if(cta)changes.push('More prominent CTA');
  if(cta&&/top|sus/.test(low))throw new Error('CTA at the top is not supported by the local layout engine. Try a stronger CTA or a new editorial direction.');
  if(FORMATS[format].height!==parent.spec.canvas.height)changes.push(`${FORMATS[format].width} × ${FORMATS[format].height} format`);
  if(visual)changes.push('Recomposed into three brand directions');
  if(!changes.length)throw new Error('This request is not supported by the local editor yet. Try an editorial layout, more whitespace, photo-led design, a stronger CTA, Stories, square, or a new headline.');
  const forbidden=activeBrand?.forbidden_phrases.filter(p=>Object.values(copy).join(' ').replace(/\s+/g,' ').toLowerCase().includes(p.toLowerCase()))??[];
  if(forbidden.length)throw new Error(`This iteration contains forbidden brand copy: ${forbidden.join(', ')}.`);
  const candidates=generateBrandLayouts({copy,images:parent.ingredients??sourceImages(parent),brand:activeBrand,format,origin:'brand',refinement:{headlineScale:bigger?1.15:1,whitespace,strongCta:cta}});
  if(/photo|foto/.test(low))candidates.unshift(candidates.splice(1,1)[0]);
  else if(/bold|statement/.test(low))candidates.unshift(candidates.splice(2,1)[0]);
  else if(!visual){const originalTitle=parent.title.split(' · ')[0];const match=candidates.findIndex(v=>v.title===originalTitle);if(match>=0)candidates.unshift(candidates.splice(match,1)[0]);}
  return candidates.map((v,index)=>({...v,title:`${v.title} · iteration ${index+1}`,parentId:parent.id,origin:'iteration',changes:[...changes,...v.changes],request,pageCreated:false}));
}
export function iterateVersion(parent:StudioVersion,request:string,newHeadline?:string):StudioVersion{return iterateVersions(parent,request,newHeadline)[0];}
