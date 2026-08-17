import { hasUsableChart, validatedAudioPreferences } from '../src/ui/app.js';

let fails = 0;
const ok = (label, condition) => {
  if (!condition) fails++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

console.log('--- overlay eligibility follows the primary chart ---');
ok('a missing chart cannot be overlaid', !hasUsableChart(null));
ok('a chart-shaped blank cannot be overlaid', !hasUsableChart({ placements: [] }));
ok('a malformed placements value cannot be overlaid', !hasUsableChart({ placements: 'sun' }));
ok('a populated chart can be overlaid', hasUsableChart({ placements: [{ key: 'sun' }] }));

console.log('\n--- saved audio preferences are safe to apply ---');
ok('a saved volume is retained', validatedAudioPreferences({ volume: 0.31 }).volume === 0.31);
ok('volume is clamped at the lower bound', validatedAudioPreferences({ volume: -2 }).volume === 0);
ok('volume is clamped at the upper bound', validatedAudioPreferences({ volume: 4 }).volume === 1);
ok('a numeric string is rejected', validatedAudioPreferences({ volume: '0.4' }).volume === 0.75);
ok('a non-finite volume is rejected', validatedAudioPreferences({ volume: Infinity }).volume === 0.75);
ok('a missing preference uses the default', validatedAudioPreferences(null).volume === 0.75);

console.log(`\n${fails === 0 ? 'All UI-state checks passed.' : `${fails} FAILURE(S).`}`);
process.exit(fails ? 1 : 0);
