// simple stroke icons
window.IC={
move:'<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
brush:'<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-4 2-4 4 0 1.5-1 2.5-3 3 3 1 7 1 8-2 .5-1.5 0-3-1-5"/>',
eraser:'<path d="M7 21h12M4 15l9-9 6 6-7 7H8z"/><path d="M10 9l6 6"/>',
select:'<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/>',
lasso:'<path d="M5 13c-2-5 3-9 8-9s8 3 7 6-6 5-10 4"/><path d="M8 14c-2 1-2 4 0 5s2 2 1 3"/>',
mask:'<rect x="3" y="4" width="18" height="16" rx="3" stroke-dasharray="2.4 2"/><path d="M15 8l2 2-5.5 5.5-2.2-2.2z"/><path d="M9.5 13.5c-1.6 0-2 .9-2 1.8 0 .7-.5 1.2-1.4 1.4 1.4.5 3.3.4 3.8-.9.2-.7 0-1.4-.4-2.3"/>',
maskerase:'<rect x="3" y="4" width="18" height="16" rx="3" stroke-dasharray="2.4 2"/><path d="M8 16l8-8M9 9l6 6"/>',
transform:'<rect x="5" y="5" width="14" height="14"/><rect x="3" y="3" width="4" height="4" fill="currentColor"/><rect x="17" y="3" width="4" height="4" fill="currentColor"/><rect x="3" y="17" width="4" height="4" fill="currentColor"/><rect x="17" y="17" width="4" height="4" fill="currentColor"/>',
crop:'<path d="M6 2v16h16M2 6h16v16"/>',
genarea:'<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
eyedrop:'<path d="M14 5l5 5"/><path d="M15.2 3.2l4.6 4.6-2 2-4.6-4.6z"/><path d="M13.5 8.5L7 15a2.8 2.8 0 104 4l6.5-6.5"/><circle cx="8.2" cy="18.6" r="1.3" fill="currentColor" stroke="none"/>',
hand:'<path d="M8 13V5a1.5 1.5 0 013 0v6M11 11V4a1.5 1.5 0 013 0v7M14 11V5a1.5 1.5 0 013 0v8M17 10a1.5 1.5 0 013 0v4c0 4-3 7-7 7s-5-2-7-5l-2-3a1.5 1.5 0 012.5-1.5L8 13"/>',
zoom:'<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',
text:'<path d="M5 5h14M12 5v15"/>',
eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
eyeoff:'<path d="M3 3l18 18M10 6c.7-.1 1.3-.1 2-.1 6 0 10 7 10 7a17 17 0 01-3 3.5M6.5 6.5C3.8 8.3 2 12 2 12s4 7 10 7c1.7 0 3.2-.4 4.5-1"/>',
lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
folder:'<path d="M3 6h6l2 2h10v11H3z"/>',
search:'<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>',
open:'<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 17v-6M9 14l3-3 3 3"/>',
collapse:'<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/>',
expand:'<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
spark:'<path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
upload:'<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
link:'<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>',
filter:'<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
wand:'<path d="M4 20L15 9M15 4v2M20 9h-2M18 6l-1.5 1.5M13 3l.5 1.5"/>',
pen:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
chev:'<path d="M6 9l6 6 6-6"/>',
chevr:'<path d="M9 6l6 6-6 6"/>',
x:'<path d="M6 6l12 12M18 6L6 18"/>',
dice:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
invert:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/>',
undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
redo:'<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
star:'<path d="M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.6 3 1-6.1L3 9.5l6.3-.9z"/>',
grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
play:'<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
fx:'<path d="M10 4H7a2 2 0 00-2 2v14M3 11h6M13 10l6 8M19 10l-6 8"/>',
};
function ic(n,s){s=s||16;return `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${IC[n]||''}</svg>`}
window.zeroImageStudioIcon = ic;
function zeroImageStudioHydrateIcons(root){
  (root||document).querySelectorAll("[data-i]").forEach(e=>{
    if (e.dataset.hydrated) return;
    e.dataset.hydrated = "1";
    e.insertAdjacentHTML("afterbegin", ic(e.dataset.i, +e.dataset.s || undefined));
  });
}
window.zeroImageStudioHydrateIcons = zeroImageStudioHydrateIcons;
if (window.__ZEROIMAGESTUDIO_PAGE) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => zeroImageStudioHydrateIcons());
  else zeroImageStudioHydrateIcons();
}
