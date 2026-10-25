import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitorLanguage } from '../../functions/_lib/language.js';
import { onRequest } from '../../functions/index.js';

test('regional Arabic/French map to their pages; English, other languages and absent preferences use English', () => {
 for (const [header, expected] of [['ar-DZ,fr;q=0.8','ar'],['fr-FR,en;q=0.8','fr'],['en-US,fr;q=0.8','en'],['de-DE,fr;q=0.8','en'],['','en'],[null,'en'],['*','en'],['AR-dz','ar']]) assert.equal(visitorLanguage(header), expected, String(header));
});
test('browser preference weights and exclusions are respected', () => {
 for (const [header, expected] of [['en;q=0.3,fr;q=0.9','fr'],['fr;q=0,ar;q=0.8','ar'],['fr;q=0.8,ar;q=0.8','fr'],['fr;q=bad,en','en'],['fr;q=2,en','en']]) assert.equal(visitorLanguage(header),expected,header);
});
test('root redirect keeps query parameters and cannot be cached across browser languages', () => {
 const request=new Request('https://www.libalstal.com/?campaign=example',{headers:{'Accept-Language':'ar-DZ'}});
 const response=onRequest({request});
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),'https://www.libalstal.com/ar/?campaign=example');
 assert.equal(response.headers.get('vary'),'Accept-Language');assert.equal(response.headers.get('cache-control'),'no-store');
});
