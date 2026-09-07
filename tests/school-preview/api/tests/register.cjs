/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('node:fs')
const { transpileModule, ModuleKind, ScriptTarget } = require('typescript')

// Standalone Node tests: no Next server, root test runner, or production API imports.
require.extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8')
  const { outputText } = transpileModule(source, {
    fileName: filename, compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  })
  module._compile(outputText, filename)
}
