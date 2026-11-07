import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pages: [] as any[], made: [] as any[], failImage: false, editing: false, currentIndex:0 }));
vi.mock("express-document-sdk", () => {
  function make(kind: string, text?: string) {
    const data = new Map();
    const node = { id: `native-${state.made.length}`, kind, fullContent: { text, applyCharacterStyles: vi.fn(), applyParagraphStyles: vi.fn() }, boundsLocal: { x: 0, y: 0 }, setPositionInParent: vi.fn(), addOnData: { setItem: (k: string, v: string) => data.set(k, v), getItem: (k: string) => data.get(k) } };
    state.made.push(node); return node;
  }
  return {
    constants: { SceneNodeType: { group: 'group', gridLayout: 'gridLayout',mediaContainer:'image' }, TextAlignment: {left:'left'},FillRule:{nonZero:0,evenOdd:1} },
    fonts: { fromPostscriptName: vi.fn(async (name: string) => ({ postscriptName: name })) },
    editor: {
      context: { get currentPage() { return state.pages[state.currentIndex]; }, insertionParent: { visualRoot: { id: 'board' } } },
      keepContentActiveDuringAsync: async (_target: unknown, task: () => Promise<unknown>, callback: (result: unknown) => void) => {
        const result = await task();
        state.editing = true;
        try { callback(result); } finally { state.editing = false; }
      },
      loadBitmapImage: vi.fn(async () => { if (!state.editing) throw new Error('Bitmap load outside editing context'); if (state.failImage) throw new Error("Image load failed"); return {}; }),
      makeColorFill: (color: unknown) => ({ color }),
      createPath: (path:string)=>Object.assign(make('path'),{path}),makeStroke:(stroke:unknown)=>stroke,
      createRectangle: () => make("rectangle"), createText: (text: string) => make("text", text),
      createImageContainer: () => make("image"),
      documentRoot: { pages: {
        visitPages: vi.fn(async (pages: any[], callback: (page: any) => void|Promise<void>) => {
          state.editing = true;
          try { for (const page of pages) await callback(page); } finally { state.editing = false; }
        }),
        [Symbol.iterator]: () => state.pages[Symbol.iterator](),
        addPage: vi.fn((canvas: unknown) => {
          if (!state.editing) throw new Error("Editing not permitted after async wait");
          const children: any[] = [];
          Object.assign(children, { append: (...nodes: unknown[]) => { for (const node of nodes) {const i=children.indexOf(node);if(i>=0)children.splice(i,1);children.push(node);} } });
          const board = { children, get allChildren() {return children;}, addOnData: { setItem: vi.fn() } };
          const page = { canvas, artboards: [board] }; state.pages.push(page); return page;
        }),
        remove: vi.fn((page: unknown) => { state.pages = state.pages.filter((p) => p !== page); }),
      } },
    },
  };
});
import { createConceptPage } from "../src/sandbox/conceptPages";
import {editor} from 'express-document-sdk';
import {extractCurrentPage} from '../src/sandbox/pageImport';
import {generateDesigns,type BrandProfile} from '../src/shared/studio';
import type { DesignSpec } from "../src/shared/contracts";
const spec: DesignSpec = { design_id: "concept", version: 1, canvas: { width: 1080, height: 1350 }, nodes: [
  { id: "bg", type: "rectangle", role: "background", bbox: [0, 0, 1080, 1350], fill: "#081b26" },
  { id: "headline", type: "text", role: "headline", bbox: [72, 100, 700, 300], text: "AI Expo\nEurope", font_size: 80, color: "#ffffff" },
  { id: "photo", type: "image", role: "product", bbox: [700, 500, 300, 700] },
] };
beforeEach(() => { state.pages = [{ original: true, id: 'source',width:1080,height:1350,artboards: [{ id: 'board', allChildren: [] }] }]; state.made = []; state.failImage = false;state.currentIndex=0;vi.clearAllMocks(); });

it("creates a new native editable page and preserves the original", async () => {
  const original = state.pages[0];
  const result = await createConceptPage(spec, "The editorial", { photo: new Blob(["photo"]) }, { headline: { weight: 700 } });
  expect(state.pages).toHaveLength(2); expect(state.pages[0]).toBe(original);
  expect(result.node_count).toBe(3);
  expect(result.bindings.map((b) => b.type)).toEqual(["rectangle", "text", "image"]);
  const text = state.made.find((n) => n.kind === "text");
  expect(text.fullContent.text).toBe("AI Expo\nEurope");
  expect(text.fullContent.applyCharacterStyles).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 80, font: { postscriptName: "Arial-BoldMT" } }));
});

