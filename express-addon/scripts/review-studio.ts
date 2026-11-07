import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {generateDesigns,iterateVersions,type BrandProfile} from '../src/shared/studio';
import {specToSvg} from '../src/shared/svgPreview';
const out='/private/tmp/creativedna-review';mkdirSync(out,{recursive:true});
for(const name of ['aurelia','pulse','wildform']){
 const brand=JSON.parse(readFileSync(`${out}/${name}.json`,'utf8')) as BrandProfile;
 const png=readFileSync(`assets-public/${name==='aurelia'?'serum-packshot.png':'alphaz-hero.png'}`),photo=png.toString('base64');
 const items=generateDesigns({copy:{brand:brand.wordmark??brand.name,headline:brand.sample_copy.headline,body:brand.sample_copy.body,cta:brand.sample_copy.cta},images:[{id:'hero',name:'Sample photo',url:`data:image/png;base64,${photo}`,width:png.readUInt32BE(16),height:png.readUInt32BE(20)}],brand,format:'portrait',origin:'brand'});
 items.forEach((v,i)=>writeFileSync(`${out}/${name}-${i}.svg`,specToSvg(v.spec,{width:540,styles:v.styles,assets:v.assets,vectors:v.vectors})));
 const iterations=iterateVersions(items[0],'More editorial and stronger CTA');
 writeFileSync(`${out}/${name}-iteration.svg`,specToSvg(iterations[0].spec,{width:540,styles:iterations[0].styles,assets:iterations[0].assets,vectors:iterations[0].vectors}));
 for(const format of ['square','story'] as const){
  const versions=generateDesigns({copy:{brand:brand.wordmark??brand.name,headline:'We’re back at AI Expo Europe this year!',body:'Meet the team, discover our latest work and explore what comes next. Come visit us at our stand.\n\n1–2 November 2026\n\nRadisson Blu Hotel, Bucharest',cta:'Get your ticket now'},images:[{id:'hero',name:'Original photo',url:`data:image/png;base64,${photo}`,width:png.readUInt32BE(16),height:png.readUInt32BE(20)}],brand,format,origin:'brand'});
  versions.forEach((v,i)=>writeFileSync(`${out}/${name}-${format}-${i}.svg`,specToSvg(v.spec,{width:540,styles:v.styles,assets:v.assets,vectors:v.vectors})));
 }
}
