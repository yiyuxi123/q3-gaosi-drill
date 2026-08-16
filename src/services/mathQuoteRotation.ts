export function getNextQuoteIndex(
  quoteCount: number,
  currentIndex: number,
  random: () => number = Math.random
): number {
  if (quoteCount <= 1) return 0;
  const safeCurrent = Math.min(Math.max(0, currentIndex), quoteCount - 1);
  const randomValue = Math.min(Math.max(random(), 0), 0.9999999999999999);
  const candidate = Math.floor(randomValue * (quoteCount - 1));
  return candidate >= safeCurrent ? candidate + 1 : candidate;
}
