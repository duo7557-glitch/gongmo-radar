import { unzipSync } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';
import { collectOfferings, createDartClient } from '../supabase/functions/_shared/dart.mjs';
import { loadEnv } from './load-env.mjs';
await loadEnv();
try {
  const client = createDartClient(process.env.DART_API_KEY);
  const result = await collectOfferings({ client, unzip: unzipSync });
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/ipo-import.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2) + '\n', 'utf8');
  console.log(`공시 ${result.scanned}건 확인 · 자동 등록 가능 ${result.listings.length}건 · 추가 확인 ${result.review.length}건`);
  console.log('data/ipo-import.json에 저장했습니다. 클라우드 자동 갱신은 ipo-sync 함수와 schedule.sql로 활성화하세요.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
