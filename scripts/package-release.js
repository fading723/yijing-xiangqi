'use strict';
// Dependency-free ZIP packaging: UTF-8 names, raw deflate and fixed timestamps.
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
const html = fs.readFileSync(path.join(root, '弈境-离线版.html'));
const guide = Buffer.from('\uFEFF' + fs.readFileSync(path.join(root, 'docs/怎么玩.txt'), 'utf8').replace(/\r?\n/g, '\r\n'));

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, data] of files) {
    const name = Buffer.from(filename, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // ZIP 2.0
    header.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(((2026 - 1980) << 9) | (11 << 5) | 6, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

fs.mkdirSync(out, { recursive: true });
const assets = new Map([
  ['Yijing-Xiangqi.html', html],
  ['Yijing-Xiangqi.zip', zip([['开始游戏.html', html], ['怎么玩.txt', guide]])]
]);
for (const [name, data] of assets) fs.writeFileSync(path.join(out, name), data);
const checksums = [...assets].map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`).join('');
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), checksums);
console.log('Player downloads ready in dist/:');
for (const [name, data] of assets) console.log(`  ${name} (${data.length} bytes)`);
