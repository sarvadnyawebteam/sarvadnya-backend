import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let exitCode = 0;
const results = [];

function pass(msg) { results.push(`  ✅ ${msg}`); }
function warn(msg) { results.push(`  ⚠️  ${msg}`); }
function fail(msg) { results.push(`  ❌ ${msg}`); exitCode = 1; }

function check(label, condition, severity = 'fail') {
  if (condition) {
    pass(label);
  } else {
    severity === 'fail' ? fail(label) : warn(label);
  }
}

// ─── 1. Environment Variables ─────────────────────────────────
results.push('\n📋 Environment & Secrets');
const envPath = resolve(root, '.env');
const envExamplePath = resolve(root, '.env.example');
check('.env file exists', existsSync(envPath));
check('.env.example file exists', existsSync(envExamplePath));

if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  const hasMongoURI = envContent.includes('MONGODB_URI');
  const hasGroqKey = envContent.includes('GROQ_API_KEY');
  check('MONGODB_URI is set', hasMongoURI);
  check('GROQ_API_KEY is set', hasGroqKey);
  if (envContent.includes('ADMIN_ACCESS_KEY')) {
    pass('ADMIN_ACCESS_KEY is configured');
  } else {
    warn('ADMIN_ACCESS_KEY not set in .env — admin auth is disabled');
  }
}

// Check .gitignore has .env*
const gitignore = existsSync(resolve(root, '.gitignore'))
  ? readFileSync(resolve(root, '.gitignore'), 'utf-8') : '';
check('.gitignore contains .env* pattern', /\.env\*/.test(gitignore));

// ─── 2. Package Dependencies ──────────────────────────────────
results.push('\n📦 Dependency Security');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const hasTypeScript = 'typescript' in deps;
check('TypeScript is installed', hasTypeScript);
warn('Consider adding: npm audit --audit-level=high (run separately)');

// ─── 3. Security Headers Check ────────────────────────────────
results.push('\n🔒 Security Headers');
const configPath = resolve(root, 'next.config.js');
if (existsSync(configPath)) {
  const config = readFileSync(configPath, 'utf-8');
  check('Content-Security-Policy header configured', /Content-Security-Policy/.test(config));
  check('Strict-Transport-Security header configured', /Strict-Transport-Security/.test(config));
  check('X-Frame-Options header configured', /X-Frame-Options/.test(config));
  check('X-Content-Type-Options header configured', /X-Content-Type-Options/.test(config));
  check('Referrer-Policy header configured', /Referrer-Policy/.test(config));
  check('Permissions-Policy header configured', /Permissions-Policy/.test(config));
  check('Cross-Origin-Opener-Policy header configured', /Cross-Origin-Opener-Policy/.test(config));
  check('Cross-Origin-Resource-Policy header configured', /Cross-Origin-Resource-Policy/.test(config));
}

// ─── 4. Middleware Check ───────────────────────────────────────
results.push('\n🛡️  Middleware & Auth');
// CHANGE: 2026-10-08 — this section used to assert proxy.ts EXISTS with rate limiting and
// admin protection in it. proxy.ts was DELETED by SP-4 (2026-10-06, AGENTS §13): Next 15
// never reads it, so everything it "protected" ran unauthenticated. The audit was red on a
// check that demanded the exact file SP-4 removed. Assert the LIVE guard instead.
const proxyPath = resolve(root, 'proxy.ts');
check('proxy.ts stays deleted (SP-4 — middleware.ts is the live guard, AGENTS §13)', !existsSync(proxyPath));
const mwPath = resolve(root, 'middleware.ts');
if (existsSync(mwPath)) {
  const mw = readFileSync(mwPath, 'utf-8');
  check('middleware.ts runs the admin guard (isAdminPath + isAdminRequest)', /isAdminPath\(/.test(mw) && /isAdminRequest\(/.test(mw));
  check('unauthenticated admin API answers 401 (nested convention, SP-4)', /status:\s*401/.test(mw));
  check('middleware.ts rate-limits /api/* (60 req/min incl. admin login)', /checkRateLimit\(/.test(mw));
  check('middleware.ts gates unsupported write content-types (415)', /isUnsupportedWrite\(/.test(mw) && /status:\s*415/.test(mw));
  check('middleware.ts sets the noindex header (owner rule, SP-4 layer 2)', /X-Robots-Tag/.test(mw));
} else {
  check('middleware.ts exists (the live guard on Next 15)', false);
}

// ─── 5. Security Utilities Check ─────────────────────────────
results.push('\n📚 Security Utilities');
// CHANGE: 2026-10-08 — same stale-expectation fix as the public repo: lib/api-security.ts
// and lib/rate-limit.ts were dead code deleted on 2026-07-29, so these two checks have
// been red since. What actually guards this deployment is lib/admin-guard.ts (SP-4,
// unit-tested by npm run test:guard) — assert THAT exists and is wired into middleware.
const guardLib = resolve(root, 'lib', 'admin-guard.ts');
check('lib/admin-guard.ts exists (SP-4 guard: auth + rate limit + content gate)', existsSync(guardLib));
const mwText = existsSync(mwPath) ? readFileSync(mwPath, 'utf-8') : '';
check('middleware.ts imports the guard from lib/admin-guard.ts', /from ['"]\.\/lib\/admin-guard\.ts['"]/.test(mwText));

// ─── 6. MongoDB Config Check ──────────────────────────────────
results.push('\n🗄️  Database Configuration');
const mongoLib = resolve(root, 'lib', 'mongodb.ts');
if (existsSync(mongoLib)) {
  const mongo = readFileSync(mongoLib, 'utf-8');
  check('MongoDB uses environment variable for URI', /process\.env\.MONGODB_URI/.test(mongo));
  check('MongoDB connection has timeout settings', /timeout/i.test(mongo));
}

// ─── Summary ──────────────────────────────────────────────────
results.push(`\n${'━'.repeat(50)}`);
results.push(`Audit complete — ${exitCode === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);

console.log(results.join('\n'));
process.exit(exitCode);
