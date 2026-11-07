import type {BBox,DesignNode} from './contracts';
import type {StudioVersion,GenerateInput,StudioImage,BrandProfile} from './studio';
import {balanceText,wrapText,measureText,type TextStyle} from './textLayout';
import {expandComponent,type VectorStyle} from './pdfElements';

let sequence=0;
class LayoutOverflow extends Error {
  constructor(){super('This post has too much text for a readable layout. Shorten the supporting copy or choose Stories.');}
}
function lum(hex:string){
  const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
  return v[0]*.2126+v[1]*.7152+v[2]*.0722;
}
function colors(brand?:BrandProfile,refs?:string[]){
  const p=brand?.palette.length?brand.palette:refs?.length?refs:['#ffffff','#000000','#67fefe'];
  const sorted=[...p].sort((a,b)=>lum(a)-lum(b));
  const named=(pattern:RegExp)=>brand?.colors.find(c=>pattern.test(`${c.name} ${c.usage}`))?.hex;
  const dark=sorted[0],light=sorted[sorted.length-1];
  return {dark,light,
    accent:named(/key actions|calls to action|warm copper/i)??brand?.colors.find(c=>/accent/i.test(c.role))?.hex??p.find(c=>c!==dark&&c!==light)??dark,
    soft:named(/^sage\b|^stone\b|light backgrounds/i)??light,
    line:named(/^stone\b|^slate\b/i)??dark};
}
function rounded([x,y,w,h]:BBox,r:number){
  const k=.552285;r=Math.min(r,w/2,h/2);
  return `M${x+r},${y} L${x+w-r},${y} C${x+w-r+r*k},${y} ${x+w},${y+r-r*k} ${x+w},${y+r} L${x+w},${y+h-r} C${x+w},${y+h-r+r*k} ${x+w-r+r*k},${y+h} ${x+w-r},${y+h} L${x+r},${y+h} C${x+r-r*k},${y+h} ${x},${y+h-r+r*k} ${x},${y+h-r} L${x},${y+r} C${x},${y+r-r*k} ${x+r-r*k},${y} ${x+r},${y} Z`;
}

/** Actual text measurements and intrinsic image proportions drive every
 * composition. Every text, image and mark remains a separate native layer. */
