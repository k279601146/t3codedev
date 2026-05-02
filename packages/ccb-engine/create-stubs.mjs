import fs from 'fs';
import path from 'path';

const commandsTsPath = 'D:/workkaifa/t3codedev/packages/ccb-engine/src/commands.ts';
const content = fs.readFileSync(commandsTsPath, 'utf8');

const importPattern = /import\s+\w+\s+from\s+['"](\.\/commands\/[^'"]+)['"]/g;
const requirePattern = /require\(['"](\.\/commands\/[^'"]+)['"]\)/g;

const matches = [
    ...Array.from(content.matchAll(importPattern)).map(m => m[1]),
    ...Array.from(content.matchAll(requirePattern)).map(m => m[1])
];

const srcDir = path.dirname(commandsTsPath);

matches.forEach(importPath => {
    const absPath = path.resolve(srcDir, importPath);
    // Check if it exists with .ts, .tsx, or if it's a directory with index.ts/tsx
    const possiblePaths = [
        absPath,
        absPath + '.ts',
        absPath + '.tsx',
        path.join(absPath, 'index.ts'),
        path.join(absPath, 'index.tsx')
    ];

    const exists = possiblePaths.some(p => fs.existsSync(p));

    if (!exists) {
        console.log(`Missing: ${importPath}`);
        // Create a stub
        const stubDir = absPath.endsWith('.ts') || absPath.endsWith('.tsx') ? path.dirname(absPath) : absPath;
        if (!fs.existsSync(stubDir)) {
            fs.mkdirSync(stubDir, { recursive: true });
        }
        
        const stubFile = absPath.endsWith('.ts') || absPath.endsWith('.tsx') ? absPath : path.join(absPath, 'index.ts');
        fs.writeFileSync(stubFile, "export default { isEnabled: () => false, isHidden: true, name: 'stub' };\n");
        console.log(`  Created stub at ${stubFile}`);
    }
});
