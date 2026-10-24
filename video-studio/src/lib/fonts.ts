// Montserrat (site typeface) and Cairo (Arabic), loaded from public/fonts before any frame is captured.
import { loadFont } from '@remotion/fonts';
import { continueRender, delayRender, staticFile } from 'remotion';

export const FONT_LATIN = 'Montserrat';
export const FONT_ARABIC = 'Cairo';

const handle = delayRender('Loading fonts');
Promise.all([
  loadFont({ family: FONT_LATIN, url: staticFile('fonts/Montserrat-Medium.ttf'), weight: '500' }),
  loadFont({ family: FONT_LATIN, url: staticFile('fonts/Montserrat-SemiBold.ttf'), weight: '600' }),
  loadFont({ family: FONT_ARABIC, url: staticFile('fonts/Cairo-Variable.ttf'), weight: '400 700' }),
])
  .then(() => continueRender(handle))
  .catch(err => { console.error(err); continueRender(handle); });
