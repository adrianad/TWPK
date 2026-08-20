import { encrypt } from 'pagecrypt'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const password = process.env.PAGECRYPT_PASSWORD
if (!password) {
  console.error('PAGECRYPT_PASSWORD is not set. Copy .env.example to .env and set a password.')
  process.exit(1)
}

const apps = [
  { src: 'src/mission-helper.html', dest: 'mission-helper/index.html' },
  { src: 'src/clan-tech-planner.html', dest: 'clan-tech-planner/index.html' },
  { src: 'src/clantechrace.html', dest: 'clantechrace/index.html' },
  { src: 'src/warledger.html', dest: 'warledger/index.html' },
]

// pagecrypt caches its derived decryption key in sessionStorage under the fixed name "k".
// sessionStorage is shared across every path on the same origin, but each encrypted page
// uses its own random salt (different derived key) — so visiting page A then page B makes
// B reuse A's cached key, fail to decrypt, and fall back to the password prompt. Namespace
// each page's cache slot to its own dest dir so pages can never collide.
function namespaceSessionKey(html, dest) {
  const uniq = 'k_' + dest.split('/')[0].replace(/[^A-Za-z0-9]/g, '_')
  return html
    .replace(/sessionStorage\.k(?![A-Za-z0-9_$])/g, `sessionStorage.${uniq}`)
    .replace(/removeItem\("k"\)/g, `removeItem("${uniq}")`)
}

for (const { src, dest } of apps) {
  await mkdir(dest.split('/').slice(0, -1).join('/'), { recursive: true })
  await encrypt(src, dest, password)
  const html = await readFile(dest, 'utf8')
  await writeFile(dest, namespaceSessionKey(html, dest))
  console.log(`encrypted ${src} -> ${dest}`)
}
