// Imported first by main.tsx. Zod 4 compiles validators with new Function(), which our strict CSP
// (no unsafe-eval) blocks. Keep the CSP strict and turn the JIT off instead.
import { z } from "zod";

z.config({ jitless: true });
