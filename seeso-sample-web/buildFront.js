// seeso-sample-web/buildFront.js
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const Bundler = require('parcel-bundler'); // v1

const entryFiles = [
  path.join(__dirname, 'public', 'login.html'),
  path.join(__dirname, 'public', 'destination.html'),
  path.join(__dirname, 'public', 'camera-error.html'),
  path.join(__dirname, 'public', 'nocamera_index.html'),

  path.join(__dirname, 'samples', 'gaze', 'index.html'),
  path.join(__dirname, 'samples', 'gaze', 'user_index.html'),
  path.join(__dirname, 'samples', 'gaze', 'noseeso_index.html'),
  path.join(__dirname, 'samples', 'gaze', 'nocamera_success.html'),
  path.join(__dirname, 'samples', 'gaze', 'success', 'success.html'),
];

const outDir = path.join(__dirname, 'dist');

const options = {
  outDir,
  publicUrl: '/',
  watch: false,
  cache: false,
  hmr: false,
  minify: true,
  target: 'browser',
  logLevel: 3,
  sourceMaps: false,
};

(async () => {
  const bundler = new Bundler(entryFiles, options);
  await bundler.bundle();

  // ★ beeps 정적 자원 복사 (Parcel v1이 자동 포함 안 함)
  const srcBeeps = path.join(__dirname, 'public', 'beeps');
  const dstBeeps = path.join(outDir, 'public', 'beeps');
  try {
    if (fs.existsSync(srcBeeps)) {
      await fse.ensureDir(dstBeeps);
      await fse.copy(srcBeeps, dstBeeps, { overwrite: true });
      console.log('📦 copied public/beeps → dist/public/beeps');
    } else {
      console.warn('⚠️ public/beeps not found, skip copy');
    }
  } catch (err) {
    console.error('❌ copy beeps failed:', err);
    process.exitCode = 1;
  }

  console.log('✅ parcel-bundler(v1) build finished → dist/');
})();
