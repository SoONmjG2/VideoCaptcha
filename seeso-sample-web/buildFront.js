// seeso-sample-web/buildFront.js
const path = require('path');
const Bundler = require('parcel-bundler'); // v1
const fse = require('fs-extra');           // 정적 자원 복사용

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

const options = {
  outDir: path.join(__dirname, 'dist'), // 빌드 산출물
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
  // 1) Parcel 번들
  const bundler = new Bundler(entryFiles, options);
  await bundler.bundle();
  console.log('✅ parcel-bundler(v1) build finished → dist/');

  // 2) Parcel이 복사하지 않는 정적 자원 보강(copy)
  const ROOT = __dirname;
  const DIST = path.join(ROOT, 'dist');

  // 원본 → 목적지
  const COPY_DIRS = [
    [path.join(ROOT, 'public', 'beeps'), path.join(DIST, 'public', 'beeps')], // ★ 핵심
    // 필요하면 아래도 주석 해제
    // [path.join(ROOT, 'css'),            path.join(DIST, 'css')],
    // [path.join(ROOT, 'image'),          path.join(DIST, 'image')],
    // [path.join(ROOT, 'samples'),        path.join(DIST, 'samples')],
  ];

  for (const [from, to] of COPY_DIRS) {
    if (await fse.pathExists(from)) {
      await fse.ensureDir(to);
      await fse.copy(from, to);
      console.log(`📦 copied ${path.relative(ROOT, from)} → ${path.relative(ROOT, to)}`);
    } else {
      console.warn(`⚠️ skip: ${path.relative(ROOT, from)} (not found)`);
    }
  }

  // 3) 최종 확인 로그
  const beepsDest = path.join(DIST, 'public', 'beeps');
  if (await fse.pathExists(beepsDest)) {
    const files = await fse.readdir(beepsDest);
    console.log('✅ dist/public/beeps files:', files);
  } else {
    console.warn('⚠️ dist/public/beeps 가 없습니다. public/beeps 소스가 비었거나 경로가 다른지 확인하세요.');
  }
})();
