// Stand-in for @remotion/fonts loadFont(): the standard FontFace API, which is what it wraps.
export async function loadFont(o: { family: string; url: string; weight?: string; style?: string }) {
  const face = new FontFace(o.family, `url(${o.url})`, { weight: o.weight ?? '400', style: o.style ?? 'normal', display: 'block' });
  await face.load();
  document.fonts.add(face);
}
