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

const packageMap = {
    '@t3tools/ccb-engine': path.join(packagesDir, 'ccb-engine', 'src'),
    '@anthropic/ink': path.join(packagesDir, 'ccb-ink', 'src'),
    '@ant/model-provider': path.join(packagesDir, 'ccb-model-provider', 'src'),
    '@claude-code-best/builtin-tools': path.join(packagesDir, 'ccb-builtin-tools', 'src'),
    '@claude-code-best/agent-tools': path.join(packagesDir, 'ccb-agent-tools', 'src'),
    '@claude-code-best/mcp-client': path.join(packagesDir, 'ccb-mcp-client', 'src')
};

function resolveImport(currentFile, importPath) {
    let targetPath = '';
    if (importPath.startsWith('.')) {
        targetPath = path.resolve(path.dirname(currentFile), importPath);
    } else {
        for (const [pkgName, pkgSrc] of Object.entries(packageMap)) {
            if (importPath.startsWith(pkgName)) {
                let subPath = importPath.slice(pkgName.length);
                if (subPath.startsWith('/tools/')) {
                    targetPath = path.join(pkgSrc, 'tools', subPath.slice(7));
                } else if (subPath === '' || subPath === '/') {
                    targetPath = path.join(pkgSrc, 'index');
                } else {
                    targetPath = path.join(pkgSrc, subPath);
                }
                break;
            }
        }
    }

    if (!targetPath) return null;

    // Remove existing extension if any, to re-evaluate
    const base = targetPath.replace(/\.(ts|tsx|js|jsx)$/, '');
    const importBase = importPath.replace(/\.(ts|tsx|js|jsx)$/, '');
    
    if (fs.existsSync(base + '.tsx')) return importBase + '.tsx';
    if (fs.existsSync(base + '.ts')) return importBase + '.ts';
    if (fs.existsSync(base + '.js')) return importBase + '.js';
    
    // Check for index files
    if (fs.existsSync(path.join(base, 'index.tsx'))) return importBase.replace(/\/$/, '') + '/index.tsx';
    if (fs.existsSync(path.join(base, 'index.ts'))) return importBase.replace(/\/$/, '') + '/index.ts';
    if (fs.existsSync(path.join(base, 'index.js'))) return importBase.replace(/\/$/, '') + '/index.js';

    return null;
}

packageNames.forEach(pkg => {
    const pkgSrcDir = path.join(packagesDir, pkg, 'src');
    if (!fs.existsSync(pkgSrcDir)) return;
    
    console.log(`Smart fixing package: ${pkg}`);

    walkDir(pkgSrcDir, (filePath) => {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
        
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;
        
        const pattern = /(from|import|require)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;
        
        content = content.replace(pattern, (match, type, importPath) => {
            if (importPath.startsWith('.') || importPath.startsWith('@claude-code-best/') || importPath.startsWith('@t3tools/ccb-') || importPath.startsWith('@ant/') || importPath.startsWith('@anthropic/')) {
                const fixed = resolveImport(filePath, importPath);
                if (fixed && fixed !== importPath) {
                    return match.replace(importPath, fixed);
                }
            }
            return match;
        });

        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
    });
});
