/**
 * Convert a click inside the rendered PDF page to the coordinate system used
 * by `synctex edit`: PDF points (72 dpi) with the origin at the TOP-left.
 *
 * The viewer's page div uses CSS pixels at `scale`; no Y flip is allowed here
 * (SyncTeX's edit mode expects y measured from the top edge of the page).
 */
export function pdfClickToSynctex(
  xCssPx: number,
  yCssPx: number,
  scale: number
): { x: number; y: number } {
  const safeScale = scale > 0 ? scale : 1
  return { x: xCssPx / safeScale, y: yCssPx / safeScale }
}
