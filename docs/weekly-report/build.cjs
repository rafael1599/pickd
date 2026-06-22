/*
 * Build a weekly-report PDF from a JSX template.
 *
 *   node build.cjs [input.jsx] [output.pdf]
 *
 * Defaults: input = ./report-template.jsx, output = /tmp/weekly-report.pdf
 *
 * Resolves the pickd node_modules (for @react-pdf/renderer, react, @fontsource,
 * esbuild) by walking up from this file, so it works on any machine where the
 * pickd repo's deps are installed. No global installs needed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function findNodeModules(start) {
  let d = start;
  for (let i = 0; i < 10; i++) {
    const nm = path.join(d, 'node_modules');
    if (fs.existsSync(path.join(nm, '@react-pdf', 'renderer', 'package.json'))) return nm;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  if (fs.existsSync('/home/user/pickd/node_modules/@react-pdf/renderer/package.json')) {
    return '/home/user/pickd/node_modules';
  }
  throw new Error('Could not find pickd node_modules with @react-pdf/renderer. Run `pnpm install` in the pickd repo first.');
}

function findEsbuild(nm) {
  const direct = path.join(nm, 'esbuild', 'lib', 'main.js');
  if (fs.existsSync(direct)) return direct;
  const pnpm = path.join(nm, '.pnpm');
  if (fs.existsSync(pnpm)) {
    const hit = fs.readdirSync(pnpm).find((n) => /^esbuild@/.test(n));
    if (hit) {
      const p = path.join(pnpm, hit, 'node_modules', 'esbuild', 'lib', 'main.js');
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Could not find esbuild under node_modules (it ships as a transitive dep of vite).');
}

const NM = findNodeModules(__dirname);
process.env.PICKD_NM = NM; // the template reads this to resolve react/@react-pdf/fonts
const esbuild = require(findEsbuild(NM));

const inFile = path.resolve(process.argv[2] || path.join(__dirname, 'report-template.jsx'));
const outFile = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'weekly-report.pdf'));
const gen = path.join(os.tmpdir(), `weekly-report.gen.${Date.now()}.cjs`);

const { code } = esbuild.transformSync(fs.readFileSync(inFile, 'utf8'), {
  loader: 'jsx', format: 'cjs', target: 'node18',
  jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  sourcefile: inFile,
});
fs.writeFileSync(gen, code);

require(gen)(outFile)
  .then(() => {
    console.log(`OK → ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
    try { fs.unlinkSync(gen); } catch {}
  })
  .catch((e) => { console.error('FAIL:', e); process.exit(1); });
