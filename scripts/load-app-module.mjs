import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// Execute the actual TypeScript modules in tests with injectable Firebase
// configuration. No emitted test code or extra test framework is needed.
export function loadAppModule(name, overrides = {}) {
  const cache = new Map();
  const require = createRequire(import.meta.url);
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
    const exports = {};
    cache.set(filename, exports);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } });
    new Function("require", "exports", compiled.outputText)((specifier) => {
      if (specifier in overrides) return overrides[specifier];
      if (!specifier.startsWith(".")) return require(specifier);
      return load(path.resolve(path.dirname(filename), /\.json$/.test(specifier) ? specifier : specifier + ".ts"));
    }, exports);
    return exports;
  };
  return load(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
}
