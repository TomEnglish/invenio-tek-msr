// Which version of this function is running: the checksum of its other source
// files. `node scripts/release.mjs stamp` writes it and tests/release.test.js
// fails when it is out of date, so it changes whenever the code does. Every
// response carries it in the X-Function-Release header, which is how the
// release check confirms an environment runs the released code.
export const FUNCTION_RELEASE = '7238dbdd32d6cc6e0ebacdff646976a618ea80131efad92f6e405aed9cbe37e9';
