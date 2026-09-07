/* eslint-disable @typescript-eslint/no-require-imports */
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  })
  module._compile(output.outputText, filename)
}
