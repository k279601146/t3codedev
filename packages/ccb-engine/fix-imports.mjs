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
    const pkgSrcDir = path.join(packagesDir, pkg, 'src');
    if (!fs.existsSync(pkgSrcDir)) {
        console.log(`Skipping ${pkg}, src dir not found.`);
        return;
    }
    
    console.log(`Processing package: ${pkg}`);
    const srcAbsPath = path.resolve(pkgSrcDir);

    walkDir(pkgSrcDir, (filePath) => {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
        
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;
        
        const fileAbsPath = path.resolve(filePath);
        const fileDir = path.dirname(fileAbsPath);
        const relToSrc = path.relative(srcAbsPath, fileDir);
        
        // Calculate how many levels deep we are from 'src'
        const depth = relToSrc === '' ? 0 : relToSrc.split(path.sep).length;
        const prefix = depth === 0 ? './' : '../'.repeat(depth);
        
        // Replace "src/" or 'src/' with the relative prefix
        const srcPattern = /(['"])src\//g;
        content = content.replace(srcPattern, `$1${prefix}`);
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  Fixed imports in: ${path.relative(pkgSrcDir, filePath)} (depth: ${depth})`);
        }
    });
});
