// seeso-sample-web/buildFront.js
const path = require('path');
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
  path.join(__dirname, 'samples', 'success', 'gaze', 'success.html'),
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
  const bundler = new Bundler(entryFiles, options);
  await bundler.bundle();
  console.log('✅ parcel-bundler(v1) build finished → dist/');
})();
