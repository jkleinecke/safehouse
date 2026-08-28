/**
 * /read/:bookCode — the shell's route element for the rulebook reader.
 *
 * The server's `/read/:code` answers with the printed → PDF page MAPPING as
 * JSON, not a rendered page, so framing it directly would show the GM a blob
 * of JSON. The books feature owns the actual viewer: it resolves the mapping,
 * then frames the PDF itself at `#page=N` with a printed-page stepper.
 */
export { default } from '../../features/gm/books/BookReader.js';
