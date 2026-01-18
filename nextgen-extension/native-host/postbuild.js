import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcePath = path.join(__dirname, 'src-tauri', 'target', 'release', 'ImgVault Native Host.exe');
const destPath = path.join(__dirname, 'ImgVault-Native-Host.exe');

try {
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log('✅ Copied portable exe to:', destPath);
  } else {
    console.warn('⚠️ Source exe not found:', sourcePath);
  }
} catch (error) {
  console.error('❌ Failed to copy exe:', error.message);
  process.exit(1);
}
