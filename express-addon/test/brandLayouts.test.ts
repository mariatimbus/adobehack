import {expect,it} from 'vitest';
import {analyzePost,generateDesigns,iterateVersions,type BrandProfile,type StudioFormat} from '../src/shared/studio';
import {balanceText,measureText,wrapText} from '../src/shared/textLayout';

function guide(name:string):BrandProfile{
  return {name,tagline:'Made for your everyday.',palette:['#101b32','#f4f7fb','#cbf36a'],colors:[],
    typography:{headline:{family:name==='AURELIA'?'Georgia':name==='WILDFORM'?'Arial Black':'Arial',fallback:'Arial'},body:{family:'Arial',fallback:'Arial'}},
    sample_copy:{},visual_rules:[],copy_rules:[],tone:'Clear',forbidden_phrases:[],min_font_size:{},locked_roles:[],notes:[],warnings:[],provenance:'test'};
}
const short={brand:'Example',headline:'One idea. A clearer picture.',body:'Thoughtfully designed for everyday moments, with the details that make a difference.',cta:'Explore the collection'};
const event={...short,headline:'We’re back at AI Expo Europe this year!',body:'Meet the team, discover our latest work and explore what comes next. Come visit us at our stand.\n\n1–2 November 2026\n\nRadisson Blu Hotel, Bucharest',cta:'Get your ticket now'};

it('balances headline lines without splitting ordinary words or changing copy',()=>{
  const value='We are back at AI Expo Europe this year';
  const lines=balanceText(value,78,650,{weight:700});
  expect(lines.join(' ')).toBe(value);
  expect(lines.every(line=>measureText(line,78,{weight:700})<=650)).toBe(true);
  expect(lines.length).toBe(wrapText(value,78,650,{weight:700}).length);
  expect(lines[lines.length-1].split(' ').length).toBeGreaterThan(1);
});

it('reflows short copy and event details across all three brands and formats without clipping or text collisions',()=>{
  for(const name of ['AURELIA','PULSE','WILDFORM'])for(const format of ['portrait','square','story'] as StudioFormat[])for(const copy of [short,event]){
    const versions=generateDesigns({copy,brand:guide(name),format,origin:'brand',images:[{id:'hero',nativeId:'original',name:'Hero',width:600,height:900}]});
    expect(versions).toHaveLength(3);
    expect(new Set(versions.map(v=>JSON.stringify(v.spec.nodes.map(n=>n.bbox)))).size).toBe(3);
    for(const version of versions){
      const analysis=analyzePost(version);
      expect(analysis.issues.filter(i=>/overlap|overflow|beyond/.test(i)),`${name} ${format} ${version.title}`).toEqual([]);
      for(const text of version.spec.nodes.filter(n=>n.type==='text'&&n.role!=='decoration'))expect(text.font_size).toBeGreaterThanOrEqual(text.role==='headline'?44:28);
      expect(version.nativeSources.photo).toBe('original');
      expect(version.spec.nodes.find(n=>n.id==='photo')!.bbox[3]).toBeGreaterThanOrEqual(260);
      expect(version.spec.nodes.find(n=>n.id==='photo')!.bbox[2]/version.spec.nodes.find(n=>n.id==='photo')!.bbox[3]).toBeCloseTo(2/3);
    }
  }
});

it('provides three different readable compositions with long copy or no imagery, including iterations',()=>{
  const copy={...short,body:'A practical way to bring your ideas together. Keep everything you need in one place and make room for the things that matter. Explore the collection at your own pace, discover the details, and find an approach that works for you. Clear information and a little more breathing room make the next step easier.'};
  for(const images of [[],[{id:'hero',name:'Portrait',nativeId:'original',width:310,height:1050}]]){
    const versions=generateDesigns({copy,images,brand:guide('PULSE'),format:'portrait',origin:'brand'});
    expect(new Set(versions.map(v=>JSON.stringify(v.spec.nodes.map(n=>n.bbox)))).size).toBe(3);
    for(const v of [...versions,...iterateVersions(versions[0],'More whitespace')]){
      const text=v.spec.nodes.filter(n=>n.role==='subhead').map(n=>n.text).join(' ').replace(/\s+/g,' ');
      expect(text).toBe(copy.body);
      expect(analyzePost(v).issues.filter(i=>/overlap|overflow|beyond/.test(i))).toEqual([]);
    }
  }
});
