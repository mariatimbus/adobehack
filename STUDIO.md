# CreativeDNA studio behavior

The studio is a local layout engine, not a connected generative AI provider.
The original backend repair pipeline is still available separately. No frozen
backend design/operation schemas were changed for this UI.

## Brand generation

The Markdown parser extracts HEX values, table color usage, headline/body
font families and fallback names, explicit sample copy, tone, visual rules,
and exact prohibited phrases. Quoted negative-copy examples retain their
meaning; channel-table cells are not added as forbidden phrases. Source
files are data, never executable instructions.

Each brand has three distinct compositions: a quiet editorial system for
AURELIA, a bold graphic system for PULSE, and field-note compositions for
WILDFORM. They use approved colors and system typography fallbacks. All campaign copy is retained,
except that the brand wordmark is replaced by the selected brand name.
Decoration is recomposed. The main image is reused; inclusion of all secondary
images/overlays is optional. New designs let the user choose reference images
and write the copy. Without a brand, measured reference colors drive the theme.
Headlines use balanced line breaks, and text boxes take their measured height.
Body copy stays at least 30px at 1080px width; headlines stay at least 44px.
Square and Stories have their own available space, without vertically stretching
the portrait layout. Image panels adapt to source aspect ratios. Narrow sidebars
that cannot fit the copy reflow into a full-width reading area; long copy is
retained rather than clipped or silently removed. Each reflowed direction still
has its own reading order. Extremely long copy produces an explicit error.
CTAs grow for wrapped copy, use native vector arrows, and sit clear of event
details, secondary assets and the brand footer. Decorative edition numbers and
unsupported glyph arrows are not added to posts.
Imagery, voice, medical/financial/environmental claims, logo treatment and all
qualitative brand requirements need human review. A color/keyword check does
not prove complete compliance with a brand guide.

Native reuse clones the source page, then rearranges its copied images within
that page. Cross-page reparenting is not assumed to work. Source page IDs (not
live content handles) are retained between calls; `visitPages` supplies active
content during creation. Uploaded/reference assets are prepared as browser
PNG/JPEG Blobs; bitmap loads start in an active edit callback. Pages are built
synchronously after async resource preparation. Failure removes only the new
page. Animated source pages currently require separately supplied photos.
The page visitation API is `editor.documentRoot.pages.visitPages`, on PageList.
Creation can reuse an imported photo while a different page is selected, even
without a preview bitmap. Creation errors and success are also shown beside
the affected design's button so the result stays visible in a long gallery.

## Scores

`analyzePost` in `express-addon/src/shared/studio.ts` is the source of truth.
Every metric is clamped to 0–100. The overall score is the arithmetic mean of
available metrics; brand fit is excluded when no guide is selected.

- **Attention potential:** 55 for a detected headline, 25 for at most 12 words
  (10 for 13–20), 10 for imagery, 10 for strong hierarchy; subtract 8 per text
  overlap. It is a layout proxy, not an estimate of viewing duration.
- **Readability:** starts at 100; subtracts 12 per mobile-small text layer,
  17 per low-contrast text layer, 15 per estimated overflow and 8 per out-of-
  bounds element. Mobile size is estimated at a 360px feed width. Contrast is
  computed only where a full solid background can be established; image and
  ambiguous backgrounds are reported as requiring review.
- **Hierarchy:** depends on detected headline presence, headline/body font
  size ratio, and text-box collisions. It cannot measure semantic interest.
- **CTA clarity:** considers presence, short copy, a grouped background and
  canvas containment. Absence is scored zero.
- **Brand alignment:** approved palette share (80 points), declared system
  fallback families (20), minus 40 per exact forbidden phrase. Unmeasured tone,
  imagery and substantiation are explicitly outside this score.

Retention is displayed as **No audience data**. No conversion probabilities,
predicted engagement percentages or synthetic audience results are produced.
Browser text fitting is an estimate; Adobe font metrics/readback can differ.

## Iterations

Each request produces three recomposed directions with parent IDs and concrete
change lists. The selected brand applies to palette, typography and wordmark.
Original campaign copy and component ingredients are retained between iterations;
line breaks from previews are not fed back into the copy. The source version
is never mutated. Supported local intents include editorial, photo-led and bold
directions, headline replacement/enlargement, more whitespace, stronger CTA,
square and Stories. Format changes preserve image proportions. Secondary
assets have a reserved area so event facts and the CTA stay separate.
Unsupported requests fail visibly; this engine does not
translate arbitrary instructions using a live language model.

## Pinterest PDF library

The Pinterest URL field is the single import entry point: submitting a Pinterest
or pin.it link loads the supplied workspace `pinterest.pdf` locally with PyMuPDF.
This is a fixed source, not a live scrape of the entered board; the imported
filename is visible with the results. There is no separate PDF extraction or
file-picker block. Other public image URLs keep their web import behavior.
Text spans and actual paths remain editable native text and
vector layers; embedded bitmap artwork remains an image. Rasterized artwork
is not traced or described as native vector geometry. All elements and detected
cards start selected, with type/page filters and bulk selection controls.
Cards can be inserted on separate pages or used as separated components in
new designs and subsequent iterations. Import immediately populates New design
with all detected cards selected, without a separate transfer action. PDFs
without detected cards provide editable page components instead. Card selection
is shared between Import and New design; thumbnails never replace their native
text/vector/image ingredients. The New design gallery shows its own generated
versions, and Brand guidelines shows its own versions rather than reusing an
unrelated gallery from another section. Native selection is limited to the
current Adobe page; after batch insertion all layers on the last page are
selected. Original pages remain intact.

## Branding and add-on icon

The interface uses #67fefe, black and white and starts directly with navigation,
without a duplicate logo/header. The supplied logo2 is used for the browser
favicon and touch icon included in the built HTML. Adobe's native
panel/launchpad icon is managed by the add-on listing, not manifest v2.
Upload `express-addon/assets-public/addon-icon-144.png` as the 144×144 icon
when configuring the listing in Manage add-ons. Local development mode keeps
Adobe's default native icon until a listing with a custom icon is used.

## Workspace and previews

All six navigation buttons are independently usable; unmet prerequisites have
explicit actions. The version library lasts for the open panel session. Native
pages persist in Adobe. Outside Adobe, the labeled harness downloads SVGs.
An unavailable original layer rendition is shown as unavailable, not replaced
by an invented photo. The optional main-photo upload provides exact preview
assets in hosts without layer renditions.
