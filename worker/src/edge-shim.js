// Compatibilidade Node -> Edge Function do Supabase (Deno): process.env e Buffer antes de qualquer outro modulo
import { Buffer } from "node:buffer";
import process from "node:process";
if (!globalThis.process) globalThis.process = process;
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
