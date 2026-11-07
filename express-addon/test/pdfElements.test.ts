import {expect,it} from 'vitest';
import {cardSelectionPages,pdfSelectionPages,cardComponent,expandComponent,pdfReferenceImages,mapPath,type PdfImport} from '../src/shared/pdfElements';
import {generateDesigns,iterateVersions,type BrandProfile} from '../src/shared/studio';
import {specToSvg} from '../src/shared/svgPreview';
const pdf:PdfImport={filename:'pinterest.pdf',source_id:'source',element_count:3,counts:{vector:1,text:1,image:1},warnings:[],provenance:'pdf_object_extraction',pages:[{id:'page',page_number:1,width:810,height:1012.5,preview_url:'data:image/png;base64,AA==',counts:{vector:1,text:1,image:1},elements:[
{id:'rect',page_number:1,kind:'vector',bbox:[100,200,200,300],order:0,label:'Shape',fill:'#ffffff',path_data:'M100,200 L300,200 L300,500 L100,500 Z'},
{id:'text',page_number:1,kind:'text',bbox:[120,220,150,40],order:1,label:'Free',text:'Free',font_size:20,color:'#000000'},
{id:'image',page_number:1,kind:'image',bbox:[120,280,100,160],order:2,label:'Photo',image_url:'data:image/png;base64,AA==',image_width:100,image_height:160}
]}],cards:[{id:'card',page_number:1,kind:'pricing_card',label:'Free',bbox:[100,200,200,300],element_ids:['rect','text','image'],preview_url:'data:image/png;base64,AA=='}]};
it('selects every source element or only checked IDs without duplicates',()=>{
 expect(pdfSelectionPages(pdf,['rect','text','image'])[0].elements).toHaveLength(3);
 expect(pdfSelectionPages(pdf,['text','text'])[0].elements.map(e=>e.id)).toEqual(['text']);
 expect(pdfSelectionPages(pdf,[])).toEqual([]);
});
it('keeps card vector, text and image as separate layers after resize and preserves path coordinates',()=>{
 const card=cardSelectionPages(pdf,['card'])[0];expect(card.elements.map(e=>e.kind)).toEqual(['vector','text','image']);
 expect(card.elements[0].path_data).toBe('M24.0000,24.0000 L624.0000,24.0000 L624.0000,924.0000 L24.0000,924.0000 Z');
 expect(card.elements[1].font_size).toBe(60);
 const component=cardComponent(pdf,pdf.cards[0]);const result=expandComponent(component,[50,60,200,300],'test');
 expect(result.nodes).toHaveLength(3);expect(result.vectors['test-0'].path).toContain('M100,200');
 const svg=specToSvg({design_id:'component',version:1,canvas:{width:400,height:500},nodes:result.nodes},{vectors:result.vectors,styles:result.styles,assets:result.assets});
 expect(svg).toContain('<path d="M50.0000,60.0000');expect(svg).toContain('Free');
});
it('new designs and re-composed iterations preserve editable PDF components',()=>{
 const component=cardComponent(pdf,pdf.cards[0]);
 const designs=generateDesigns({copy:{brand:'Test',headline:'A clear picture.',body:'One useful story.',cta:'Learn more'},images:[{id:'component',name:'Free',width:200,height:300,component}],origin:'new',format:'portrait'});
 for(const version of designs){expect(version.spec.nodes.some(n=>n.text==='Free')).toBe(true);expect(Object.keys(version.vectors!)).toContain('photo-0');}
 const iterations=iterateVersions(designs[0],'More editorial');expect(iterations).toHaveLength(3);
 for(const v of iterations){expect(v.parentId).toBe(designs[0].id);expect(v.spec.nodes.some(n=>n.text==='Free')).toBe(true);expect(v.vectors?.['photo-0']).toBeDefined();}
});

it('makes imported Pinterest cards immediately available to new designs without using the loaded page photo',()=>{
 const refs=pdfReferenceImages(pdf);
 expect(refs.map(r=>r.id)).toEqual(['card']);expect(refs[0].component?.elements.map(e=>e.kind)).toEqual(['vector','text','image']);
 const designs=generateDesigns({copy:{brand:'Test',headline:'A clearer picture.',body:'Create something from your inspiration.',cta:'Learn more'},images:refs,origin:'new',format:'portrait'});
 for(const v of designs){
  expect(v.origin).toBe('new');expect(v.nativeSources).toEqual({});
  expect(v.spec.nodes.some(n=>n.text==='Free')).toBe(true);expect(v.assets['photo-2']).toBe(pdf.pages[0].elements[2].image_url);
 }
 expect(pdfReferenceImages(pdf,['card','card']).map(i=>i.id)).toEqual(['card']);
 expect(pdfReferenceImages(pdf,[])).toEqual([]);
});

it('uses editable page components if a PDF has no detected cards, instead of leaving New design with zero references',()=>{
 const noCards={...pdf,cards:[]};const refs=pdfReferenceImages(noCards);
 expect(refs).toHaveLength(1);expect(refs[0].component?.elements).toEqual(pdf.pages[0].elements);
 expect(refs[0].component?.bounds).toEqual([0,0,810,1012.5]);
 expect(pdfReferenceImages({...noCards,pages:[]})).toEqual([]);
});
