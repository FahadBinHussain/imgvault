// Custom Vite plugin to strip exports from content.js
export function stripExports() {
  return {
    name: 'strip-exports',
    generateBundle(options, bundle) {
      const contentFile = bundle['content.js'];
      if (contentFile && contentFile.type === 'chunk') {
        // Remove export statements
        contentFile.code = contentFile.code
          .replace(/export\s+default\s+\w+\(\);?\s*$/gm, '')
          .replace(/export\s*{[^}]*};?\s*$/gm, '')
          .replace(/export\s+\w+\s+\w+.*;?\s*$/gm, '');
        
        console.log('✅ Stripped exports from content.js');
      }
    }
  };
}
