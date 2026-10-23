export default function rejectPrepackagedArtifact(event) {
  const options = event?.packager?.packagerOptions;
  if (options === null || typeof options !== 'object') {
    throw new Error('Cannot verify artifact packaging options before publication');
  }
  if (options.prepackaged != null) {
    throw new Error('Prepackaged artifacts are unsupported because they bypass the packaged Electron Node security gate. Rebuild through the normal packaging hooks.');
  }
}
