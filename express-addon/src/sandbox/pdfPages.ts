import {editor,fonts,constants} from 'express-document-sdk';
import type {BitmapImage,PageNode,VisualNode} from 'express-document-sdk';
import type {PdfInsertPage,PdfInsertResult} from '../shared/pdfElements';
import {NODE_ID_KEY,DESIGN_ID_KEY,VERSION_KEY,currentArtboard} from './pageImport';
import {createVector,hexColor} from './vectorNode';

/** Every extracted object stays a separate native layer. Images keep their
 * raster provenance; original paths are never flattened to bitmap previews. */
export async function insertPdfPages(pages:PdfInsertPage[],blobs:Record<string,Blob>):Promise<PdfInsertResult>{
  if(!pages.length)throw new Error('Select at least one PDF element or card.');
  const all=pages.flatMap(p=>p.elements);
  if(pages.some(p=>!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<1||p.height<1)||all.some(e=>!e.bbox.every(Number.isFinite)||e.bbox[2]<=0||e.bbox[3]<=0))throw new Error('Invalid PDF geometry.');
  const images=all.filter(e=>e.kind==='image');
  for(const e of images)if(!blobs[e.id]?.size)throw new Error(`Missing image ${e.label}. No PDF pages were added.`);
  let loading:Promise<Array<[string,BitmapImage]>>|undefined;
  await editor.keepContentActiveDuringAsync(editor.context.currentPage,async()=>{},()=>{
    loading=Promise.all(images.map(e=>editor.loadBitmapImage(blobs[e.id]).then(bitmap=>[e.id,bitmap] as [string,BitmapImage])));
  });
  const bitmaps=new Map(await loading!);
  const regular=await fonts.fromPostscriptName('ArialMT'),bold=await fonts.fromPostscriptName('Arial-BoldMT');
  const created:PageNode[]=[];let selectedCount=0;
  await editor.keepContentActiveDuringAsync(editor.context.currentPage,async()=>{},()=>{
    try{
      for(const input of pages){
        const page=editor.documentRoot.pages.addPage({width:input.width,height:input.height});created.push(page);page.name=`CreativeDNA · ${input.title}`;
        const board=Array.from(page.artboards)[0];const nodes:VisualNode[]=[];
        for(const e of [...input.elements].sort((a,b)=>a.order-b.order)){
          const [x,y,width,height]=e.bbox;let node:VisualNode;
          if(e.kind==='text'){
            const text=editor.createText(e.text??'');text.layout={type:2,width:width+Math.max(2,width*.025)};
            text.textAlignment=constants.TextAlignment.left;text.fullContent.applyParagraphStyles({spaceBefore:0,spaceAfter:0,lineSpacing:1});
            const font=e.bold?bold:regular;text.fullContent.applyCharacterStyles({...(font?{font}:{}),fontSize:e.font_size??12,color:hexColor(e.color??'#000000')});node=text;
          }else if(e.kind==='vector')node=createVector({path:e.path_data!,box:e.bbox,stroke:e.stroke,strokeWidth:e.stroke_width,opacity:e.opacity,evenOdd:e.even_odd},e.bbox,e.fill);
          else node=editor.createImageContainer(bitmaps.get(e.id)!,{initialSize:{width,height}});
          board.children.append(node);node.setPositionInParent({x,y},{x:node.boundsLocal.x,y:node.boundsLocal.y});
          node.opacity=e.opacity??1;node.addOnData.setItem(NODE_ID_KEY,e.id);node.addOnData.setItem('creativedna.kind',e.kind==='vector'?'rectangle':e.kind);
          node.addOnData.setItem('creativedna.pdf_kind',e.kind);node.addOnData.setItem('creativedna.source_name',e.label);nodes.push(node);
        }
        board.addOnData.setItem(DESIGN_ID_KEY,`pdf-${page.id}`);board.addOnData.setItem(VERSION_KEY,'1');
        editor.context.selection=nodes;selectedCount=editor.context.selection.length;
      }
    }catch(error){for(const page of [...created].reverse())editor.documentRoot.pages.remove(page);throw error;}
  });
  return {pageCount:created.length,elementCount:all.length,selectedCount,warnings:['PDF text uses Arial/Arial Bold fallbacks. Original raster cards remain raster backings with separately editable text.']};
}
export function selectAllPageElements():number{
  const nodes=Array.from(currentArtboard().children);editor.context.selection=nodes;
  return editor.context.selection.length;
}
