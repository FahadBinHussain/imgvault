import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const releaseDir = path.join(__dirname, 'src-tauri', 'target', 'release');
const filesToCopy = [
  {
    source: path.join(releaseDir, 'imgvault-native-host.exe'),
    dest: path.join(__dirname, 'ImgVault-Native-Host.exe'),
  },
];

try {
  for (const file of filesToCopy) {
    if (fs.existsSync(file.source)) {
      fs.copyFileSync(file.source, file.dest);
      console.log('Copied portable file to:', file.dest);
    } else {
      console.warn('Source file not found:', file.source);
    }
  }
} catch (error) {
  console.error('Failed to copy portable host files:', error.message);
  process.exit(1);
}
