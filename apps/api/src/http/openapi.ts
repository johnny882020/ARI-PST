// Loads the OpenAPI contract and compiles request/response validators from it. The contract is the single source of truth (C-10).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { Ajv2020, type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FieldIssue } from '@ari/domain';

type Json = any; // OpenAPI documents are dynamic

export function findOpenApiPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.OPENAPI_PATH, resolve(here, 'openapi.yaml'), resolve(here, '../openapi.yaml'),
    resolve(here, '../../../packages/contracts/openapi.yaml'), resolve(here, '../../../../packages/contracts/openapi.yaml'),
    resolve(process.cwd(), '../../packages/contracts/openapi.yaml'), resolve(process.cwd(), 'packages/contracts/openapi.yaml')];
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error('openapi.yaml not found');
}
export interface OperationInfo { operationId: string; method: string; path: string; fullPath: string; xRoles: string[] | 'public' | null; responses: Record<string, Json>; security: Json; op: Json }

export class Contract {
  readonly doc: Json;
  private ajv: Ajv2020;
  private cache = new Map<string, ValidateFunction>();
  readonly operations: OperationInfo[] = [];
  constructor(doc?: Json) {
    this.doc = doc ?? parse(readFileSync(findOpenApiPath(), 'utf8'));
    this.ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
    (addFormats as unknown as (a: Ajv2020) => void)(this.ajv);
    this.ajv.addFormat('uri-reference', true);
    this.ajv.addSchema({ ...this.doc, $id: 'urn:ari:openapi' });
    const base = '/api/v1';
    for (const [path, item] of Object.entries<Json>(this.doc.paths)) {
      const serverOverride = item.servers?.[0]?.url as string | undefined;
      for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = item[m]; if (!op) continue;
        const xr = op['x-roles'];
        this.operations.push({
          operationId: op.operationId, method: m.toUpperCase(), path, fullPath: (serverOverride ?? base) + path,
          xRoles: xr === 'public' ? 'public' : Array.isArray(xr) ? xr : null, responses: op.responses ?? {}, security: op.security ?? this.doc.security, op,
        });
      }
    }
  }
  private compile(ref: string): ValidateFunction {
    let v = this.cache.get(ref);
    if (!v) { const got = this.ajv.getSchema(`urn:ari:openapi#${ref}`); if (!got) throw new Error(`schema ${ref} missing`); v = got; this.cache.set(ref, v); }
    return v;
  }
  schema(name: string): ValidateFunction { return this.compile(`/components/schemas/${name}`); }
  /** Validate a JSON value against an inline schema object from the document (resolved through $ref). */
  validateAgainst(schema: Json, value: unknown): ErrorObject[] | null {
    const key = JSON.stringify(schema);
    let v = this.cache.get(key);
    if (!v) { v = this.ajv.compile({ ...schema, $defs: undefined, components: this.doc.components }); this.cache.set(key, v); }
    return v(value) ? null : (v.errors ?? []);
  }
  operation(id: string): OperationInfo | undefined { return this.operations.find((o) => o.operationId === id); }
  responseSchema(opId: string, status: number, mediaType = 'application/json'): Json | null {
    const op = this.operation(opId); if (!op) return null;
    let r = op.responses[String(status)]; if (!r) return null;
    if (r.$ref) r = this.doc.components.responses[r.$ref.split('/').pop() as string];
    return r?.content?.[mediaType]?.schema ?? null;
  }
  /** Validate a response body. Returns a list of schema paths that failed (no values). */
  validateResponse(opId: string, status: number, body: unknown, mediaType = 'application/json'): string[] | null {
    const s = this.responseSchema(opId, status, mediaType);
    if (!s) return null;
    const wrapped = { ...s, components: this.doc.components };
    const key = `${opId}:${status}:${mediaType}`;
    let v = this.cache.get(key);
    if (!v) {
      // Rewrite local refs to the loaded document.
      const rewritten = JSON.parse(JSON.stringify(wrapped).replaceAll('"$ref":"#/', '"$ref":"urn:ari:openapi#/'));
      delete rewritten.components;
      v = this.ajv.compile(rewritten); this.cache.set(key, v);
    }
    return v(body) ? [] : (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.keyword}`);
  }
}

/** Map Ajv errors to {field, rule}. Values are never included. */
export function toFieldIssues(errors: ErrorObject[]): FieldIssue[] {
  const out: FieldIssue[] = []; const seen = new Set<string>();
  for (const e of errors) {
    const path = e.instancePath.split('/').filter(Boolean).map((p) => p.replace(/^\d+$/, '[]')).join('.');
    let field = path; let rule = 'FORMAT';
    switch (e.keyword) {
      case 'required': field = [path, (e.params as { missingProperty: string }).missingProperty].filter(Boolean).join('.'); rule = 'REQUIRED'; break;
      case 'additionalProperties': field = [path, (e.params as { additionalProperty: string }).additionalProperty].filter(Boolean).join('.'); rule = 'UNKNOWN_FIELD'; break;
      case 'enum': case 'const': rule = 'VOCAB'; break;
      case 'minimum': case 'maximum': case 'minLength': case 'maxLength': case 'minItems': case 'maxItems': case 'exclusiveMinimum': rule = 'RANGE'; break;
      default: rule = 'FORMAT';
    }
    const k = `${field}:${rule}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ field: field || '$', rule });
  }
  return out.slice(0, 50);
}
