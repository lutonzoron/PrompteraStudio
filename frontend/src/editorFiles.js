export function takeSelectedFiles(input) {
  // FileList is live: clearing the input before copying it discards the upload.
  const files = Array.from(input.files || []);
  input.value = "";
  return files;
}
