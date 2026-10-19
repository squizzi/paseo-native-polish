export function shouldAnimateFooterRise(
  previousFooter: object | null,
  currentFooter: object | null,
): boolean {
  return previousFooter !== null && previousFooter === currentFooter;
}
