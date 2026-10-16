const fs = require('node:fs');
const path = require('node:path');
const qrcode = require('qrcode-generator');

const fixture = require('../src/services/mock/identification-fixtures.json');
const destination = path.resolve(__dirname, '../testing/qr');
fs.mkdirSync(destination, { recursive: true });
for (const [name, recipientRef] of [
  ['member-a.svg', 'recipient-member-a'],
  ['guest-1.svg', 'recipient-guest-1'],
]) {
  const recipient = fixture.recipients.find((item) => item.recipientRef === recipientRef);
  if (!recipient) throw new Error(`Missing QR fixture: ${recipientRef}`);
  const code = qrcode(0, 'M');
  code.addData(recipient.qrPayload);
  code.make();
  fs.writeFileSync(path.join(destination, name), code.createSvgTag(8, 32), 'utf8');
}
console.log(`Generated ${path.join(destination, 'member-a.svg')} and guest-1.svg from the app fixture`);
