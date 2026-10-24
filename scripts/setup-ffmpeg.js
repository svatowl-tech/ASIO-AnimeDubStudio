const fs = require('fs');
const path = require('path');
const ffmpegStaticPath = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// Target directory
const binDir = path.join(__dirname, '..', 'src-tauri', 'bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// Get required host info
const osName = process.platform;
const arch = process.arch;

// Copy helper for multiple target names
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
    // Both Apple Silicon and Intel Macs
    ffmpegNames.push('ffmpeg-aarch64-apple-darwin', 'ffmpeg-x86_64-apple-darwin', 'ffmpeg');
    ffprobeNames.push('ffprobe-aarch64-apple-darwin', 'ffprobe-x86_64-apple-darwin', 'ffprobe');
} else if (osName === 'linux') {
    ffmpegNames.push('ffmpeg-x86_64-unknown-linux-gnu', 'ffmpeg-aarch64-unknown-linux-gnu', 'ffmpeg');
    ffprobeNames.push('ffprobe-x86_64-unknown-linux-gnu', 'ffprobe-aarch64-unknown-linux-gnu', 'ffprobe');
} else {
    console.warn('Unsupported platform for setting up ffmpeg-static');
    process.exit(0);
}

copyToDestinations(ffmpegStaticPath, ffmpegNames);
copyToDestinations(ffprobeStatic && ffprobeStatic.path, ffprobeNames);

// Create embedded_ffmpeg.zip for single-file portable builds when DUBSTUDIO_EMBED_FFMPEG=1
const embeddedZipPath = path.join(binDir, 'embedded_ffmpeg.zip');
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
} else if (!fs.existsSync(embeddedZipPath)) {
    fs.writeFileSync(embeddedZipPath, Buffer.alloc(0));
}

console.log('Successfully set up FFmpeg sidecars for Tauri.');
