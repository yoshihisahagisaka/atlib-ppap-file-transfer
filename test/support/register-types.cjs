// Node 24 native TypeScript erasure. Resolve the same extensionless imports used by tsc.
const { registerHooks } = require('node:module');
const { extname } = require('node:path');
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !extname(specifier)) {
    try { return nextResolve(specifier, context); }
    catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND' && e.code !== 'MODULE_NOT_FOUND') throw e; return nextResolve(specifier + '.ts', context); }
  }
  return nextResolve(specifier, context);
} });