it("does not create a blank page when the required image is missing or fails to load", async () => {
  await expect(createConceptPage(spec, "Test", {}, {})).rejects.toThrow("photo could not be prepared");
  expect(state.pages).toHaveLength(1);
  state.failImage = true;
  await expect(createConceptPage(spec, "Test", { photo: new Blob(["bad"]) }, {})).rejects.toThrow("Image load failed");
  expect(state.pages).toHaveLength(1);
});

it('copies the source page before reflowing its native images, preserving original photo and styles',async()=>{
  const metadata=new Map<string,string>();
  const clone={id:'native-clone',boundsLocal:{x:0,y:0},resize:vi.fn(),setPositionInParent:vi.fn(),removeFromParent:vi.fn(),addOnData:{setItem:(k:string,v:string)=>metadata.set(k,v),getItem:(k:string)=>metadata.get(k)}};
  const original={id:'original-photo',type:'image',resize:vi.fn(),allChildren:[]};
  state.pages[0].artboards=[{id:'board',allChildren:[original],addOnData:{getItem:()=>undefined}}];
  state.pages[0].cloneInPlace=vi.fn(()=>{const page=editor.documentRoot.pages.addPage(spec.canvas);page.artboards[Symbol.iterator]().next().value!.children.append(clone as any);return page;});
  const originalPage=state.pages[0];
  const result=await createConceptPage(spec,'Native clone',{}, {headline:{family:'Georgia, serif'}},{photo:'original-photo'});
  expect(originalPage.cloneInPlace).toHaveBeenCalledOnce();expect(original.resize).not.toHaveBeenCalled();
  expect(clone.resize).toHaveBeenCalledWith({width:300,behavior:'proportional',avoidScalingVisualDetailsIfPossible:false});
  expect(state.pages[1].artboards[0].children).toContain(clone);
  expect(result.bindings.find(b=>b.node_id==='photo')?.adobe_node_id).toBe('native-clone');
  expect(state.made.find(n=>n.kind==='text').fullContent.applyCharacterStyles).toHaveBeenCalledWith(expect.objectContaining({font:{postscriptName:'Georgia'}}));
  expect(state.made.find(n=>n.kind==='text').textAlignment).toBe('left');
});

it('creates The focus card from another selected page through PageList.visitPages without a photo preview',async()=>{
  const metadata=new Map<string,string>();
  const original={id:'focus-original-photo',type:'image',boundsInNode:()=>({x:20,y:20,width:400,height:600}),allChildren:[],addOnData:{getItem:(k:string)=>metadata.get(k),setItem:(k:string,v:string)=>metadata.set(k,v)}};
  state.pages[0].artboards=[{id:'board',allChildren:[original],addOnData:{getItem:()=>undefined}}];
  extractCurrentPage(); // Register the imported page ID, as the Load flow does.
  const source=state.pages[0],cloneMeta=new Map<string,string>();
  const clone={id:'focus-clone-photo',boundsLocal:{x:0,y:0},resize:vi.fn(),setPositionInParent:vi.fn(),addOnData:{getItem:(k:string)=>cloneMeta.get(k),setItem:(k:string,v:string)=>cloneMeta.set(k,v)}};
  source.cloneInPlace=vi.fn(()=>{const page=editor.documentRoot.pages.addPage(spec.canvas);page.artboards[Symbol.iterator]().next().value!.children.append(clone as any);return page;});
  state.pages.push({id:'another-page',artboards:[{id:'other-board',allChildren:[]}]});state.currentIndex=1;
  const other=state.pages[1];
  const brand:BrandProfile={name:'PULSE',tagline:'Make money make sense.',palette:['#101b32','#f4f7fb','#cbf36a'],colors:[],typography:{},sample_copy:{},visual_rules:[],copy_rules:[],tone:'',forbidden_phrases:[],min_font_size:{},locked_roles:[],notes:[],warnings:[],provenance:'test'};
  const focus=generateDesigns({brand,copy:{brand:'pulse',headline:'Meet us at AI Expo.',body:'Discover what comes next.\n\n1–2 November 2026',cta:'Get your ticket now'},images:[{id:'photo',nativeId:original.id,name:'Original',width:400,height:600}],format:'portrait',origin:'brand'})[1];
  expect(focus.title).toBe('The focus card');expect(focus.spec.nodes).toHaveLength(11);expect(focus.assets).toEqual({});
  const result=await createConceptPage(focus.spec,focus.title,{},focus.styles,focus.nativeSources,focus.vectors);
  expect(editor.documentRoot.pages.visitPages).toHaveBeenCalledWith([source],expect.any(Function));
  expect(result.node_count).toBe(11);expect(state.pages).toHaveLength(3);expect(state.pages[1]).toBe(other);
  expect(result.bindings.find(b=>b.node_id==='photo')?.adobe_node_id).toBe(clone.id);
  expect(state.made.filter(n=>n.kind==='path')).toHaveLength(3);
  expect(editor.loadBitmapImage).not.toHaveBeenCalled();
});
