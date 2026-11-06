import { extractFromDocument } from './extract';
import type { ExtractedPage } from './model';

// Kept in the extension's isolated world. No page event bridge or network requests.
(globalThis as typeof globalThis & { __ideaClipExtract?: () => ExtractedPage }).__ideaClipExtract = () => extractFromDocument(document, location.href);
