// Route by the browser's highest-priority language; unsupported languages use English.
export function visitorLanguage(header = '') {
  const entries = String(header).split(',').map((part, order) => {
    const [tag, ...parameters] = part.trim().toLowerCase().split(';');
    const parameter = parameters.map(s => s.trim()).find(s => s.startsWith('q='));
    const q = parameter === undefined ? 1 : Number(parameter.slice(2));
    return { tag: tag.trim(), q, order };
  }).filter(x => /^(?:[a-z]{2,8}(?:-[a-z0-9]{1,8})*|\*)$/.test(x.tag) && Number.isFinite(x.q) && x.q > 0 && x.q <= 1)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  const language = entries[0]?.tag.split('-')[0];
  return language === 'ar' || language === 'fr' ? language : 'en';
}
