export function asHTMLElement(value) {
  const element = value?.nodeType === 1 ? value : value?.[0] ?? value?.element?.[0] ?? value?.element;
  return element?.nodeType === 1 ? element : null;
}
