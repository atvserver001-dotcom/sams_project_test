/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('node:fs')
const { transpileModule, ModuleKind, ScriptTarget } = require('typescript')

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  })
  module._compile(outputText, filename)
}
