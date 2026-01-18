import pngToIco from 'png-to-ico';
import fs from 'fs';

const inputPath = 'src-tauri/icons/128x128.png';
const outputPath = 'src-tauri/icons/icon.ico';

pngToIco(inputPath)
  .then(buf => {
    fs.writeFileSync(outputPath, buf);
    console.log('✓ Icon converted successfully!');
  })
  .catch(err => {
    console.error('Error converting icon:', err);
    process.exit(1);
  });
