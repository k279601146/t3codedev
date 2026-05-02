import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (f === 'node_modules' || f === 'dist' || f === '.git') return;
        isDirectory ? 
            walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

const packagesDir = 'd:/workkaifa/t3codedev/packages';
const packageNames = [
    'ccb-engine',
    'ccb-model-provider',
    'ccb-ink',
    'ccb-builtin-tools',
    'ccb-agent-tools',
    'ccb-mcp-client'
];

packageNames.forEach(pkg => {
    const pkgDir = path.join(packagesDir, pkg);
    const pkgSrcDir = path.join(pkgDir, 'src');
    if (!fs.existsSync(pkgSrcDir)) return;
    
    console.log(`Final processing for package: ${pkg}`);

    // 1. Rename .js to .ts where appropriate (if .ts doesn't exist)
    walkDir(pkgSrcDir, (filePath) => {
        if (filePath.endsWith('.js')) {
            const tsPath = filePath.slice(0, -3) + '.ts';
            if (!fs.existsSync(tsPath)) {
                fs.renameSync(filePath, tsPath);
                console.log(`  Renamed: ${path.relative(pkgSrcDir, filePath)} -> .ts`);
            }
        }
    });

    // 2. Fix all imports and requires
    walkDir(pkgSrcDir, (filePath) => {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
        
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;
        
        // Fix .js to .ts in cross-package imports
        // Pattern: from "@claude-code-best/foo/bar.js" -> from "@claude-code-best/foo/bar.ts"
        content = content.replace(/from\s+(['"])@claude-code-best\/([^'"]+?)\.js(['"])/g, 'from $1@claude-code-best/$2.ts$3');
        
        // Fix .js to .ts in relative imports (already handled in previous script, but repeat for safety)
        content = content.replace(/from\s+(['"])(\.?\.?\/)([^'"]+?)\.js(['"])/g, 'from $1$2$3.ts$4');
        content = content.replace(/require\((['"])(\.?\.?\/)([^'"]+?)\.js(['"])\)/g, 'require($1$2$3.ts$4)');
        
        // Fix .js to .ts in requires of @claude-code-best
        content = content.replace(/require\((['"])@claude-code-best\/([^'"]+?)\.js(['"])\)/g, 'require($1@claude-code-best/$2.ts$3)');

        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  Fixed content in: ${path.relative(pkgSrcDir, filePath)}`);
        }
    });
});
