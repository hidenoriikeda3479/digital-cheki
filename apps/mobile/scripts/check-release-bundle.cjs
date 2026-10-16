const fs = require('node:fs');
const path = require('node:path');

const release = process.argv[2] || 'stage02-release';
if (!/^stage[0-9]+-release$/.test(release)) throw new Error('Unexpected release directory');
const root = path.resolve(__dirname, `../dist/${release}/_expo/static/js/ios`);
const files = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
if (files.length === 0) throw new Error('検証対象のiOS JavaScript bundleがありません');
const forbidden = ['group-a', 'fan-a', 'idol-a', 'RESET_MOCK_DATA', 'Digital Cheki storage check', 'テストグループA', '端末保存の確認', 'DemoPass123', 'group@example.test', 'fan@example.test', 'stopped-group@example.test', 'deleted-fan@example.test', 'recipient-member-a', 'dc:1:member:member-a', '"700001"', '"000123"', '仮転送の試験設定', 'mock-advance-seven-days', 'fail-three', 'lost-response', 'fail-midway', 'download-fail-'];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const text of forbidden) {
    const escaped = text.replace(/[\u0080-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    if (source.includes(text) || source.toLowerCase().includes(escaped.toLowerCase())) {
      throw new Error(`公開bundleにモック専用内容が残っています: ${text} (${file})`);
    }
  }
}
console.log(`PASS: ${files.length} iOS bundle(s), fixture / storage check markers absent`);
