import {expect,it} from 'vitest';
import {analyzePost,generateDesigns,iterateVersion,extractCopy,FORMATS,type BrandProfile,type StudioVersion} from '../src/shared/studio';
import {wrapText} from '../src/shared/textLayout';
const brand:BrandProfile={name:'AURELIA',tagline:'A little less. A lot more.',palette:['#f7f4ef','#252a28','#a8b6a5','#d9d2c8','#b97958'],colors:[],typography:{headline:{family:'Cormorant Garamond',fallback:'Georgia'},body:{family:'Inter',fallback:'Arial'}},sample_copy:{},visual_rules:[],copy_rules:[],tone:'Calm',forbidden_phrases:['instant results'],min_font_size:{},locked_roles:[],notes:[],warnings:[],provenance:'rule_based_extraction'};
const input={copy:{brand:'AURELIA',headline:'Your routine, refined.',body:'Thoughtfully formulated essentials designed for everyday care.\n\nFind the essentials that fit yours.',cta:'Explore the collection'},images:[{id:'photo',nativeId:'adobe-original-photo',name:'Original photo',width:600,height:1000},{id:'logo',nativeId:'adobe-original-logo',name:'Logo',width:200,height:70}],brand,format:'portrait' as const,origin:'brand' as const};
it('builds three distinct editable directions using supplied colors, fallback fonts, all copy and native photos',()=>{
  const original=JSON.stringify(input);const versions=generateDesigns(input);
  expect(versions).toHaveLength(3);expect(new Set(versions.map(v=>JSON.stringify(v.spec.nodes.map(n=>n.bbox)))).size).toBe(3);
  for(const v of versions){
    expect(extractCopy(v.spec).headline.replace(/\s+/g,' ')).toBe(input.copy.headline);
    expect(extractCopy(v.spec).body.replace(/\s+/g,' ')).toBe(input.copy.body.replace(/\s+/g,' '));
    expect(v.nativeSources).toEqual({photo:'adobe-original-photo','support-0':'adobe-original-logo'});
    expect(v.styles.headline.family).toBe('Georgia, serif');
    for(const n of v.spec.nodes){
      const[x,y,w,h]=n.bbox;expect(x).toBeGreaterThanOrEqual(0);expect(y).toBeGreaterThanOrEqual(0);expect(x+w).toBeLessThanOrEqual(1080);expect(y+h).toBeLessThanOrEqual(1350);
      if(n.fill||n.color)expect(brand.palette).toContain(n.fill??n.color);
      if(n.type==='text')expect(wrapText(n.text!,n.font_size!,w,v.styles[n.id]).length*n.font_size!*v.styles[n.id].lineHeight!).toBeLessThanOrEqual(h+.01);
    }
    expect(analyzePost(v).metrics.find(m=>m.id==='brand')?.score).toBe(100);
  }
  expect(JSON.stringify(input)).toBe(original);
});
it('reference colors affect new designs and a brand takes precedence over the board palette',()=>{
  const references=['#0a1020','#f0f6ff','#6acccc'];
  const v=generateDesigns({...input,brand:undefined,referenceColors:references,origin:'new'})[0];
  expect(references).toContain(v.spec.nodes.find(n=>n.id==='bg')?.fill);
  const branded=generateDesigns({...input,referenceColors:references})[0];expect(branded.spec.nodes.find(n=>n.id==='bg')?.fill).toBe('#f7f4ef');
});
it('iterations branch from their selected parent and preserve image proportions in Stories and square',()=>{
  const original=generateDesigns(input)[0];const snapshot=JSON.stringify(original);
  const version=iterateVersion(original,'More whitespace and adapt to Stories','Care, considered.');
  expect(version.parentId).toBe(original.id);expect(version.spec.canvas).toEqual(FORMATS.story);expect(version.origin).toBe('iteration');
  expect(version.spec.nodes.find(n=>n.role==='headline')?.text?.replace(/\s+/g,' ')).toBe('Care, considered.');
  for(const n of version.spec.nodes.filter(n=>n.type==='image')){const before=original.spec.nodes.find(o=>o.id===n.id)!;expect(n.bbox[2]/n.bbox[3]).toBeCloseTo(before.bbox[2]/before.bbox[3]);}
  const square=iterateVersion(version,'Make it square');expect(square.spec.canvas).toEqual(FORMATS.square);expect(JSON.stringify(original)).toBe(snapshot);
});
it('does not silently accept unsupported requests or forbidden brand copy',()=>{
  const original=generateDesigns(input)[0];expect(()=>iterateVersion(original,'make a talking animated dog')).toThrow('not supported');
  expect(()=>iterateVersion(original,'replace headline','Get instant results')).toThrow('forbidden brand copy');
  expect(()=>generateDesigns({...input,copy:{...input.copy,headline:'Get instant results'}})).toThrow('conflicts with brand guidelines');
});
it('scores reveal actual layout problems and do not manufacture retention data',()=>{
  const good=generateDesigns(input)[0];const bad:StudioVersion=JSON.parse(JSON.stringify(good));
  bad.spec.nodes=bad.spec.nodes.filter(n=>n.role!=='cta_text');
  const headline=bad.spec.nodes.find(n=>n.role==='headline')!;headline.bbox[0]=-100;headline.color=brand.palette[0];headline.font_size=15;
  bad.spec.nodes.find(n=>n.id==='body')!.color=brand.palette[0];
  const a=analyzePost(good),b=analyzePost(bad);expect(b.overall).toBeLessThan(a.overall);
  expect(b.issues.some(i=>i.includes('beyond'))).toBe(true);expect(b.issues.some(i=>i.includes('call to action'))).toBe(true);
  expect(b.issues.some(i=>i.includes('low contrast'))).toBe(true);
  expect(b.provenance).toContain('not measured retention');expect(b.metrics.map(m=>m.id)).not.toContain('retention');
  expect(analyzePost({...good,brand:undefined}).metrics.find(m=>m.id==='brand')?.score).toBeNull();
});

