import Ajv from 'ajv';
import standalone from 'ajv/dist/standalone/index.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const sectionNames = ['summary', 'targetUsers', 'painPoints', 'positioning', 'businessModel', 'revenue', 'acquisition', 'advantages', 'costs', 'replicability', 'risks', 'sevenDayPlan', 'thirtyDayPlan', 'ninetyDayPlan', 'questions'];
const schema = {
  $id: 'IdeaClipReportV1', type: 'object', additionalProperties: false, required: ['schemaVersion', 'sections'],
  properties: { schemaVersion: { const: 1 }, sections: { type: 'object', additionalProperties: false, required: sectionNames, properties: Object.fromEntries(sectionNames.map(name => [name, { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/claim' } }])) } },
  $defs: { claim: { type: 'object', additionalProperties: false, required: ['kind', 'text', 'evidence'], properties: { kind: { enum: ['fact', 'inference', 'hypothesis'] }, text: { type: 'string', minLength: 1, maxLength: 3000 }, evidence: { type: ['string', 'null'], maxLength: 1000 } } } },
};
const ajv = new Ajv({ code: { source: true, esm: true }, strict: true });
await mkdir('src/ai/generated', { recursive: true });
await writeFile('src/ai/generated/schema.json', JSON.stringify(schema, null, 2) + '\n');
const code = standalone(ajv, ajv.compile(schema)).replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length');
if (/require\(/.test(code)) throw new Error('Unexpected runtime dependency in generated validator');
// Native Unicode iteration counts code points without a CommonJS runtime helper.
await writeFile('src/ai/generated/validate.js', '// Generated at build time with Ajv; no runtime eval.\nconst ucs2length = value => { let count = 0; for (const point of value) count++; return count; };\n' + code);
await writeFile('public/licenses/ajv-LICENSE.txt', (await readFile('node_modules/ajv/LICENSE', 'utf8')).trimEnd() + '\n');
