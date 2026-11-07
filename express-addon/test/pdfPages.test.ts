import {beforeEach,expect,it,vi} from 'vitest';
import type {PdfInsertPage} from '../src/shared/pdfElements';
const state=vi.hoisted(()=>({pages:[] as any[],editing:false,selected:[] as any[],paths:[] as any[],failPath:false,failBitmap:false}));
vi.mock('express-document-sdk',()=>{
 function node(type:string){const data=new Map<string,string>();return {id:`node-${Math.random()}`,type,opacity:1,boundsLocal:{x:0,y:0},setPositionInParent:vi.fn(),addOnData:{setItem:(k:string,v:string)=>data.set(k,v),getItem:(k:string)=>data.get(k)},fullContent:{applyParagraphStyles:vi.fn(),applyCharacterStyles:vi.fn()}};}
 const pages={addPage:(canvas:unknown)=>{if(!state.editing)throw new Error('outside editing callback');const children:any[]=[];Object.assign(children,{append:(n:any)=>children.push(n)});const page={id:`p${state.pages.length}`,canvas,artboards:[{id:'board',children,addOnData:{setItem:vi.fn()}}]};state.pages.push(page);return page;},remove:(page:unknown)=>{state.pages=state.pages.filter(p=>p!==page);}};
 return {constants:{FillRule:{nonZero:0,evenOdd:1},TextAlignment:{left:'left'}},fonts:{fromPostscriptName:async(name:string)=>({postscriptName:name})},editor:{
 context:{currentPage:{},get selection(){return state.selected;},set selection(nodes:any[]){state.selected=nodes;}},
 keepContentActiveDuringAsync:async(_target:unknown,task:()=>Promise<unknown>,callback:()=>void)=>{await task();state.editing=true;try{callback();}finally{state.editing=false;}},
 documentRoot:{pages},createText:(text:string)=>Object.assign(node('text'),{text}),
 createPath:(path:string)=>{if(state.failPath)throw new Error('path failed');const n=Object.assign(node('path'),{path});state.paths.push(n);return n;},
 makeColorFill:(color:unknown)=>({color}),makeStroke:(options:unknown)=>options,
 loadBitmapImage:async()=>{if(!state.editing)throw new Error('bitmap outside callback');if(state.failBitmap)throw new Error('bitmap failed');return {};},
 createImageContainer:(_bitmap:unknown,options:unknown)=>Object.assign(node('image'),{options}),
 }};
});
import {insertPdfPages} from '../src/sandbox/pdfPages';
const page:PdfInsertPage={title:'Card',width:400,height:500,elements:[
 {id:'shape',page_number:1,kind:'vector',bbox:[20,30,200,300],order:0,label:'Vector',path_data:'M20,30 L220,30 L220,330 L20,330 Z',fill:'#67fefe'},
 {id:'title',page_number:1,kind:'text',bbox:[35,55,150,35],order:1,label:'Free',text:'Free',font_size:20,color:'#000000'},
 {id:'photo',page_number:1,kind:'image',bbox:[35,130,150,150],order:2,label:'Image',image_width:150,image_height:150}
]};
beforeEach(()=>{state.pages=[{original:true}];state.editing=false;state.selected=[];state.paths=[];state.failPath=false;state.failBitmap=false;});
it('imports every checked object separately with real paths and selects all newly added layers',async()=>{
 const original=state.pages[0];const result=await insertPdfPages([page],{photo:new Blob(['png'],{type:'image/png'})});
 expect(result).toMatchObject({pageCount:1,elementCount:3,selectedCount:3});expect(state.pages[0]).toBe(original);
 expect(state.pages[1].artboards[0].children.map((n:any)=>n.type)).toEqual(['path','text','image']);expect(state.paths[0].path).toContain('M20.0000,30.0000');
 expect(state.selected).toHaveLength(3);expect(state.selected[1].text).toBe('Free');expect(state.selected[1].fullContent.applyCharacterStyles).toHaveBeenCalledWith(expect.objectContaining({fontSize:20}));
});
it('creates no pages when image preparation fails',async()=>{state.failBitmap=true;await expect(insertPdfPages([page],{photo:new Blob(['bad'])})).rejects.toThrow('bitmap failed');expect(state.pages).toHaveLength(1);});
it('rolls back only its own pages if native path creation fails',async()=>{state.failPath=true;await expect(insertPdfPages([page],{photo:new Blob(['png'])})).rejects.toThrow('path failed');expect(state.pages).toEqual([{original:true}]);});
