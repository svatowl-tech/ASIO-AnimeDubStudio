const fs = require('fs');
const path = require('path');

// Target directory
const binDir = path.join(__dirname, '..', 'src-tauri', 'bin');

try {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
} catch (e) {
  console.warn('Could not create binDir:', e.message);
}

const embeddedZipPath = path.join(binDir, 'embedded_ffmpeg.zip');
if (!fs.existsSync(embeddedZipPath)) {
  try {
    fs.writeFileSync(embeddedZipPath, Buffer.alloc(0));
  } catch (e) {
    console.warn('Could not create placeholder embedded_ffmpeg.zip:', e.message);
  }
}

try {
  let ffmpegStaticPath = null;
  let ffprobeStatic = null;

  try {
    ffmpegStaticPath = require('ffmpeg-static');
  } catch (e) {
    console.warn('ffmpeg-static not available:', e.message);
  }

  // In CI / Desktop release builds, if ffmpeg-static binary was not downloaded yet, run its install script
  if (
    (process.env.DUBSTUDIO_EMBED_FFMPEG === '1' || process.env.GITHUB_ACTIONS === 'true') &&
    ffmpegStaticPath &&
    !fs.existsSync(ffmpegStaticPath)
  ) {
    try {
      const installScript = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'install.js');
      if (fs.existsSync(installScript)) {
        require('child_process').execFileSync(process.execPath, [installScript], { stdio: 'inherit' });
      }
    } catch (e) {
      console.warn('ffmpeg-static CI install fallback warning:', e.message);
    }
  }

  try {
    ffprobeStatic = require('ffprobe-static');
  } catch (e) {
    console.warn('ffprobe-static not available:', e.message);
  }

  const osName = process.platform;

  function copyToDestinations(sourcePath, destFilenames) {
    if (!sourcePath || !fs.existsSync(sourcePath)) return;
    for (const name of destFilenames) {
      const dest = path.join(binDir, name);
      try {
        console.log(`Copying ${sourcePath} -> ${dest}`);
        fs.copyFileSync(sourcePath, dest);
        fs.chmodSync(dest, 0o755);
      } catch (e) {
        console.warn(`Could not copy to ${dest}:`, e.message);
      }
    }
  }

  const ffmpegNames = [];
  const ffprobeNames = [];

  if (osName === 'win32') {
    ffmpegNames.push('ffmpeg-x86_64-pc-windows-msvc.exe', 'ffmpeg.exe');
    ffprobeNames.push('ffprobe-x86_64-pc-windows-msvc.exe', 'ffprobe.exe');
  } else if (osName === 'darwin') {
    ffmpegNames.push('ffmpeg-aarch64-apple-darwin', 'ffmpeg-x86_64-apple-darwin', 'ffmpeg');
    ffprobeNames.push('ffprobe-aarch64-apple-darwin', 'ffprobe-x86_64-apple-darwin', 'ffprobe');
  } else if (osName === 'linux') {
    ffmpegNames.push('ffmpeg-x86_64-unknown-linux-gnu', 'ffmpeg-aarch64-unknown-linux-gnu', 'ffmpeg');
    ffprobeNames.push('ffprobe-x86_64-unknown-linux-gnu', 'ffprobe-aarch64-unknown-linux-gnu', 'ffprobe');
  }

  copyToDestinations(ffmpegStaticPath, ffmpegNames);
  copyToDestinations(ffprobeStatic && ffprobeStatic.path, ffprobeNames);

  if (process.env.DUBSTUDIO_EMBED_FFMPEG === '1') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const exeSuffix = osName === 'win32' ? '.exe' : '';
      const ffmpegBin = path.join(binDir, `ffmpeg${exeSuffix}`);
      const ffprobeBin = path.join(binDir, `ffprobe${exeSuffix}`);
      if (fs.existsSync(ffmpegBin)) {
        zip.addLocalFile(ffmpegBin);
      }
      if (fs.existsSync(ffprobeBin)) {
        zip.addLocalFile(ffprobeBin);
      }
      zip.writeZip(embeddedZipPath);
      console.log(`Created portable embedded archive: ${embeddedZipPath}`);
    } catch (e) {
      console.warn('Could not create embedded_ffmpeg.zip, writing empty placeholder:', e.message);
      fs.writeFileSync(embeddedZipPath, Buffer.alloc(0));
    }
  }

  console.log('Successfully set up FFmpeg sidecars for Tauri.');
} catch (err) {
  console.warn('Non-fatal warning in setup-ffmpeg.js:', err.message);
}
process.exit(0);
