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

const featureFlagsPath = path.join(packagesDir, 'ccb-engine/src/featureFlags.ts');

packageNames.forEach(pkg => {
    const targetDir = path.join(packagesDir, pkg, 'src');
    console.log('Processing package:', pkg);
    
    walkDir(targetDir, (filePath) => {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
        
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;
        
        // 1. Replace bun:bundle imports
        if (content.includes('bun:bundle')) {
            const relativePath = path.relative(path.dirname(filePath), featureFlagsPath).replace(/\\/g, '/');
            const importPath = relativePath.startsWith('.') ? relativePath : './' + relativePath;
            content = content.replace(/import\s+\{([^}]*feature[^}]*)\}\s+from\s+['"]bun:bundle['"];?/g, `import { $1 } from "${importPath}";`);
        }

        // 2. Replace Bun.env with process.env
        if (content.includes('Bun.env')) {
            content = content.replace(/Bun\.env/g, 'process.env');
        }

        // 3. Replace Bun.argv with process.argv
        if (content.includes('Bun.argv')) {
            content = content.replace(/Bun\.argv/g, 'process.argv');
        }

        // 4. Ensure lodash-es imports have .js (required for Node ESM)
        if (content.includes('lodash-es/')) {
            content = content.replace(/from\s+['"]lodash-es\/([^'"]+?)(?:\.js)?['"]/g, 'from "lodash-es/$1.js"');
        }

        // 5. Convert local imports and src/ imports from .js to .ts
        // This handles: from "./foo.js", from "../bar.js", from "src/utils.js"
        content = content.replace(/from\s+['"](\.?\.?\/|src\/)([^'"]+?)\.js['"]/g, 'from "$1$2.ts"');
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Fixed:', filePath);
        }
    });

    // Fix tsconfig.json
    const tsconfigPath = path.join(packagesDir, pkg, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
        let tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
        if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
        
        tsconfig.compilerOptions.baseUrl = ".";
        tsconfig.compilerOptions.paths = { "src/*": ["src/*"] };
        tsconfig.compilerOptions.exactOptionalPropertyTypes = false;
        tsconfig.compilerOptions.skipLibCheck = true;
        tsconfig.compilerOptions.noImplicitAny = false;
        tsconfig.compilerOptions.strictNullChecks = false;
        tsconfig.compilerOptions.erasableSyntaxOnly = false;
        tsconfig.compilerOptions.verbatimModuleSyntax = false;
        tsconfig.compilerOptions.jsx = "react-jsx";
        tsconfig.compilerOptions.moduleResolution = "Bundler";
        tsconfig.compilerOptions.module = "ESNext";
        tsconfig.compilerOptions.noImplicitOverride = false;
        tsconfig.compilerOptions.useDefineForClassFields = false;
        
        fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');
        console.log('Updated tsconfig:', tsconfigPath);
    }
});