export function generateBrandLayouts(input:GenerateInput):StudioVersion[]{
  const {brand,copy,images}=input;
  if(!copy.headline.trim())throw new Error('Add a headline before generating designs.');
  const normalized=Object.values(copy).join(' ').replace(/\s+/g,' ').toLowerCase();
  const forbidden=brand?.forbidden_phrases.filter(p=>normalized.includes(p.toLowerCase()))??[];
  if(forbidden.length)throw new Error(`Copy conflicts with brand guidelines: ${forbidden.join(', ')}. Edit the copy first.`);
  const c=colors(brand,input.referenceColors),name=brand?.name.toLowerCase()??'';
  const calm=/aurelia/.test(name)||/cormorant|georgia/i.test(brand?.typography.headline?.family??'');
  const outdoor=/wildform/.test(name)||/archivo/i.test(brand?.typography.headline?.family??'');
  const family=calm?'Georgia, serif':outdoor?'Arial Black, Arial, sans-serif':'Arial, Helvetica, sans-serif';
  const canvas={width:1080,height:input.format==='story'?1920:input.format==='square'?1080:1350};
  const H=canvas.height,M=72,W=936,gap=input.refinement?.whitespace?52:36;
  const top=input.format==='story'?200:158;
  const primary=images[0],extras=images.slice(1);
  const extraH=extras.length?Math.min(270,104*Math.ceil(extras.length/3)):0;
  const extraStart=H-(input.format==='story'?170:104)-extraH;
  const bottom=extraStart-(extras.length?36:0),room=bottom-top;
  const parts=copy.body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
  const details=parts.filter(p=>p.length<120&&/\b(?:20\d{2}|hotel|bucharest|venue|location|november|october|september|january|february|march|april|june|july|august|december)\b/i.test(p));
  const body=parts.filter(p=>!details.includes(p)).join('\n\n'),facts=details.join('\n');
  const titles=calm?['Quiet editorial','The considered frame','A study in contrast']:outdoor?['Field notes','The trail marker','Outside the grid']:['The bold introduction','The focus card','A clear statement'];

  return titles.map((title,index)=>{
    const id=`v${Date.now()}-${++sequence}`;
    const nodes:DesignNode[]=[],styles:Record<string,TextStyle>={},assets:Record<string,string>={},nativeSources:Record<string,string>={},vectors:Record<string,VectorStyle>={};
    const rect=(id:string,b:BBox,fill:string,role:DesignNode['role']='decoration',radius=0)=>{
      if(b[2]<=0||b[3]<=0)return;
      nodes.push({id,type:'rectangle',role,bbox:b,fill});
      if(radius)vectors[id]={path:rounded(b,radius),box:b};
    };
    const line=(id:string,x:number,y:number,w:number,color:string,height=1)=>rect(id,[x,y,w,height],color);
    const path=(id:string,b:BBox,d:string,color:string,width:number)=>{
      nodes.push({id,type:'rectangle',role:'decoration',bbox:b,fill:null});
      vectors[id]={path:d,box:b,stroke:color,strokeWidth:width};
    };
    function measure(value:string,w:number,maxH:number,size:number,role:DesignNode['role']='subhead',weight=400){
      const style:TextStyle={family:role==='headline'?family:'Arial, Helvetica, sans-serif',weight,lineHeight:role==='headline'?1.16:1.22};
      const display=role==='headline',text=display?value.trim().replace(/\s+/g,' '):value;
      let fontSize=size*(display?(input.refinement?.headlineScale??1):1);
      const min=display?44:role==='decoration'?18:role==='cta_text'?28:30;
      let lines:string[]=[];
      for(;fontSize>=min;fontSize--){
        lines=display?balanceText(text,fontSize,w,style):wrapText(text,fontSize,w,style);
        if(lines.length*fontSize*style.lineHeight!+6<=maxH)break;
      }
      if(fontSize<min)throw new LayoutOverflow();
      return {size:fontSize,lines,style,height:lines.length*fontSize*style.lineHeight!+6};
    }
    function text(id:string,x:number,y:number,w:number,maxH:number,value:string,size:number,color:string,role:DesignNode['role']='subhead',weight=400){
      if(!value.trim())return 0;
      const fitted=measure(value,w,maxH,size,role,weight);
      nodes.push({id,type:'text',role,bbox:[x,y,w,fitted.height],text:fitted.lines.join('\n'),font_size:fitted.size,color});styles[id]=fitted.style;
      return fitted.height;
    }
    function photo(item:StudioImage|undefined,b:BBox,nid='photo',backing?:string,anchor:'left'|'center'|'right'='center'){
      if(!item)return;
      if(item.component){
        const component=expandComponent(item.component,b,nid);
        nodes.push(...component.nodes);Object.assign(styles,component.styles);Object.assign(assets,component.assets);Object.assign(vectors,component.vectors);return;
      }
      const scale=Math.min(b[2]/item.width,b[3]/item.height),w=item.width*scale,h=item.height*scale;
      const x=b[0]+(anchor==='left'?0:anchor==='right'?b[2]-w:(b[2]-w)/2),y=b[1]+(b[3]-h)/2;
      if(backing)rect(`${nid}-mat`,[x-12,y-12,w+24,h+24],backing,'decoration',calm?0:16);
      nodes.push({id:nid,type:'image',role:nid==='photo'?'product':'decoration',bbox:[x,y,w,h],asset_id:nid});
      if(item.url)assets[nid]=item.url;if(item.nativeId)nativeSources[nid]=item.nativeId;
    }
    const actionH=copy.cta?Math.max(82,wrapText(copy.cta,30,250,{weight:700}).length*30*1.22+30)+(input.refinement?.strongCta?16:0):0;
    function cta(x:number,y:number,w:number,fill:string,ink:string){
      if(!copy.cta)return;
      rect('cta-bg',[x,y,w,actionH],fill,'cta_background',calm?0:outdoor?3:20);
      const h=measure(copy.cta,w-88,actionH-18,30,'cta_text',700).height;
      text('cta',x+24,y+(actionH-h)/2,w-88,actionH-18,copy.cta,30,ink,'cta_text',700);
      const ax=x+w-44,ay=y+actionH/2-9;
      path('cta-arrow',[ax,ay,18,18],`M${ax},${ay+18} L${ax+18},${ay} M${ax},${ay} L${ax+18},${ay} L${ax+18},${ay+18}`,ink,2);
    }
    function supporting(x:number,y:number,w:number,h:number,ink:string){
      if(!body&&!facts)return 0;
      const separation=body&&facts?24:0;
      const style:TextStyle={family:'Arial, Helvetica, sans-serif',lineHeight:1.22};
      let size=34;
      for(;size>=30;size--){
        const a=body?wrapText(body,size,w,style).length*size*1.22+6:0;
        const b=facts?wrapText(facts,size,w,{...style,weight:700}).length*size*1.22+6:0;
        if(a+b+separation<=h)break;
      }
      if(size<30)throw new LayoutOverflow();
      let used=text('body',x,y,w,h,body,size,ink);
      if(facts){if(used)used+=separation;used+=text('facts',x,y+used,w,h-used,facts,size,ink,'subhead',700);}
      return used;
    }
    function supportHeight(w:number,size=32){
      const style:TextStyle={family:'Arial, Helvetica, sans-serif',lineHeight:1.22};
      return (body?wrapText(body,size,w,style).length*size*1.22+6:0)
        +(facts?wrapText(facts,size,w,{...style,weight:700}).length*size*1.22+6:0)+(body&&facts?24:0);
    }
    function header(ink:string){
      text('brand',M,input.format==='story'?106:64,700,56,copy.brand||brand?.wordmark||brand?.name||'',calm?34:outdoor?38:44,ink,'brand',700);
    }
    function footer(ink:string){
      if(extras.length){
        const cols=Math.min(3,extras.length),rows=Math.ceil(extras.length/cols),cw=W/cols,ch=(extraH-8)/rows;
        extras.forEach((item,i)=>photo(item,[M+i%cols*cw,extraStart+Math.floor(i/cols)*ch,cw-24,ch-18],`support-${i}`));
      }
      text('footer',M,H-(input.format==='story'?104:56),500,32,brand?.tagline??'',20,ink,'decoration');
    }
    const dark=(calm&&index===2)||(outdoor&&index===1)||(!calm&&!outdoor&&index===0);
    const ink=dark?c.light:c.dark,bg=dark?c.dark:c.light;
    rect('bg',[0,0,1080,H],bg,'background');header(ink);
    const baseCount=nodes.length;

    const wideCopy=body.length+facts.length>260||copy.headline.length>110||!primary
      ||(room<850&&(body.length+facts.length>90||copy.headline.length>60));
    function compose(forceWide=false){
    if(wideCopy||forceWide){
      if(calm)line('header-line',M,top-24,W,c.line);
      else line('signal',M,top-24,outdoor?64:96,c.accent,5);
      const headlineW=W-[0,32,88][index],headlineSize=(calm?100:116)*[1,.88,1.08][index];
      const hh=measure(copy.headline,headlineW,room*.32,headlineSize,'headline',calm?400:700).height;
      const imageW=[340,360,300][index],copyW=W-imageW-gap;
      const rowY=top+hh+gap,rowH=bottom-rowY;
      if(primary&&supportHeight(copyW,30)<=rowH-actionH-gap){
        // Compact formats need a large image alongside the reading area,
        // rather than a tiny portrait squeezed between two full-width blocks.
        text('headline',M,top,headlineW,hh,copy.headline,headlineSize,ink,'headline',calm?400:700);
        const copyX=index===1?M:M+imageW+gap,imageX=index===1?1008-imageW:M;
        photo(primary,[imageX,rowY,imageW,rowH],'photo');
        supporting(copyX,rowY,copyW,rowH-actionH-gap,ink);
        cta(copyX,bottom-actionH,copyW,dark?c.light:c.dark,dark?c.dark:c.light);
      }else{
      const supportH=Math.min(room*.47,Math.max(supportHeight(W),60));
      const imageH=room-hh-supportH-actionH-gap*3;
      if(primary&&imageH<180)throw new LayoutOverflow();
      const headY=index===1&&primary?top+imageH+gap:top;
      text('headline',M,headY,headlineW,hh,copy.headline,headlineSize,ink,'headline',calm?400:700);
      const bodyY=index===2||!primary?headY+hh+gap:bottom-actionH-gap-supportH;
      supporting(M,bodyY,W,supportH,ink);
      if(primary){
        const photoY=index===1?top:index===2?bodyY+supportH+gap:top+hh+gap;
        photo(primary,[M,photoY,W,imageH],'photo');
      }else line('reading-rule',M,bodyY+supportH+gap,calm?64:128,c.accent,calm?2:6);
      cta(M,bottom-actionH,Math.min(W,Math.max(420,measureText(copy.cta,30,{weight:700})+100)),dark?c.light:c.dark,dark?c.dark:c.light);
      }
    }else if(calm&&index===0){
      line('header-line',M,top-24,W,c.line);
      const hh=text('headline',M,top,900,room*.3,copy.headline,108,c.dark,'headline',400);
      const y=top+hh+48,h=bottom-y;
      const imageW=Math.min(514,Math.max(330,(h-24)*primary!.width/primary!.height+24));
      const x=M+imageW+56,w=W-imageW-56;
      photo(primary,[M+12,y+12,imageW-24,h-24],'photo',c.soft,'left');
      line('copper-mark',x,y,48,c.accent,3);
      supporting(x,y+32,w,h-actionH-64,c.dark);
      cta(x,bottom-actionH,w,c.dark,c.light);
    }else if(calm&&index===1){
      const hh=measure(copy.headline,W,room*.27,86,'headline',400).height;
      const sh=supportHeight(W);
      const imageH=room-hh-sh-actionH-gap*3;
      rect('image-field',[M,top,W,imageH],c.soft);
      photo(primary,[M+24,top+18,W-48,imageH-36],'photo');
      const y=top+imageH+gap;
      text('headline',M,y,W,hh,copy.headline,86,c.dark,'headline',400);
      supporting(M,y+hh+24,W,sh,c.dark);
      cta(M,bottom-actionH,Math.min(W,Math.max(510,measureText(copy.cta,30,{weight:700})+100)),c.dark,c.light);
    }else if(calm&&index===2){
      rect('porcelain-panel',[600,0,480,H],c.soft);
      const hh=text('headline',M,top+22,472,room*.43,copy.headline,100,c.light,'headline',400);
      line('copper-mark',M,top-14,48,c.accent,3);
      const y=top+hh+gap+22;
      supporting(M,y,472,bottom-actionH-gap-y,c.light);
      cta(M,bottom-actionH,472,c.light,c.dark);
      photo(primary,[624,top+16,384,bottom-top-32],'photo');
    }else if(outdoor&&index===0){
      line('trail-mark',M,top-24,72,c.accent,6);
      const hh=text('headline',M,top,W,room*.32,copy.headline,120,c.dark,'headline',700);
      const y=top+hh+gap,h=bottom-y;
      photo(primary,[498,y,510,h],'photo');
      supporting(M,y+12,374,h-actionH-gap-12,c.dark);
      cta(M,bottom-actionH,374,c.dark,c.light);
    }else if(outdoor&&index===1){
      photo(primary,[M,top,480,room],'photo');
      const x=600,w=408;
      const hh=text('headline',x,top+20,w,room*.42,copy.headline,88,c.light,'headline',700);
      const y=top+hh+56;
      supporting(x,y,w,bottom-actionH-gap-y,c.light);
      cta(x,bottom-actionH,w,c.accent,c.dark);
    }else if(outdoor&&index===2){
      const hh=text('headline',M,top,W,room*.32,copy.headline,126,c.dark,'headline',700);
      const y=top+hh+48;
      rect('field-block',[0,y-16,1080,H-y+16],c.dark);
      photo(primary,[528,y+24,480,bottom-y-24],'photo');
      supporting(M,y+32,400,bottom-actionH-gap-y-32,c.light);
      cta(M,bottom-actionH,400,c.accent,c.dark);
    }else if(index===0){
      const hh=text('headline',M,top,W,room*.32,copy.headline,124,c.light,'headline',700);
      const y=top+hh+gap,h=bottom-y;
      const imageW=Math.min(460,Math.max(280,(h-40)*primary!.width/primary!.height+40));
      const imageX=1008-imageW,copyW=imageX-M-gap;
      rect('focus-card',[imageX,y,imageW,h],c.light,'decoration',28);
      photo(primary,[imageX+20,y+20,imageW-40,h-40],'photo');
      supporting(M,y+12,copyW,h-actionH-gap-12,c.light);
      cta(M,bottom-actionH,copyW,c.accent,c.dark);
    }else if(index===1){
      const hh=measure(copy.headline,W-72,room*.3,110,'headline',700).height;
      rect('headline-card',[M,top,W,hh+72],c.dark,'decoration',28);
      text('headline',M+36,top+36,W-72,hh,copy.headline,110,c.light,'headline',700);
      const y=top+hh+72+gap,h=bottom-y;
      const imageW=Math.min(420,Math.max(260,h*primary!.width/primary!.height));
      const x=M+imageW+gap,w=W-imageW-gap;
      photo(primary,[M,y,imageW,h],'photo');
      supporting(x,y+12,w,h-actionH-gap-12,c.dark);
      cta(x,bottom-actionH,w,c.dark,c.light);
    }else{
      rect('midnight-column',[708,0,372,H],c.dark);
      const hh=text('headline',M,top,580,room*.46,copy.headline,114,c.dark,'headline',700);
      const y=top+hh+gap;
      supporting(M,y,580,bottom-actionH-gap-y,c.dark);
      cta(M,bottom-actionH,580,c.accent,c.dark);
      photo(primary,[732,top+36,276,room-72],'photo');
      [0,1,2].forEach(i=>rect(`pulse-${i}`,[942+i*22,64+(2-i)*7,10,22+i*7],c.light,'decoration',3));
    }
    }
    let reflowed=wideCopy;
    try{compose();}catch(error){
      if(!(error instanceof LayoutOverflow)||wideCopy)throw error;
      // Retry the same direction with a full-width reading area. A narrow
      // sidebar must never make the entire three-direction request fail.
      nodes.splice(baseCount);for(const key of Object.keys(styles))if(key!=='brand')delete styles[key];
      for(const map of [assets,nativeSources,vectors])for(const key of Object.keys(map))delete map[key];
      compose(true);reflowed=true;
    }
    footer(outdoor&&index===2&&!reflowed?c.light:ink);
    return {id,title,spec:{design_id:id,version:1,canvas,nodes},styles,assets,nativeSources,vectors,
      origin:input.origin,brand,ingredients:images,campaignCopy:copy,
      changes:[`${brand?.name??'Reference'} art direction`,'Balanced headline, readable copy and a dedicated CTA',`${images.length} original image/card components retained`]};
  });
}
