const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const tauriConfPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(__dirname, '..', 'src-tauri', 'Cargo.toml');

if (!fs.existsSync(packagePath)) {
  console.error('package.json not found!');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = packageJson.version;

console.log(`Syncing version ${version} across configuration files...`);

// 1. Update tauri.conf.json
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  if (tauriConf.version !== version) {
    tauriConf.version = version;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`Updated tauri.conf.json to version ${version}`);
  }
}

// 2. Update Cargo.toml
if (fs.existsSync(cargoTomlPath)) {
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  const versionRegex = /^version\s*=\s*"[^"]+"/m;
  if (versionRegex.test(cargoToml)) {
    cargoToml = cargoToml.replace(versionRegex, `version = "${version}"`);
    fs.writeFileSync(cargoTomlPath, cargoToml);
    console.log(`Updated Cargo.toml to version ${version}`);
  }
}

console.log('Version sync completed successfully.');
