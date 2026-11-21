// Placement for the page's popovers (the calendar and the time picker), which
// are position: fixed. Browsers' own pickers always open below their field,
// which runs off the bottom of the window when the field is near it.

/** Below the anchor if it fits, otherwise above, and always inside the window. */
export function placeBeside(element, anchor) {
  const box = anchor.getBoundingClientRect();
  const width = element.offsetWidth, height = element.offsetHeight;
  const viewWidth = document.documentElement.clientWidth, viewHeight = window.innerHeight;
  const gap = 6, margin = 8;
  const below = box.bottom + gap, above = box.top - gap - height;
  let top;
  if (below + height <= viewHeight - margin) top = below;
  else if (above >= margin) top = above;
  else top = Math.max(margin, Math.min(below, viewHeight - margin - height));
  const left = Math.max(margin, Math.min(box.left, viewWidth - margin - width));
  element.style.top = `${Math.round(top)}px`;
  element.style.left = `${Math.round(left)}px`;
  element.dataset.side = top < box.top ? 'above' : 'below';
}
