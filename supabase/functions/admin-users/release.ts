// Which version of this function is running: the checksum of its other source
// files. `node scripts/release.mjs stamp` writes it and tests/release.test.js
// fails when it is out of date, so it changes whenever the code does. Every
// response carries it in the X-Function-Release header, which is how the
// release check confirms an environment runs the released code.
export const FUNCTION_RELEASE = '63c4c39e37f5f3498987317ced79a705554893c3ae2f482e21f2f5314dbf4dbf';
