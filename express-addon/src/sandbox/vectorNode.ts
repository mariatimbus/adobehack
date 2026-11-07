import {editor,constants} from 'express-document-sdk';
import type {Color,FillableNode} from 'express-document-sdk';
import type {BBox} from '../shared/contracts';
import {mapPath,type VectorStyle} from '../shared/pdfElements';
export function hexColor(hex:string):Color{return {red:parseInt(hex.slice(1,3),16)/255,green:parseInt(hex.slice(3,5),16)/255,blue:parseInt(hex.slice(5,7),16)/255,alpha:1};}
export function createVector(vector:VectorStyle,box:BBox,fill?:string|null):FillableNode {
  const node=editor.createPath(mapPath(vector.path,vector.box,box));
  node.fill=fill?editor.makeColorFill(hexColor(fill)):undefined;
  if(vector.stroke&&vector.strokeWidth)node.stroke=editor.makeStroke({color:hexColor(vector.stroke),width:vector.strokeWidth*box[2]/vector.box[2]});
  if(constants.FillRule)node.fillRule=vector.evenOdd?constants.FillRule.evenOdd:constants.FillRule.nonZero;
  if(vector.opacity!=null)node.opacity=vector.opacity;
  return node;
}
