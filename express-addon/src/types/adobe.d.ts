/**
 * Minimal TypeScript declarations for the Adobe Express Add-on SDK surface
 * used by CreativeDNA. Verified against the official published typings
 * (@adobe/ccweb-add-on-sdk-types 1.40): express-document-sdk (document
 * sandbox), add-on-sdk-document-sandbox (sandbox runtime bridge) and the
 * add-on-sdk sdk.js global loaded by the panel iframe.
 */

declare module "express-document-sdk" {
  export interface Point {
    x: number;
    y: number;
  }
  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  export interface Color {
    red: number;
    green: number;
    blue: number;
    alpha: number;
  }
  export interface Fill {
    type: string;
  }
  export interface ColorFill extends Fill {
    color: Color;
  }
  export const enum TextLayout {
    area = 1,
    autoHeight = 2,
    autoWidth = 3,
  }
  export interface AutoHeightTextLayout {
    type: TextLayout.autoHeight;
    width: number;
  }
  export interface CharacterStylesInput {
    font?: AvailableFont;
    fontSize?: number;
    color?: Color;
    letterSpacing?: number;
    underline?: boolean;
    baselineShift?: number;
  }
  export class AddOnData {
    setItem(key: string, value: string): void;
    getItem(key: string): string | undefined;
    removeItem(key: string): void;
    keys(): string[];
  }
  export class BaseNode {
    removeFromParent(): void;
    get id(): string;
    get addOnData(): AddOnData;
    get parent(): BaseNode | undefined;
    get type(): string;
  }
  export class VisualNode extends BaseNode {
    cloneInPlace(): VisualNode;
    resize(options: {width: number; behavior: 'proportional'; avoidScalingVisualDetailsIfPossible: boolean; height?: number}): void;
    createRendition(options?: { scale?: number }): Promise<{ blob?: Blob }>;
    get allChildren(): Readonly<Iterable<VisualNode>>;
    get visualRoot(): VisualNode;
    get boundsLocal(): Readonly<Rect>;
    boundsInNode(target: VisualNode): Readonly<Rect>;
    localPointInNode(point: Point, target: VisualNode): Readonly<Point>;
    get boundsInParent(): Readonly<Rect>;
    get translation(): Readonly<Point>;
    set translation(value: Point);
    setPositionInParent(parentPoint: Point, localRegistrationPoint: Point): void;
    removeFromParent(): void;
    get opacity(): number;
    set opacity(value: number);
    get allDescendants(): Readonly<Iterable<BaseNode>>;
  }
  export class FillableNode extends VisualNode {
    stroke: unknown;
    fillRule: unknown;
    get fill(): Fill | undefined;
    set fill(fill: Fill | undefined);
  }
  export class RectangleNode extends FillableNode {
    width: number;
    height: number;
  }
  export class TextContentModel {
    applyParagraphStyles(styles: {spaceBefore?: number; spaceAfter?: number; lineSpacing?: number}): void;
    get characterStyleRanges(): ReadonlyArray<{ fontSize: number; color: Color }>;
    get text(): string;
    set text(value: string);
    applyCharacterStyles(styles: CharacterStylesInput, range?: unknown): void;
    getCharacterStyles(range?: unknown): Array<{ fontSize?: number; color?: Color }>;
  }
  export class StandaloneTextNode extends VisualNode {
    textAlignment: string | number;
    get fullContent(): TextContentModel;
    set layout(layout: AutoHeightTextLayout);
    width: number;
  }
  export class MediaContainerNode extends VisualNode {
    width: number;
    height: number;
  }
  export class BitmapImage {}
  export interface ContainerNode {
    children: {
      append(...items: BaseNode[]): void;
      [Symbol.iterator](): Iterator<BaseNode>;
      readonly length: number;
    };
  }
  export class ArtboardNode extends VisualNode implements ContainerNode {
    readonly width: number;
    readonly height: number;
    readonly children: ContainerNode["children"];
  }
  export class PageNode extends BaseNode {
    cloneInPlace(): PageNode;
    name: string;
    width: number;
    height: number;
    readonly artboards: Iterable<ArtboardNode>;
  }
  export class Editor {
    createPath(data: string): FillableNode;
    makeStroke(options: {color: Color; width:number}): unknown;
    readonly documentRoot: { pages: { [Symbol.iterator](): Iterator<PageNode>; addPage(geometry: { width: number; height: number }): PageNode; remove(page: PageNode): void; visitPages?(pages: PageNode[], callback: (page: PageNode) => void | Promise<void>): Promise<void> } };
    get context(): {
      insertionParent: ContainerNode;
      currentPage: PageNode;
      selection: BaseNode[];
    };
    createRectangle(): RectangleNode;
    createText(textContent: string): StandaloneTextNode;
    createImageContainer(
      bitmapData: BitmapImage,
      options?: { initialSize?: { width: number; height: number } }
    ): MediaContainerNode;
    loadBitmapImage(bitmapData: Blob): Promise<BitmapImage>;
    makeColorFill(color: Color): ColorFill;
    keepContentActiveDuringAsync<T>(
      target: VisualNode | unknown,
      asyncLambda: () => Promise<T>,
      afterAsyncCallback: (result: T) => void
    ): Promise<void>;
  }
  export const editor: Editor;
  export interface AvailableFont { readonly family: string; readonly postscriptName: string }
  export const fonts: { fromPostscriptName(name: string): Promise<AvailableFont | undefined> };
  export const constants: {
    FillRule: {evenOdd: unknown; nonZero: unknown};
    TextAlignment: {left: string | number};
    TextLayout: typeof TextLayout;
    SceneNodeType: Record<"group" | "gridLayout" | "gridCell" | "mediaContainer" | "imageRectangle" | "text" | "rectangle", string>;
  };
}

declare module "add-on-sdk-document-sandbox" {
  interface SandboxRuntime {
    exposeApi<T>(apiObj: T): void;
  }
  const sandboxSdk: { instance: { runtime: SandboxRuntime } };
  export default sandboxSdk;
}

/** Global shape of the Add-on UI SDK (loaded as an ES module, not a window global) */
interface AddOnUISdkGlobal {
  ready: Promise<void>;
  instance: {
    runtime: {
      exposeApi<T>(apiObj: T): void;
      apiProxy<T>(runtimeType: string): Promise<T>;
    };
  };
  app: { document: { promptForFile: (t: string) => Promise<File> } };
  runtime?: unknown; // legacy shape — do not use
}

declare module "https://new.express.adobe.com/static/add-on-sdk/sdk.js" {
  const sdk: AddOnUISdkGlobal;
  export default sdk;
}

interface Window {
  addOnUISdk?: AddOnUISdkGlobal;
  __creativednaSdk?: AddOnUISdkGlobal;
  __creativednaSdkError?: string;
}
