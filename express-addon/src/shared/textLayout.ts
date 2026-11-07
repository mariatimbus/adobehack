export interface TextStyle { weight?: number; family?: string; lineHeight?: number }
let context: CanvasRenderingContext2D | null | undefined;

export function measureText(text: string, size: number, style: TextStyle = {}): number {
  if (context === undefined) context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (context) {
    context.font = `${style.weight ?? 400} ${size}px ${style.family ?? "Arial, Helvetica, sans-serif"}`;
    return context.measureText(text).width;
  }
  // Conservative fallback for Node tests and non-browser artifact rendering.
  return [...text].reduce((width, c) => width + (/\s/.test(c) ? 0.3 : /[ilI.,!':;]/.test(c) ? 0.28 : /[MW@]/.test(c) ? 0.9 : 0.57), 0) * size;
}

export function wrapText(text: string, size: number, width: number, style: TextStyle = {}): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next, size, style) > width) { lines.push(line); line = ""; }
      if (measureText(word, size, style) > width) {
        for (const letter of word) {
          if (line && measureText(line + letter, size, style) > width) { lines.push(line); line = ""; }
          line += letter;
        }
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

export function fitText(text: string, width: number, height: number, desired: number, style: TextStyle = {}): { size: number; lines: string[] } {
  let size = desired;
  while (size > 16 && wrapText(text, size, width, style).length * size * (style.lineHeight ?? 1.15) > height) size -= 1;
  return { size, lines: wrapText(text, size, width, style) };
}

/** Balance display lines without changing words or reducing headline size. */
export function balanceText(text:string,size:number,width:number,style:TextStyle={}):string[]{
  const words=text.trim().split(/\s+/),greedy=wrapText(words.join(' '),size,width,style),count=greedy.length;
  if(count<2||words.length>60||words.some(w=>measureText(w,size,style)>width))return greedy;
  const memo=new Map<string,{cost:number;lines:string[]}>();
  function solve(start:number,left:number):{cost:number;lines:string[]}{
    if(!left)return {cost:start===words.length?0:Infinity,lines:[]};
    const key=`${start}/${left}`,cached=memo.get(key);if(cached)return cached;
    let best={cost:Infinity,lines:[] as string[]};
    for(let end=start+1;end<=words.length-left+1;end++){
      const line=words.slice(start,end).join(' '),used=measureText(line,size,style);if(used>width)break;
      const next=solve(end,left-1),orphan=left===1&&end-start===1&&words.length>4?width*width*.7:0;
      const cost=(width-used)**2+next.cost+orphan;
      if(cost<best.cost)best={cost,lines:[line,...next.lines]};
    }
    memo.set(key,best);return best;
  }
  return solve(0,count).lines.length?solve(0,count).lines:greedy;
}