it('iterations create three composed brand directions using the newly selected guide',async()=>{
  const {iterateVersions}=await import('../src/shared/studio');
  const source=generateDesigns(input)[0];const snapshot=JSON.stringify(source);
  const pulse:BrandProfile={...brand,name:'PULSE',palette:['#101b32','#cbf36a','#f4f7fb','#3567d4','#536078'],typography:{headline:{family:'Space Grotesk',fallback:'Arial'},body:{family:'Inter',fallback:'Arial'}}};
  const next=iterateVersions(source,'Photo-led design, stronger CTA',undefined,pulse);
  expect(next).toHaveLength(3);expect(new Set(next.map(v=>JSON.stringify(v.spec.nodes.map(n=>n.bbox)))).size).toBe(3);
  for(const v of next){expect(v.brand?.name).toBe('PULSE');expect(v.spec.nodes.find(n=>n.role==='brand')?.text).toBe('PULSE');expect(v.parentId).toBe(source.id);expect(v.nativeSources.photo).toBe('adobe-original-photo');expect(v.spec.nodes.find(n=>n.role==='cta_background')).toBeDefined();expect(v.styles.headline.family).toContain('Arial');}
  expect(JSON.stringify(source)).toBe(snapshot);
});

it('keeps event details, CTA and all 15 imported assets in separate areas across brand systems',()=>{
  const images=Array.from({length:15},(_,i)=>({id:`asset-${i}`,nativeId:`native-${i}`,name:`Asset ${i}`,width:400,height:600}));
  for(const name of ['AURELIA','PULSE','WILDFORM']){
    const versions=generateDesigns({...input,brand:{...brand,name,typography:{}},images,copy:{...input.copy,body:'Meet our team and discover the latest product releases.\n\n1–2 November 2026\n\nRadisson Blu Hotel, Bucharest'}});
    for(const v of versions){
      expect(Object.values(v.nativeSources)).toHaveLength(15);
      const a=analyzePost(v);expect(a.issues.filter(i=>/overlap|beyond/.test(i))).toEqual([]);
      for(const image of v.spec.nodes.filter(n=>n.type==='image'))expect(image.bbox[2]/image.bbox[3]).toBeCloseTo(2/3);
      const support=v.spec.nodes.filter(n=>n.id.startsWith('support-'));
      const main=v.spec.nodes.filter(n=>['body','facts','cta','photo'].includes(n.id));
      expect(Math.max(...main.map(n=>n.bbox[1]+n.bbox[3]))).toBeLessThan(Math.min(...support.map(n=>n.bbox[1])));
    }
  }
});
