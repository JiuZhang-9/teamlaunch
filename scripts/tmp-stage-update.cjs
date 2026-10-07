/* 临时测试脚本：布置伪造的 1.0.5 更新源（latest.yml + 拷贝安装包），仅单机验证用。 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(process.env.APPDATA, 'TeamLaunch-tl-18', 'updates');
fs.mkdirSync(dir, { recursive: true });
const src = path.join(__dirname, '..', 'dist', 'installer', 'TeamLaunch-Setup-1.0.4.exe');
const dst = path.join(dir, 'TeamLaunch-Setup-1.0.5.exe');
fs.copyFileSync(src, dst);
const sha512 = crypto.createHash('sha512').update(fs.readFileSync(dst)).digest('base64');
const yml = `version: 1.0.5\npath: TeamLaunch-Setup-1.0.5.exe\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`;
fs.writeFileSync(path.join(dir, 'latest.yml'), yml);
console.log('staged:', dst, 'sha512-len:', sha512.length);
