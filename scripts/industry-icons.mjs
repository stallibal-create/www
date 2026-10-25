// Architectural pictograms, rendered without image downloads or client JavaScript.
const drawings = {
  tertiary: `<path class="ind-icon-fill" d="M18 78V28l30-12v62ZM48 78V38l28 10v30Z"/><path d="M18 78V28l30-12v62M48 38l28 10v30M12 78h72M29 33v6m0 8v6m0 8v6m10-38v6m0 8v6m0 8v6m20-11v5m10-2v5M30 78V66h10v12"/><path class="ind-icon-air" d="M58 23h21m-5-5 5 5-5 5M61 33h14"/>`,
  health: `<path class="ind-icon-fill" d="M29 77V20h38v57ZM15 77V43h14v34ZM67 77V43h14v34Z"/><path d="M29 77V20h38v57M15 77V43h14m38 0h14v34M10 77h76M41 77V61h14v16M38 47h5m10 0h5M21 54v5m0 7v4m54-16v5m0 7v4"/><path class="ind-icon-air" d="M44 28h8v6h6v8h-6v6h-8v-6h-6v-8h6Z"/>`,
  hospitality: `<path class="ind-icon-fill" d="M22 78V30h52v48Z"/><path d="M22 78V30h52v48M14 78h68M18 30h60M28 22h40M36 78V62h24v16M33 41h7v9h-7Zm23 0h7v9h-7ZM48 64v14"/><path class="ind-icon-air" d="m48 10 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.5 5-.7Z"/><path d="M18 57h60"/>`,
  industrial: `<path class="ind-icon-fill" d="M14 78V44l20 10V40l20 13V37l18 12 3-31h8v60Z"/><path d="M14 78V44l20 10V40l20 13V37l18 12 3-31h8v60M9 78h78M23 63h8v7h-8Zm18 0h8v7h-8Zm18 0h8v7h-8Z"/><path class="ind-icon-air" d="M20 27h37m-5-5 5 5-5 5M29 17h20"/>`,
  retail: `<path class="ind-icon-fill" d="M16 43h64v35H16ZM14 43l7-18h54l7 18Z"/><path d="M16 47v31h64V47M10 78h76M14 43l7-18h54l7 18M14 43c0 10 14 10 14 0 0 10 13 10 13 0 0 10 14 10 14 0 0 10 13 10 13 0 0 10 14 10 14 0M29 26l-1 17m14-17-1 17m13-17 1 17m12-17 1 17M24 59h17v13H24Zm30 19V59h17v19"/><path class="ind-icon-air" d="M38 17v-4h20v4"/>`
};
export function industryIcon(key) {
  if (!drawings[key]) throw new Error(`Missing industry pictogram: ${key}`);
  return `<svg class="ind-icon" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawings[key]}</svg>`;
}
